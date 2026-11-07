package database

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/jmoiron/sqlx"

	"github.com/tyler71/owlchirp/app/internal/assert"
)

func TestNormalizePattern(t *testing.T) {
	tests := []struct {
		in, want string
		bad      bool
	}{
		{in: "206-256-*", want: "1206256*"},
		{in: "(206) 256-1234", want: "12062561234"},
		{in: "+1 206 256 1234", want: "12062561234"},
		{in: "1-206-*", want: "1206*"},
		{in: "+44 20 *", want: "4420*"},
		{in: "206*", want: "1206*"},
		{in: "12*", bad: true},
		{in: "", bad: true},
		{in: "206-abc-*", bad: true},
		{in: "1234567890123456", bad: true},
	}
	for _, tt := range tests {
		got, err := NormalizePattern(tt.in)
		if tt.bad {
			assert.ErrorIs(t, err, ErrBadPattern)
			continue
		}
		assert.Nil(t, err)
		assert.Equal(t, got, tt.want)
	}
}

func TestBuildings(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)
	lots := DefaultLots()

	list, err := db.ListBuildings(ctx)
	assert.Nil(t, err)
	assert.Equal(t, len(list), 0)

	a, err := db.CreateBuilding(ctx, "Seattle", []string{"1206256*"}, 1)
	assert.Nil(t, err)
	assert.Equal(t, [2]int{a.X, a.Y}, [2]int{lots[0].X, lots[0].Y})
	b, err := db.CreateBuilding(ctx, "Bellevue", []string{"1425*"}, 0)
	assert.Nil(t, err)
	assert.Equal(t, [2]int{b.X, b.Y}, [2]int{lots[1].X, lots[1].Y})

	// Updating keeps the position.
	u, found, err := db.UpdateBuilding(ctx, a.ID, "Seattle HQ", []string{"1206*", "12065550100"}, 2)
	assert.Nil(t, err)
	assert.True(t, found)
	assert.Equal(t, u.X, a.X)
	assert.Equal(t, u.Name, "Seattle HQ")
	assert.Equal(t, u.Patterns, []string{"1206*", "12065550100"})

	_, found, err = db.UpdateBuilding(ctx, 999, "x", nil, 0)
	assert.Nil(t, err)
	assert.False(t, found)

	// Moving: anywhere on the map, but not on HQ or another building.
	m, found, err := db.MoveBuilding(ctx, a.ID, 0, 0)
	assert.Nil(t, err)
	assert.True(t, found)
	assert.Equal(t, [2]int{m.X, m.Y}, [2]int{0, 0})
	_, _, err = db.MoveBuilding(ctx, a.ID, b.X+2, b.Y+3)
	assert.ErrorIs(t, err, ErrSpotTaken)
	_, _, err = db.MoveBuilding(ctx, a.ID, MapHQ.X, MapHQ.Y)
	assert.ErrorIs(t, err, ErrBadSpot)
	_, _, err = db.MoveBuilding(ctx, a.ID, MapCols-3, 0)
	assert.ErrorIs(t, err, ErrBadSpot)
	_, found, err = db.MoveBuilding(ctx, 999, 10, 10)
	assert.Nil(t, err)
	assert.False(t, found)

	// The first default lot is free again, so the next building goes there.
	c, err := db.CreateBuilding(ctx, "Tacoma", []string{}, 0)
	assert.Nil(t, err)
	assert.Equal(t, [2]int{c.X, c.Y}, [2]int{lots[0].X, lots[0].Y})

	found, err = db.DeleteBuilding(ctx, a.ID)
	assert.Nil(t, err)
	assert.True(t, found)

	list, err = db.ListBuildings(ctx)
	assert.Nil(t, err)
	assert.Equal(t, len(list), 2)

	for range MapBuildingLimit - 2 {
		_, err := db.CreateBuilding(ctx, "filler", nil, 0)
		assert.Nil(t, err)
	}
	_, err = db.CreateBuilding(ctx, "one too many", nil, 0)
	assert.ErrorIs(t, err, ErrMapFull)
}

