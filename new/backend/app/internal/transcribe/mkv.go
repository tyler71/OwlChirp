package transcribe

import (
	"bufio"
	"errors"
	"fmt"
	"io"
)

// Matroska element IDs read from Amazon Connect's KVS stream. GetMedia
// returns a sequence of MKV fragments, each an EBML header followed by an
// unknown-size Segment with Tracks, Tags and a Cluster of SimpleBlocks.
const (
	idEBML        = 0x1A45DFA3
	idSegment     = 0x18538067
	idTracks      = 0x1654AE6B
	idTrackEntry  = 0xAE
	idTrackNumber = 0xD7
	idTrackName   = 0x536E
	idTags        = 0x1254C367
	idTag         = 0x7373
	idSimpleTag   = 0x67C8
	idTagName     = 0x45A3
	idTagString   = 0x4487
	idCluster     = 0x1F43B675
	idBlockGroup  = 0xA0
	idBlock       = 0xA1
	idSimpleBlock = 0xA3
)

// Track names Amazon Connect gives the two audio tracks.
const (
	TrackFromCustomer = "AUDIO_FROM_CUSTOMER"
	TrackToCustomer   = "AUDIO_TO_CUSTOMER"
)

// Tag Amazon Connect writes on every fragment with the contact being streamed.
const contactIDTag = "ContactId"

// maxElementSize caps the elements read into memory; larger ones are
// skipped. Connect's audio blocks are a few KiB.
const maxElementSize = 1 << 20

const unknownSize = -1

// Frame is one block of raw audio from a named track.
type Frame struct {
	Track string
	Data  []byte
}

// mkvReader walks an MKV byte stream without buffering it. Master
// elements are entered rather than read whole, so unknown-size Segments and
// Clusters stream through; only the elements it needs are kept.
type mkvReader struct {
	r *bufio.Reader

	tracks map[uint64]string

	entryNumber uint64
	entryName   string

	tagName   string
	contactID string
}

func newMKVReader(r io.Reader) *mkvReader {
	return &mkvReader{r: bufio.NewReaderSize(r, 64<<10), tracks: map[uint64]string{}}
}

// ContactID returns the most recent ContactId tag seen, or "".
func (m *mkvReader) ContactID() string { return m.contactID }

// Next returns the next audio frame. It returns io.EOF at the end of the
// stream.
func (m *mkvReader) Next() (Frame, error) {
	for {
		id, size, err := m.header()
		if err != nil {
			return Frame{}, err
		}

		switch id {
		case idSegment, idTracks, idTags, idTag, idCluster, idBlockGroup:
			continue // enter
		case idTrackEntry:
			m.entryNumber, m.entryName = 0, ""
			continue
		case idSimpleTag:
			m.tagName = ""
			continue
		}

		if size == unknownSize {
			return Frame{}, fmt.Errorf("mkv: unknown size for element %#x", id)
		}

		switch id {
		case idTrackNumber:
			b, err := m.read(size)
			if err != nil {
				return Frame{}, err
			}
			m.entryNumber = uintBE(b)
			m.addTrack()
		case idTrackName:
			b, err := m.read(size)
			if err != nil {
				return Frame{}, err
			}
			m.entryName = trimNul(b)
			m.addTrack()
		case idTagName:
			b, err := m.read(size)
			if err != nil {
				return Frame{}, err
			}
			m.tagName = trimNul(b)
		case idTagString:
			b, err := m.read(size)
			if err != nil {
				return Frame{}, err
			}
			if m.tagName == contactIDTag {
				m.contactID = trimNul(b)
			}
		case idSimpleBlock, idBlock:
			if size > maxElementSize {
				if err := m.skip(size); err != nil {
					return Frame{}, err
				}
				continue
			}
			b, err := m.read(size)
			if err != nil {
				return Frame{}, err
			}
			if f, ok := m.block(b); ok {
				return f, nil
			}
		default:
			if err := m.skip(size); err != nil {
				return Frame{}, err
			}
		}
	}
}

