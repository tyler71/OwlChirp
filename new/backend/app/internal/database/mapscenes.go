package database

import (
	"context"
	"slices"
	"strings"

	"github.com/jmoiron/sqlx"
)

// The map's scenes: the town, and Office Space inside Techline HQ. Sizes,
// kinds, the office's locked tiles and its starting furniture mirror the
// frontend's components/map/world.ts and components/map/office.ts; update
// both together.
const (
	SceneTown   = "town"
	SceneOffice = "office"

	OfficeCols = 24
	OfficeRows = 16
)

// OfficeTiles are the ground tiles that can be painted in the office.
var OfficeTiles = []string{"carpet", "wood", "tilefloor", "wall"}

// OfficePropKinds are the furniture that can be placed in the office.
var OfficePropKinds = []string{
	"desk", "table", "chair", "plant", "couch", "whiteboard", "watercooler", "coffee", "printer", "bookshelf",
	"globe", "rug",
}

// ValidScene reports whether scene is one of the map's scenes.
func ValidScene(scene string) bool {
	return scene == SceneTown || scene == SceneOffice
}

// SceneOr returns scene, or the town when it's empty (older clients).
func SceneOr(scene string) string {
	if scene == "" {
		return SceneTown
	}
	return scene
}

// SceneSize is a scene's width and height in tiles.
func SceneSize(scene string) (cols, rows int) {
	if scene == SceneOffice {
		return OfficeCols, OfficeRows
	}
	return MapCols, MapRows
}

// InScene reports whether tile x, y is inside scene.
func InScene(scene string, x, y int) bool {
	cols, rows := SceneSize(scene)
	return x >= 0 && y >= 0 && x < cols && y < rows
}

// SceneLocked reports whether tile x, y can't be painted or decorated: HQ in
// the town, and the office's outer walls and exit.
func SceneLocked(scene string, x, y int) bool {
	if scene == SceneOffice {
		return x == 0 || x == OfficeCols-1 || y <= 1 || y == OfficeRows-1
	}
	return OnHQ(x, y)
}

func sceneTiles(scene string) []string {
	if scene == SceneOffice {
		return OfficeTiles
	}
	return MapTiles
}

func scenePropKinds(scene string) []string {
	if scene == SceneOffice {
		return OfficePropKinds
	}
	return MapPropKinds
}

// officeFurniture is the office's starting furniture, placed once.
func officeFurniture() []MapProp {
	var props []MapProp
	add := func(kind string, x, y int) {
		props = append(props, MapProp{Scene: SceneOffice, Kind: kind, X: x, Y: y})
	}
	// Three pods of four desks, back to back, a chair on each outer side.
	for _, a := range []int{2, 6, 10} {
		for dx := range 2 {
			add("chair", a+dx, 4)
			add("desk", a+dx, 5)
			add("desk", a+dx, 6)
			add("chair", a+dx, 7)
		}
	}
	// Meeting table.
	for x := 4; x <= 6; x++ {
		add("chair", x, 10)
		add("table", x, 11)
		add("chair", x, 12)
	}
	add("whiteboard", 5, 2)
	add("bookshelf", 13, 2)
	add("bookshelf", 14, 2)
	add("plant", 1, 2)
	add("plant", 1, 14)
	// Break room.
	add("coffee", 17, 2)
	add("watercooler", 19, 2)
	add("plant", 22, 2)
	add("table", 19, 5)
	add("couch", 18, 7)
	add("couch", 19, 7)
	add("couch", 20, 7)
	// Copy corner.
	add("printer", 21, 10)
	add("bookshelf", 22, 12)
	add("plant", 22, 14)
	return props
}

// seedOffice places the office's starting furniture the first time, so
// clearing it out later doesn't bring it back.
func seedOffice(ctx context.Context, db *sqlx.DB) error {
	res, err := db.ExecContext(ctx, `INSERT OR IGNORE INTO map_seeds (scene) VALUES (?)`, SceneOffice)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err != nil || n == 0 {
		return err
	}
	for _, p := range officeFurniture() {
		_, err := db.ExecContext(ctx, `INSERT OR IGNORE INTO map_props (scene, kind, x, y) VALUES (?, ?, ?, ?)`,
			p.Scene, p.Kind, p.X, p.Y)
		if err != nil {
			return err
		}
	}
	return nil
}

func validSceneTile(t MapTile) bool {
	s := SceneOr(t.Scene)
	return ValidScene(s) && InScene(s, t.X, t.Y) && !SceneLocked(s, t.X, t.Y) && slices.Contains(sceneTiles(s), t.Tile)
}

// migrateScenes gives map_tiles and map_props from before Office Space a
// scene: everything already painted or placed is in the town. map_tiles is
// keyed by (x, y) there, so it's rebuilt keyed by (scene, x, y).
func migrateScenes(ctx context.Context, db *sqlx.DB) error {
	var cols []string
	if err := db.SelectContext(ctx, &cols, `SELECT name FROM pragma_table_info('map_tiles')`); err != nil {
		return err
	}
	if !slices.ContainsFunc(cols, func(c string) bool { return strings.EqualFold(c, "scene") }) {
		tx, err := db.BeginTxx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		for _, q := range []string{
			`CREATE TABLE map_tiles_new (
				scene VARCHAR(10) NOT NULL DEFAULT 'town',
				x INTEGER NOT NULL,
				y INTEGER NOT NULL,
				tile VARCHAR(20) NOT NULL,
				PRIMARY KEY (scene, x, y)
			)`,
			`INSERT INTO map_tiles_new (scene, x, y, tile) SELECT 'town', x, y, tile FROM map_tiles`,
			`DROP TABLE map_tiles`,
			`ALTER TABLE map_tiles_new RENAME TO map_tiles`,
		} {
			if _, err := tx.ExecContext(ctx, q); err != nil {
				return err
			}
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}

	if err := ensureColumn(ctx, db, "map_props", "scene", "VARCHAR(10) NOT NULL DEFAULT 'town'"); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `DROP INDEX IF EXISTS ix_map_props_xy`); err != nil {
		return err
	}
	_, err := db.ExecContext(ctx, `CREATE UNIQUE INDEX IF NOT EXISTS ix_map_props_scene_xy ON map_props (scene, x, y)`)
	return err
}
