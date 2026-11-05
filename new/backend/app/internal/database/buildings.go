package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jmoiron/sqlx"
)

// ErrMapFull is returned when the map already has MapBuildingLimit buildings.
var ErrMapFull = errors.New("the map is full: delete a building first")

// ErrBadSpot is returned for a building position off the map or on HQ.
var ErrBadSpot = errors.New("buildings must be on the map and clear of HQ")

// ErrSpotTaken is returned when a building would overlap another one.
var ErrSpotTaken = errors.New("another building is in the way")

// ErrBadPattern is returned by NormalizePattern for unusable input.
var ErrBadPattern = errors.New("pattern needs at least 3 digits, e.g. 206-256-* or 206-256-1234")

// Building is a place on the map that incoming calls are matched to.
type Building struct {
	ID       int64    `json:"id"`
	Name     string   `json:"name"`
	Patterns []string `json:"patterns"`
	X        int      `json:"x"` // top-left tile of the footprint
	Y        int      `json:"y"`
	Style    int      `json:"style"`
}

type buildingRow struct {
	ID       int64  `db:"id"`
	Name     string `db:"name"`
	Patterns string `db:"patterns"`
	X        int    `db:"x"`
	Y        int    `db:"y"`
	Style    int    `db:"style"`
}

func (r buildingRow) building() Building {
	b := Building{ID: r.ID, Name: r.Name, X: r.X, Y: r.Y, Style: r.Style, Patterns: []string{}}
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

// ListBuildings returns every building, top to bottom.
func (db *DB) ListBuildings(ctx context.Context) ([]Building, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var rows []buildingRow
	err := db.SelectContext(ctx, &rows,
		`SELECT id, name, patterns, x, y, style FROM map_buildings ORDER BY y, x, id`)
	if err != nil {
		return nil, err
	}
	buildings := make([]Building, 0, len(rows))
	for _, r := range rows {
		buildings = append(buildings, r.building())
	}
	return buildings, nil
}

// CreateBuilding adds a building in the first default lot that is clear.
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

	used, err := buildingRects(ctx, tx, 0)
	if err != nil {
		return Building{}, err
	}
	if len(used) >= MapBuildingLimit {
		return Building{}, ErrMapFull
	}
	spot, found := MapRect{}, false
	for _, lot := range DefaultLots() {
		if !overlapsAny(lot, used) {
			spot, found = lot, true
			break
		}
	}
	if !found {
		return Building{}, ErrMapFull
	}

	ts := now()
	res, err := tx.ExecContext(ctx,
		`INSERT INTO map_buildings (name, patterns, slot, x, y, style, created_on, updated_on) VALUES (?, ?, 0, ?, ?, ?, ?, ?)`,
		name, string(encoded), spot.X, spot.Y, style, ts, ts)
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
	return Building{ID: id, Name: name, Patterns: patterns, X: spot.X, Y: spot.Y, Style: style}, nil
}

// MoveBuilding puts a building's top-left corner at tile x, y. found is
// false when there is no building with that id.
func (db *DB) MoveBuilding(ctx context.Context, id int64, x, y int) (Building, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	if !ValidBuildingSpot(x, y) {
		return Building{}, false, ErrBadSpot
	}
	tx, err := db.BeginTxx(ctx, nil)
	if err != nil {
		return Building{}, false, err
	}
	defer tx.Rollback()

	others, err := buildingRects(ctx, tx, id)
	if err != nil {
		return Building{}, false, err
	}
	if overlapsAny(BuildingRect(x, y), others) {
		return Building{}, false, ErrSpotTaken
	}
	res, err := tx.ExecContext(ctx, `UPDATE map_buildings SET x = ?, y = ?, updated_on = ? WHERE id = ?`, x, y, now(), id)
	if err != nil {
		return Building{}, false, err
	}
	if n, err := res.RowsAffected(); err != nil || n == 0 {
		return Building{}, false, err
	}
	var row buildingRow
	if err := tx.GetContext(ctx, &row, `SELECT id, name, patterns, x, y, style FROM map_buildings WHERE id = ?`, id); err != nil {
		return Building{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return Building{}, false, err
	}
	return row.building(), true, nil
}

// buildingRects returns the footprints of every building except skipID.
func buildingRects(ctx context.Context, q sqlx.QueryerContext, skipID int64) ([]MapRect, error) {
	var rows []struct {
		X int `db:"x"`
		Y int `db:"y"`
	}
	if err := sqlx.SelectContext(ctx, q, &rows, `SELECT x, y FROM map_buildings WHERE id != ?`, skipID); err != nil {
		return nil, err
	}
	rects := make([]MapRect, len(rows))
	for i, r := range rows {
		rects[i] = BuildingRect(r.X, r.Y)
	}
	return rects, nil
}

func overlapsAny(r MapRect, rects []MapRect) bool {
	for _, o := range rects {
		if r.overlaps(o) {
			return true
		}
	}
	return false
}

// UpdateBuilding changes a building's name, patterns and style. Its
// position stays the same. found is false when there is no building with that id.
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
	err = db.GetContext(ctx, &row, `SELECT id, name, patterns, x, y, style FROM map_buildings WHERE id = ?`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return Building{}, false, nil
	}
	if err != nil {
		return Building{}, false, err
	}
	return row.building(), true, nil
}

