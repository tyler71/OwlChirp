package main

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"github.com/tyler71/owlchirp/app/internal/assert"
	"github.com/tyler71/owlchirp/app/internal/connect"
	"github.com/tyler71/owlchirp/app/internal/database"
)

type fakeFlowSource struct {
	contacts []connect.FlowContact
	lookups  int
	ranges   [][2]time.Time
}

// SearchFlowContacts returns the contacts initiated in [start, end); with
// no contacts set up for the range it returns them all.
func (f *fakeFlowSource) SearchFlowContacts(_ context.Context, start, end time.Time) ([]connect.FlowContact, error) {
	f.ranges = append(f.ranges, [2]time.Time{start, end})
	var out []connect.FlowContact
	for _, c := range f.contacts {
		if !c.InitiatedAt.Before(start) && c.InitiatedAt.Before(end) {
			out = append(out, c)
		}
	}
	return out, nil
}

func (f *fakeFlowSource) CustomerNumber(context.Context, string) (string, error) {
	f.lookups++
	return "+15550001", nil
}

func TestFlowPollerSync(t *testing.T) {
	ctx := context.Background()
	db, err := database.New(filepath.Join(t.TempDir(), "test.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	start := time.Now().Add(-time.Minute)
	src := &fakeFlowSource{contacts: []connect.FlowContact{{ID: "c-1", InitiatedAt: start}}}
	var sent []database.FlowCall
	p := &flowPoller{
		source:    src,
		db:        db,
		broadcast: func(_ string, data any) { sent = append(sent, data.(database.FlowCall)) },
		logger:    slog.New(slog.NewTextHandler(io.Discard, nil)),
		known:     make(map[string]database.FlowCall),
	}

	assert.Nil(t, p.sync(ctx))
	assert.Equal(t, len(sent), 1)
	assert.Equal(t, sent[0].PhoneNumber, "+15550001")

	// Unchanged contacts are neither looked up again nor rebroadcast.
	assert.Nil(t, p.sync(ctx))
	assert.Equal(t, len(sent), 1)
	assert.Equal(t, src.lookups, 1)

	src.contacts[0].EnqueuedAt = start.Add(10 * time.Second)
	src.contacts[0].QueueName = "Support"
	assert.Nil(t, p.sync(ctx))
	assert.Equal(t, len(sent), 2)
	assert.Equal(t, sent[1].QueueName, "Support")
	assert.Equal(t, sent[1].PhoneNumber, "+15550001")

	calls, err := db.ListFlowCalls(ctx, 0, 0)
	assert.Nil(t, err)
	assert.Equal(t, len(calls), 1)
	assert.Equal(t, calls[0].EnqueuedAt, start.Add(10*time.Second).UnixMilli())
}

func TestBackfillFlowCalls(t *testing.T) {
	ctx := context.Background()
	db, err := database.New(filepath.Join(t.TempDir(), "test.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	now := time.Now()
	src := &fakeFlowSource{contacts: []connect.FlowContact{
		{ID: "old", InitiatedAt: now.Add(-50 * 24 * time.Hour)},
		{ID: "mid", InitiatedAt: now.Add(-10 * 24 * time.Hour)},
		{ID: "stored", InitiatedAt: now.Add(-2 * 24 * time.Hour), AgentName: "Ann Agent", AgentUsername: "ann"},
	}}
	// Stored before agent usernames were recorded.
	assert.Nil(t, db.UpsertFlowCall(ctx, database.FlowCall{
		ContactID: "stored", PhoneNumber: "+15550009", AgentName: "Ann Agent",
		InitiatedAt: src.contacts[2].InitiatedAt.UnixMilli(),
	}))

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	backfillFlowCalls(ctx, src, db, logger, time.Millisecond)

	// Chunks are at most 2 weeks, contiguous, and span the whole window.
	assert.Equal(t, len(src.ranges), 4)
	for i, r := range src.ranges {
		if r[1].Sub(r[0]) > flowBackfillChunk {
			t.Errorf("chunk %d spans %v", i, r[1].Sub(r[0]))
		}
		if i > 0 && !r[0].Equal(src.ranges[i-1][1]) {
			t.Errorf("chunk %d leaves a gap", i)
		}
	}
	if d := src.ranges[0][0].Sub(now.Add(-timelineWindow)); d < 0 || d > time.Second {
		t.Errorf("backfill starts %v off the window", d)
	}

	// Only the two new contacts are looked up and stored; the stored one gains
	// its agent username and keeps its number.
	assert.Equal(t, src.lookups, 2)
	calls, err := db.ListFlowCalls(ctx, 0, 0)
	assert.Nil(t, err)
	assert.Equal(t, len(calls), 3)
	for _, c := range calls {
		if c.ContactID == "stored" {
			assert.Equal(t, c.AgentUsername, "ann")
			assert.Equal(t, c.PhoneNumber, "+15550009")
		}
	}
}
