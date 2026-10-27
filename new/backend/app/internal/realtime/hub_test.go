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

func recv(t *testing.T, c *Client) map[string]any {
	t.Helper()
	select {
	case msg := <-c.Send:
		var m map[string]any
		if err := json.Unmarshal(msg, &m); err != nil {
			t.Fatal(err)
		}
		return m
	default:
		return nil
	}
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
