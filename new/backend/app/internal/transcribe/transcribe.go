// Package transcribe turns an Amazon Connect call's live audio into text.
// It reads the contact's Kinesis Video Stream with GetMedia, splits the MKV
// in memory, and streams the caller's audio track to Amazon Transcribe. The
// agent's side of the call is ignored. Nothing is written to disk or the database; text is
// handed to the caller as it arrives.
package transcribe

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/kinesisvideo"
	kvtypes "github.com/aws/aws-sdk-go-v2/service/kinesisvideo/types"
	"github.com/aws/aws-sdk-go-v2/service/kinesisvideomedia"
	kvmtypes "github.com/aws/aws-sdk-go-v2/service/kinesisvideomedia/types"
	"github.com/aws/aws-sdk-go-v2/service/transcribestreaming"
	tstypes "github.com/aws/aws-sdk-go-v2/service/transcribestreaming/types"
)

// Amazon Connect streams 16-bit little-endian mono PCM at 8 kHz.
const sampleRate = 8000

// chunkBytes is how much audio is batched into one Transcribe event
// (100 ms); AWS recommends 50-200 ms chunks.
const chunkBytes = sampleRate * 2 / 10

// SpeakerCaller labels segments from the caller's audio, the only track
// transcribed.
const SpeakerCaller = "caller"

// ErrContactChanged means the stream moved on to another contact. Connect
// reuses an agent's stream between calls.
var ErrContactChanged = errors.New("stream moved to another contact")

// Segment is a piece of transcript. Partial segments are replaced by later
// ones with the same ID until one arrives with Partial false.
type Segment struct {
	ContactID string  `json:"contactId"`
	ID        string  `json:"id"`
	Speaker   string  `json:"speaker"`
	Text      string  `json:"text"`
	Partial   bool    `json:"partial"`
	Start     float64 `json:"start"` // seconds since transcription started
}

// Service holds the AWS clients. It's safe for concurrent use.
type Service struct {
	cfg      aws.Config
	kvs      *kinesisvideo.Client
	ts       *transcribestreaming.Client
	language tstypes.LanguageCode
}

// New creates a Service from an AWS config. language is a Transcribe
// streaming language code such as "en-US".
func New(cfg aws.Config, language string) *Service {
	if language == "" {
		language = "en-US"
	}
	return &Service{
		cfg:      cfg,
		kvs:      kinesisvideo.NewFromConfig(cfg),
		ts:       transcribestreaming.NewFromConfig(cfg),
		language: tstypes.LanguageCode(language),
	}
}

// Run transcribes contactID's audio from streamARN, starting from now, and
// calls emit for every segment. emit is called from multiple goroutines
// but never concurrently. Run returns when ctx is cancelled (nil), the
// stream ends (nil), the stream moves to another contact
// (ErrContactChanged), or on an AWS error.
func (s *Service) Run(ctx context.Context, contactID, streamARN string, emit func(Segment)) error {
	media, err := s.openMedia(ctx, streamARN)
	if err != nil {
		return err
	}
	defer media.Close()

	g, ctx := newGroup(ctx)
	defer g.cancel()

	out := make(chan Segment, 32)
	tracks := map[string]chan []byte{
		TrackFromCustomer: make(chan []byte, 64),
	}
	speakers := map[string]string{TrackFromCustomer: SpeakerCaller}

	var transcribers sync.WaitGroup
	for track, ch := range tracks {
		transcribers.Add(1)
		g.Go(func() error {
			defer transcribers.Done()
			return s.transcribe(ctx, contactID, speakers[track], ch, out)
		})
	}
	go func() {
		transcribers.Wait()
		close(out)
	}()

	g.Go(func() error {
		defer func() {
			for _, ch := range tracks {
				close(ch)
			}
		}()
		return demux(ctx, media, contactID, tracks)
	})

	g.Go(func() error {
		for seg := range out {
			emit(seg)
		}
		return nil
	})

	// Closing the body unblocks the demuxer if a transcriber fails first.
	go func() {
		<-ctx.Done()
		media.Close()
	}()

	err = g.Wait()
	if errors.Is(err, context.Canceled) {
		return nil
	}
	return err
}

func (s *Service) openMedia(ctx context.Context, streamARN string) (io.ReadCloser, error) {
	ep, err := s.kvs.GetDataEndpoint(ctx, &kinesisvideo.GetDataEndpointInput{
		APIName:   kvtypes.APINameGetMedia,
		StreamARN: aws.String(streamARN),
	})
	if err != nil {
		return nil, fmt.Errorf("kvs get data endpoint: %w", err)
	}
	client := kinesisvideomedia.NewFromConfig(s.cfg, func(o *kinesisvideomedia.Options) {
		o.BaseEndpoint = ep.DataEndpoint
	})
	out, err := client.GetMedia(ctx, &kinesisvideomedia.GetMediaInput{
		StreamARN:     aws.String(streamARN),
		StartSelector: &kvmtypes.StartSelector{StartSelectorType: kvmtypes.StartSelectorTypeNow},
	})
	if err != nil {
		return nil, fmt.Errorf("kvs get media: %w", err)
	}
	return out.Payload, nil
}

