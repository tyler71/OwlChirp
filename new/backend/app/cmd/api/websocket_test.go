package main

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/tyler71/owlchirp/app/internal/assert"
	"github.com/tyler71/owlchirp/app/internal/auth"
	"github.com/tyler71/owlchirp/app/internal/connect"
	"github.com/tyler71/owlchirp/app/internal/database"
	"github.com/tyler71/owlchirp/app/internal/realtime"
)

type fakeUsers []connect.RegisteredUser

func (f fakeUsers) RegisteredUsers(context.Context) ([]connect.RegisteredUser, error) {
	return f, nil
}

// fakeFlags turns owlchirp on for the usernames it holds.
type fakeFlags map[string]bool

func (f fakeFlags) Owlchirp(_ context.Context, username string) bool {
	return f[username]
}

var (
	testAgent    = connect.RegisteredUser{ID: "agent-1", Username: "agent@example.com"}
	disabledUser = connect.RegisteredUser{ID: "agent-2", Username: "disabled@example.com"}
)

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()

	db, err := database.New(filepath.Join(t.TempDir(), "test.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	app := &application{
		db:     db,
		auth:   auth.NewVerifier(fakeUsers{testAgent, disabledUser}),
		hub:    realtime.NewHub(nil, time.Hour, logger),
		flags:  fakeFlags{testAgent.Username: true},
		logger: logger,
	}
	app.handlers = app.wsHandlers()

	srv := httptest.NewServer(app.routes())
	t.Cleanup(srv.Close)
	return srv
}

type testClient struct {
	t    *testing.T
	conn *websocket.Conn
	next int64
	// skipped holds messages read past by readUntil, in arrival order.
	skipped []testMessage
}

func dial(t *testing.T, srv *httptest.Server, token string) *testClient {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/api/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.CloseNow() })

	c := &testClient{t: t, conn: conn}
	c.send(map[string]string{"type": "auth", "token": token})
	return c
}

func validToken() string {
	return tokenFor(testAgent)
}

func tokenFor(u connect.RegisteredUser) string {
	hour := time.Now().UTC().Truncate(time.Hour).Unix()
	return auth.Token(hour, u.ID, u.Username)
}

func (c *testClient) send(v any) {
	c.t.Helper()
	msg, err := json.Marshal(v)
	if err != nil {
		c.t.Fatal(err)
	}
	if err := c.conn.Write(context.Background(), websocket.MessageText, msg); err != nil {
		c.t.Fatal(err)
	}
}

type testMessage struct {
	ID    int64           `json:"id"`
	Type  string          `json:"type"`
	Data  json.RawMessage `json:"data"`
	Error string          `json:"error"`
}