// DeleteBuilding removes a building.
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

// SchoolPrefix is the normalized prefix of every school's phone number
// (206-252-*). Each saved caller ID under it gets its own building.
const SchoolPrefix = "1206252"

// maxSchoolNameLength matches the map_buildings.name column.
const maxSchoolNameLength = 30

// SchoolPattern returns the building pattern for phone and whether phone is a
// school number: an exact 11 digit NANP number starting with SchoolPrefix.
func SchoolPattern(phone string) (string, bool) {
	p, err := NormalizePattern(phone)
	if err != nil || strings.HasSuffix(p, "*") || len(p) != 11 || !strings.HasPrefix(p, SchoolPrefix) {
		return "", false
	}
	return p, true
}

// schoolBuilding finds the building linked to pattern: the one whose only
// pattern is that exact number. Buildings with other patterns are never linked.
func (db *DB) schoolBuilding(ctx context.Context, pattern string) (Building, bool, error) {
	encoded, err := json.Marshal([]string{pattern})
	if err != nil {
		return Building{}, false, err
	}
	var row buildingRow
	err = db.GetContext(ctx, &row,
		`SELECT id, name, patterns, x, y, style FROM map_buildings WHERE patterns = ? ORDER BY id LIMIT 1`, string(encoded))
	if errors.Is(err, sql.ErrNoRows) {
		return Building{}, false, nil
	}
	if err != nil {
		return Building{}, false, err
	}
	return row.building(), true, nil
}

// SchoolSync says what SyncSchoolBuilding did.
type SchoolSync int

const (
	SchoolUnchanged SchoolSync = iota
	SchoolCreated
	SchoolRenamed
)

// SyncSchoolBuilding makes sure the school number phone has a building named
// name, creating or renaming it. It returns ErrMapFull when there is no room.
// Callers should check SchoolPattern first; other numbers are ignored.
func (db *DB) SyncSchoolBuilding(ctx context.Context, phone, name string) (Building, SchoolSync, error) {
	pattern, ok := SchoolPattern(phone)
	if !ok {
		return Building{}, SchoolUnchanged, nil
	}
	name = strings.TrimSpace(name)
	if r := []rune(name); len(r) > maxSchoolNameLength {
		name = string(r[:maxSchoolNameLength])
	}
	if name == "" {
		return Building{}, SchoolUnchanged, nil
	}

	b, found, err := db.schoolBuilding(ctx, pattern)
	if err != nil {
		return Building{}, SchoolUnchanged, err
	}
	if found {
		if b.Name == name {
			return b, SchoolUnchanged, nil
		}
		b, found, err = db.UpdateBuilding(ctx, b.ID, name, b.Patterns, b.Style)
		if err != nil || !found {
			return Building{}, SchoolUnchanged, err
		}
		return b, SchoolRenamed, nil
	}

	// Spread the styles so neighbouring schools look different.
	style := int(pattern[len(pattern)-1]-'0') % MapStyleCount
	b, err = db.CreateBuilding(ctx, name, []string{pattern}, style)
	if err != nil {
		return Building{}, SchoolUnchanged, err
	}
	return b, SchoolCreated, nil
}

// DeleteSchoolBuilding removes the building linked to the school number
// phone. found is false when there is none.
func (db *DB) DeleteSchoolBuilding(ctx context.Context, phone string) (id int64, found bool, err error) {
	pattern, ok := SchoolPattern(phone)
	if !ok {
		return 0, false, nil
	}
	b, found, err := db.schoolBuilding(ctx, pattern)
	if err != nil || !found {
		return 0, false, err
	}
	found, err = db.DeleteBuilding(ctx, b.ID)
	return b.ID, found, err
}
