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
}

func (f *fakeFlowSource) SearchFlowContacts(context.Context, time.Time) ([]connect.FlowContact, error) {
	return f.contacts, nil
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
