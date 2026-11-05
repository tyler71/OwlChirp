package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/tyler71/owlchirp/app/internal/assert"
	"github.com/tyler71/owlchirp/app/internal/database"
)

func TestSocketMapPermissions(t *testing.T) {
	srv := newTestServer(t)
	std := dial(t, srv, tokenFor(standardUser))

	for _, typ := range []string{"map.state", "map.move", "map.gear", "map.paint", "map.props.create", "map.props.delete", "buildings.create", "buildings.update", "buildings.delete", "buildings.move"} {
		reply := std.call(typ, map[string]any{})
		assert.Equal(t, reply.Type, "error")
		assert.Equal(t, reply.Error, "permission denied")
	}
}

func TestSocketBuildings(t *testing.T) {
	srv := newTestServer(t)
	agent := dial(t, srv, validToken())

	reply := agent.call("buildings.create", map[string]any{"name": "Seattle", "patterns": []string{"206-256-*", "", "206 256 *"}})
	assert.Equal(t, reply.Type, "result")
	var b database.Building
	assert.Nil(t, json.Unmarshal(reply.Data, &b))
	assert.Equal(t, b.Patterns, []string{"1206256*"})
	lot := database.DefaultLots()[0]
	assert.Equal(t, [2]int{b.X, b.Y}, [2]int{lot.X, lot.Y})
	agent.readUntil(func(m testMessage) bool { return m.Type == "building.updated" })

	for _, bad := range []map[string]any{
		{"name": "", "patterns": []string{}},
		{"name": "x", "patterns": []string{"12*"}},
		{"name": "x", "style": 99},
	} {
		reply = agent.call("buildings.create", bad)
		assert.Equal(t, reply.Type, "error")
	}

	reply = agent.call("buildings.update", map[string]any{"id": b.ID, "name": "Seattle 2", "patterns": []string{"425*"}, "style": 3})
	assert.Equal(t, reply.Type, "result")
	assert.Nil(t, json.Unmarshal(reply.Data, &b))
	assert.Equal(t, b.Name, "Seattle 2")
	assert.Equal(t, b.Patterns, []string{"1425*"})
	assert.Equal(t, b.Style, 3)

	reply = agent.call("buildings.move", map[string]any{"id": b.ID, "x": 2, "y": 3})
	assert.Equal(t, reply.Type, "result")
	assert.Nil(t, json.Unmarshal(reply.Data, &b))
	assert.Equal(t, [2]int{b.X, b.Y}, [2]int{2, 3})
	reply = agent.call("buildings.move", map[string]any{"id": b.ID, "x": -1, "y": 3})
	assert.Equal(t, reply.Type, "error")

	reply = agent.call("map.paint", map[string]any{"tiles": []map[string]any{{"x": 1, "y": 1, "tile": "water"}}})
	assert.Equal(t, reply.Type, "result")
	agent.readUntil(func(m testMessage) bool { return m.Type == "map.painted" })
	reply = agent.call("map.paint", map[string]any{"tiles": []map[string]any{{"x": 1, "y": 1, "tile": "lava"}}})
	assert.Equal(t, reply.Type, "error")

	reply = agent.call("map.props.create", map[string]any{"kind": "bench", "x": 9, "y": 9})
	assert.Equal(t, reply.Type, "result")
	var prop database.MapProp
	assert.Nil(t, json.Unmarshal(reply.Data, &prop))

	reply = agent.call("map.state", nil)
	assert.Equal(t, reply.Type, "result")
	var state mapState
	assert.Nil(t, json.Unmarshal(reply.Data, &state))
	assert.Equal(t, len(state.Buildings), 1)
	assert.Equal(t, len(state.Players), 1)
	assert.Equal(t, state.Players[0].Username, testAgent.Username)
	assert.Equal(t, len(state.Tiles), 1)
	assert.Equal(t, len(state.Props), 1)
	assert.Equal(t, state.Limit, database.MapBuildingLimit)

	reply = agent.call("map.props.delete", map[string]any{"id": prop.ID})
	assert.Equal(t, reply.Type, "result")
	reply = agent.call("map.props.delete", map[string]any{"id": prop.ID})
	assert.Equal(t, reply.Type, "error")

	reply = agent.call("buildings.delete", map[string]any{"id": b.ID})
	assert.Equal(t, reply.Type, "result")
	agent.readUntil(func(m testMessage) bool { return m.Type == "building.deleted" })
	reply = agent.call("buildings.delete", map[string]any{"id": b.ID})
	assert.Equal(t, reply.Type, "error")
}

func TestSocketMapPresence(t *testing.T) {
	srv := newTestServer(t)
	watcher := dial(t, srv, validToken())
	watcher.call("map.state", nil) // wait until authenticated and joined

	// A second user appears, moves, and leaves.
	other := dial(t, srv, tokenFor(standardUser))
	joined := watcher.readUntil(func(m testMessage) bool {
		return m.Type == "map.joined" && strings.Contains(string(m.Data), standardUser.Username)
	})
	var p mapPlayer
	assert.Nil(t, json.Unmarshal(joined.Data, &p))
	assert.Equal(t, p.Username, standardUser.Username)

	// The watcher moving is seen by itself too; positions are clamped.
	reply := watcher.call("map.move", map[string]any{"x": 99999, "y": -5, "dir": "left"})
	assert.Equal(t, reply.Type, "result")
	moved := watcher.readUntil(func(m testMessage) bool { return m.Type == "map.moved" })
	assert.Nil(t, json.Unmarshal(moved.Data, &p))
	assert.Equal(t, p.X, float64(mapWidth))
	assert.Equal(t, p.Y, 0.0)
	assert.Equal(t, p.Dir, "left")

	reply = watcher.call("map.move", map[string]any{"x": 1, "y": 1, "dir": "sideways"})
	assert.Equal(t, reply.Type, "error")

	// Pets and rides are seen by everyone.
	reply = watcher.call("map.gear", map[string]any{"pet": "dog", "ride": "car"})
	assert.Equal(t, reply.Type, "result")
	geared := watcher.readUntil(func(m testMessage) bool {
		return m.Type == "map.moved" && strings.Contains(string(m.Data), `"pet":"dog"`)
	})
	assert.Nil(t, json.Unmarshal(geared.Data, &p))
	assert.Equal(t, p.Ride, "car")
	for _, bad := range []map[string]any{{"pet": "dragon", "ride": "walk"}, {"pet": "", "ride": "rocket"}} {
		reply = watcher.call("map.gear", bad)
		assert.Equal(t, reply.Type, "error")
	}

	other.conn.CloseNow()
	left := watcher.readUntil(func(m testMessage) bool { return m.Type == "map.left" })
	assert.MatchesRegexp(t, string(left.Data), standardUser.Username)
}

func TestMapPresenceTabs(t *testing.T) {
	var p mapPresence
	_, joined := p.join("a")
	assert.True(t, joined)
	_, joined = p.join("a")
	assert.False(t, joined)
	assert.False(t, p.leave("a"))
	assert.True(t, p.leave("a"))
	assert.False(t, p.leave("a"))

	p.join("b")
	now := time.Now()
	_, ok := p.move("b", 10, 10, "up", now)
	assert.True(t, ok)
	_, ok = p.move("b", 11, 10, "up", now.Add(10*time.Millisecond))
	assert.False(t, ok)
	_, ok = p.move("b", 11, 10, "up", now.Add(mapMoveInterval))
	assert.True(t, ok)
	_, ok = p.move("nobody", 1, 1, "up", now)
	assert.False(t, ok)
}
