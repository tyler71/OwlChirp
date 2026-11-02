package database

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/tyler71/owlchirp/app/internal/assert"
)

func newTestDB(t *testing.T) *DB {
	t.Helper()
	db, err := New("sqlite+aiosqlite:///" + filepath.Join(t.TempDir(), "test.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestCalls(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)

	calls, err := db.ListRecentCalls(ctx, "agent@example.com", 10, 0)
	assert.Nil(t, err)
	assert.Equal(t, len(calls), 0)

	assert.Nil(t, db.AddPhoneLog(ctx, "agent@example.com", "+15550001", 1000, "c-1"))
	assert.Nil(t, db.AddPhoneLog(ctx, "agent@example.com", "+15550002", 2000, "c-2"))
	assert.Nil(t, db.AddPhoneLog(ctx, "other@example.com", "+15550001", 3000, "c-3"))

	calls, err = db.ListRecentCalls(ctx, "agent@example.com", 0, 0)
	assert.Nil(t, err)
	assert.Equal(t, len(calls), 2)
	assert.Equal(t, calls[0].ContactID, "c-2")

	calls, err = db.ListRecentCalls(ctx, "agent@example.com", 1, 0)
	assert.Nil(t, err)
	assert.Equal(t, len(calls), 1)
	assert.Equal(t, calls[0].ContactID, "c-2")

	calls, err = db.ListRecentCalls(ctx, "agent@example.com", 1, 1)
	assert.Nil(t, err)
	assert.Equal(t, len(calls), 1)
	assert.Equal(t, calls[0].ContactID, "c-1")

	calls, err = db.ListRecentCalls(ctx, "agent@example.com", 1, 2)
	assert.Nil(t, err)
	assert.Equal(t, len(calls), 0)

	n, err := db.CountRecentCalls(ctx, "agent@example.com")
	assert.Nil(t, err)
	assert.Equal(t, n, 2)

	calls, err = db.ListRecentCalls(ctx, "", 10, 0)
	assert.Nil(t, err)
	assert.Equal(t, len(calls), 3)
	assert.Equal(t, calls[0].Agent, "other@example.com")

	calls, err = db.ListRecentCalls(ctx, "", 2, 2)
	assert.Nil(t, err)
	assert.Equal(t, len(calls), 1)
	assert.Equal(t, calls[0].ContactID, "c-1")

	n, err = db.CountRecentCalls(ctx, "")
	assert.Nil(t, err)
	assert.Equal(t, n, 3)

	phoneCalls, err := db.GetPhoneCalls(ctx, "+15550001", 10)
	assert.Nil(t, err)
	assert.Equal(t, len(phoneCalls), 2)
	assert.Equal(t, phoneCalls[0].Agent, "other@example.com")

	id1, err := db.GetOrCreateUser(ctx, "agent@example.com")
	assert.Nil(t, err)
	id2, err := db.GetOrCreateUser(ctx, "agent@example.com")
	assert.Nil(t, err)
	assert.Equal(t, id1, id2)
}

func TestCallerID(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)

	_, found, err := db.GetCallerID(ctx, "+15550001")
	assert.Nil(t, err)
	assert.False(t, found)

	assert.Nil(t, db.UpsertCallerID(ctx, "+15550001", "Alice"))
	assert.Nil(t, db.UpsertCallerID(ctx, "+15550001", "Alice B"))

	c, found, err := db.GetCallerID(ctx, "+15550001")
	assert.Nil(t, err)
	assert.True(t, found)
	assert.Equal(t, c.Name, "Alice B")

	assert.Nil(t, db.UpsertCallerID(ctx, "+15550002", "aaron"))
	callerIDs, err := db.ListCallerIDs(ctx)
	assert.Nil(t, err)
	assert.Equal(t, len(callerIDs), 2)
	assert.Equal(t, callerIDs[0].Name, "aaron")

	deleted, err := db.DeleteCallerID(ctx, "+15550002")
	assert.Nil(t, err)
	assert.True(t, deleted)
	deleted, err = db.DeleteCallerID(ctx, "+15550002")
	assert.Nil(t, err)
	assert.False(t, deleted)

	callerIDs, err = db.ListCallerIDs(ctx)
	assert.Nil(t, err)
	assert.Equal(t, len(callerIDs), 1)
}

func TestPermissions(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)

	levels, err := db.ListPermissions(ctx)
	assert.Nil(t, err)
	assert.Equal(t, len(levels), 0)

	assert.Nil(t, db.SetPermission(ctx, "agent@example.com", 1))
	assert.Nil(t, db.SetPermission(ctx, "agent@example.com", 2))
	assert.Nil(t, db.SetPermission(ctx, "other@example.com", 0))

	levels, err = db.ListPermissions(ctx)
	assert.Nil(t, err)
	assert.Equal(t, len(levels), 2)
	assert.Equal(t, levels["agent@example.com"], 2)
	assert.Equal(t, levels["other@example.com"], 0)

	deleted, err := db.DeletePermission(ctx, "agent@example.com")
	assert.Nil(t, err)
	assert.True(t, deleted)

	deleted, err = db.DeletePermission(ctx, "agent@example.com")
	assert.Nil(t, err)
	assert.False(t, deleted)

	levels, err = db.ListPermissions(ctx)
	assert.Nil(t, err)
	assert.Equal(t, len(levels), 1)
}

