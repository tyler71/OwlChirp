package database

import (
	"context"
	"database/sql"
	"errors"
	"slices"
)

// ErrBadTile is returned for a ground tile that is off the map, on HQ, or
// of an unknown kind.
var ErrBadTile = errors.New("tiles must be on the map, off locked spots, and a known kind")

// ErrBadProp is returned for a decoration that is off the map, on HQ, or of
// an unknown kind.
var ErrBadProp = errors.New("decorations must be on the map, off locked spots, and a known kind")

// ErrTileTaken is returned when a decoration is already on that tile.
var ErrTileTaken = errors.New("there is already a decoration there")

// MapTile is a painted ground tile, overriding the default layout. Painting
// a tile also clears the default tree on it.
type MapTile struct {
	Scene string `json:"scene" db:"scene"`
	X     int    `json:"x" db:"x"`
	Y     int    `json:"y" db:"y"`
	Tile  string `json:"tile" db:"tile"`
}

// MapProp is a decoration placed on one tile.
type MapProp struct {
	ID    int64  `json:"id" db:"id"`
	Scene string `json:"scene" db:"scene"`
	Kind  string `json:"kind" db:"kind"`
	X     int    `json:"x" db:"x"`
	Y     int    `json:"y" db:"y"`
}

// ValidTile reports whether t can be painted: inside its scene (the town
// when Scene is empty), off locked tiles, and a kind that scene has.
func ValidTile(t MapTile) bool {
	return validSceneTile(t)
}

// ListTiles returns every painted tile.
func (db *DB) ListTiles(ctx context.Context) ([]MapTile, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	tiles := []MapTile{}
	err := db.SelectContext(ctx, &tiles, `SELECT scene, x, y, tile FROM map_tiles ORDER BY scene, y, x`)
	return tiles, err
}

// PaintTiles saves painted tiles, replacing earlier paint on the same spot.
func (db *DB) PaintTiles(ctx context.Context, tiles []MapTile) error {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	for _, t := range tiles {
		if !ValidTile(t) {
			return ErrBadTile
		}
	}
	tx, err := db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, t := range tiles {
		_, err := tx.ExecContext(ctx,
			`INSERT INTO map_tiles (scene, x, y, tile) VALUES (?, ?, ?, ?)
			 ON CONFLICT (scene, x, y) DO UPDATE SET tile = excluded.tile`,
			SceneOr(t.Scene), t.X, t.Y, t.Tile)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ListProps returns every decoration.
func (db *DB) ListProps(ctx context.Context) ([]MapProp, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	props := []MapProp{}
	err := db.SelectContext(ctx, &props, `SELECT id, scene, kind, x, y FROM map_props ORDER BY id`)
	return props, err
}

// CreateProp places a decoration on an empty tile of scene (the town when
// empty).
func (db *DB) CreateProp(ctx context.Context, scene, kind string, x, y int) (MapProp, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	scene = SceneOr(scene)
	if !ValidScene(scene) || !InScene(scene, x, y) || SceneLocked(scene, x, y) || !slices.Contains(scenePropKinds(scene), kind) {
		return MapProp{}, ErrBadProp
	}
	res, err := db.ExecContext(ctx, `INSERT OR IGNORE INTO map_props (scene, kind, x, y) VALUES (?, ?, ?, ?)`, scene, kind, x, y)
	if err != nil {
		return MapProp{}, err
	}
	if n, err := res.RowsAffected(); err != nil {
		return MapProp{}, err
	} else if n == 0 {
		return MapProp{}, ErrTileTaken
	}
	id, err := res.LastInsertId()
	if err != nil {
		return MapProp{}, err
	}
	return MapProp{ID: id, Scene: scene, Kind: kind, X: x, Y: y}, nil
}

// MoveProp moves a decoration to another empty tile of its scene. found is
// false when there is none with that id.
func (db *DB) MoveProp(ctx context.Context, id int64, x, y int) (MapProp, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	tx, err := db.BeginTxx(ctx, nil)
	if err != nil {
		return MapProp{}, false, err
	}
	defer tx.Rollback()

	var p MapProp
	err = tx.GetContext(ctx, &p, `SELECT id, scene, kind, x, y FROM map_props WHERE id = ?`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return MapProp{}, false, nil
	}
	if err != nil {
		return MapProp{}, false, err
	}
	if !InScene(p.Scene, x, y) || SceneLocked(p.Scene, x, y) {
		return MapProp{}, true, ErrBadProp
	}
	var taken int
	err = tx.GetContext(ctx, &taken, `SELECT COUNT(*) FROM map_props WHERE scene = ? AND x = ? AND y = ? AND id <> ?`, p.Scene, x, y, id)
	if err != nil {
		return MapProp{}, true, err
	}
	if taken > 0 {
		return MapProp{}, true, ErrTileTaken
	}
	if _, err := tx.ExecContext(ctx, `UPDATE map_props SET x = ?, y = ? WHERE id = ?`, x, y, id); err != nil {
		return MapProp{}, true, err
	}
	if err := tx.Commit(); err != nil {
		return MapProp{}, true, err
	}
	p.X, p.Y = x, y
	return p, true, nil
}

// DeleteProp removes a decoration. found is false when there is none with
// that id.
func (db *DB) DeleteProp(ctx context.Context, id int64) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	res, err := db.ExecContext(ctx, `DELETE FROM map_props WHERE id = ?`, id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}
