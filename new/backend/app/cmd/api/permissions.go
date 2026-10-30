package main

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"sync"

	"github.com/tyler71/owlchirp/app/internal/connect"
	"github.com/tyler71/owlchirp/app/internal/flags"
)

// hardcodedAdmins are always admin, whatever the database or feature flag
// says, and can't be changed from the Admin section.
var hardcodedAdmins = map[string]bool{
	"tyyeager@seattleschools.org": true,
}

// permissionStore caches the levels admins have set, which override the
// owlchirp feature flag. The database is the source of truth; the cache lets
// every request check the current level without a query.
type permissionStore struct {
	mu     sync.RWMutex
	levels map[string]int
}

func newPermissionStore(levels map[string]int) *permissionStore {
	if levels == nil {
		levels = make(map[string]int)
	}
	return &permissionStore{levels: levels}
}

func (s *permissionStore) get(username string) (int, bool) {
	if hardcodedAdmins[username] {
		return flags.Admin, true
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	level, ok := s.levels[username]
	return level, ok
}

// level returns username's set level, or flagLevel when none is set.
func (s *permissionStore) level(username string, flagLevel int) int {
	if level, ok := s.get(username); ok {
		return level
	}
	return flagLevel
}

func (s *permissionStore) set(username string, level int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.levels[username] = level
}

func (s *permissionStore) delete(username string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.levels, username)
}

// Where a user's level comes from.
const (
	sourceDB        = "db"
	sourceFlag      = "flag"
	sourceHardcoded = "hardcoded"
)

type managedUser struct {
	Username string `json:"username"`
	Level    int    `json:"level"`
	Source   string `json:"source"`
}

// wsListUsers returns every registered Connect user with their permission
// level, ordered by username.
func (app *application) wsListUsers(ctx context.Context, _ connect.RegisteredUser, _ json.RawMessage) (any, error) {
	registered, err := app.users.RegisteredUsers(ctx)
	if err != nil {
		return nil, err
	}

	// Flag evaluations are remote calls, so run them concurrently.
	users := make([]managedUser, len(registered))
	var wg sync.WaitGroup
	for i, u := range registered {
		if hardcodedAdmins[u.Username] {
			users[i] = managedUser{Username: u.Username, Level: flags.Admin, Source: sourceHardcoded}
			continue
		}
		if level, ok := app.perms.get(u.Username); ok {
			users[i] = managedUser{Username: u.Username, Level: level, Source: sourceDB}
			continue
		}
		wg.Go(func() {
			users[i] = managedUser{Username: u.Username, Level: app.flags.Permission(ctx, u.Username), Source: sourceFlag}
		})
	}
	wg.Wait()

	slices.SortFunc(users, func(a, b managedUser) int {
		return strings.Compare(strings.ToLower(a.Username), strings.ToLower(b.Username))
	})
	return users, nil
}

// requireOtherUser checks that username is a registered Connect user other
// than the caller; admins can't change their own level so they can't lock
// themselves out.
func (app *application) requireOtherUser(ctx context.Context, caller connect.RegisteredUser, username string) error {
	if err := requireField("username", username); err != nil {
		return err
	}
	if username == caller.Username {
		return clientError("you can't change your own permission")
	}
	if hardcodedAdmins[username] {
		return clientError("this user is always an admin")
	}

	registered, err := app.users.RegisteredUsers(ctx)
	if err != nil {
		return err
	}
	if !slices.ContainsFunc(registered, func(u connect.RegisteredUser) bool { return u.Username == username }) {
		return clientError("user not found")
	}
	return nil
}

// wsSetPermission sets a user's level, overriding the feature flag. The
// change applies to the user's next request; "permission.updated" lets their
// UI follow without reconnecting.
func (app *application) wsSetPermission(ctx context.Context, user connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		Username string `json:"username"`
		Level    int    `json:"level"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	if input.Level < flags.Standard || input.Level > flags.Admin {
		return nil, clientError("level must be 0 (standard), 1 (power) or 2 (admin)")
	}
	if err := app.requireOtherUser(ctx, user, input.Username); err != nil {
		return nil, err
	}

	if err := app.db.SetPermission(ctx, input.Username, input.Level); err != nil {
		return nil, err
	}
	app.perms.set(input.Username, input.Level)

	updated := managedUser{Username: input.Username, Level: input.Level, Source: sourceDB}
	app.broadcast("permission.updated", updated)
	return updated, nil
}

// wsResetPermission removes a user's set level so the feature flag decides
// again.
func (app *application) wsResetPermission(ctx context.Context, user connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		Username string `json:"username"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	if err := app.requireOtherUser(ctx, user, input.Username); err != nil {
		return nil, err
	}

	if _, err := app.db.DeletePermission(ctx, input.Username); err != nil {
		return nil, err
	}
	app.perms.delete(input.Username)

	updated := managedUser{Username: input.Username, Level: app.flags.Permission(ctx, input.Username), Source: sourceFlag}
	app.broadcast("permission.updated", updated)
	return updated, nil
}
