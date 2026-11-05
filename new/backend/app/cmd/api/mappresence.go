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
// components/map/world.ts.
const (
	mapWidth  = database.MapCols * 16
	mapHeight = database.MapRows * 16

	maxBuildingNameLength = 30
	maxBuildingPatterns   = 20

	// mapMoveInterval is the shortest gap between accepted moves per user;
	// faster moves are dropped. Clients send at most ~10/s.
	mapMoveInterval = 50 * time.Millisecond

	// maxPaintTiles caps the tiles painted by one request.
	maxPaintTiles = 400
)

// Spawn area: the plaza in front of Techline HQ.
var mapSpawn = struct{ minX, maxX, minY, maxY float64 }{57 * 16, 72 * 16, 52 * 16, 55 * 16}

// Pets that follow a character, and what they ride.
var (
	validPets  = map[string]bool{"": true, "dog": true, "cat": true}
	validRides = map[string]bool{"walk": true, "bike": true, "car": true}
)

// mapPlayer is one Owlchirp user on the map. Everyone with Owlchirp open is
// on the map, in every tab they have open at the same spot.
type mapPlayer struct {
	Username string  `json:"username"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Dir      string  `json:"dir"`
	Pet      string  `json:"pet"`  // "", "dog" or "cat"
	Ride     string  `json:"ride"` // "walk", "bike" or "car"

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
			Ride:     "walk",
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

// gear sets username's pet and ride. ok is false when the user isn't on the
// map.
func (p *mapPresence) gear(username, pet, ride string) (mapPlayer, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	pl, found := p.players[username]
	if !found {
		return mapPlayer{}, false
	}
	pl.Pet, pl.Ride = pet, ride
	return *pl, true
}

// positions returns where each of names is, leaving out anyone not on the
// map.
func (p *mapPresence) positions(names []string) map[string][2]float64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make(map[string][2]float64, len(names))
	for _, n := range names {
		if pl, ok := p.players[n]; ok {
			out[n] = [2]float64{pl.X, pl.Y}
		}
	}
	return out
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
	Tiles     []database.MapTile  `json:"tiles"`
	Props     []database.MapProp  `json:"props"`
	Limit     int                 `json:"limit"`
}

func (app *application) wsMapState(ctx context.Context, _ connect.RegisteredUser, _ json.RawMessage) (any, error) {
	buildings, err := app.db.ListBuildings(ctx)
	if err != nil {
		return nil, err
	}
	tiles, err := app.db.ListTiles(ctx)
	if err != nil {
		return nil, err
	}
	props, err := app.db.ListProps(ctx)
	if err != nil {
		return nil, err
	}
	return mapState{
		Buildings: buildings,
		Players:   app.presence.list(),
		Tiles:     tiles,
		Props:     props,
		Limit:     database.MapBuildingLimit,
	}, nil
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
	if errors.Is(err, database.ErrMapFull) {
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

// wsMapGear sets the user's pet and ride, seen by everyone.
func (app *application) wsMapGear(_ context.Context, user connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		Pet  string `json:"pet"`
		Ride string `json:"ride"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	if !validPets[input.Pet] {
		return nil, clientError("pet must be dog, cat or empty")
	}
	if !validRides[input.Ride] {
		return nil, clientError("ride must be walk, bike or car")
	}
	player, ok := app.presence.gear(user.Username, input.Pet, input.Ride)
	if !ok {
		return nil, clientError("not on the map")
	}
	app.broadcast("map.moved", player)
	return player, nil
}

