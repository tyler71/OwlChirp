package database

import (
	"context"
	"errors"
	"slices"
)

// ErrBadTile is returned for a ground tile that is off the map, on HQ, or
// of an unknown kind.
var ErrBadTile = errors.New("tiles must be on the map, off HQ, and a known kind")

// ErrBadProp is returned for a decoration that is off the map, on HQ, or of
// an unknown kind.
var ErrBadProp = errors.New("decorations must be on the map, off HQ, and a known kind")

// ErrTileTaken is returned when a decoration is already on that tile.
var ErrTileTaken = errors.New("there is already a decoration there")

// MapTile is a painted ground tile, overriding the default layout. Painting
// a tile also clears the default tree on it.
type MapTile struct {
	X    int    `json:"x" db:"x"`
	Y    int    `json:"y" db:"y"`
	Tile string `json:"tile" db:"tile"`
}

// MapProp is a decoration placed on one tile.
type MapProp struct {
	ID   int64  `json:"id" db:"id"`
	Kind string `json:"kind" db:"kind"`
	X    int    `json:"x" db:"x"`
	Y    int    `json:"y" db:"y"`
}

// ValidTile reports whether t can be painted.
func ValidTile(t MapTile) bool {
	return InMap(t.X, t.Y) && !OnHQ(t.X, t.Y) && slices.Contains(MapTiles, t.Tile)
}

// ListTiles returns every painted tile.
func (db *DB) ListTiles(ctx context.Context) ([]MapTile, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	tiles := []MapTile{}
	err := db.SelectContext(ctx, &tiles, `SELECT x, y, tile FROM map_tiles ORDER BY y, x`)
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
			`INSERT INTO map_tiles (x, y, tile) VALUES (?, ?, ?) ON CONFLICT (x, y) DO UPDATE SET tile = excluded.tile`,
			t.X, t.Y, t.Tile)
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
	err := db.SelectContext(ctx, &props, `SELECT id, kind, x, y FROM map_props ORDER BY id`)
	return props, err
}

// CreateProp places a decoration on an empty tile.
func (db *DB) CreateProp(ctx context.Context, kind string, x, y int) (MapProp, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	if !InMap(x, y) || OnHQ(x, y) || !slices.Contains(MapPropKinds, kind) {
		return MapProp{}, ErrBadProp
	}
	res, err := db.ExecContext(ctx, `INSERT OR IGNORE INTO map_props (kind, x, y) VALUES (?, ?, ?)`, kind, x, y)
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
	return MapProp{ID: id, Kind: kind, X: x, Y: y}, nil
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
