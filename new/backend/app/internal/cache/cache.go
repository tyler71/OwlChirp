// Package cache provides small in-memory TTL caches used to avoid hammering
// the Amazon Connect API. Fetches are serialized per key so concurrent callers
// share a single upstream request.
package cache

import (
	"context"
	"sync"
	"time"
)

// Value caches the result of a single fetch function for ttl.
type Value[T any] struct {
	ttl     time.Duration
	fetch   func(ctx context.Context) (T, error)
	mu      sync.Mutex
	value   T
	expires time.Time
}

func NewValue[T any](ttl time.Duration, fetch func(ctx context.Context) (T, error)) *Value[T] {
	return &Value[T]{ttl: ttl, fetch: fetch}
}

func (c *Value[T]) Get(ctx context.Context) (T, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if time.Now().Before(c.expires) {
		return c.value, nil
	}

	v, err := c.fetch(ctx)
	if err != nil {
		var zero T
		return zero, err
	}

	c.value = v
	c.expires = time.Now().Add(c.ttl)
	return v, nil
}

// Map caches fetch results per key for ttl. When more than maxSize entries
// are held, expired entries are dropped, then everything if still too large.
type Map[K comparable, V any] struct {
	ttl     time.Duration
	maxSize int
	fetch   func(ctx context.Context, key K) (V, error)

	mu      sync.Mutex
	entries map[K]*entry[V]
}

type entry[V any] struct {
	mu      sync.Mutex
	value   V
	expires time.Time
}

func NewMap[K comparable, V any](ttl time.Duration, maxSize int, fetch func(ctx context.Context, key K) (V, error)) *Map[K, V] {
	return &Map[K, V]{ttl: ttl, maxSize: maxSize, fetch: fetch, entries: make(map[K]*entry[V])}
}

func (c *Map[K, V]) Get(ctx context.Context, key K) (V, error) {
	c.mu.Lock()
	e, ok := c.entries[key]
	if !ok {
		c.evict()
		e = &entry[V]{}
		c.entries[key] = e
	}
	c.mu.Unlock()

	e.mu.Lock()
	defer e.mu.Unlock()

	if time.Now().Before(e.expires) {
		return e.value, nil
	}

	v, err := c.fetch(ctx, key)
	if err != nil {
		var zero V
		return zero, err
	}

	e.value = v
	e.expires = time.Now().Add(c.ttl)
	return v, nil
}

// evict must be called with c.mu held.
func (c *Map[K, V]) evict() {
	if len(c.entries) < c.maxSize {
		return
	}

	now := time.Now()
	for k, e := range c.entries {
		if e.mu.TryLock() {
			if now.After(e.expires) {
				delete(c.entries, k)
			}
			e.mu.Unlock()
		}
	}

	if len(c.entries) >= c.maxSize {
		c.entries = make(map[K]*entry[V])
	}
}
