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
	timelineWindow = 48 * time.Hour
	timelineBucket = 15 * time.Minute
	timelineTTL    = 30 * time.Minute
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
	SearchFlowContacts(ctx context.Context, since time.Time) ([]connect.FlowContact, error)
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

	contacts, err := p.source.SearchFlowContacts(ctx, since)
	if err != nil {
		return err
	}

	for _, fc := range contacts {
		call := database.FlowCall{
			ContactID:      fc.ID,
			QueueName:      fc.QueueName,
			AgentName:      fc.AgentName,
			InitiatedAt:    unixMilli(fc.InitiatedAt),
			EnqueuedAt:     unixMilli(fc.EnqueuedAt),
			ConnectedAt:    unixMilli(fc.ConnectedAt),
			DisconnectedAt: unixMilli(fc.DisconnectedAt),
		}

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
