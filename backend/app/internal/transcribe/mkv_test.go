package transcribe

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"
)

// el encodes an EBML element with a known size.
func el(id uint64, body ...[]byte) []byte {
	data := bytes.Join(body, nil)
	return append(append(idBytes(id), sizeBytes(len(data))...), data...)
}

// elUnknown encodes a master element with the unknown-size marker, as KVS
// writes Segments and Clusters.
func elUnknown(id uint64, body ...[]byte) []byte {
	return append(append(idBytes(id), 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF), bytes.Join(body, nil)...)
}

func idBytes(id uint64) []byte {
	var b []byte
	for id > 0 {
		b = append([]byte{byte(id)}, b...)
		id >>= 8
	}
	return b
}

// sizeBytes encodes n as an 8-byte EBML size, like most muxers do.
func sizeBytes(n int) []byte {
	b := make([]byte, 8)
	v := uint64(n)
	for i := 7; i >= 1; i-- {
		b[i] = byte(v)
		v >>= 8
	}
	b[0] = 0x01
	return b
}

func str(id uint64, s string) []byte  { return el(id, []byte(s)) }
func uintEl(id uint64, v byte) []byte { return el(id, []byte{v}) }

func simpleBlock(track byte, data ...byte) []byte {
	return el(idSimpleBlock, []byte{0x80 | track, 0, 0, 0x80}, data)
}

func fragment(contactID string, blocks ...[]byte) []byte {
	return append(
		el(idEBML, str(0x4282, "matroska")),
		elUnknown(idSegment,
			el(idTracks,
				el(idTrackEntry, uintEl(idTrackNumber, 1), str(idTrackName, TrackFromCustomer)),
				el(idTrackEntry, uintEl(idTrackNumber, 2), str(idTrackName, TrackToCustomer)),
			),
			el(idTags, el(idTag, el(idSimpleTag, str(idTagName, contactIDTag), str(idTagString, contactID)))),
			elUnknown(idCluster, append(el(0xE7, []byte{0}), bytes.Join(blocks, nil)...)),
		)...,
	)
}

func TestMKVReaderFrames(t *testing.T) {
	stream := append(
		fragment("abc", simpleBlock(1, 1, 2), simpleBlock(2, 3, 4)),
		fragment("abc", simpleBlock(1, 5, 6))...,
	)
	r := newMKVReader(bytes.NewReader(stream))

	want := []Frame{
		{TrackFromCustomer, []byte{1, 2}},
		{TrackToCustomer, []byte{3, 4}},
		{TrackFromCustomer, []byte{5, 6}},
	}
	for i, w := range want {
		f, err := r.Next()
		if err != nil {
			t.Fatalf("frame %d: %v", i, err)
		}
		if f.Track != w.Track || !bytes.Equal(f.Data, w.Data) {
			t.Fatalf("frame %d = %v, want %v", i, f, w)
		}
	}
	if r.ContactID() != "abc" {
		t.Fatalf("contact id = %q", r.ContactID())
	}
	if _, err := r.Next(); !errors.Is(err, io.EOF) {
		t.Fatalf("end = %v, want EOF", err)
	}
}

func TestMKVReaderSkipsUnknownTrack(t *testing.T) {
	r := newMKVReader(bytes.NewReader(fragment("abc", simpleBlock(9, 1), simpleBlock(2, 7))))
	f, err := r.Next()
	if err != nil || f.Track != TrackToCustomer || !bytes.Equal(f.Data, []byte{7}) {
		t.Fatalf("got %v, %v", f, err)
	}
}

func TestDemuxStopsOnContactChange(t *testing.T) {
	audio := bytes.Repeat([]byte{1}, chunkBytes)
	stream := append(
		fragment("abc", simpleBlock(1, audio...)),
		fragment("other", simpleBlock(1, audio...))...,
	)
	tracks := map[string]chan []byte{
		TrackFromCustomer: make(chan []byte, 8),
		TrackToCustomer:   make(chan []byte, 8),
	}
	err := demux(context.Background(), bytes.NewReader(stream), "ABC", tracks)
	if !errors.Is(err, ErrContactChanged) {
		t.Fatalf("err = %v, want ErrContactChanged", err)
	}
	if n := len(tracks[TrackFromCustomer]); n != 1 {
		t.Fatalf("caller chunks = %d, want 1", n)
	}
}

func TestDemuxFlushesAtEOF(t *testing.T) {
	tracks := map[string]chan []byte{
		TrackFromCustomer: make(chan []byte, 8),
		TrackToCustomer:   make(chan []byte, 8),
	}
	stream := fragment("abc", simpleBlock(1, 1, 2), simpleBlock(1, 3))
	if err := demux(context.Background(), bytes.NewReader(stream), "abc", tracks); err != nil {
		t.Fatal(err)
	}
	got := <-tracks[TrackFromCustomer]
	if !bytes.Equal(got, []byte{1, 2, 3}) {
		t.Fatalf("flushed %v", got)
	}
}

func TestDemuxIgnoresAgentAudio(t *testing.T) {
	tracks := map[string]chan []byte{TrackFromCustomer: make(chan []byte, 8)}
	stream := fragment("abc", simpleBlock(2, 9, 9), simpleBlock(1, 1), simpleBlock(2, 9))
	if err := demux(context.Background(), bytes.NewReader(stream), "abc", tracks); err != nil {
		t.Fatal(err)
	}
	if got := <-tracks[TrackFromCustomer]; !bytes.Equal(got, []byte{1}) {
		t.Fatalf("caller audio %v", got)
	}
}
