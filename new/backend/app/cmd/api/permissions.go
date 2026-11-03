package main

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"sync"

	"github.com/tyler71/owlchirp/app/internal/connect"
	"github.com/tyler71/owlchirp/app/internal/features"
)

// hardcodedAdmins always have every feature, whatever the database says, and
// can't be changed from the Admin section.
var hardcodedAdmins = map[string]bool{
	"tyyeager@seattleschools.org": true,
}

// permissionStore caches the features admins have granted. The database is
// the source of truth; the cache lets every request check the current
// features without a query.
type permissionStore struct {
	mu   sync.RWMutex
	sets map[string][]string
}

func newPermissionStore(sets map[string][]string) *permissionStore {
	if sets == nil {
		sets = make(map[string][]string)
	}
	return &permissionStore{sets: sets}
}

// get returns username's features and where they come from.
func (s *permissionStore) get(username string) ([]string, string) {
	if hardcodedAdmins[username] {
		return slices.Clone(features.All), sourceHardcoded
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if list, ok := s.sets[username]; ok {
		return slices.Clone(list), sourceDB
	}
	return []string{}, sourceDefault
}

// features returns username's features; users without a saved set have none.
func (s *permissionStore) features(username string) []string {
	list, _ := s.get(username)
	return list
}

// has reports whether username has feature.
func (s *permissionStore) has(username, feature string) bool {
	if hardcodedAdmins[username] {
		return true
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return slices.Contains(s.sets[username], feature)
}

func (s *permissionStore) set(username string, list []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sets[username] = slices.Clone(list)
}

func (s *permissionStore) delete(username string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sets, username)
}

// Where a user's features come from.
const (
	sourceDB        = "db"
	sourceDefault   = "default"
	sourceHardcoded = "hardcoded"
)

type managedUser struct {
	Username string   `json:"username"`
	Features []string `json:"features"`
	Source   string   `json:"source"`
}

func (app *application) managedUser(username string) managedUser {
	list, source := app.perms.get(username)
	return managedUser{Username: username, Features: list, Source: source}
}

// wsListUsers returns every registered Connect user with their features,
// ordered by username.
func (app *application) wsListUsers(ctx context.Context, _ connect.RegisteredUser, _ json.RawMessage) (any, error) {
	registered, err := app.users.RegisteredUsers(ctx)
	if err != nil {
		return nil, err
	}

	users := make([]managedUser, len(registered))
	for i, u := range registered {
		users[i] = app.managedUser(u.Username)
	}
	slices.SortFunc(users, func(a, b managedUser) int {
		return strings.Compare(strings.ToLower(a.Username), strings.ToLower(b.Username))
	})
	return users, nil
}

// requireOtherUser checks that username is a registered Connect user other
// than the caller; admins can't change their own features so they can't lock
// themselves out.
func (app *application) requireOtherUser(ctx context.Context, caller connect.RegisteredUser, username string) error {
	if err := requireField("username", username); err != nil {
		return err
	}
	if username == caller.Username {
		return clientError("you can't change your own permissions")
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

// wsSetFeatures saves the features granted to a user. The change applies to
// the user's next request; "permission.updated" lets their UI follow without
// reconnecting.
func (app *application) wsSetFeatures(ctx context.Context, user connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		Username string   `json:"username"`
		Features []string `json:"features"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	list, ok := features.Normalize(input.Features)
	if !ok {
		return nil, clientError("unknown feature")
	}
	if err := app.requireOtherUser(ctx, user, input.Username); err != nil {
		return nil, err
	}

	if err := app.db.SetFeatures(ctx, input.Username, list); err != nil {
		return nil, err
	}
	app.perms.set(input.Username, list)

	updated := app.managedUser(input.Username)
	app.broadcast("permission.updated", updated)
	return updated, nil
}

// wsResetFeatures removes a user's saved features, leaving them with none.
func (app *application) wsResetFeatures(ctx context.Context, user connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		Username string `json:"username"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	if err := app.requireOtherUser(ctx, user, input.Username); err != nil {
		return nil, err
	}

	if _, err := app.db.DeleteFeatures(ctx, input.Username); err != nil {
		return nil, err
	}
	app.perms.delete(input.Username)

	updated := app.managedUser(input.Username)
	app.broadcast("permission.updated", updated)
	return updated, nil
}
