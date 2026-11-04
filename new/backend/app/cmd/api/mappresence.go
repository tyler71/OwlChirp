package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/tyler71/owlchirp/app/internal/connect"
	"github.com/tyler71/owlchirp/app/internal/database"
)

// Map world size in pixels. Mirrors WORLD_W/WORLD_H in the frontend's
// components/map/world.ts (48x32 tiles of 16px).
const (
	mapWidth  = 48 * 16
	mapHeight = 32 * 16

	maxBuildingNameLength = 30
	maxBuildingPatterns   = 20

	// mapMoveInterval is the shortest gap between accepted moves per user;
	// faster moves are dropped. Clients send at most ~10/s.
	mapMoveInterval = 50 * time.Millisecond
)

// Spawn area: the plaza in front of Techline HQ.
var mapSpawn = struct{ minX, maxX, minY, maxY float64 }{19 * 16, 29 * 16, 17*16 + 8, 19 * 16}

// mapPlayer is one Owlchirp user on the map. Everyone with Owlchirp open is
// on the map, in every tab they have open at the same spot.
type mapPlayer struct {
	Username string  `json:"username"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Dir      string  `json:"dir"`

	conns    int
	lastMove time.Time
}

// mapPresence tracks who is on the map. Positions live only in memory: the
// map resets when the server restarts. The zero value is ready to use.
type mapPresence struct {
	mu      sync.Mutex
	players map[string]*mapPlayer
}

// join adds a connection for username. joined is true for the user's first
// connection, when they appear on the map.
func (p *mapPresence) join(username string) (player mapPlayer, joined bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.players == nil {
		p.players = make(map[string]*mapPlayer)
	}
	pl, ok := p.players[username]
	if !ok {
		pl = &mapPlayer{
			Username: username,
			X:        mapSpawn.minX + rand.Float64()*(mapSpawn.maxX-mapSpawn.minX),
			Y:        mapSpawn.minY + rand.Float64()*(mapSpawn.maxY-mapSpawn.minY),
			Dir:      "down",
		}
		p.players[username] = pl
	}
	pl.conns++
	return *pl, !ok
}

// leave drops a connection for username. left is true when it was their
// last one and they are no longer on the map.
func (p *mapPresence) leave(username string) (left bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	pl, ok := p.players[username]
	if !ok {
		return false
	}
	pl.conns--
	if pl.conns > 0 {
		return false
	}
	delete(p.players, username)
	return true
}

// move updates username's position. ok is false when the user isn't on the
// map or moved too recently.
func (p *mapPresence) move(username string, x, y float64, dir string, now time.Time) (mapPlayer, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	pl, found := p.players[username]
	if !found || now.Sub(pl.lastMove) < mapMoveInterval {
		return mapPlayer{}, false
	}
	pl.X, pl.Y, pl.Dir, pl.lastMove = clamp(x, 0, mapWidth), clamp(y, 0, mapHeight), dir, now
	return *pl, true
}

func (p *mapPresence) list() []mapPlayer {
	p.mu.Lock()
	defer p.mu.Unlock()
	players := make([]mapPlayer, 0, len(p.players))
	for _, pl := range p.players {
		players = append(players, *pl)
	}
	return players
}

func clamp(v, lo, hi float64) float64 {
	return max(lo, min(hi, v))
}

var validDirs = map[string]bool{"up": true, "down": true, "left": true, "right": true}

// mapJoin puts user on the map for one connection and returns the matching
// leave, to defer.
func (app *application) mapJoin(user connect.RegisteredUser) func() {
	if player, joined := app.presence.join(user.Username); joined {
		app.broadcast("map.joined", player)
	}
	return func() {
		if app.presence.leave(user.Username) {
			app.broadcast("map.left", map[string]string{"username": user.Username})
		}
	}
}

type mapState struct {
	Buildings []database.Building `json:"buildings"`
	Players   []mapPlayer         `json:"players"`
	Slots     int                 `json:"slots"`
}

func (app *application) wsMapState(ctx context.Context, _ connect.RegisteredUser, _ json.RawMessage) (any, error) {
	buildings, err := app.db.ListBuildings(ctx)
	if err != nil {
		return nil, err
	}
	return mapState{Buildings: buildings, Players: app.presence.list(), Slots: database.MapSlotCount}, nil
}

// wsMapMove moves the user's character. Moves arriving faster than
// mapMoveInterval are dropped without an error; the client sends its final
// position again when it stops.
func (app *application) wsMapMove(_ context.Context, user connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		X   float64 `json:"x"`
		Y   float64 `json:"y"`
		Dir string  `json:"dir"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	if !validDirs[input.Dir] {
		return nil, clientError("dir must be up, down, left or right")
	}
	player, ok := app.presence.move(user.Username, input.X, input.Y, input.Dir, time.Now())
	if !ok {
		return map[string]bool{"accepted": false}, nil
	}
	app.broadcast("map.moved", player)
	return map[string]bool{"accepted": true}, nil
}

type buildingInput struct {
	ID       int64    `json:"id"`
	Name     string   `json:"name"`
	Patterns []string `json:"patterns"`
	Style    int      `json:"style"`
}

// validate trims and normalizes the input in place.
func (in *buildingInput) validate() error {
	in.Name = strings.TrimSpace(in.Name)
	if err := requireField("name", in.Name); err != nil {
		return err
	}
	if utf8.RuneCountInString(in.Name) > maxBuildingNameLength {
		return clientError(fmt.Sprintf("name must be at most %d characters", maxBuildingNameLength))
	}
	if len(in.Patterns) > maxBuildingPatterns {
		return clientError(fmt.Sprintf("at most %d numbers per building", maxBuildingPatterns))
	}
	if in.Style < 0 || in.Style >= database.MapStyleCount {
		return clientError("unknown building style")
	}
	seen := make(map[string]bool)
	patterns := make([]string, 0, len(in.Patterns))
	for _, raw := range in.Patterns {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		p, err := database.NormalizePattern(raw)
		if err != nil {
			return clientError(fmt.Sprintf("%q: %s", raw, err))
		}
		if !seen[p] {
			seen[p] = true
			patterns = append(patterns, p)
		}
	}
	in.Patterns = patterns
	return nil
}

func (app *application) wsListBuildings(ctx context.Context, _ connect.RegisteredUser, _ json.RawMessage) (any, error) {
	return app.db.ListBuildings(ctx)
}

func (app *application) wsCreateBuilding(ctx context.Context, _ connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input buildingInput
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	if err := input.validate(); err != nil {
		return nil, err
	}
	b, err := app.db.CreateBuilding(ctx, input.Name, input.Patterns, input.Style)
	if errors.Is(err, database.ErrNoFreeSlot) {
		return nil, clientError(err.Error())
	}
	if err != nil {
		return nil, err
	}
	app.broadcast("building.updated", b)
	return b, nil
}

func (app *application) wsUpdateBuilding(ctx context.Context, _ connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input buildingInput
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	if err := input.validate(); err != nil {
		return nil, err
	}
	b, found, err := app.db.UpdateBuilding(ctx, input.ID, input.Name, input.Patterns, input.Style)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, clientError("building not found")
	}
	app.broadcast("building.updated", b)
	return b, nil
}

func (app *application) wsDeleteBuilding(ctx context.Context, _ connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		ID int64 `json:"id"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	found, err := app.db.DeleteBuilding(ctx, input.ID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, clientError("building not found")
	}
	app.broadcast("building.deleted", map[string]int64{"id": input.ID})
	return map[string]int64{"id": input.ID}, nil
}