func TestDefaultLots(t *testing.T) {
	lots := DefaultLots()
	assert.Equal(t, len(lots), MapBuildingLimit)
	for i, a := range lots {
		assert.True(t, ValidBuildingSpot(a.X, a.Y))
		for _, b := range lots[i+1:] {
			assert.False(t, a.overlaps(b))
		}
	}
}

func TestMapDesign(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)

	assert.Nil(t, db.PaintTiles(ctx, []MapTile{{X: 1, Y: 1, Tile: "water"}, {X: 2, Y: 1, Tile: "road"}}))
	assert.Nil(t, db.PaintTiles(ctx, []MapTile{{X: 1, Y: 1, Tile: "sand"}}))
	tiles, err := db.ListTiles(ctx)
	assert.Nil(t, err)
	assert.Equal(t, tiles, []MapTile{{Scene: SceneTown, X: 1, Y: 1, Tile: "sand"}, {Scene: SceneTown, X: 2, Y: 1, Tile: "road"}})

	for _, bad := range []MapTile{{X: -1, Y: 0, Tile: "road"}, {X: MapHQ.X, Y: MapHQ.Y, Tile: "road"}, {X: 0, Y: 0, Tile: "lava"}} {
		assert.ErrorIs(t, db.PaintTiles(ctx, []MapTile{bad}), ErrBadTile)
	}

	p, err := db.CreateProp(ctx, "", "bench", 5, 5)
	assert.Nil(t, err)
	_, err = db.CreateProp(ctx, "", "lamp", 5, 5)
	assert.ErrorIs(t, err, ErrTileTaken)
	_, err = db.CreateProp(ctx, "", "dragon", 6, 5)
	assert.ErrorIs(t, err, ErrBadProp)
	props, err := db.ListProps(ctx)
	assert.Nil(t, err)
	assert.Equal(t, townProps(props), []MapProp{p})

	other, err := db.CreateProp(ctx, "", "lamp", 7, 5)
	assert.Nil(t, err)
	moved, found, err := db.MoveProp(ctx, p.ID, 6, 5)
	assert.Nil(t, err)
	assert.True(t, found)
	assert.Equal(t, moved, MapProp{ID: p.ID, Scene: SceneTown, Kind: "bench", X: 6, Y: 5})
	_, _, err = db.MoveProp(ctx, p.ID, other.X, other.Y)
	assert.ErrorIs(t, err, ErrTileTaken)
	_, _, err = db.MoveProp(ctx, p.ID, -1, 5)
	assert.ErrorIs(t, err, ErrBadProp)
	_, _, err = db.MoveProp(ctx, p.ID, MapHQ.X, MapHQ.Y)
	assert.ErrorIs(t, err, ErrBadProp)
	_, found, err = db.MoveProp(ctx, 99999, 8, 5)
	assert.Nil(t, err)
	assert.False(t, found)
	p = moved
	_, err = db.DeleteProp(ctx, other.ID)
	assert.Nil(t, err)

	found, err = db.DeleteProp(ctx, p.ID)
	assert.Nil(t, err)
	assert.True(t, found)
	found, err = db.DeleteProp(ctx, p.ID)
	assert.Nil(t, err)
	assert.False(t, found)
}

func TestMigrateBuildingSlots(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "old.sqlite3")
	old, err := sqlx.Connect("sqlite", path)
	assert.Nil(t, err)
	_, err = old.Exec(`CREATE TABLE map_buildings (
		id INTEGER NOT NULL PRIMARY KEY, name VARCHAR(30) NOT NULL, patterns TEXT NOT NULL DEFAULT '[]',
		slot INTEGER NOT NULL, style INTEGER NOT NULL DEFAULT 0, created_on DATETIME, updated_on DATETIME);
		CREATE UNIQUE INDEX ix_map_buildings_slot ON map_buildings (slot);
		INSERT INTO map_buildings (name, slot) VALUES ('a', 0), ('b', 3);`)
	assert.Nil(t, err)
	old.Close()

	db, err := New(path)
	assert.Nil(t, err)
	defer db.Close()
	list, err := db.ListBuildings(ctx)
	assert.Nil(t, err)
	assert.Equal(t, len(list), 2)
	lots := DefaultLots()
	got := map[string][2]int{}
	for _, b := range list {
		got[b.Name] = [2]int{b.X, b.Y}
	}
	assert.Equal(t, got["a"], [2]int{lots[0].X, lots[0].Y})
	assert.Equal(t, got["b"], [2]int{lots[3].X, lots[3].Y})

	// New buildings no longer collide on the old slot index.
	_, err = db.CreateBuilding(ctx, "c", nil, 0)
	assert.Nil(t, err)
}