func TestWrapups(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)

	wrapups, err := db.GetWrapups(ctx, "+15550001", 10)
	assert.Nil(t, err)
	assert.Equal(t, len(wrapups), 0)

	first, err := db.UpsertWrapup(ctx, "agent@example.com", Wrapup{
		ContactID: "c-1", PhoneNumber: "+15550001", Incident: "INC-1", Mood: "intense", Thoughts: "loud",
	})
	assert.Nil(t, err)
	assert.Equal(t, first.Agent, "agent@example.com")
	assert.True(t, first.Timestamp > 0)

	_, err = db.UpsertWrapup(ctx, "other@example.com", Wrapup{
		ContactID: "c-2", PhoneNumber: "+15550001", Mood: "friendly",
	})
	assert.Nil(t, err)

	// Saving the same contact again edits it and keeps the original timestamp.
	edited, err := db.UpsertWrapup(ctx, "agent@example.com", Wrapup{
		ContactID: "c-1", PhoneNumber: "+15550001", Incident: "INC-2", Mood: "spam",
	})
	assert.Nil(t, err)
	assert.Equal(t, edited.Incident, "INC-2")
	assert.Equal(t, edited.Thoughts, "")
	assert.Equal(t, edited.Timestamp, first.Timestamp)

	wrapups, err = db.GetWrapups(ctx, "+15550001", 0)
	assert.Nil(t, err)
	assert.Equal(t, len(wrapups), 2)
	assert.Equal(t, wrapups[0].ContactID, "c-2")

	wrapups, err = db.GetWrapups(ctx, "+15550001", 1)
	assert.Nil(t, err)
	assert.Equal(t, len(wrapups), 1)

	wrapups, err = db.GetWrapups(ctx, "+15559999", 0)
	assert.Nil(t, err)
	assert.Equal(t, len(wrapups), 0)
}

func TestSettings(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)

	s, err := db.GetSettings(ctx, "alice")
	assert.Nil(t, err)
	assert.Equal(t, s.Theme, "")

	_, err = db.SaveSettings(ctx, "alice", Settings{Theme: "dracula"})
	assert.Nil(t, err)
	_, err = db.SaveSettings(ctx, "alice", Settings{Theme: "nord", FollowTeamMeeting: true})
	assert.Nil(t, err)

	s, err = db.GetSettings(ctx, "alice")
	assert.Nil(t, err)
	assert.Equal(t, s.Theme, "nord")
	assert.Equal(t, s.FollowTeamMeeting, true)

	s, err = db.GetSettings(ctx, "bob")
	assert.Nil(t, err)
	assert.Equal(t, s.Theme, "")
}

