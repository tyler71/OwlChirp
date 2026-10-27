package database

import (
	"context"
	"path/filepath"
	"testing"

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

	calls, err := db.GetAgentCalls(ctx, "agent@example.com", 10)
	assert.Nil(t, err)
	assert.Equal(t, len(calls), 0)

	assert.Nil(t, db.AddPhoneLog(ctx, "agent@example.com", "+15550001", 1000, "c-1"))
	assert.Nil(t, db.AddPhoneLog(ctx, "agent@example.com", "+15550002", 2000, "c-2"))
	assert.Nil(t, db.AddPhoneLog(ctx, "other@example.com", "+15550001", 3000, "c-3"))

	calls, err = db.GetAgentCalls(ctx, "agent@example.com", 0)
	assert.Nil(t, err)
	assert.Equal(t, len(calls), 2)
	assert.Equal(t, calls[0].ContactID, "c-2")

	calls, err = db.GetAgentCalls(ctx, "agent@example.com", 1)
	assert.Nil(t, err)
	assert.Equal(t, len(calls), 1)

	calls, err = db.GetPhoneCalls(ctx, "+15550001", 10)
	assert.Nil(t, err)
	assert.Equal(t, len(calls), 2)
	assert.Equal(t, calls[0].Agent, "other@example.com")

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
}