func TestSchoolPattern(t *testing.T) {
	tests := []struct {
		in, want string
		ok       bool
	}{
		{in: "+12062521234", want: "12062521234", ok: true},
		{in: "206-252-1234", want: "12062521234", ok: true},
		{in: "+12062561234"},
		{in: "+1206252123"},
		{in: "206-252-*"},
		{in: ""},
	}
	for _, tt := range tests {
		got, ok := SchoolPattern(tt.in)
		assert.Equal(t, ok, tt.ok)
		assert.Equal(t, got, tt.want)
	}
}

func TestSyncSchoolBuilding(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)

	// A hand-made building with extra patterns is never linked.
	other, err := db.CreateBuilding(ctx, "District", []string{"12062521234", "1425*"}, 0)
	assert.Nil(t, err)

	b, what, err := db.SyncSchoolBuilding(ctx, "+12062521234", "Lincoln Elem")
	assert.Nil(t, err)
	assert.Equal(t, what, SchoolCreated)
	assert.Equal(t, b.Name, "Lincoln Elem")
	assert.Equal(t, b.Patterns, []string{"12062521234"})

	// Syncing again changes nothing.
	again, what, err := db.SyncSchoolBuilding(ctx, "+12062521234", "Lincoln Elem")
	assert.Nil(t, err)
	assert.Equal(t, what, SchoolUnchanged)
	assert.Equal(t, again.ID, b.ID)

	// A rename keeps the building and its spot.
	renamed, what, err := db.SyncSchoolBuilding(ctx, "+12062521234", "Lincoln Elementary")
	assert.Nil(t, err)
	assert.Equal(t, what, SchoolRenamed)
	assert.Equal(t, renamed.ID, b.ID)
	assert.Equal(t, [2]int{renamed.X, renamed.Y}, [2]int{b.X, b.Y})
	assert.Equal(t, renamed.Name, "Lincoln Elementary")

	// Other numbers are ignored.
	_, what, err = db.SyncSchoolBuilding(ctx, "+12065550100", "Not a school")
	assert.Nil(t, err)
	assert.Equal(t, what, SchoolUnchanged)

	id, found, err := db.DeleteSchoolBuilding(ctx, "+12062521234")
	assert.Nil(t, err)
	assert.True(t, found)
	assert.Equal(t, id, b.ID)
	_, found, err = db.DeleteSchoolBuilding(ctx, "+12062521234")
	assert.Nil(t, err)
	assert.Equal(t, found, false)

	list, err := db.ListBuildings(ctx)
	assert.Nil(t, err)
	assert.Equal(t, len(list), 1)
	assert.Equal(t, list[0].ID, other.ID)
}

func townProps(props []MapProp) []MapProp {
	var out []MapProp
	for _, p := range props {
		if p.Scene == SceneTown {
			out = append(out, p)
		}
	}
	return out
}

