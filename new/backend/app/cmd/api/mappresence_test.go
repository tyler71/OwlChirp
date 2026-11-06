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

	for _, typ := range []string{"map.state", "map.move", "map.gear", "map.look", "map.enter", "map.paint", "map.props.create", "map.props.delete", "buildings.create", "buildings.update", "buildings.delete", "buildings.move", "buildings.import"} {
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
	reply = agent.call("map.props.move", map[string]any{"id": prop.ID, "x": 10, "y": 9})
	assert.Equal(t, reply.Type, "result")
	assert.Nil(t, json.Unmarshal(reply.Data, &prop))
	assert.Equal(t, [2]int{prop.X, prop.Y}, [2]int{10, 9})
	agent.readUntil(func(m testMessage) bool { return m.Type == "map.prop.updated" })
	reply = agent.call("map.props.move", map[string]any{"id": prop.ID, "x": -1, "y": 9})
	assert.Equal(t, reply.Type, "error")

	reply = agent.call("map.state", nil)
	assert.Equal(t, reply.Type, "result")
	var state mapState
	assert.Nil(t, json.Unmarshal(reply.Data, &state))
	assert.Equal(t, len(state.Buildings), 1)
	assert.Equal(t, len(state.Players), 1)
	assert.Equal(t, state.Players[0].Username, testAgent.Username)
	assert.Equal(t, len(state.Tiles), 1)
	town := 0
	for _, p := range state.Props {
		if p.Scene == database.SceneTown {
			town++
		}
	}
	assert.Equal(t, town, 1) // plus the office's starting furniture
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
	_, joined := p.join("a", database.MapGear{})
	assert.True(t, joined)
	_, joined = p.join("a", database.MapGear{})
	assert.False(t, joined)
	assert.False(t, p.leave("a"))
	assert.True(t, p.leave("a"))
	assert.False(t, p.leave("a"))

	p.join("b", database.MapGear{})
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

func TestMapPresenceScenes(t *testing.T) {
	var p mapPresence
	pl, _ := p.join("a", database.MapGear{})
	assert.Equal(t, pl.Scene, database.SceneTown)

	now := time.Now()
	pl, ok := p.enter("a", database.SceneOffice, now)
	assert.True(t, ok)
	assert.Equal(t, pl.Scene, database.SceneOffice)
	assert.Equal(t, [2]float64{pl.X, pl.Y}, sceneArrivals[database.SceneOffice])

	// Moves are kept inside the office.
	pl, ok = p.move("a", 99999, 99999, "down", now.Add(mapMoveInterval))
	assert.True(t, ok)
	assert.Equal(t, pl.X, float64(database.OfficeCols*16))
	assert.Equal(t, pl.Y, float64(database.OfficeRows*16))
	assert.Equal(t, p.positions([]string{"a"})["a"].Scene, database.SceneOffice)

	pl, _ = p.enter("a", database.SceneTown, now)
	assert.Equal(t, pl.Scene, database.SceneTown)
	_, ok = p.enter("nobody", database.SceneOffice, now)
	assert.False(t, ok)
}

func TestSocketMapEnter(t *testing.T) {
	srv := newTestServer(t)
	c := dial(t, srv, validToken())
	c.call("map.state", nil)

	reply := c.call("map.enter", map[string]any{"scene": "office"})
	assert.Equal(t, reply.Type, "result")
	var p mapPlayer
	assert.Nil(t, json.Unmarshal(reply.Data, &p))
	assert.Equal(t, p.Scene, "office")
	moved := c.readUntil(func(m testMessage) bool { return m.Type == "map.moved" })
	assert.MatchesRegexp(t, string(moved.Data), `"scene":"office"`)

	reply = c.call("map.enter", map[string]any{"scene": "moon"})
	assert.Equal(t, reply.Type, "error")

	// Painting and furnishing the office.
	reply = c.call("map.paint", map[string]any{"tiles": []map[string]any{{"scene": "office", "x": 3, "y": 3, "tile": "wood"}}})
	assert.Equal(t, reply.Type, "result")
	reply = c.call("map.props.create", map[string]any{"scene": "office", "kind": "plant", "x": 3, "y": 3})
	assert.Equal(t, reply.Type, "result")
	assert.MatchesRegexp(t, string(reply.Data), `"scene":"office"`)
	reply = c.call("map.paint", map[string]any{"tiles": []map[string]any{{"scene": "office", "x": 0, "y": 3, "tile": "wood"}}})
	assert.Equal(t, reply.Type, "error")
}

func TestSocketSchoolBuildings(t *testing.T) {
	srv := newTestServer(t)
	agent := dial(t, srv, validToken())

	setCaller := func(phone, name string) database.Building {
		t.Helper()
		reply := agent.call("callerid.set", map[string]any{"phoneNumber": phone, "name": name})
		assert.Equal(t, reply.Type, "result")
		m := agent.readUntil(func(m testMessage) bool { return m.Type == "building.updated" })
		var b database.Building
		assert.Nil(t, json.Unmarshal(m.Data, &b))
		return b
	}

	// Saving a school caller ID adds its building.
	adams := setCaller("+12062520001", "Adams Elem")
	assert.Equal(t, adams.Name, "Adams Elem")
	assert.Equal(t, adams.Patterns, []string{"12062520001"})

	// Renaming renames the same building.
	renamed := setCaller("+12062520001", "Adams Elementary")
	assert.Equal(t, renamed.ID, adams.ID)
	assert.Equal(t, renamed.Name, "Adams Elementary")

	// Other numbers get no building.
	reply := agent.call("callerid.set", map[string]any{"phoneNumber": "+12065550100", "name": "Not a school"})
	assert.Equal(t, reply.Type, "result")

	// Import puts back a school building that was deleted by hand.
	reply = agent.call("buildings.delete", map[string]any{"id": adams.ID})
	assert.Equal(t, reply.Type, "result")
	reply = agent.call("buildings.import", nil)
	assert.Equal(t, reply.Type, "result")
	var result schoolImport
	assert.Nil(t, json.Unmarshal(reply.Data, &result))
	assert.Equal(t, result, schoolImport{Created: 1})

	reply = agent.call("buildings.import", nil)
	assert.Nil(t, json.Unmarshal(reply.Data, &result))
	assert.Equal(t, result, schoolImport{Existing: 1})

	// Deleting the caller ID deletes its building.
	reply = agent.call("callerid.delete", map[string]any{"phoneNumber": "+12062520001"})
	assert.Equal(t, reply.Type, "result")
	agent.readUntil(func(m testMessage) bool { return m.Type == "building.deleted" })
	reply = agent.call("buildings.import", nil)
	assert.Nil(t, json.Unmarshal(reply.Data, &result))
	assert.Equal(t, result, schoolImport{})
}

func TestSocketMapLook(t *testing.T) {
	srv := newTestServer(t)
	c := dial(t, srv, validToken())
	c.call("map.state", nil)

	look := map[string]any{
		"avatar": map[string]any{"skin": 1, "eyes": 2, "pants": 4, "hair": 5},
		"car":    map[string]any{"color": 5, "style": "truck"},
		"bike":   map[string]any{"color": 6},
		"dog":    map[string]any{"coat": 1, "color": 3},
		"cat":    map[string]any{"coat": 1, "color": 5},
	}
	reply := c.call("map.look", look)
	assert.Equal(t, reply.Type, "result")
	moved := c.readUntil(func(m testMessage) bool { return m.Type == "map.moved" })
	var p mapPlayer
	assert.Nil(t, json.Unmarshal(moved.Data, &p))
	assert.Equal(t, p.Look.Avatar["hair"], 5)
	assert.Equal(t, p.Look.Car.Style, "truck")

	for _, bad := range []map[string]any{{"avatar": map[string]any{"skin": 99, "eyes": 0, "pants": 0}}, {"avatar": nil}} {
		broken := map[string]any{}
		for k, v := range look {
			broken[k] = v
		}
		for k, v := range bad {
			broken[k] = v
		}
		reply = c.call("map.look", broken)
		assert.Equal(t, reply.Type, "error")
	}

	reply = c.call("map.gear", map[string]any{"pet": "cat", "ride": "bike"})
	assert.Equal(t, reply.Type, "result")

	// Coming back later (after leaving the map), the look and gear are saved.
	c.conn.CloseNow()
	time.Sleep(100 * time.Millisecond)
	c = dial(t, srv, validToken())
	state := c.call("map.state", nil)
	var s mapState
	assert.Nil(t, json.Unmarshal(state.Data, &s))
	var me *mapPlayer
	for i := range s.Players {
		if s.Players[i].Username == testAgent.Username {
			me = &s.Players[i]
		}
	}
	assert.True(t, me != nil)
	assert.Equal(t, me.Pet, "cat")
	assert.Equal(t, me.Ride, "bike")
	assert.True(t, me.Look != nil)
	assert.Equal(t, me.Look.Dog.Color, 3)

	// null resets to the derived look.
	reply = c.call("map.look", nil)
	assert.Equal(t, reply.Type, "result")
	assert.Nil(t, json.Unmarshal(reply.Data, &me))
	assert.True(t, me.Look == nil)
}
