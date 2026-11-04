package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
)

// MapSlotCount is how many building lots the map has. The frontend's world
// layout (components/map/world.ts) defines the same number of lots.
const MapSlotCount = 16

// MapStyleCount is how many building sprite styles the frontend draws.
const MapStyleCount = 4

// ErrNoFreeSlot is returned when every map lot already has a building.
var ErrNoFreeSlot = errors.New("every map lot is taken")

// ErrBadPattern is returned by NormalizePattern for unusable input.
var ErrBadPattern = errors.New("pattern needs at least 3 digits, e.g. 206-256-* or 206-256-1234")

// Building is a place on the map that incoming calls are matched to.
type Building struct {
	ID       int64    `json:"id"`
	Name     string   `json:"name"`
	Patterns []string `json:"patterns"`
	Slot     int      `json:"slot"`
	Style    int      `json:"style"`
}

type buildingRow struct {
	ID       int64  `db:"id"`
	Name     string `db:"name"`
	Patterns string `db:"patterns"`
	Slot     int    `db:"slot"`
	Style    int    `db:"style"`
}

func (r buildingRow) building() Building {
	b := Building{ID: r.ID, Name: r.Name, Slot: r.Slot, Style: r.Style, Patterns: []string{}}
	_ = json.Unmarshal([]byte(r.Patterns), &b.Patterns)
	if b.Patterns == nil {
		b.Patterns = []string{}
	}
	return b
}

// NormalizePattern turns user input like "206-256-*", "(206) 256-1234" or
// "+1 206 256 *" into the digits of an E.164 number, with a trailing "*" for
// a prefix. Ten digit (NANP) input gets the leading country code 1, as does a
// prefix of up to ten digits that doesn't already start with 1.
func NormalizePattern(s string) (string, error) {
	s = strings.TrimSpace(s)
	prefix := strings.HasSuffix(s, "*")
	explicitCountry := strings.HasPrefix(s, "+")
	var digits strings.Builder
	for _, r := range strings.TrimSuffix(s, "*") {
		switch {
		case r >= '0' && r <= '9':
			digits.WriteRune(r)
		case strings.ContainsRune(" -().+", r):
		default:
			return "", ErrBadPattern
		}
	}
	d := digits.String()
	if len(d) < 3 || len(d) > 15 {
		return "", ErrBadPattern
	}
	if !explicitCountry {
		if prefix && len(d) <= 10 && d[0] != '1' {
			d = "1" + d
		} else if !prefix && len(d) == 10 {
			d = "1" + d
		}
	}
	if prefix {
		return d + "*", nil
	}
	return d, nil
}

// ListBuildings returns every building, ordered by lot.
func (db *DB) ListBuildings(ctx context.Context) ([]Building, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var rows []buildingRow
	err := db.SelectContext(ctx, &rows,
		`SELECT id, name, patterns, slot, style FROM map_buildings ORDER BY slot`)
	if err != nil {
		return nil, err
	}
	buildings := make([]Building, 0, len(rows))
	for _, r := range rows {
		buildings = append(buildings, r.building())
	}
	return buildings, nil
}

// CreateBuilding adds a building in the lowest free lot.
func (db *DB) CreateBuilding(ctx context.Context, name string, patterns []string, style int) (Building, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	if patterns == nil {
		patterns = []string{}
	}
	encoded, err := json.Marshal(patterns)
	if err != nil {
		return Building{}, err
	}

	tx, err := db.BeginTxx(ctx, nil)
	if err != nil {
		return Building{}, err
	}
	defer tx.Rollback()

	var used []int
	if err := tx.SelectContext(ctx, &used, `SELECT slot FROM map_buildings ORDER BY slot`); err != nil {
		return Building{}, err
	}
	taken := make(map[int]bool, len(used))
	for _, s := range used {
		taken[s] = true
	}
	slot := -1
	for i := range MapSlotCount {
		if !taken[i] {
			slot = i
			break
		}
	}
	if slot < 0 {
		return Building{}, ErrNoFreeSlot
	}

	ts := now()
	res, err := tx.ExecContext(ctx,
		`INSERT INTO map_buildings (name, patterns, slot, style, created_on, updated_on) VALUES (?, ?, ?, ?, ?, ?)`,
		name, string(encoded), slot, style, ts, ts)
	if err != nil {
		return Building{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Building{}, err
	}
	if err := tx.Commit(); err != nil {
		return Building{}, err
	}
	return Building{ID: id, Name: name, Patterns: patterns, Slot: slot, Style: style}, nil
}

// UpdateBuilding changes a building's name, patterns and style. Its lot
// stays the same. found is false when there is no building with that id.
func (db *DB) UpdateBuilding(ctx context.Context, id int64, name string, patterns []string, style int) (Building, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	if patterns == nil {
		patterns = []string{}
	}
	encoded, err := json.Marshal(patterns)
	if err != nil {
		return Building{}, false, err
	}
	res, err := db.ExecContext(ctx,
		`UPDATE map_buildings SET name = ?, patterns = ?, style = ?, updated_on = ? WHERE id = ?`,
		name, string(encoded), style, now(), id)
	if err != nil {
		return Building{}, false, err
	}
	if n, err := res.RowsAffected(); err != nil || n == 0 {
		return Building{}, false, err
	}

	var row buildingRow
	err = db.GetContext(ctx, &row, `SELECT id, name, patterns, slot, style FROM map_buildings WHERE id = ?`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return Building{}, false, nil
	}
	if err != nil {
		return Building{}, false, err
	}
	return row.building(), true, nil
}

// DeleteBuilding removes a building and frees its lot.
func (db *DB) DeleteBuilding(ctx context.Context, id int64) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	res, err := db.ExecContext(ctx, `DELETE FROM map_buildings WHERE id = ?`, id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}