// demux reads frames until EOF and sends each track's audio, in chunks of
// about chunkBytes, to its channel.
func demux(ctx context.Context, r io.Reader, contactID string, tracks map[string]chan []byte) error {
	mkv := newMKVReader(r)
	pending := map[string][]byte{}

	flush := func(track string) error {
		if len(pending[track]) == 0 {
			return nil
		}
		select {
		case tracks[track] <- pending[track]:
		case <-ctx.Done():
			return ctx.Err()
		}
		pending[track] = nil
		return nil
	}

	for {
		f, err := mkv.Next()
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				for track := range tracks {
					if err := flush(track); err != nil {
						return err
					}
				}
				return nil
			}
			return err
		}
		if id := mkv.ContactID(); id != "" && !strings.EqualFold(id, contactID) {
			return ErrContactChanged
		}
		if _, ok := tracks[f.Track]; !ok {
			continue
		}
		pending[f.Track] = append(pending[f.Track], f.Data...)
		if len(pending[f.Track]) >= chunkBytes {
			if err := flush(f.Track); err != nil {
				return err
			}
		}
	}
}

// transcribe streams one track's audio to Transcribe and forwards results
// until audio ends.
func (s *Service) transcribe(ctx context.Context, contactID, speaker string, audio <-chan []byte, out chan<- Segment) error {
	resp, err := s.ts.StartStreamTranscription(ctx, &transcribestreaming.StartStreamTranscriptionInput{
		LanguageCode:                      s.language,
		MediaEncoding:                     tstypes.MediaEncodingPcm,
		MediaSampleRateHertz:              aws.Int32(sampleRate),
		EnablePartialResultsStabilization: true,
		PartialResultsStability:           tstypes.PartialResultsStabilityMedium,
	})
	if err != nil {
		// Drain so the demuxer isn't blocked on this track.
		go func() {
			for range audio {
			}
		}()
		return fmt.Errorf("transcribe start (%s): %w", speaker, err)
	}
	stream := resp.GetStream()
	defer stream.Close()

	sendErr := make(chan error, 1)
	go func() {
		defer stream.Writer.Close()
		for chunk := range audio {
			ev := &tstypes.AudioStreamMemberAudioEvent{Value: tstypes.AudioEvent{AudioChunk: chunk}}
			if err := stream.Writer.Send(ctx, ev); err != nil {
				for range audio {
				}
				sendErr <- fmt.Errorf("transcribe send (%s): %w", speaker, err)
				return
			}
		}
		sendErr <- nil
	}()

	for ev := range stream.Reader.Events() {
		te, ok := ev.(*tstypes.TranscriptResultStreamMemberTranscriptEvent)
		if !ok || te.Value.Transcript == nil {
			continue
		}
		for _, r := range te.Value.Transcript.Results {
			if len(r.Alternatives) == 0 {
				continue
			}
			text := strings.TrimSpace(aws.ToString(r.Alternatives[0].Transcript))
			if text == "" {
				continue
			}
			seg := Segment{
				ContactID: contactID,
				ID:        speaker + ":" + aws.ToString(r.ResultId),
				Speaker:   speaker,
				Text:      text,
				Partial:   r.IsPartial,
				Start:     r.StartTime,
			}
			select {
			case out <- seg:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}

	if err := stream.Err(); err != nil && ctx.Err() == nil {
		return fmt.Errorf("transcribe (%s): %w", speaker, err)
	}
	select {
	case err := <-sendErr:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

// group runs goroutines, cancels the shared context on the first error and
// returns that error from Wait.
type group struct {
	wg     sync.WaitGroup
	cancel context.CancelFunc
	once   sync.Once
	err    error
}

func newGroup(ctx context.Context) (*group, context.Context) {
	ctx, cancel := context.WithCancel(ctx)
	return &group{cancel: cancel}, ctx
}

func (g *group) Go(f func() error) {
	g.wg.Add(1)
	go func() {
		defer g.wg.Done()
		if err := f(); err != nil {
			g.once.Do(func() {
				g.err = err
				g.cancel()
			})
		}
	}()
}

func (g *group) Wait() error {
	g.wg.Wait()
	g.cancel()
	return g.err
}