func TestCallLogs(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)

	_, err := db.AppendCallLog(ctx, "alice", CallLog{
		ContactID: "c-1", PhoneNumber: "+15550001", Inbound: true,
		Entries: []LogEntry{{Time: 1, Source: "app", Level: "info", Message: "connecting"}},
	})
	assert.Nil(t, err)

	saved, err := db.AppendCallLog(ctx, "alice", CallLog{
		ContactID: "c-1", Outcome: "failed", EndedAt: 99,
		Entries: []LogEntry{{Time: 2, Source: "console", Level: "error", Message: "boom"}},
	})
	assert.Nil(t, err)
	assert.Equal(t, saved.PhoneNumber, "+15550001")
	assert.Equal(t, saved.Outcome, "failed")
	assert.Equal(t, saved.EndedAt, int64(99))
	assert.Equal(t, saved.EntryCount, 2)
	assert.Equal(t, saved.ErrorCount, 1)

	logs, err := db.ListCallLogs(ctx, "alice", 10)
	assert.Nil(t, err)
	assert.Equal(t, len(logs), 1)
	assert.Equal(t, len(logs[0].Entries), 0)

	full, found, err := db.GetCallLog(ctx, "alice", "c-1")
	assert.Nil(t, err)
	assert.Equal(t, found, true)
	assert.Equal(t, len(full.Entries), 2)
	assert.Equal(t, full.Entries[1].Message, "boom")

	// Another agent cannot read it.
	_, found, err = db.GetCallLog(ctx, "bob", "c-1")
	assert.Nil(t, err)
	assert.Equal(t, found, false)

	// The oldest entries are dropped past the cap.
	many := make([]LogEntry, MaxCallLogEntries)
	for i := range many {
		many[i] = LogEntry{Time: int64(100 + i), Level: "info"}
	}
	saved, err = db.AppendCallLog(ctx, "alice", CallLog{ContactID: "c-1", Entries: many})
	assert.Nil(t, err)
	assert.Equal(t, saved.EntryCount, MaxCallLogEntries)
	assert.Equal(t, saved.ErrorCount, 0)
	assert.Equal(t, saved.Outcome, "failed")
}

func TestFlowCalls(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)

	assert.Nil(t, db.UpsertFlowCall(ctx, FlowCall{ContactID: "c-1", PhoneNumber: "+15550001", InitiatedAt: 1000}))
	assert.Nil(t, db.UpsertFlowCall(ctx, FlowCall{ContactID: "c-2", PhoneNumber: "+15550002", InitiatedAt: 2000}))
	assert.Nil(t, db.UpsertFlowCall(ctx, FlowCall{
		ContactID: "c-1", PhoneNumber: "+15550001", QueueName: "Support", InitiatedAt: 1000, EnqueuedAt: 1500,
	}))

	calls, err := db.ListFlowCalls(ctx, 0, 0)
	assert.Nil(t, err)
	assert.Equal(t, len(calls), 2)
	assert.Equal(t, calls[0].ContactID, "c-2")
	assert.Equal(t, calls[1].QueueName, "Support")
	assert.Equal(t, calls[1].EnqueuedAt, int64(1500))

	calls, err = db.ListFlowCalls(ctx, 1500, 0)
	assert.Nil(t, err)
	assert.Equal(t, len(calls), 1)

	assert.Nil(t, db.PruneFlowCalls(ctx, 1500))
	calls, err = db.ListFlowCalls(ctx, 0, 0)
	assert.Nil(t, err)
	assert.Equal(t, len(calls), 1)
	assert.Equal(t, calls[0].ContactID, "c-2")
}

func TestFlowCallTimeline(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)

	const q = int64(15 * 60 * 1000)
	base := 1000 * q
	for _, c := range []FlowCall{
		{ContactID: "old", InitiatedAt: base - q},
		{ContactID: "a", InitiatedAt: base + 1, ConnectedAt: base + 10},
		{ContactID: "b", InitiatedAt: base + q - 1, DisconnectedAt: base + q},
		{ContactID: "c", InitiatedAt: base + 2*q + 5},
	} {
		assert.Nil(t, db.UpsertFlowCall(ctx, c))
	}

	buckets, err := db.FlowCallTimeline(ctx, base, 15*time.Minute)
	assert.Nil(t, err)
	assert.Equal(t, len(buckets), 2)

	assert.Equal(t, buckets[0].Start, base+2*q)
	assert.Equal(t, buckets[0].Total, 1)
	assert.Equal(t, buckets[0].Calls[0].ContactID, "c")

	assert.Equal(t, buckets[1].Start, base)
	assert.Equal(t, buckets[1].Total, 2)
	assert.Equal(t, buckets[1].Answered, 1)
	assert.Equal(t, buckets[1].Abandoned, 1)
	assert.Equal(t, buckets[1].Calls[0].ContactID, "b")
}

