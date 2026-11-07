package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/tyler71/owlchirp/app/internal/connect"
	"github.com/tyler71/owlchirp/app/internal/database"
)

const (
	// flowWindow is how far back each poll searches, so calls that sit in
	// the flow or queue for a while keep getting updates.
	flowWindow = 30 * time.Minute
	// flowMaxLookback bounds the search when an older call is still open.
	flowMaxLookback = 12 * time.Hour
	flowMaxBackoff  = time.Minute
	flowPruneEvery  = time.Hour

	// The timeline groups the last timelineWindow of calls into
	// timelineBucket slots and is rebuilt at most once per timelineTTL.
	// 8 weeks is the widest range SearchContacts accepts in one query.
	timelineWindow = 8 * 7 * 24 * time.Hour
	timelineBucket = 15 * time.Minute
	timelineTTL    = 30 * time.Minute

	// The startup backfill searches in chunks of at most 2 weeks (wider
	// ranges are throttled to 1 request/s) and paces caller-number lookups.
	flowBackfillChunk = 14 * 24 * time.Hour
	flowBackfillPace  = 500 * time.Millisecond
)

// flowTimeline is the cached reply to "flowcalls.timeline".
type flowTimeline struct {
	GeneratedAt   int64                     `json:"generatedAt"`
	Hours         int                       `json:"hours"`
	BucketMinutes int                       `json:"bucketMinutes"`
	Buckets       []database.FlowCallBucket `json:"buckets"`
}

func (app *application) buildTimeline(ctx context.Context) (flowTimeline, error) {
	now := time.Now()
	buckets, err := app.db.FlowCallTimeline(ctx, now.Add(-timelineWindow).UnixMilli(), timelineBucket)
	if err != nil {
		return flowTimeline{}, err
	}
	return flowTimeline{
		GeneratedAt:   now.UnixMilli(),
		Hours:         int(timelineWindow / time.Hour),
		BucketMinutes: int(timelineBucket / time.Minute),
		Buckets:       buckets,
	}, nil
}

type flowContactSource interface {
	SearchFlowContacts(ctx context.Context, start, end time.Time) ([]connect.FlowContact, error)
	CustomerNumber(ctx context.Context, contactID string) (string, error)
}

// flowPoller mirrors inbound contacts from SearchContacts into the
// flow_calls table and broadcasts "flowcall.updated" when one changes.
type flowPoller struct {
	source    flowContactSource
	db        *database.DB
	broadcast func(typ string, data any)
	logger    *slog.Logger
	// known holds the last stored state of recent calls.
	known map[string]database.FlowCall
}

// pollFlowCalls runs until ctx is cancelled. It polls whether or not anyone
// is connected so the history has no gaps.
func (app *application) pollFlowCalls(ctx context.Context) {
	interval := app.config.flowCalls.interval
	if interval <= 0 {
		app.logger.Info("flow calls polling disabled")
		return
	}

	go backfillFlowCalls(ctx, app.connect, app.db, app.logger, flowBackfillPace)

	p := &flowPoller{
		source:    app.connect,
		db:        app.db,
		broadcast: app.broadcast,
		logger:    app.logger,
		known:     make(map[string]database.FlowCall),
	}

	recent, err := app.db.ListFlowCalls(ctx, time.Now().Add(-flowMaxLookback).UnixMilli(), 0)
	if err != nil {
		app.logger.Error("flow calls: load recent", "error", err)
	}
	for _, c := range recent {
		p.known[c.ContactID] = c
	}

	delay := interval
	var lastPrune time.Time
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}

		if err := p.sync(ctx); err != nil {
			// Usually throttling; back off instead of making it worse.
			delay = min(delay*2, flowMaxBackoff)
			app.logger.Warn("flow calls: sync", "error", err, "retry_in", delay)
			continue
		}
		delay = interval

		if time.Since(lastPrune) > flowPruneEvery {
			lastPrune = time.Now()
			cutoff := time.Now().Add(-app.config.flowCalls.retention).UnixMilli()
			if err := app.db.PruneFlowCalls(ctx, cutoff); err != nil {
				app.logger.Error("flow calls: prune", "error", err)
			}
		}
	}
}

