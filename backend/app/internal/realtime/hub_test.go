package realtime

import (
	"encoding/json"
	"io"
	"log/slog"
	"testing"

	"github.com/tyler71/owlchirp/app/internal/assert"
)

func newTestHub() *Hub {
	return NewHub(nil, 0, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

type envelope struct {
	Type string         `json:"type"`
	Data map[string]any `json:"data"`
}

func recvEnvelope(t *testing.T, c *Client) *envelope {
	t.Helper()
	select {
	case msg := <-c.Send:
		var e envelope
		if err := json.Unmarshal(msg, &e); err != nil {
			t.Fatal(err)
		}
		return &e
	default:
		return nil
	}
}

// recv returns the data of the next metrics message, or nil if none is queued.
func recv(t *testing.T, c *Client) map[string]any {
	t.Helper()
	e := recvEnvelope(t, c)
	if e == nil {
		return nil
	}
	assert.Equal(t, e.Type, "metrics")
	return e.Data
}

func TestPublishSendsOnlyChangedKeys(t *testing.T) {
	h := newTestHub()
	c := h.Subscribe()

	h.publish(map[string]any{"queue_count": 1, "available_count": 2})
	assert.Equal(t, len(recv(t, c)), 2)

	h.publish(map[string]any{"queue_count": 1, "available_count": 3})
	m := recv(t, c)
	assert.Equal(t, len(m), 1)
	assert.Equal(t, m["available_count"], any(float64(3)))

	h.publish(map[string]any{"queue_count": 1, "available_count": 3})
	assert.True(t, recv(t, c) == nil)
}

func TestSubscribeReceivesSnapshot(t *testing.T) {
	h := newTestHub()
	first := h.Subscribe()
	h.publish(map[string]any{"queue_count": 4, "handled_incoming": 10})
	recv(t, first)

	second := h.Subscribe()
	m := recv(t, second)
	assert.Equal(t, m["queue_count"], any(float64(4)))
	assert.Equal(t, m["handled_incoming"], any(float64(10)))
}

func TestSlowClientIsDropped(t *testing.T) {
	h := newTestHub()
	c := h.Subscribe()

	for i := 0; i <= clientBuffer; i++ {
		h.publish(map[string]any{"queue_count": i})
	}

	select {
	case <-c.Dropped:
	default:
		t.Fatal("expected slow client to be dropped")
	}
	assert.Equal(t, h.clientCount(), 0)
}

func TestBroadcastReachesAllClients(t *testing.T) {
	h := newTestHub()
	a, b := h.Subscribe(), h.Subscribe()

	msg, err := Message("wrapup.saved", map[string]any{"contactId": "c-1"})
	assert.Nil(t, err)
	h.Broadcast(msg)

	for _, c := range []*Client{a, b} {
		e := recvEnvelope(t, c)
		assert.True(t, e != nil)
		assert.Equal(t, e.Type, "wrapup.saved")
		assert.Equal(t, e.Data["contactId"], any("c-1"))
	}
}
