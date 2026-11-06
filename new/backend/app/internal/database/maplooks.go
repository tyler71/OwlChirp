package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
)

// Palette sizes for MapLook colours. Mirror the palettes in the frontend's
// components/map/sprites.ts.
const (
	VehicleColorCount = 8
	DogCoatCount      = 5
	CatCoatCount      = 5
)

// Styles a MapLook can pick.
var (
	CarStyles   = []string{"sedan", "truck"}
	DogMarkings = []string{"none", "spots", "patch"}
	CatMarkings = []string{"none", "stripes", "socks"}
)

// AvatarParts is how many layers each avatar part offers. Mirrors the
// frontend's src/assets/map/sprite/manifest.json (regenerate both with
// frontend/scripts/export-sprites.sh). Required parts can't be left off.
var AvatarParts = []struct {
	Name     string
	Count    int
	Required bool
}{
	{"skin", 7, true},
	{"eyes", 8, true},
	{"pants", 9, true},
	{"brows", 5, false},
	{"hair", 22, false},
	{"beard", 5, false},
	{"face", 3, false},
	{"facepaint", 4, false},
	{"outfit", 17, false},
	{"tabard", 6, false},
	{"cape", 4, false},
	{"headwear", 14, false},
	{"ears", 3, false},
	{"accessory", 11, false},
	{"glasses", 1, false},
}

// MapAvatar picks one layer per part of the character sprite: an index into
// the part's layers, or -1 for none.
type MapAvatar map[string]int

// MapLook is how a user designed their character, vehicles and pets. Colours
// are indexes into the frontend's fixed palettes. Avatar is nil for looks
// saved before avatars were built from sprite layers; they draw the default.
type MapLook struct {
	Avatar MapAvatar `json:"avatar,omitempty"`
	Car    struct {
		Color int    `json:"color"`
		Style string `json:"style"`
	} `json:"car"`
	Bike struct {
		Color int `json:"color"`
	} `json:"bike"`
	Dog struct {
		Coat    int    `json:"coat"`
		Marking string `json:"marking"`
	} `json:"dog"`
	Cat struct {
		Coat    int    `json:"coat"`
		Marking string `json:"marking"`
	} `json:"cat"`
}

// Validate reports the first colour or style that isn't one the map draws.
func (l MapLook) Validate() error {
	colors := []struct {
		name  string
		value int
		count int
	}{
		{"car color", l.Car.Color, VehicleColorCount},
		{"bike color", l.Bike.Color, VehicleColorCount},
		{"dog coat", l.Dog.Coat, DogCoatCount},
		{"cat coat", l.Cat.Coat, CatCoatCount},
	}
	for _, c := range colors {
		if c.value < 0 || c.value >= c.count {
			return fmt.Errorf("unknown %s", c.name)
		}
	}
	styles := []struct {
		name  string
		value string
		valid []string
	}{
		{"car style", l.Car.Style, CarStyles},
		{"dog marking", l.Dog.Marking, DogMarkings},
		{"cat marking", l.Cat.Marking, CatMarkings},
	}
	for _, s := range styles {
		if !slices.Contains(s.valid, s.value) {
			return fmt.Errorf("unknown %s", s.name)
		}
	}
	if l.Avatar == nil {
		return errors.New("missing avatar")
	}
	return l.Avatar.Validate()
}

// Validate reports the first part that's unknown, out of range, or required
// and left off.
func (a MapAvatar) Validate() error {
	known := make(map[string]bool, len(AvatarParts))
	for _, p := range AvatarParts {
		known[p.Name] = true
		v, ok := a[p.Name]
		if !ok {
			v = -1
		}
		lo := -1
		if p.Required {
			lo = 0
		}
		if v < lo || v >= p.Count {
			return fmt.Errorf("unknown %s", p.Name)
		}
	}
	for name := range a {
		if !known[name] {
			return fmt.Errorf("unknown avatar part %q", name)
		}
	}
	return nil
}

// MapGear is what a user saved for the map. Look is nil until they design
// one.
type MapGear struct {
	Pet  string
	Ride string
	Look *MapLook
}

// GetMapGear returns username's saved pet, ride and look, or a walker with
// no pet and no look when they've saved none.
func (db *DB) GetMapGear(ctx context.Context, username string) (MapGear, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var row struct {
		Pet  string         `db:"pet"`
		Ride string         `db:"ride"`
		Look sql.NullString `db:"look"`
	}
	err := db.GetContext(ctx, &row, `SELECT pet, ride, look FROM map_looks WHERE username = ?`, username)
	if errors.Is(err, sql.ErrNoRows) {
		return MapGear{Ride: "walk"}, nil
	}
	if err != nil {
		return MapGear{}, err
	}
	gear := MapGear{Pet: row.Pet, Ride: row.Ride}
	if row.Look.Valid && row.Look.String != "" {
		var look MapLook
		if err := json.Unmarshal([]byte(row.Look.String), &look); err != nil {
			return MapGear{}, err
		}
		gear.Look = &look
	}
	return gear, nil
}

// SaveMapGear saves username's pet and ride, keeping their look.
func (db *DB) SaveMapGear(ctx context.Context, username, pet, ride string) error {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	_, err := db.ExecContext(ctx,
		`INSERT INTO map_looks (username, pet, ride, updated_on) VALUES (?, ?, ?, ?)
		 ON CONFLICT (username) DO UPDATE SET pet = excluded.pet, ride = excluded.ride, updated_on = excluded.updated_on`,
		username, pet, ride, now())
	return err
}

// SaveMapLook saves username's look, keeping their pet and ride. A nil look
// goes back to the one derived from their username.
func (db *DB) SaveMapLook(ctx context.Context, username string, look *MapLook) error {
	var data sql.NullString
	if look != nil {
		b, err := json.Marshal(look)
		if err != nil {
			return err
		}
		data = sql.NullString{String: string(b), Valid: true}
	}

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	_, err := db.ExecContext(ctx,
		`INSERT INTO map_looks (username, look, updated_on) VALUES (?, ?, ?)
		 ON CONFLICT (username) DO UPDATE SET look = excluded.look, updated_on = excluded.updated_on`,
		username, data, now())
	return err
}