// sync fetches recent contacts and stores and broadcasts the ones that changed.
func (p *flowPoller) sync(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	now := time.Now()
	since := now.Add(-flowWindow)
	oldest := now.Add(-flowMaxLookback)
	for id, c := range p.known {
		started := time.UnixMilli(c.InitiatedAt)
		if started.Before(oldest) {
			delete(p.known, id)
			continue
		}
		if flowCallOpen(c) && started.Before(since) {
			since = started
		}
	}

	contacts, err := p.source.SearchFlowContacts(ctx, since, now)
	if err != nil {
		return err
	}

	for _, fc := range contacts {
		call := flowCallFrom(fc, "")

		prev, seen := p.known[fc.ID]
		if seen {
			call.PhoneNumber = prev.PhoneNumber
		} else {
			// Search results don't carry the caller's number; look it up once.
			number, err := p.source.CustomerNumber(ctx, fc.ID)
			if err != nil {
				p.logger.Warn("flow calls: customer number", "contact_id", fc.ID, "error", err)
			}
			call.PhoneNumber = number
		}

		if seen && prev == call {
			continue
		}
		if err := p.db.UpsertFlowCall(ctx, call); err != nil {
			return err
		}
		p.known[fc.ID] = call
		p.broadcast("flowcall.updated", call)
	}
	return nil
}

// flowCallFrom converts a searched contact into its stored form.
func flowCallFrom(fc connect.FlowContact, phoneNumber string) database.FlowCall {
	return database.FlowCall{
		ContactID:      fc.ID,
		PhoneNumber:    phoneNumber,
		QueueName:      fc.QueueName,
		AgentName:      fc.AgentName,
		AgentUsername:  fc.AgentUsername,
		InitiatedAt:    unixMilli(fc.InitiatedAt),
		EnqueuedAt:     unixMilli(fc.EnqueuedAt),
		ConnectedAt:    unixMilli(fc.ConnectedAt),
		DisconnectedAt: unixMilli(fc.DisconnectedAt),
	}
}

// flowCallOpen reports whether c is still in the flow or queue.
func flowCallOpen(c database.FlowCall) bool {
	return c.DisconnectedAt == 0 && c.ConnectedAt == 0
}

func unixMilli(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.UnixMilli()
}

// backfillFlowCalls fills flow_calls with the timelineWindow of history
// that predates the live poller, so the timeline isn't empty after a fresh
// start. Contacts already stored are skipped, which makes restarts cheap.
func backfillFlowCalls(ctx context.Context, src flowContactSource, db *database.DB, logger *slog.Logger, pace time.Duration) {
	now := time.Now()
	end := now.Add(-flowWindow) // the poller covers the rest
	tick := time.NewTicker(pace)
	defer tick.Stop()

	added := 0
	for start := now.Add(-timelineWindow); start.Before(end); start = start.Add(flowBackfillChunk) {
		chunkEnd := start.Add(flowBackfillChunk)
		if chunkEnd.After(end) {
			chunkEnd = end
		}
		n, err := backfillChunk(ctx, src, db, logger, tick.C, start, chunkEnd)
		added += n
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			logger.Warn("flow calls: backfill chunk", "start", start, "end", chunkEnd, "error", err)
		}
	}
	logger.Info("flow calls: backfill done", "added", added)
}

func backfillChunk(ctx context.Context, src flowContactSource, db *database.DB, logger *slog.Logger,
	tick <-chan time.Time, start, end time.Time) (int, error) {
	stored, err := db.ListFlowCalls(ctx, start.UnixMilli(), 0)
	if err != nil {
		return 0, err
	}
	have := make(map[string]database.FlowCall, len(stored))
	for _, c := range stored {
		have[c.ContactID] = c
	}

	contacts, err := src.SearchFlowContacts(ctx, start, end)
	if err != nil {
		return 0, err
	}

	added := 0
	for _, fc := range contacts {
		if prev, ok := have[fc.ID]; ok {
			// Rows stored before agent usernames were recorded get filled in;
			// the number is already known, so no extra lookup is needed.
			if prev.AgentUsername == "" && fc.AgentUsername != "" {
				if err := db.UpsertFlowCall(ctx, flowCallFrom(fc, prev.PhoneNumber)); err != nil {
					return added, err
				}
			}
			continue
		}
		select {
		case <-ctx.Done():
			return added, ctx.Err()
		case <-tick:
		}
		number, err := src.CustomerNumber(ctx, fc.ID)
		if err != nil {
			logger.Warn("flow calls: customer number", "contact_id", fc.ID, "error", err)
		}
		call := flowCallFrom(fc, number)
		if err := db.UpsertFlowCall(ctx, call); err != nil {
			return added, err
		}
		have[fc.ID] = call
		added++
	}
	return added, nil
}
