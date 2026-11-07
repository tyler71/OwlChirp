package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"math"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/tyler71/owlchirp/app/internal/features"
	"github.com/tyler71/owlchirp/app/internal/realtime"
)

// Map proximity voice. Everyone on the Map streams their microphone (Opus
// frames, encoded in the browser) to this relay, which forwards each frame
// only to listeners standing near the speaker. Listeners set the volume
// themselves from the live distance; the relay just decides who gets it.
const (
	// voiceRange is how far a voice carries, in world pixels (5 tiles).
	// Mirrors VOICE_RANGE in the frontend's lib/voice.ts.
	voiceRange = 5 * 16
	// voiceRelayRange adds a tile of slack: positions here lag the clients'
	// by up to a move interval, and the client fades to silence at the edge.
	voiceRelayRange = voiceRange + 16

	// voiceMaxFrame caps one message; a 20ms Opus frame is ~60 bytes. A
	// bigger one closes the connection.
	voiceMaxFrame = 1500
	// voiceMaxFramesPerSec drops frames from a client sending faster than
	// real time (20ms frames are 50/s).
	voiceMaxFramesPerSec = 60
	voiceSendBuffer      = 64

	wsStatusForbidden websocket.StatusCode = 4403
	wsStatusReplaced  websocket.StatusCode = 4409
)

// voiceMsg is one message queued for a voice connection.
type voiceMsg struct {
	binary bool
	data   []byte
}

// voiceConn is one user's voice connection. A user has at most one; a newer
// one (another tab) replaces it.
type voiceConn struct {
	id       uint16
	username string
	send     chan voiceMsg
	kicked   chan struct{} // closed when replaced
	onCall   bool          // guarded by voiceRoom.mu
}

// trySend queues msg unless the connection is backed up. Audio is useless
// late, so it is dropped rather than waited for.
func (c *voiceConn) trySend(msg voiceMsg) {
	select {
	case c.send <- msg:
	default:
	}
}

type voicePeer struct {
	ID       uint16 `json:"id"`
	Username string `json:"username"`
}

// voiceRoom tracks voice connections. The zero value is ready to use.
type voiceRoom struct {
	mu     sync.Mutex
	conns  map[string]*voiceConn
	nextID uint16
}

// join adds a connection for username and returns everyone else already in
// the room. The user's previous connection, if any, is kicked.
func (r *voiceRoom) join(username string) (c *voiceConn, peers []voicePeer) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.conns == nil {
		r.conns = make(map[string]*voiceConn)
	}
	r.nextID++
	if r.nextID == 0 {
		r.nextID = 1
	}
	c = &voiceConn{
		id:       r.nextID,
		username: username,
		send:     make(chan voiceMsg, voiceSendBuffer),
		kicked:   make(chan struct{}),
	}
	replaced := r.conns[username]
	r.conns[username] = c
	for _, o := range r.conns {
		if o != c {
			peers = append(peers, voicePeer{ID: o.id, Username: o.username})
		}
	}
	if replaced != nil {
		close(replaced.kicked)
	}
	return c, peers
}

// leave removes c. It reports false when c had already been replaced.
func (r *voiceRoom) leave(c *voiceConn) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.conns[c.username] != c {
		return false
	}
	delete(r.conns, c.username)
	return true
}

func (r *voiceRoom) setOnCall(c *voiceConn, on bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c.onCall = on
}

// others returns every current connection but except. With listening set,
// it leaves out anyone on a call, and returns nothing if except is on a call
// or has been replaced.
func (r *voiceRoom) others(except *voiceConn, listening bool) []*voiceConn {
	r.mu.Lock()
	defer r.mu.Unlock()
	if listening && (except.onCall || r.conns[except.username] != except) {
		return nil
	}
	out := make([]*voiceConn, 0, len(r.conns))
	for _, c := range r.conns {
		if c != except && !(listening && c.onCall) {
			out = append(out, c)
		}
	}
	return out
}

// tell sends a control message to every connection but except.
func (r *voiceRoom) tell(except *voiceConn, typ string, data any) {
	msg, err := json.Marshal(map[string]any{"type": typ, "data": data})
	if err != nil {
		return
	}
	for _, c := range r.others(except, false) {
		c.trySend(voiceMsg{data: msg})
	}
}

