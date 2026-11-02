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
	"github.com/tyler71/owlchirp/app/internal/cache"
	"github.com/tyler71/owlchirp/app/internal/connect"
	"github.com/tyler71/owlchirp/app/internal/database"
	"github.com/tyler71/owlchirp/app/internal/flags"
	"github.com/tyler71/owlchirp/app/internal/realtime"
)

type fakeUsers []connect.RegisteredUser

func (f fakeUsers) RegisteredUsers(context.Context) ([]connect.RegisteredUser, error) {
	return f, nil
}

// fakeFlags gives the usernames it holds their permission level; anyone else
// is standard.
type fakeFlags map[string]int

func (f fakeFlags) Permission(_ context.Context, username string) int {
	return f[username]
}

var (
	testAgent    = connect.RegisteredUser{ID: "agent-1", Username: "agent@example.com"}
	standardUser = connect.RegisteredUser{ID: "agent-2", Username: "standard@example.com"}
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
		auth:   auth.NewVerifier(fakeUsers{testAgent, standardUser}),
		users:  fakeUsers{testAgent, standardUser},
		hub:    realtime.NewHub(nil, time.Hour, logger),
		flags:  fakeFlags{testAgent.Username: flags.Admin},
		perms:  newPermissionStore(nil),
		logger: logger,
	}
	app.handlers = app.wsHandlers()
	app.timeline = cache.NewValue(timelineTTL, app.buildTimeline)

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

	t.Run("admin", func(t *testing.T) {
		c := dial(t, srv, validToken())
		msg := c.readUntil(func(testMessage) bool { return true })
		assert.Equal(t, msg.Type, "flags")
		assert.Equal(t, string(msg.Data), `{"owlchirp":2}`)
	})

	t.Run("standard", func(t *testing.T) {
		c := dial(t, srv, tokenFor(standardUser))
		msg := c.readUntil(func(testMessage) bool { return true })
		assert.Equal(t, msg.Type, "flags")
		assert.Equal(t, string(msg.Data), `{"owlchirp":0}`)

		// Most requests are served at every level; only admin requests are refused.
		reply := c.call("calls.agent", map[string]any{})
		assert.Equal(t, reply.Type, "result")

		reply = c.call("settings.get", map[string]any{})
		assert.Equal(t, reply.Type, "result")

		reply = c.call("callerid.set", map[string]any{"phoneNumber": "+15550009", "name": "Ada"})
		assert.Equal(t, reply.Type, "result")

		for _, typ := range []string{"callerid.list", "callerid.delete"} {
			reply = c.call(typ, map[string]any{"phoneNumber": "+15550009"})
			assert.Equal(t, reply.Type, "error")
			assert.Equal(t, reply.Error, "permission denied")
		}
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

func TestSocketSettings(t *testing.T) {
	srv := newTestServer(t)
	c := dial(t, srv, validToken())

	reply := c.call("settings.get", nil)
	assert.Equal(t, reply.Type, "result")
	assert.Equal(t, string(reply.Data), `{"theme":"","followTeamMeeting":false}`)

	reply = c.call("settings.save", map[string]any{"theme": "dracula", "followTeamMeeting": true})
	assert.Equal(t, reply.Type, "result")

	// A second connection for the same user sees the saved settings.
	other := dial(t, srv, validToken())
	reply = other.call("settings.get", nil)
	assert.Equal(t, string(reply.Data), `{"theme":"dracula","followTeamMeeting":true}`)
}

func TestSocketCallLogs(t *testing.T) {
	srv := newTestServer(t)
	c := dial(t, srv, validToken())

	reply := c.call("syslog.append", map[string]any{
		"contactId": "c-1", "phoneNumber": "+15550001", "outcome": "failed",
		"entries": []map[string]any{{"time": 1, "source": "console", "level": "error", "message": strings.Repeat("x", 3000)}},
	})
	assert.Equal(t, reply.Type, "result")

	reply = c.call("syslog.list", nil)
	var list []database.CallLog
	assert.Nil(t, json.Unmarshal(reply.Data, &list))
	assert.Equal(t, len(list), 1)
	assert.Equal(t, list[0].ErrorCount, 1)

	reply = c.call("syslog.get", map[string]any{"contactId": "c-1"})
	var log database.CallLog
	assert.Nil(t, json.Unmarshal(reply.Data, &log))
	assert.Equal(t, len(log.Entries), 1)
	assert.Equal(t, len(log.Entries[0].Message), 2000)
}

func TestSocketFlowCalls(t *testing.T) {
	srv := newTestServer(t)
	c := dial(t, srv, validToken())

	reply := c.call("flowcalls.list", nil)
	assert.Equal(t, reply.Type, "result")
	assert.Equal(t, string(reply.Data), `[]`)
}

func TestSocketFlowTimeline(t *testing.T) {
	srv := newTestServer(t)
	c := dial(t, srv, validToken())

	reply := c.call("flowcalls.timeline", nil)
	assert.Equal(t, reply.Type, "result")
	var tl flowTimeline
	assert.Nil(t, json.Unmarshal(reply.Data, &tl))
	assert.Equal(t, tl.Hours, 8*7*24)
	assert.Equal(t, tl.BucketMinutes, 15)
	assert.Equal(t, len(tl.Buckets), 0)

	// Served from cache: the same snapshot comes back.
	again := c.call("flowcalls.timeline", nil)
	var tl2 flowTimeline
	assert.Nil(t, json.Unmarshal(again.Data, &tl2))
	assert.Equal(t, tl2.GeneratedAt, tl.GeneratedAt)
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
		{"callerid.set", map[string]any{"phoneNumber": "+1", "name": strings.Repeat("a", 31)}, "name must be at most 30 characters"},
		{"callerid.delete", map[string]any{}, "phoneNumber is required"},
		{"callerid.delete", map[string]any{"phoneNumber": "+1"}, "caller id not found"},
		{"settings.save", map[string]any{"theme": "Dracula!"}, "theme is invalid"},
		{"syslog.append", map[string]any{"outcome": "failed"}, "contactId is required"},
		{"syslog.append", map[string]any{"contactId": "c-1", "outcome": "weird"}, "outcome must be failed or missed"},
		{"syslog.get", map[string]any{"contactId": "missing"}, "log not found"},
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
	var page callPage
	assert.Nil(t, json.Unmarshal(reply.Data, &page))
	assert.Equal(t, len(page.Calls), 1)
	assert.Equal(t, page.Total, 1)
	assert.Equal(t, page.Calls[0].Agent, testAgent.Username)

	standard := dial(t, srv, tokenFor(standardUser))
	reply = standard.call("calls.log", map[string]any{"phoneNumber": "+15550002", "contactId": "c-2"})
	assert.Equal(t, reply.Type, "result")

	reply = standard.call("calls.agent", map[string]any{"maxRecords": 5})
	assert.Nil(t, json.Unmarshal(reply.Data, &page))
	assert.Equal(t, len(page.Calls), 1)
	assert.Equal(t, page.Calls[0].Agent, standardUser.Username)

	reply = standard.call("calls.all", map[string]any{"maxRecords": 5})
	assert.Equal(t, reply.Error, "permission denied")

	reply = c.call("calls.all", map[string]any{"maxRecords": 5})
	assert.Nil(t, json.Unmarshal(reply.Data, &page))
	assert.Equal(t, len(page.Calls), 2)
	assert.Equal(t, page.Total, 2)

	reply = c.call("calls.all", map[string]any{"maxRecords": 1, "offset": 1})
	page = callPage{}
	assert.Nil(t, json.Unmarshal(reply.Data, &page))
	assert.Equal(t, len(page.Calls), 1)
	assert.Equal(t, page.Total, 2)
	assert.Equal(t, page.Calls[0].ContactID, "c-1")

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

	reply = c.call("callerid.list", nil)
	var callerIDs []database.CallerID
	assert.Nil(t, json.Unmarshal(reply.Data, &callerIDs))
	assert.Equal(t, len(callerIDs), 1)
	assert.Equal(t, callerIDs[0].PhoneNumber, "+15550001")

	reply = c.call("callerid.delete", map[string]any{"phoneNumber": "+15550001"})
	assert.Equal(t, reply.Type, "result")
	event = c.readUntil(func(m testMessage) bool { return m.Type == "callerid.deleted" })
	assert.True(t, strings.Contains(string(event.Data), "+15550001"))

	reply = c.call("callerid.get", map[string]any{"phoneNumber": "+15550001"})
	assert.Equal(t, string(reply.Data), "")
}

func TestSocketHelpRequest(t *testing.T) {
	srv := newTestServer(t)
	a := dial(t, srv, validToken())
	b := dial(t, srv, tokenFor(standardUser))

	// Make sure b is subscribed before a asks.
	b.call("settings.get", nil)

	reply := a.call("help.request", map[string]any{"name": " Ada ", "queueCount": 3})
	assert.Equal(t, reply.Type, "result")

	event := b.readUntil(func(m testMessage) bool { return m.Type == "help.requested" })
	var pushed helpRequest
	assert.Nil(t, json.Unmarshal(event.Data, &pushed))
	assert.Equal(t, pushed.Agent, testAgent.Username)
	assert.Equal(t, pushed.Name, "Ada")
	assert.Equal(t, pushed.QueueCount, 3)

	reply = a.call("help.request", map[string]any{"name": "Ada", "queueCount": 4})
	assert.Equal(t, reply.Type, "error")
	assert.Equal(t, reply.Error, "help was already requested")

	// The cooldown is per agent.
	reply = b.call("help.request", nil)
	assert.Equal(t, reply.Type, "result")
	event = a.readUntil(func(m testMessage) bool {
		return m.Type == "help.requested" && strings.Contains(string(m.Data), standardUser.Username)
	})
	assert.Nil(t, json.Unmarshal(event.Data, &pushed))
	assert.Equal(t, pushed.Name, standardUser.Username)
}

func TestSocketPermissions(t *testing.T) {
	srv := newTestServer(t)
	admin := dial(t, srv, validToken())
	standard := dial(t, srv, tokenFor(standardUser))

	reply := standard.call("users.list", nil)
	assert.Equal(t, reply.Error, "permission denied")

	reply = admin.call("users.list", nil)
	assert.Equal(t, reply.Type, "result")
	var users []managedUser
	assert.Nil(t, json.Unmarshal(reply.Data, &users))
	assert.Equal(t, len(users), 2)
	assert.Equal(t, users[0], managedUser{Username: testAgent.Username, Level: flags.Admin, Source: sourceFlag})
	assert.Equal(t, users[1], managedUser{Username: standardUser.Username, Level: flags.Standard, Source: sourceFlag})

	reply = admin.call("users.setPermission", map[string]any{"username": testAgent.Username, "level": flags.Standard})
	assert.Equal(t, reply.Error, "you can't change your own permission")
	reply = admin.call("users.setPermission", map[string]any{"username": "nobody@example.com", "level": flags.Power})
	assert.Equal(t, reply.Error, "user not found")
	reply = admin.call("users.setPermission", map[string]any{"username": standardUser.Username, "level": 3})
	assert.Equal(t, reply.Type, "error")

	// A promotion applies to the user's next request without reconnecting.
	reply = admin.call("users.setPermission", map[string]any{"username": standardUser.Username, "level": flags.Admin})
	assert.Equal(t, reply.Type, "result")
	event := standard.readUntil(func(m testMessage) bool { return m.Type == "permission.updated" })
	var updated managedUser
	assert.Nil(t, json.Unmarshal(event.Data, &updated))
	assert.Equal(t, updated, managedUser{Username: standardUser.Username, Level: flags.Admin, Source: sourceDB})

	reply = standard.call("users.list", nil)
	assert.Equal(t, reply.Type, "result")

	// A level set in the database overrides the flag, including on connect.
	reply = standard.call("users.setPermission", map[string]any{"username": testAgent.Username, "level": flags.Power})
	assert.Equal(t, reply.Type, "result")
	reply = admin.call("users.list", nil)
	assert.Equal(t, reply.Error, "permission denied")

	again := dial(t, srv, validToken())
	msg := again.readUntil(func(testMessage) bool { return true })
	assert.Equal(t, string(msg.Data), `{"owlchirp":1}`)

	// Resetting returns the user to their flag level.
	reply = standard.call("users.resetPermission", map[string]any{"username": testAgent.Username})
	assert.Equal(t, reply.Type, "result")
	assert.Nil(t, json.Unmarshal(reply.Data, &updated))
	assert.Equal(t, updated, managedUser{Username: testAgent.Username, Level: flags.Admin, Source: sourceFlag})

	reply = admin.call("users.list", nil)
	assert.Equal(t, reply.Type, "result")
}

func TestHardcodedAdmin(t *testing.T) {
	hardcodedAdmins[standardUser.Username] = true
	t.Cleanup(func() { delete(hardcodedAdmins, standardUser.Username) })

	srv := newTestServer(t)
	c := dial(t, srv, tokenFor(standardUser))
	msg := c.readUntil(func(testMessage) bool { return true })
	assert.Equal(t, string(msg.Data), `{"owlchirp":2}`)

	admin := dial(t, srv, validToken())
	reply := admin.call("users.setPermission", map[string]any{"username": standardUser.Username, "level": flags.Standard})
	assert.Equal(t, reply.Error, "this user is always an admin")
	reply = admin.call("users.resetPermission", map[string]any{"username": standardUser.Username})
	assert.Equal(t, reply.Error, "this user is always an admin")

	reply = admin.call("users.list", nil)
	var users []managedUser
	assert.Nil(t, json.Unmarshal(reply.Data, &users))
	assert.Equal(t, users[1], managedUser{Username: standardUser.Username, Level: flags.Admin, Source: sourceHardcoded})
}