func TestOfficeScene(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)

	// The office starts furnished.
	props, err := db.ListProps(ctx)
	assert.Nil(t, err)
	assert.Equal(t, len(props), len(officeFurniture()))
	for _, p := range props {
		assert.Equal(t, p.Scene, SceneOffice)
		assert.True(t, InScene(SceneOffice, p.X, p.Y) && !SceneLocked(SceneOffice, p.X, p.Y))
	}

	// The same tile in each scene is painted separately.
	assert.Nil(t, db.PaintTiles(ctx, []MapTile{{X: 3, Y: 3, Tile: "road"}, {Scene: SceneOffice, X: 3, Y: 3, Tile: "wood"}}))
	tiles, err := db.ListTiles(ctx)
	assert.Nil(t, err)
	assert.Equal(t, tiles, []MapTile{{Scene: SceneOffice, X: 3, Y: 3, Tile: "wood"}, {Scene: SceneTown, X: 3, Y: 3, Tile: "road"}})

	for _, bad := range []MapTile{
		{Scene: SceneOffice, X: 0, Y: 5, Tile: "wood"},               // outer wall
		{Scene: SceneOffice, X: 11, Y: OfficeRows - 1, Tile: "wood"}, // exit
		{Scene: SceneOffice, X: OfficeCols, Y: 5, Tile: "wood"},      // off the office
		{Scene: SceneOffice, X: 5, Y: 5, Tile: "road"},               // a town tile
		{Scene: "moon", X: 5, Y: 5, Tile: "wood"},
	} {
		assert.ErrorIs(t, db.PaintTiles(ctx, []MapTile{bad}), ErrBadTile)
	}

	// Decorations: per scene, office kinds only in the office.
	_, err = db.CreateProp(ctx, SceneOffice, "desk", 3, 3)
	assert.Nil(t, err)
	_, err = db.CreateProp(ctx, "", "bench", 3, 3)
	assert.Nil(t, err)
	_, err = db.CreateProp(ctx, SceneOffice, "bench", 4, 3)
	assert.ErrorIs(t, err, ErrBadProp)
	_, err = db.CreateProp(ctx, "", "desk", 4, 3)
	assert.ErrorIs(t, err, ErrBadProp)
	_, err = db.CreateProp(ctx, SceneOffice, "plant", 0, 3)
	assert.ErrorIs(t, err, ErrBadProp)

	// Clearing the office out doesn't bring the furniture back.
	_, err = db.ExecContext(ctx, `DELETE FROM map_props WHERE scene = ?`, SceneOffice)
	assert.Nil(t, err)
	assert.Nil(t, seedOffice(ctx, db.DB))
	props, err = db.ListProps(ctx)
	assert.Nil(t, err)
	assert.Equal(t, len(props), 1)
}

func TestMigrateScenes(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)
	// An old-style database: tiles keyed by (x, y), props without a scene.
	for _, q := range []string{
		`DROP TABLE map_tiles`,
		`CREATE TABLE map_tiles (x INTEGER NOT NULL, y INTEGER NOT NULL, tile VARCHAR(20) NOT NULL, PRIMARY KEY (x, y))`,
		`INSERT INTO map_tiles (x, y, tile) VALUES (1, 2, 'road')`,
		`DROP TABLE map_props`,
		`CREATE TABLE map_props (id INTEGER NOT NULL PRIMARY KEY, kind VARCHAR(20) NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL)`,
		`CREATE UNIQUE INDEX ix_map_props_xy ON map_props (x, y)`,
		`INSERT INTO map_props (kind, x, y) VALUES ('bench', 4, 4)`,
	} {
		_, err := db.ExecContext(ctx, q)
		assert.Nil(t, err)
	}
	assert.Nil(t, migrateScenes(ctx, db.DB))
	assert.Nil(t, migrateScenes(ctx, db.DB)) // runs again harmlessly

	tiles, err := db.ListTiles(ctx)
	assert.Nil(t, err)
	assert.Equal(t, tiles, []MapTile{{Scene: SceneTown, X: 1, Y: 2, Tile: "road"}})
	props, err := db.ListProps(ctx)
	assert.Nil(t, err)
	assert.Equal(t, len(props), 1)
	assert.Equal(t, props[0].Scene, SceneTown)
	_, err = db.CreateProp(ctx, SceneOffice, "desk", 4, 4) // same spot, other scene
	assert.Nil(t, err)
	assert.Nil(t, db.PaintTiles(ctx, []MapTile{{Scene: SceneOffice, X: 1, Y: 2, Tile: "wood"}}))
}