func (m *mkvReader) addTrack() {
	if m.entryNumber != 0 && m.entryName != "" {
		m.tracks[m.entryNumber] = m.entryName
	}
}

// block parses a (Simple)Block: track vint, 16-bit timecode, flags, frame.
// Laced blocks are skipped; Connect doesn't use lacing.
func (m *mkvReader) block(b []byte) (Frame, bool) {
	track, n, ok := vint(b, true)
	if !ok || len(b) < n+3 {
		return Frame{}, false
	}
	flags := b[n+2]
	if flags&0x06 != 0 {
		return Frame{}, false
	}
	name, ok := m.tracks[track]
	if !ok {
		return Frame{}, false
	}
	return Frame{Track: name, Data: b[n+3:]}, true
}

// header reads an element ID (marker bits kept) and data size.
func (m *mkvReader) header() (uint64, int64, error) {
	first, err := m.r.ReadByte()
	if err != nil {
		return 0, 0, err
	}
	n := vintLen(first)
	if n == 0 || n > 4 {
		return 0, 0, fmt.Errorf("mkv: invalid element id byte %#x", first)
	}
	id := uint64(first)
	for range n - 1 {
		c, err := m.r.ReadByte()
		if err != nil {
			return 0, 0, unexpected(err)
		}
		id = id<<8 | uint64(c)
	}

	first, err = m.r.ReadByte()
	if err != nil {
		return 0, 0, unexpected(err)
	}
	n = vintLen(first)
	if n == 0 {
		return 0, 0, fmt.Errorf("mkv: invalid size byte %#x", first)
	}
	buf := []byte{first}
	for range n - 1 {
		c, err := m.r.ReadByte()
		if err != nil {
			return 0, 0, unexpected(err)
		}
		buf = append(buf, c)
	}
	size, _, _ := vint(buf, true)
	if size == (uint64(1)<<(7*n))-1 {
		return id, unknownSize, nil
	}
	if size > 1<<40 {
		return 0, 0, errors.New("mkv: element too large")
	}
	return id, int64(size), nil
}

func (m *mkvReader) read(size int64) ([]byte, error) {
	if size > maxElementSize {
		return nil, fmt.Errorf("mkv: element of %d bytes is too large", size)
	}
	b := make([]byte, size)
	if _, err := io.ReadFull(m.r, b); err != nil {
		return nil, unexpected(err)
	}
	return b, nil
}

func (m *mkvReader) skip(size int64) error {
	_, err := m.r.Discard(int(size))
	return unexpected(err)
}

// vintLen is the encoded length of an EBML variable-size integer, from the
// position of the first set bit; 0 if invalid.
func vintLen(first byte) int {
	for i := range 8 {
		if first&(0x80>>i) != 0 {
			return i + 1
		}
	}
	return 0
}

// vint decodes the variable-size integer at the start of b, optionally
// clearing its length marker. It returns the value and bytes consumed.
func vint(b []byte, stripMarker bool) (uint64, int, bool) {
	if len(b) == 0 {
		return 0, 0, false
	}
	n := vintLen(b[0])
	if n == 0 || len(b) < n {
		return 0, 0, false
	}
	v := uint64(b[0])
	if stripMarker {
		v &^= 0x80 >> (n - 1)
	}
	for i := 1; i < n; i++ {
		v = v<<8 | uint64(b[i])
	}
	return v, n, true
}

func uintBE(b []byte) uint64 {
	var v uint64
	for _, c := range b {
		v = v<<8 | uint64(c)
	}
	return v
}

func trimNul(b []byte) string {
	for len(b) > 0 && b[len(b)-1] == 0 {
		b = b[:len(b)-1]
	}
	return string(b)
}

func unexpected(err error) error {
	if errors.Is(err, io.EOF) {
		return io.ErrUnexpectedEOF
	}
	return err
}
