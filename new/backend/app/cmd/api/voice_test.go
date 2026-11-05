package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/tyler71/owlchirp/app/internal/assert"
	"github.com/tyler71/owlchirp/app/internal/features"
)

type voiceClient struct {
	t     *testing.T
	conn  *websocket.Conn
	id    uint16
	peers []voicePeer
	in    chan voiceIn
}

type voiceIn struct {
	typ  websocket.MessageType
	data []byte
	err  error
}

// dialVoice connects and authenticates. Reads run in the background, since a
// read that times out would close the connection.
func dialVoice(t *testing.T, srv *httptest.Server, token string) *voiceClient {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/api/voice", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.CloseNow() })
	c := &voiceClient{t: t, conn: conn, in: make(chan voiceIn, 64)}
	go func() {
		for {
			typ, data, err := conn.Read(context.Background())
			c.in <- voiceIn{typ, data, err}
			if err != nil {
				return
			}
		}
	}()
	c.text(map[string]string{"type": "auth", "token": token})
	return c
}

func (c *voiceClient) text(v any) {
	c.t.Helper()
	msg, _ := json.Marshal(v)
	if err := c.conn.Write(context.Background(), websocket.MessageText, msg); err != nil {
		c.t.Fatal(err)
	}
}

func (c *voiceClient) audio(frame []byte) {
	c.t.Helper()
	if err := c.conn.Write(context.Background(), websocket.MessageBinary, frame); err != nil {
		c.t.Fatal(err)
	}
}

// next returns the next message within wait; ok is false if none came.
func (c *voiceClient) next(wait time.Duration) (voiceIn, bool) {
	select {
	case m := <-c.in:
		return m, true
	case <-time.After(wait):
		return voiceIn{}, false
	}
}

// closeStatus waits for the connection to close and returns why.
func (c *voiceClient) closeStatus() websocket.StatusCode {
	c.t.Helper()
	for {
		m, ok := c.next(2 * time.Second)
		if !ok {
			c.t.Fatal("connection not closed")
		}
		if m.err != nil {
			return websocket.CloseStatus(m.err)
		}
	}
}

// hello waits for the server's greeting.
func (c *voiceClient) hello() {
	c.t.Helper()
	m, ok := c.next(time.Second)
	assert.True(c.t, ok)
	assert.Nil(c.t, m.err)
	assert.Equal(c.t, m.typ, websocket.MessageText)
	var msg struct {
		Type string
		Data struct {
			ID    uint16
			Peers []voicePeer
		}
	}
	assert.Nil(c.t, json.Unmarshal(m.data, &msg))
	assert.Equal(c.t, msg.Type, "hello")
	c.id, c.peers = msg.Data.ID, msg.Data.Peers
}

// nextAudio returns the next audio frame within wait, skipping control
// messages; ok is false if none came.
func (c *voiceClient) nextAudio(wait time.Duration) (speaker uint16, frame []byte, ok bool) {
	c.t.Helper()
	deadline := time.Now().Add(wait)
	for {
		m, ok := c.next(time.Until(deadline))
		if !ok || m.err != nil {
			return 0, nil, false
		}
		if m.typ == websocket.MessageBinary {
			return binary.BigEndian.Uint16(m.data), m.data[2:], true
		}
	}
}

func TestVoiceRejects(t *testing.T) {
	srv := newTestServer(t)

	bad := dialVoice(t, srv, "not-a-token")
	assert.Equal(t, bad.closeStatus(), wsStatusUnauthorized)

	// standardUser has no features, so no Map.
	denied := dialVoice(t, srv, tokenFor(standardUser))
	assert.Equal(t, denied.closeStatus(), wsStatusForbidden)
}

func TestVoiceRelay(t *testing.T) {
	srv := newTestServer(t)
	admin := dial(t, srv, validToken())
	reply := admin.call("users.setFeatures", map[string]any{"username": standardUser.Username, "features": []string{features.Map}})
	assert.Equal(t, reply.Type, "result")
	other := dial(t, srv, tokenFor(standardUser))
	other.call("map.state", nil) // joined the map

	place := func(c *testClient, x, y float64) {
		t.Helper()
		time.Sleep(mapMoveInterval)
		reply := c.call("map.move", map[string]any{"x": x, "y": y, "dir": "down"})
		assert.Equal(t, string(reply.Data), `{"accepted":true}`)
	}
	place(admin, 100, 100)
	place(other, 100+5*16, 100) // 5 tiles away

	speaker := dialVoice(t, srv, validToken())
	speaker.hello()
	listener := dialVoice(t, srv, tokenFor(standardUser))
	listener.hello()
	assert.Equal(t, len(listener.peers), 1)
	assert.Equal(t, listener.peers[0].Username, testAgent.Username)

	frame := []byte{1, 2, 3, 4}
	speaker.audio(frame)
	id, got, ok := listener.nextAudio(time.Second)
	assert.True(t, ok)
	assert.Equal(t, id, speaker.id)
	assert.True(t, bytes.Equal(got, frame))

	// Out of range: nothing arrives.
	place(other, 100+20*16, 100)
	speaker.audio(frame)
	_, _, ok = listener.nextAudio(200 * time.Millisecond)
	assert.False(t, ok)

	// Back in range, but the listener is on a call.
	place(other, 100, 100+16)
	listener.text(map[string]any{"type": "onCall", "on": true})
	time.Sleep(50 * time.Millisecond)
	speaker.audio(frame)
	_, _, ok = listener.nextAudio(200 * time.Millisecond)
	assert.False(t, ok)

	// A speaker on a call isn't sent either.
	listener.text(map[string]any{"type": "onCall", "on": false})
	speaker.text(map[string]any{"type": "onCall", "on": true})
	time.Sleep(50 * time.Millisecond)
	speaker.audio(frame)
	_, _, ok = listener.nextAudio(200 * time.Millisecond)
	assert.False(t, ok)

	speaker.text(map[string]any{"type": "onCall", "on": false})
	time.Sleep(50 * time.Millisecond)
	speaker.audio(frame)
	_, _, ok = listener.nextAudio(time.Second)
	assert.True(t, ok)
}

func TestVoiceReplacedByNewTab(t *testing.T) {
	srv := newTestServer(t)
	dial(t, srv, validToken()).call("map.state", nil)

	first := dialVoice(t, srv, validToken())
	first.hello()
	second := dialVoice(t, srv, validToken())
	second.hello()
	assert.Equal(t, len(second.peers), 0)
	assert.Equal(t, first.closeStatus(), wsStatusReplaced)
}

func TestVoiceOversizeFrame(t *testing.T) {
	srv := newTestServer(t)
	c := dialVoice(t, srv, validToken())
	c.hello()
	c.audio(make([]byte, voiceMaxFrame+1))
	assert.Equal(t, c.closeStatus(), websocket.StatusMessageTooBig)
}
