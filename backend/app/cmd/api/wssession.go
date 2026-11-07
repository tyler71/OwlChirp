package main

import (
	"context"
	"sync"
	"time"

	"github.com/tyler71/owlchirp/app/internal/realtime"
)

const (
	wsPushBuffer = 64
	// wsPushWait is how long an important push waits for room in a full
	// buffer before it is dropped.
	wsPushWait = 2 * time.Second
)

// wsSession is per-connection state: a channel for events sent to this
// connection only, and the connection's background jobs (a transcription).
// Its context ends when the connection closes.
type wsSession struct {
	ctx  context.Context
	push chan []byte

	mu   sync.Mutex
	jobs map[string]*wsJob
}

type wsJob struct{ cancel context.CancelFunc }

type wsSessionKey struct{}

func newWSSession(ctx context.Context) *wsSession {
	return &wsSession{ctx: ctx, push: make(chan []byte, wsPushBuffer), jobs: map[string]*wsJob{}}
}

func withSession(ctx context.Context, s *wsSession) context.Context {
	return context.WithValue(ctx, wsSessionKey{}, s)
}

func sessionFrom(ctx context.Context) *wsSession {
	s, _ := ctx.Value(wsSessionKey{}).(*wsSession)
	return s
}

// send pushes an event to this connection. Droppable events are discarded
// when the buffer is full; others wait briefly. It reports whether the
// event was queued.
func (s *wsSession) send(typ string, data any, droppable bool) bool {
	msg, err := realtime.Message(typ, data)
	if err != nil {
		return false
	}
	if droppable {
		select {
		case s.push <- msg:
			return true
		default:
			return false
		}
	}
	t := time.NewTimer(wsPushWait)
	defer t.Stop()
	select {
	case s.push <- msg:
		return true
	case <-s.ctx.Done():
	case <-t.C:
	}
	return false
}

// start runs job under name in the background on the connection's
// context, cancelling any job already running under that name. done is
// called after the job finishes, unless a newer job replaced it; cancelled
// reports whether it was stopped (stopJob or the connection closing).
func (s *wsSession) start(name string, job func(ctx context.Context) error, done func(err error, cancelled bool)) {
	ctx, cancel := context.WithCancel(s.ctx)
	j := &wsJob{cancel: cancel}

	s.mu.Lock()
	if prev, ok := s.jobs[name]; ok {
		prev.cancel()
	}
	s.jobs[name] = j
	s.mu.Unlock()

	go func() {
		err := job(ctx)
		cancelled := ctx.Err() != nil
		cancel()

		s.mu.Lock()
		current := s.jobs[name] == j
		if current {
			delete(s.jobs, name)
		}
		s.mu.Unlock()

		if current && done != nil {
			done(err, cancelled)
		}
	}()
}

// stopJob cancels the named job; it reports whether one was running.
func (s *wsSession) stopJob(name string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.jobs[name]
	if ok {
		j.cancel()
	}
	return ok
}

func (s *wsSession) close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, j := range s.jobs {
		j.cancel()
	}
}
