package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/tyler71/owlchirp/app/internal/assert"
	"github.com/tyler71/owlchirp/app/internal/features"
)

type videoClient struct {
	t    *testing.T
	conn *websocket.Conn
	in   chan voiceIn
}

type videoCtl struct {
	Type string
	Data struct {
		Sharer *string
	}
}

func dialVideo(t *testing.T, srv *httptest.Server, token string) *videoClient {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/api/video", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.CloseNow() })
	c := &videoClient{t: t, conn: conn, in: make(chan voiceIn, 64)}
	go func() {
		for {
			typ, data, err := conn.Read(context.Background())
			c.in <- voiceIn{typ, data, err}
			if err != nil {
				return
			}
		}
	}()
	c.text(map[string]any{"type": "auth", "token": token})
	return c
}

func (c *videoClient) text(v any) {
	c.t.Helper()
	msg, _ := json.Marshal(v)
	if err := c.conn.Write(context.Background(), websocket.MessageText, msg); err != nil {
		c.t.Fatal(err)
	}
}

func (c *videoClient) frame(b []byte) {
	c.t.Helper()
	if err := c.conn.Write(context.Background(), websocket.MessageBinary, b); err != nil {
		c.t.Fatal(err)
	}
}

// nextCtl returns the next control message of type typ within wait,
// skipping others.
func (c *videoClient) nextCtl(typ string, wait time.Duration) (videoCtl, bool) {
	c.t.Helper()
	deadline := time.Now().Add(wait)
	for {
		var m voiceIn
		select {
		case m = <-c.in:
		case <-time.After(time.Until(deadline)):
			return videoCtl{}, false
		}
		if m.err != nil {
			return videoCtl{}, false
		}
		if m.typ != websocket.MessageText {
			continue
		}
		var msg videoCtl
		if json.Unmarshal(m.data, &msg) == nil && msg.Type == typ {
			return msg, true
		}
	}
}

// nextFrame returns the next binary frame within wait, skipping control
// messages.
func (c *videoClient) nextFrame(wait time.Duration) ([]byte, bool) {
	deadline := time.Now().Add(wait)
	for {
		select {
		case m := <-c.in:
			if m.err != nil {
				return nil, false
			}
			if m.typ == websocket.MessageBinary {
				return m.data, true
			}
		case <-time.After(time.Until(deadline)):
			return nil, false
		}
	}
}

func sharerOf(m videoCtl) string {
	if m.Data.Sharer == nil {
		return ""
	}
	return *m.Data.Sharer
}

func TestVideoRejects(t *testing.T) {
	srv := newTestServer(t)
	bad := dialVideo(t, srv, "not-a-token")
	_, ok := bad.nextCtl("hello", time.Second)
	assert.False(t, ok)
	denied := dialVideo(t, srv, tokenFor(standardUser))
	_, ok = denied.nextCtl("hello", time.Second)
	assert.False(t, ok)
}

func TestVideoShare(t *testing.T) {
	srv := newTestServer(t)
	admin := dial(t, srv, validToken())
	reply := admin.call("users.setFeatures", map[string]any{"username": standardUser.Username, "features": []string{features.Map}})
	assert.Equal(t, reply.Type, "result")

	a := dialVideo(t, srv, validToken())
	hello, ok := a.nextCtl("hello", time.Second)
	assert.True(t, ok)
	assert.Equal(t, sharerOf(hello), "")
	b := dialVideo(t, srv, tokenFor(standardUser))
	_, ok = b.nextCtl("hello", time.Second)
	assert.True(t, ok)

	// A shares; both hear about it.
	a.text(map[string]any{"type": "start"})
	st, ok := a.nextCtl("state", time.Second)
	assert.True(t, ok)
	assert.Equal(t, sharerOf(st), testAgent.Username)
	st, ok = b.nextCtl("state", time.Second)
	assert.True(t, ok)
	assert.Equal(t, sharerOf(st), testAgent.Username)

	// Only one at a time.
	b.text(map[string]any{"type": "start"})
	busy, ok := b.nextCtl("busy", time.Second)
	assert.True(t, ok)
	assert.Equal(t, sharerOf(busy), testAgent.Username)

	// Not watching: nothing arrives.
	key := []byte{videoFlagKey, 9, 9}
	delta := []byte{0, 7, 7}
	a.frame(key)
	_, ok = b.nextFrame(200 * time.Millisecond)
	assert.False(t, ok)

	// Watching: the sharer is asked for a keyframe, and deltas wait for it.
	b.text(map[string]any{"type": "watch", "on": true})
	_, ok = a.nextCtl("keyframe", time.Second)
	assert.True(t, ok)
	a.frame(delta)
	_, ok = b.nextFrame(200 * time.Millisecond)
	assert.False(t, ok)
	a.frame(key)
	got, ok := b.nextFrame(time.Second)
	assert.True(t, ok)
	assert.True(t, bytes.Equal(got, key))
	a.frame(delta)
	got, ok = b.nextFrame(time.Second)
	assert.True(t, ok)
	assert.True(t, bytes.Equal(got, delta))

	// A non-sharer's frames and stop are ignored.
	b.frame(key)
	_, ok = a.nextFrame(200 * time.Millisecond)
	assert.False(t, ok)
	b.text(map[string]any{"type": "stop"})
	_, ok = a.nextCtl("state", 200*time.Millisecond)
	assert.False(t, ok)

	// The sharer leaving frees the slot.
	a.conn.Close(websocket.StatusNormalClosure, "")
	st, ok = b.nextCtl("state", time.Second)
	assert.True(t, ok)
	assert.Equal(t, sharerOf(st), "")
	b.text(map[string]any{"type": "start"})
	st, ok = b.nextCtl("state", time.Second)
	assert.True(t, ok)
	assert.Equal(t, sharerOf(st), standardUser.Username)
}
