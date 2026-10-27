package main

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/coder/websocket"
)

const (
	wsAuthTimeout  = 5 * time.Second
	wsWriteTimeout = 10 * time.Second
	wsPingInterval = 30 * time.Second

	// Application close codes (4000-4999).
	wsStatusUnauthorized websocket.StatusCode = 4401
	wsStatusTooSlow      websocket.StatusCode = 4408
)

type wsAuthMessage struct {
	Type  string `json:"type"`
	Token string `json:"token"`
}

// metricsSocket streams realtime metric changes. Browsers can't set headers
// on a WebSocket, so the first message must be {"type":"auth","token":"<X-Api-Key>"}.
// Each following server message is a JSON object of the keys that changed.
func (app *application) metricsSocket(w http.ResponseWriter, r *http.Request) {
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

	ctx := r.Context()

	if !app.wsAuthenticate(ctx, conn) {
		conn.Close(wsStatusUnauthorized, "unauthorized")
		return
	}

	// Clients only send the auth message; CloseRead handles control frames
	// and cancels ctx when the client goes away.
	ctx = conn.CloseRead(ctx)

	client := app.hub.Subscribe()
	defer app.hub.Unsubscribe(client)

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

func (app *application) wsAuthenticate(ctx context.Context, conn *websocket.Conn) bool {
	// A read whose ctx expires tears the connection down without a close
	// frame, so close explicitly instead to give the client a 4401.
	timer := time.AfterFunc(wsAuthTimeout, func() {
		conn.Close(wsStatusUnauthorized, "authentication timeout")
	})
	defer timer.Stop()

	conn.SetReadLimit(4096)

	typ, data, err := conn.Read(ctx)
	if err != nil || typ != websocket.MessageText {
		return false
	}

	var msg wsAuthMessage
	if err := json.Unmarshal(data, &msg); err != nil || msg.Type != "auth" {
		return false
	}

	ok, err := app.auth.Verify(ctx, msg.Token)
	if err != nil {
		app.logger.Error("websocket auth", "error", err)
		return false
	}
	return ok
}

func wsWrite(ctx context.Context, conn *websocket.Conn, msg []byte) error {
	ctx, cancel := context.WithTimeout(ctx, wsWriteTimeout)
	defer cancel()
	return conn.Write(ctx, websocket.MessageText, msg)
}
