package database

import (
	"context"
	"testing"

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

	list, err := db.ListBuildings(ctx)
	assert.Nil(t, err)
	assert.Equal(t, len(list), 0)

	a, err := db.CreateBuilding(ctx, "Seattle", []string{"1206256*"}, 1)
	assert.Nil(t, err)
	assert.Equal(t, a.Slot, 0)
	b, err := db.CreateBuilding(ctx, "Bellevue", []string{"1425*"}, 0)
	assert.Nil(t, err)
	assert.Equal(t, b.Slot, 1)

	// Updating keeps the lot.
	u, found, err := db.UpdateBuilding(ctx, a.ID, "Seattle HQ", []string{"1206*", "12065550100"}, 2)
	assert.Nil(t, err)
	assert.True(t, found)
	assert.Equal(t, u.Slot, 0)
	assert.Equal(t, u.Name, "Seattle HQ")
	assert.Equal(t, u.Patterns, []string{"1206*", "12065550100"})

	_, found, err = db.UpdateBuilding(ctx, 999, "x", nil, 0)
	assert.Nil(t, err)
	assert.False(t, found)

	// Deleting frees the lot for the next building.
	found, err = db.DeleteBuilding(ctx, a.ID)
	assert.Nil(t, err)
	assert.True(t, found)
	c, err := db.CreateBuilding(ctx, "Tacoma", []string{}, 0)
	assert.Nil(t, err)
	assert.Equal(t, c.Slot, 0)

	list, err = db.ListBuildings(ctx)
	assert.Nil(t, err)
	assert.Equal(t, len(list), 2)
	assert.Equal(t, list[0].Name, "Tacoma")
	assert.Equal(t, list[1].Patterns, []string{"1425*"})

	for i := 2; i < MapSlotCount; i++ {
		_, err := db.CreateBuilding(ctx, "filler", nil, 0)
		assert.Nil(t, err)
	}
	_, err = db.CreateBuilding(ctx, "one too many", nil, 0)
	assert.ErrorIs(t, err, ErrNoFreeSlot)
}
