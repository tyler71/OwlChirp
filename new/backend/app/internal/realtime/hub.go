// Package realtime fans out metric changes to connected WebSocket clients.
//
// A single poller fetches the metric snapshot once per interval (only while
// clients are connected) and broadcasts only the keys whose values changed.
package realtime

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"
)

const clientBuffer = 16

type Source func(ctx context.Context) (map[string]any, error)

type Client struct {
	Send chan []byte
	// Dropped is closed if the client could not keep up and was removed.
	Dropped chan struct{}
}

type Hub struct {
	source   Source
	interval time.Duration
	logger   *slog.Logger

	mu      sync.Mutex
	clients map[*Client]struct{}
	last    map[string]json.RawMessage
}

func NewHub(source Source, interval time.Duration, logger *slog.Logger) *Hub {
	return &Hub{
		source:   source,
		interval: interval,
		logger:   logger,
		clients:  make(map[*Client]struct{}),
	}
}

// Subscribe registers a client. The latest known snapshot is queued
// immediately so new clients don't wait for the next change.
func (h *Hub) Subscribe() *Client {
	c := &Client{Send: make(chan []byte, clientBuffer), Dropped: make(chan struct{})}

	h.mu.Lock()
	defer h.mu.Unlock()

	h.clients[c] = struct{}{}
	if len(h.last) > 0 {
		if msg, err := json.Marshal(h.last); err == nil {
			c.Send <- msg
		}
	}
	return c
}

func (h *Hub) Unsubscribe(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	delete(h.clients, c)
	if len(h.clients) == 0 {
		// Nobody is listening; the next subscriber should get a fresh snapshot.
		h.last = nil
	}
}

func (h *Hub) clientCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}

// Run polls the source until ctx is cancelled.
func (h *Hub) Run(ctx context.Context) {
	ticker := time.NewTicker(h.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if h.clientCount() == 0 {
				continue
			}
			h.poll(ctx)
		}
	}
}

func (h *Hub) poll(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	snapshot, err := h.source(ctx)
	if err != nil {
		h.logger.Error("realtime: fetch metrics", "error", err)
		return
	}

	h.publish(snapshot)
}

// publish diffs snapshot against the last broadcast and sends changed keys.
func (h *Hub) publish(snapshot map[string]any) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.last == nil {
		h.last = make(map[string]json.RawMessage, len(snapshot))
	}

	changed := make(map[string]json.RawMessage)
	for key, value := range snapshot {
		encoded, err := json.Marshal(value)
		if err != nil {
			h.logger.Error("realtime: encode metric", "key", key, "error", err)
			continue
		}
		if prev, ok := h.last[key]; ok && bytes.Equal(prev, encoded) {
			continue
		}
		h.last[key] = encoded
		changed[key] = encoded
	}

	if len(changed) == 0 {
		return
	}

	msg, err := json.Marshal(changed)
	if err != nil {
		h.logger.Error("realtime: encode message", "error", err)
		return
	}

	for c := range h.clients {
		select {
		case c.Send <- msg:
		default:
			// Slow client: drop it rather than block everyone else.
			delete(h.clients, c)
			close(c.Dropped)
		}
	}
}
