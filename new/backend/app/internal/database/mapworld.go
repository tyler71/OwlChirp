package database

import (
	"slices"
	"sync"
)

// Map geometry shared with the frontend's components/map/world.ts; update
// both together. Everything here is in tiles.
const (
	MapCols = 128
	MapRows = 96

	// MapBuildingLimit is how many buildings the map holds.
	MapBuildingLimit = 104
	// MapBuildingSize is the width and height of a building's footprint.
	MapBuildingSize = 4
	// MapStyleCount is how many building sprite styles the frontend draws.
	MapStyleCount = 4
)

// MapRect is a rectangle in tiles.
type MapRect struct{ X, Y, W, H int }

func (r MapRect) overlaps(o MapRect) bool {
	return r.X < o.X+o.W && o.X < r.X+r.W && r.Y < o.Y+o.H && o.Y < r.Y+r.H
}

// MapHQ is Techline HQ; nothing can be built or painted on it.
var MapHQ = MapRect{X: 60, Y: 44, W: 10, H: 7}

// mapReserve is the park around HQ, kept free of default lots.
var mapReserve = MapRect{X: 45, Y: 32, W: 40, H: 30}

// MapTiles are the ground tiles that can be painted.
var MapTiles = []string{"grass", "flowers", "road", "path", "plaza", "sand", "water", "lot"}

// MapPropKinds are the decorations that can be placed.
var MapPropKinds = []string{"tree", "pine", "bush", "rock", "flowerpot", "bench", "lamp", "fountain", "fence", "sign"}

var defaultLots = sync.OnceValue(func() []MapRect {
	var lots []MapRect
	for band := range 12 {
		for col := range 20 {
			r := MapRect{X: 3 + 6*col, Y: 1 + 8*band, W: MapBuildingSize, H: MapBuildingSize}
			if !r.overlaps(mapReserve) {
				lots = append(lots, r)
			}
		}
	}
	// Nearest HQ first, so a few buildings sit close together.
	cx, cy := MapHQ.X+MapHQ.W/2, MapHQ.Y+MapHQ.H/2
	d2 := func(r MapRect) int {
		dx, dy := r.X+2-cx, r.Y+2-cy
		return dx*dx + dy*dy
	}
	slices.SortStableFunc(lots, func(a, b MapRect) int {
		if d := d2(a) - d2(b); d != 0 {
			return d
		}
		if a.Y != b.Y {
			return a.Y - b.Y
		}
		return a.X - b.X
	})
	return lots[:MapBuildingLimit]
})

// DefaultLots are the spots new buildings go in, in fill order.
func DefaultLots() []MapRect { return defaultLots() }

// BuildingRect is the footprint of a building whose top-left tile is x, y.
func BuildingRect(x, y int) MapRect {
	return MapRect{X: x, Y: y, W: MapBuildingSize, H: MapBuildingSize}
}

// ValidBuildingSpot reports whether a building fits at x, y: inside the
// map and clear of HQ.
func ValidBuildingSpot(x, y int) bool {
	r := BuildingRect(x, y)
	return r.X >= 0 && r.Y >= 0 && r.X+r.W <= MapCols && r.Y+r.H <= MapRows && !r.overlaps(MapHQ)
}

// InMap reports whether tile x, y is on the map.
func InMap(x, y int) bool {
	return x >= 0 && y >= 0 && x < MapCols && y < MapRows
}

// OnHQ reports whether tile x, y is part of HQ.
func OnHQ(x, y int) bool {
	return MapHQ.overlaps(MapRect{X: x, Y: y, W: 1, H: 1})
}