// relayVoice forwards an audio frame from speaker to every listener in range
// as [u16 speaker id][frame].
func (app *application) relayVoice(speaker *voiceConn, frame []byte) {
	listeners := app.voice.others(speaker, true)
	if len(listeners) == 0 {
		return
	}
	names := make([]string, 0, len(listeners)+1)
	names = append(names, speaker.username)
	for _, l := range listeners {
		names = append(names, l.username)
	}
	pos := app.presence.positions(names)
	from, ok := pos[speaker.username]
	if !ok {
		return
	}
	out := make([]byte, 2+len(frame))
	binary.BigEndian.PutUint16(out, speaker.id)
	copy(out[2:], frame)
	for _, l := range listeners {
		to, ok := pos[l.username]
		if ok && to.Scene == from.Scene && math.Hypot(to.X-from.X, to.Y-from.Y) <= voiceRelayRange {
			l.trySend(voiceMsg{binary: true, data: out})
		}
	}
}

// voiceSocket is the Map voice relay. Like socket, the first message is
// {"type":"auth","token":"<X-Api-Key>"}, and the user needs the Map feature.
// Then:
//   - the server sends {"type":"hello","data":{"id":n,"peers":[{id,username}]}},
//     then "peer" {id,username} and "peerLeft" {id} as people come and go
//   - the client sends binary Opus frames while talking, and
//     {"type":"onCall","on":bool}: while on a call it is neither heard nor
//     sent anything
//   - the server sends binary [u16 speaker id][frame] from nearby speakers
func (app *application) voiceSocket(w http.ResponseWriter, r *http.Request) {
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Time{})
	_ = rc.SetWriteDeadline(time.Time{})

	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		app.logger.Warn("voice accept", "error", err)
		return
	}
	defer conn.CloseNow()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	user, ok := app.wsAuthenticate(ctx, conn)
	if !ok {
		conn.Close(wsStatusUnauthorized, "unauthorized")
		return
	}
	if !app.perms.has(user.Username, features.Map) {
		conn.Close(wsStatusForbidden, "permission denied")
		return
	}
	conn.SetReadLimit(voiceMaxFrame)

	vc, peers := app.voice.join(user.Username)
	defer func() {
		if app.voice.leave(vc) {
			app.voice.tell(vc, "peerLeft", map[string]uint16{"id": vc.id})
		}
	}()

	hello, err := realtime.Message("hello", map[string]any{"id": vc.id, "peers": append([]voicePeer{}, peers...)})
	if err != nil {
		return
	}
	if err := wsWrite(ctx, conn, hello); err != nil {
		return
	}
	app.voice.tell(vc, "peer", voicePeer{ID: vc.id, Username: vc.username})

	go app.voiceReadLoop(ctx, cancel, conn, vc)

	ping := time.NewTicker(wsPingInterval)
	defer ping.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-vc.kicked:
			conn.Close(wsStatusReplaced, "voice opened in another tab")
			return
		case msg := <-vc.send:
			typ := websocket.MessageText
			if msg.binary {
				typ = websocket.MessageBinary
			}
			wctx, wcancel := context.WithTimeout(ctx, wsWriteTimeout)
			err := conn.Write(wctx, typ, msg.data)
			wcancel()
			if err != nil {
				return
			}
		case <-ping.C:
			pingCtx, pcancel := context.WithTimeout(ctx, wsWriteTimeout)
			err := conn.Ping(pingCtx)
			pcancel()
			if err != nil {
				return
			}
		}
	}
}

func (app *application) voiceReadLoop(ctx context.Context, cancel context.CancelFunc, conn *websocket.Conn, vc *voiceConn) {
	defer cancel()

	var windowStart time.Time
	frames := 0
	for {
		typ, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		if typ == websocket.MessageText {
			var msg struct {
				Type string `json:"type"`
				On   bool   `json:"on"`
			}
			if json.Unmarshal(data, &msg) == nil && msg.Type == "onCall" {
				app.voice.setOnCall(vc, msg.On)
			}
			continue
		}
		if len(data) == 0 {
			continue
		}
		now := time.Now()
		if now.Sub(windowStart) >= time.Second {
			windowStart, frames = now, 0
		}
		frames++
		if frames > voiceMaxFramesPerSec {
			continue
		}
		app.relayVoice(vc, data)
	}
}