// readUntil returns the next message matching keep. Others are kept for
// later readUntil calls, since events and replies can arrive in either order.
func (c *testClient) readUntil(keep func(testMessage) bool) testMessage {
	c.t.Helper()
	for i, m := range c.skipped {
		if keep(m) {
			c.skipped = append(c.skipped[:i], c.skipped[i+1:]...)
			return m
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	for {
		_, data, err := c.conn.Read(ctx)
		if err != nil {
			c.t.Fatal(err)
		}
		var m testMessage
		if err := json.Unmarshal(data, &m); err != nil {
			c.t.Fatal(err)
		}
		if keep(m) {
			return m
		}
		c.skipped = append(c.skipped, m)
	}
}

func (c *testClient) call(typ string, data any) testMessage {
	c.t.Helper()
	c.next++
	id := c.next
	c.send(map[string]any{"id": id, "type": typ, "data": data})
	return c.readUntil(func(m testMessage) bool {
		return m.ID == id && (m.Type == "result" || m.Type == "error")
	})
}

func TestSocketRejectsBadToken(t *testing.T) {
	srv := newTestServer(t)
	c := dial(t, srv, "not-a-token")

	_, _, err := c.conn.Read(context.Background())
	assert.Equal(t, websocket.CloseStatus(err), wsStatusUnauthorized)
}

func TestSocketFlags(t *testing.T) {
	srv := newTestServer(t)

	t.Run("enabled", func(t *testing.T) {
		c := dial(t, srv, validToken())
		msg := c.readUntil(func(testMessage) bool { return true })
		assert.Equal(t, msg.Type, "flags")
		assert.Equal(t, string(msg.Data), `{"owlchirp":true}`)

		reply := c.call("calls.agent", map[string]any{})
		assert.NotEqual(t, reply.Error, "owlchirp is not enabled for this user")
	})

	t.Run("disabled", func(t *testing.T) {
		c := dial(t, srv, tokenFor(disabledUser))
		msg := c.readUntil(func(testMessage) bool { return true })
		assert.Equal(t, msg.Type, "flags")
		assert.Equal(t, string(msg.Data), `{"owlchirp":false}`)

		reply := c.call("calls.agent", map[string]any{})
		assert.Equal(t, reply.Type, "error")
		assert.Equal(t, reply.Error, "owlchirp is not enabled for this user")
	})
}

func TestSocketWrapups(t *testing.T) {
	srv := newTestServer(t)
	a := dial(t, srv, validToken())
	b := dial(t, srv, validToken())

	// Make sure b is subscribed before a saves.
	reply := b.call("wrapups.list", map[string]any{"phoneNumber": "+15550001"})
	assert.Equal(t, reply.Type, "result")
	assert.Equal(t, string(reply.Data), "[]")

	reply = a.call("wrapups.save", map[string]any{
		"contactId": "c-1", "phoneNumber": "+15550001", "incident": " INC-9 ", "mood": "spam",
	})
	assert.Equal(t, reply.Type, "result")

	var saved database.Wrapup
	assert.Nil(t, json.Unmarshal(reply.Data, &saved))
	assert.Equal(t, saved.Agent, testAgent.Username)
	assert.Equal(t, saved.Incident, "INC-9")

	event := b.readUntil(func(m testMessage) bool { return m.Type == "wrapup.saved" })
	var pushed database.Wrapup
	assert.Nil(t, json.Unmarshal(event.Data, &pushed))
	assert.Equal(t, pushed.ContactID, "c-1")

	reply = b.call("wrapups.list", map[string]any{"phoneNumber": "+15550001"})
	var list []database.Wrapup
	assert.Nil(t, json.Unmarshal(reply.Data, &list))
	assert.Equal(t, len(list), 1)
	assert.Equal(t, list[0].Mood, "spam")
}

func TestSocketValidation(t *testing.T) {
	srv := newTestServer(t)
	c := dial(t, srv, validToken())

	tests := []struct {
		typ  string
		data any
		want string
	}{
		{"nope", nil, `unknown request type "nope"`},
		{"wrapups.save", map[string]any{"contactId": "c-1", "phoneNumber": "+1", "mood": "angry"}, "mood must be intense, friendly or spam"},
		{"wrapups.save", map[string]any{"contactId": "c-1", "phoneNumber": "+1"}, "wrap-up is empty"},
		{"wrapups.save", map[string]any{"phoneNumber": "+1", "mood": "spam"}, "contactId is required"},
		{"callerid.set", map[string]any{"phoneNumber": "+1"}, "name is required"},
	}
	for _, tt := range tests {
		reply := c.call(tt.typ, tt.data)
		assert.Equal(t, reply.Type, "error")
		assert.Equal(t, reply.Error, tt.want)
	}
}

func TestSocketCallsAndCallerID(t *testing.T) {
	srv := newTestServer(t)
	c := dial(t, srv, validToken())

	reply := c.call("calls.log", map[string]any{"phoneNumber": "+15550001", "contactId": "c-1"})
	assert.Equal(t, reply.Type, "result")
	c.readUntil(func(m testMessage) bool { return m.Type == "call.logged" })

	reply = c.call("calls.agent", map[string]any{"maxRecords": 5})
	var calls []database.Call
	assert.Nil(t, json.Unmarshal(reply.Data, &calls))
	assert.Equal(t, len(calls), 1)
	assert.Equal(t, calls[0].Agent, testAgent.Username)

	reply = c.call("callerid.get", map[string]any{"phoneNumber": "+15550001"})
	assert.Equal(t, string(reply.Data), "")

	reply = c.call("callerid.set", map[string]any{"phoneNumber": "+15550001", "name": "Ada"})
	assert.Equal(t, reply.Type, "result")
	event := c.readUntil(func(m testMessage) bool { return m.Type == "callerid.updated" })
	assert.True(t, strings.Contains(string(event.Data), "Ada"))

	reply = c.call("callerid.get", map[string]any{"phoneNumber": "+15550001"})
	var callerID database.CallerID
	assert.Nil(t, json.Unmarshal(reply.Data, &callerID))
	assert.Equal(t, callerID.Name, "Ada")
}