func TestRecentCallsMergeFlowCalls(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)

	// c-1 was logged by the browser and also seen by the poller; c-2 is an
	// outbound call only the browser logged; c-3 was answered by another agent
	// whose browser never logged it; c-4 was abandoned in queue.
	assert.Nil(t, db.AddPhoneLog(ctx, "agent@example.com", "+15550001", 1000, "c-1"))
	assert.Nil(t, db.AddPhoneLog(ctx, "agent@example.com", "+15550002", 2000, "c-2"))
	assert.Nil(t, db.UpsertFlowCall(ctx, FlowCall{
		ContactID: "c-1", PhoneNumber: "+15550001", QueueName: "Support", AgentName: "Ann Agent",
		AgentUsername: "Agent@example.com", InitiatedAt: 900, EnqueuedAt: 950, ConnectedAt: 1100,
	}))
	assert.Nil(t, db.UpsertFlowCall(ctx, FlowCall{
		ContactID: "c-3", PhoneNumber: "+15550003", AgentName: "Oz Other",
		AgentUsername: "other@example.com", InitiatedAt: 2900, EnqueuedAt: 2950, ConnectedAt: 3000,
	}))
	assert.Nil(t, db.UpsertFlowCall(ctx, FlowCall{
		ContactID: "c-4", PhoneNumber: "+15550004", InitiatedAt: 3500, EnqueuedAt: 3600, DisconnectedAt: 3700,
	}))

	calls, err := db.ListRecentCalls(ctx, "agent@example.com", 0, 0)
	assert.Nil(t, err)
	assert.Equal(t, len(calls), 2)
	assert.Equal(t, calls[0].ContactID, "c-2")
	assert.Equal(t, calls[0].ConnectedAt, int64(0))
	assert.Equal(t, calls[1].ContactID, "c-1")
	assert.Equal(t, calls[1].Timestamp, int64(1100))
	assert.Equal(t, calls[1].QueueName, "Support")
	assert.Equal(t, calls[1].AgentName, "Ann Agent")
	assert.Equal(t, calls[1].EnqueuedAt, int64(950))

	n, err := db.CountRecentCalls(ctx, "agent@example.com")
	assert.Nil(t, err)
	assert.Equal(t, n, 2)

	calls, err = db.ListRecentCalls(ctx, "", 0, 0)
	assert.Nil(t, err)
	assert.Equal(t, len(calls), 3)
	assert.Equal(t, calls[0].ContactID, "c-3")
	assert.Equal(t, calls[0].Agent, "other@example.com")

	calls, err = db.ListRecentCalls(ctx, "", 1, 2)
	assert.Nil(t, err)
	assert.Equal(t, len(calls), 1)
	assert.Equal(t, calls[0].ContactID, "c-1")

	n, err = db.CountRecentCalls(ctx, "")
	assert.Nil(t, err)
	assert.Equal(t, n, 3)
}

func TestMigrateAddsAgentUsername(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)

	// Simulate a database created before agent_username existed.
	_, err := db.ExecContext(ctx, `DROP INDEX ix_flow_calls_agent`)
	assert.Nil(t, err)
	_, err = db.ExecContext(ctx, `ALTER TABLE flow_calls DROP COLUMN agent_username`)
	assert.Nil(t, err)

	assert.Nil(t, migrate(ctx, db.DB))
	assert.Nil(t, migrate(ctx, db.DB))
	assert.Nil(t, db.UpsertFlowCall(ctx, FlowCall{ContactID: "c-1", AgentUsername: "agent@example.com", ConnectedAt: 1}))

	calls, err := db.ListFlowCalls(ctx, 0, 0)
	assert.Nil(t, err)
	assert.Equal(t, calls[0].AgentUsername, "agent@example.com")
}