// wsMoveBuilding moves a building to a new spot.
func (app *application) wsMoveBuilding(ctx context.Context, _ connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		ID int64 `json:"id"`
		X  int   `json:"x"`
		Y  int   `json:"y"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	b, found, err := app.db.MoveBuilding(ctx, input.ID, input.X, input.Y)
	if errors.Is(err, database.ErrBadSpot) || errors.Is(err, database.ErrSpotTaken) {
		return nil, clientError(err.Error())
	}
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, clientError("building not found")
	}
	app.broadcast("building.updated", b)
	return b, nil
}

// wsMapPaint paints ground tiles over the default layout.
func (app *application) wsMapPaint(ctx context.Context, _ connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		Tiles []database.MapTile `json:"tiles"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	if len(input.Tiles) == 0 {
		return nil, clientError("no tiles to paint")
	}
	if len(input.Tiles) > maxPaintTiles {
		return nil, clientError(fmt.Sprintf("at most %d tiles at a time", maxPaintTiles))
	}
	err := app.db.PaintTiles(ctx, input.Tiles)
	if errors.Is(err, database.ErrBadTile) {
		return nil, clientError(err.Error())
	}
	if err != nil {
		return nil, err
	}
	app.broadcast("map.painted", map[string]any{"tiles": input.Tiles})
	return map[string]int{"painted": len(input.Tiles)}, nil
}

// wsCreateProp places a decoration.
func (app *application) wsCreateProp(ctx context.Context, _ connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		Kind string `json:"kind"`
		X    int    `json:"x"`
		Y    int    `json:"y"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	prop, err := app.db.CreateProp(ctx, input.Kind, input.X, input.Y)
	if errors.Is(err, database.ErrBadProp) || errors.Is(err, database.ErrTileTaken) {
		return nil, clientError(err.Error())
	}
	if err != nil {
		return nil, err
	}
	app.broadcast("map.prop.created", prop)
	return prop, nil
}

// wsDeleteProp removes a decoration.
func (app *application) wsDeleteProp(ctx context.Context, _ connect.RegisteredUser, data json.RawMessage) (any, error) {
	var input struct {
		ID int64 `json:"id"`
	}
	if err := decode(data, &input); err != nil {
		return nil, err
	}
	found, err := app.db.DeleteProp(ctx, input.ID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, clientError("decoration not found")
	}
	app.broadcast("map.prop.deleted", map[string]int64{"id": input.ID})
	return map[string]int64{"id": input.ID}, nil
}

// syncSchoolBuilding keeps a school caller ID's building in step with it. A
// failure is logged; it never fails the caller ID save.
func (app *application) syncSchoolBuilding(ctx context.Context, phone, name string) {
	if _, ok := database.SchoolPattern(phone); !ok {
		return
	}
	b, what, err := app.db.SyncSchoolBuilding(ctx, phone, name)
	if err != nil {
		app.logger.Warn("sync school building", "phone", phone, "error", err)
		return
	}
	if what != database.SchoolUnchanged {
		app.broadcast("building.updated", b)
	}
}

// deleteSchoolBuilding removes the building of a deleted school caller ID.
func (app *application) deleteSchoolBuilding(ctx context.Context, phone string) {
	if _, ok := database.SchoolPattern(phone); !ok {
		return
	}
	id, found, err := app.db.DeleteSchoolBuilding(ctx, phone)
	if err != nil {
		app.logger.Warn("delete school building", "phone", phone, "error", err)
		return
	}
	if found {
		app.broadcast("building.deleted", map[string]int64{"id": id})
	}
}

// schoolImport is the result of buildings.import.
type schoolImport struct {
	Created  int  `json:"created"`
	Renamed  int  `json:"renamed"`
	Existing int  `json:"existing"`
	MapFull  bool `json:"mapFull"`
}

// wsImportSchools gives every saved school caller ID (206-252-*) a building.
func (app *application) wsImportSchools(ctx context.Context, _ connect.RegisteredUser, _ json.RawMessage) (any, error) {
	callerIDs, err := app.db.ListCallerIDs(ctx)
	if err != nil {
		return nil, err
	}
	var result schoolImport
	for _, c := range callerIDs {
		if _, ok := database.SchoolPattern(c.PhoneNumber); !ok || strings.TrimSpace(c.Name) == "" {
			continue
		}
		b, what, err := app.db.SyncSchoolBuilding(ctx, c.PhoneNumber, c.Name)
		if errors.Is(err, database.ErrMapFull) {
			result.MapFull = true
			break
		}
		if err != nil {
			return nil, err
		}
		switch what {
		case database.SchoolCreated:
			result.Created++
		case database.SchoolRenamed:
			result.Renamed++
		default:
			result.Existing++
		}
		if what != database.SchoolUnchanged {
			app.broadcast("building.updated", b)
		}
	}
	return result, nil
}
