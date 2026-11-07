package main

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/tyler71/owlchirp/app/internal/features"
	"github.com/tyler71/owlchirp/app/internal/realtime"
)

// Office screenshare. One person at a time shares their screen from a desk:
// their browser encodes it (VP8) and streams the frames to this relay, which
// forwards them to everyone watching (anyone standing at a desk). Nothing
// goes peer to peer.
const (
	// videoMaxFrame caps one message; a 1280px VP8 keyframe is well under.
	videoMaxFrame = 1 << 20
	// videoMaxFramesPerSec drops frames from a sharer sending faster.
	videoMaxFramesPerSec = 30
	videoSendBuffer      = 16
	// videoKeyEvery limits how often a lagging watcher asks for a keyframe.
	videoKeyEvery = time.Second

	// videoFlagKey marks a keyframe in a frame's first byte.
	videoFlagKey = 1
)

type videoMsg struct {
	binary bool
	data   []byte
}

// videoConn is one user's screenshare connection. A user has at most one; a
// newer one (another tab) replaces it.
type videoConn struct {
	username string
	send     chan videoMsg
	kicked   chan struct{} // closed when replaced
	// Guarded by videoRoom.mu.
	watching bool
	needKey  bool // a watcher waits for a keyframe before getting deltas
}

func (c *videoConn) trySend(msg videoMsg) bool {
	select {
	case c.send <- msg:
		return true
	default:
		return false
	}
}

// videoRoom tracks screenshare connections and who is sharing. The zero
// value is ready to use.
type videoRoom struct {
	mu     sync.Mutex
	conns  map[string]*videoConn
	sharer *videoConn
	keyAsk time.Time // when the sharer was last asked for a keyframe
}

type videoState struct {
	Sharer *string `json:"sharer"`
}

func (r *videoRoom) stateLocked() videoState {
	if r.sharer == nil {
		return videoState{}
	}
	name := r.sharer.username
	return videoState{Sharer: &name}
}

// join adds a connection for username and returns the current state. The
// user's previous connection, if any, is kicked (and stops sharing).
func (r *videoRoom) join(username string) (*videoConn, videoState) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.conns == nil {
		r.conns = make(map[string]*videoConn)
	}
	c := &videoConn{username: username, send: make(chan videoMsg, videoSendBuffer), kicked: make(chan struct{})}
	if old := r.conns[username]; old != nil {
		if r.sharer == old {
			r.sharer = nil
			r.tellLocked("state", r.stateLocked())
		}
		close(old.kicked)
	}
	r.conns[username] = c
	return c, r.stateLocked()
}

// leave removes c, ending its share.
func (r *videoRoom) leave(c *videoConn) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.conns[c.username] == c {
		delete(r.conns, c.username)
	}
	if r.sharer == c {
		r.sharer = nil
		r.tellLocked("state", r.stateLocked())
	}
}

// start makes c the sharer if nobody else is. It reports whether c shares.
func (r *videoRoom) start(c *videoConn) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.conns[c.username] != c {
		return false
	}
	if r.sharer == c {
		return true
	}
	if r.sharer != nil {
		c.trySend(controlMsg("busy", r.stateLocked()))
		return false
	}
	r.sharer = c
	r.keyAsk = time.Time{}
	for _, o := range r.conns {
		o.needKey = true
	}
	r.tellLocked("state", r.stateLocked())
	return true
}

// stop ends c's share; it does nothing if c isn't sharing.
func (r *videoRoom) stop(c *videoConn) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.sharer == c {
		r.sharer = nil
		r.tellLocked("state", r.stateLocked())
	}
}

// watch turns c's viewing on or off. A new watcher needs a keyframe first.
func (r *videoRoom) watch(c *videoConn, on bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c.watching = on
	if on {
		c.needKey = true
		r.askKeyLocked(true)
	}
}

// askKeyLocked asks the sharer for a keyframe, at most once per
// videoKeyEvery unless now is set.
func (r *videoRoom) askKeyLocked(now bool) {
	if r.sharer == nil {
		return
	}
	t := time.Now()
	if !now && t.Sub(r.keyAsk) < videoKeyEvery {
		return
	}
	r.keyAsk = t
	r.sharer.trySend(controlMsg("keyframe", nil))
}

// relay forwards a frame from c to every watcher, if c is sharing. A watcher
// that missed a frame skips deltas until the next keyframe.
func (r *videoRoom) relay(c *videoConn, frame []byte) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.sharer != c || len(frame) == 0 {
		return
	}
	key := frame[0]&videoFlagKey != 0
	msg := videoMsg{binary: true, data: frame}
	for _, w := range r.conns {
		if w == c || !w.watching {
			continue
		}
		if w.needKey && !key {
			r.askKeyLocked(false)
			continue
		}
		if w.trySend(msg) {
			w.needKey = false
		} else {
			w.needKey = true
			r.askKeyLocked(false)
		}
	}
}

func (r *videoRoom) tellLocked(typ string, data any) {
	msg := controlMsg(typ, data)
	for _, c := range r.conns {
		c.trySend(msg)
	}
}

func controlMsg(typ string, data any) videoMsg {
	b, _ := json.Marshal(map[string]any{"type": typ, "data": data})
	return videoMsg{data: b}
}

// videoSocket is the Office screenshare relay. Like socket, the first
// message is {"type":"auth","token":"<X-Api-Key>"}, and the user needs the
// Map feature. Then:
//   - the server sends {"type":"hello","data":{"sharer":name|null}}, then
//     "state" {sharer} whenever a share starts or stops
//   - the client sends {"type":"start"} to share (answered by "state", or
//     "busy" {sharer} if someone else is), {"type":"stop"}, and
//     {"type":"watch","on":bool} to get the picture
//   - the sharer sends binary frames [u8 flags (1 = key)][header][VP8]; the
//     server forwards them unchanged to watchers, and sends the sharer
//     "keyframe" when a watcher needs one
func (app *application) videoSocket(w http.ResponseWriter, r *http.Request) {
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Time{})
	_ = rc.SetWriteDeadline(time.Time{})

	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		app.logger.Warn("video accept", "error", err)
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
	conn.SetReadLimit(videoMaxFrame)

	vc, state := app.video.join(user.Username)
	defer app.video.leave(vc)

	hello, err := realtime.Message("hello", state)
	if err != nil {
		return
	}
	if err := wsWrite(ctx, conn, hello); err != nil {
		return
	}

	go app.videoReadLoop(ctx, cancel, conn, vc)

	ping := time.NewTicker(wsPingInterval)
	defer ping.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-vc.kicked:
			conn.Close(wsStatusReplaced, "screenshare opened in another tab")
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

func (app *application) videoReadLoop(ctx context.Context, cancel context.CancelFunc, conn *websocket.Conn, vc *videoConn) {
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
			if json.Unmarshal(data, &msg) != nil {
				continue
			}
			switch msg.Type {
			case "start":
				app.video.start(vc)
			case "stop":
				app.video.stop(vc)
			case "watch":
				app.video.watch(vc, msg.On)
			}
			continue
		}
		now := time.Now()
		if now.Sub(windowStart) >= time.Second {
			windowStart, frames = now, 0
		}
		frames++
		if frames > videoMaxFramesPerSec {
			continue
		}
		app.video.relay(vc, data)
	}
}
