package main

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/tyler71/owlchirp/app/internal/connect"
	"github.com/tyler71/owlchirp/app/internal/realtime"
)

const (
	wsAuthTimeout    = 5 * time.Second
	wsWriteTimeout   = 10 * time.Second
	wsPingInterval   = 30 * time.Second
	wsRequestTimeout = 15 * time.Second
	wsReadLimit      = 64 << 10
	wsReplyBuffer    = 16

	// Application close codes (4000-4999).
	wsStatusUnauthorized websocket.StatusCode = 4401
	wsStatusTooSlow      websocket.StatusCode = 4408
)

type wsAuthMessage struct {
	Type  string `json:"type"`
	Token string `json:"token"`
}

// wsRequest is a client call: {"id":1,"type":"wrapups.list","data":{...}}.
type wsRequest struct {
	ID   int64           `json:"id"`
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// wsReply answers a wsRequest with the same id and type "result" or "error".
type wsReply struct {
	ID    int64  `json:"id"`
	Type  string `json:"type"`
	Data  any    `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}

// socket is the single realtime channel between the frontend and backend.
// Browsers can't set headers on a WebSocket, so the first message must be
// {"type":"auth","token":"<X-Api-Key>"}. After that:
//   - the server pushes events as {"type":"<event>","data":...}
//     ("features", "metrics", "call.logged", "callerid.updated", "wrapup.saved",
//     "help.requested", "permission.updated", "flowcall.updated",
//     "map.joined", "map.moved", "map.left", "building.updated",
//     "building.deleted");
//     "features" is always the first, sent once per connection
//   - the client sends wsRequest calls, answered with a wsReply. The
//     user's features decide what the UI shows; requests in
//     requestFeature also need that feature on the server.
func (app *application) socket(w http.ResponseWriter, r *http.Request) {
	// The connection outlives the server's Read/WriteTimeout.
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Time{})
	_ = rc.SetWriteDeadline(time.Time{})

	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		app.logger.Warn("websocket accept", "error", err)
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
	conn.SetReadLimit(wsReadLimit)

	// Features are checked on every request; changes by an admin are pushed
	// as "permission.updated".
	msg, err := realtime.Message("features", map[string][]string{"features": app.perms.features(user.Username)})
	if err != nil {
		app.logger.Error("websocket encode features", "error", err)
		return
	}
	if err := wsWrite(ctx, conn, msg); err != nil {
		return
	}

	client := app.hub.Subscribe()
	defer app.hub.Unsubscribe(client)

	defer app.mapJoin(user)()

	// coder/websocket allows one concurrent writer, so request handlers hand
	// their replies to the write loop below.
	replies := make(chan []byte, wsReplyBuffer)
	go app.wsReadLoop(ctx, cancel, conn, user, replies)

	ping := time.NewTicker(wsPingInterval)
	defer ping.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-client.Dropped:
			conn.Close(wsStatusTooSlow, "client too slow")
			return
		case msg := <-client.Send:
			if err := wsWrite(ctx, conn, msg); err != nil {
				return
			}
		case msg := <-replies:
			if err := wsWrite(ctx, conn, msg); err != nil {
				return
			}
		case <-ping.C:
			pingCtx, cancel := context.WithTimeout(ctx, wsWriteTimeout)
			err := conn.Ping(pingCtx)
			cancel()
			if err != nil {
				return
			}
		}
	}
}

// wsReadLoop handles client requests until the connection fails, then
// cancels the connection's context so the write loop exits too.
func (app *application) wsReadLoop(ctx context.Context, cancel context.CancelFunc, conn *websocket.Conn, user connect.RegisteredUser, replies chan<- []byte) {
	defer cancel()

	for {
		typ, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		if typ != websocket.MessageText {
			continue
		}

		var req wsRequest
		if err := json.Unmarshal(data, &req); err != nil {
			app.sendReply(ctx, replies, wsReply{Type: "error", Error: "invalid message"})
			continue
		}

		// Requests run concurrently so a slow Connect lookup doesn't block
		// quick ones; the client matches replies by id.
		go func() {
			reqCtx, reqCancel := context.WithTimeout(ctx, wsRequestTimeout)
			defer reqCancel()
			app.sendReply(ctx, replies, app.handleRequest(reqCtx, user, req))
		}()
	}
}

func (app *application) sendReply(ctx context.Context, replies chan<- []byte, reply wsReply) {
	msg, err := json.Marshal(reply)
	if err != nil {
		app.logger.Error("websocket encode reply", "error", err)
		return
	}
	select {
	case replies <- msg:
	case <-ctx.Done():
	}
}

func (app *application) wsAuthenticate(ctx context.Context, conn *websocket.Conn) (connect.RegisteredUser, bool) {
	// A read whose ctx expires tears the connection down without a close
	// frame, so close explicitly instead to give the client a 4401.
	timer := time.AfterFunc(wsAuthTimeout, func() {
		conn.Close(wsStatusUnauthorized, "authentication timeout")
	})
	defer timer.Stop()

	conn.SetReadLimit(4096)

	typ, data, err := conn.Read(ctx)
	if err != nil || typ != websocket.MessageText {
		return connect.RegisteredUser{}, false
	}

	var msg wsAuthMessage
	if err := json.Unmarshal(data, &msg); err != nil || msg.Type != "auth" {
		return connect.RegisteredUser{}, false
	}

	user, ok, err := app.auth.Verify(ctx, msg.Token)
	if err != nil {
		app.logger.Error("websocket auth", "error", err)
		return connect.RegisteredUser{}, false
	}
	return user, ok
}

func wsWrite(ctx context.Context, conn *websocket.Conn, msg []byte) error {
	ctx, cancel := context.WithTimeout(ctx, wsWriteTimeout)
	defer cancel()
	return conn.Write(ctx, websocket.MessageText, msg)
}
