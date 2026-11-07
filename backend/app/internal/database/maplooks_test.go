package database

import (
	"context"
	"testing"

	"github.com/tyler71/owlchirp/app/internal/assert"
)

func validLook() MapLook {
	var l MapLook
	l.Avatar = MapAvatar{"skin": 1, "eyes": 2, "pants": 3, "hair": 4, "beard": -1, "glasses": 0}
	l.Car.Color, l.Car.Style = 5, "truck"
	l.Bike.Color = 6
	l.Dog.Coat, l.Dog.Color = 1, 3
	l.Cat.Coat, l.Cat.Color = 1, 7
	return l
}

func TestMapGear(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()

	gear, err := db.GetMapGear(ctx, "nobody")
	assert.Nil(t, err)
	assert.Equal(t, gear.Pet, "")
	assert.Equal(t, gear.Ride, "walk")
	assert.True(t, gear.Look == nil)

	// Gear and look are saved separately and keep each other.
	assert.Nil(t, db.SaveMapGear(ctx, "amy", "dog", "car"))
	look := validLook()
	assert.Nil(t, db.SaveMapLook(ctx, "amy", &look))
	assert.Nil(t, db.SaveMapGear(ctx, "amy", "cat", "bike"))
	gear, err = db.GetMapGear(ctx, "amy")
	assert.Nil(t, err)
	assert.Equal(t, gear.Pet, "cat")
	assert.Equal(t, gear.Ride, "bike")
	assert.Equal(t, *gear.Look, look)

	// A look saved first gets the default pet and ride.
	assert.Nil(t, db.SaveMapLook(ctx, "bob", &look))
	gear, err = db.GetMapGear(ctx, "bob")
	assert.Nil(t, err)
	assert.Equal(t, gear.Ride, "walk")
	assert.Equal(t, gear.Look.Car.Style, "truck")

	// Reset.
	assert.Nil(t, db.SaveMapLook(ctx, "amy", nil))
	gear, err = db.GetMapGear(ctx, "amy")
	assert.Nil(t, err)
	assert.True(t, gear.Look == nil)
	assert.Equal(t, gear.Pet, "cat")
}

func TestMapSpot(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()

	gear, err := db.GetMapGear(ctx, "amy")
	assert.Nil(t, err)
	assert.True(t, gear.Spot == nil)

	// Saving a spot keeps pet, ride and look, and the other way round.
	assert.Nil(t, db.SaveMapGear(ctx, "amy", "dog", "car"))
	look := validLook()
	assert.Nil(t, db.SaveMapLook(ctx, "amy", &look))
	spot := MapSpot{Scene: SceneOffice, X: 12.5, Y: 40, Dir: "left"}
	assert.Nil(t, db.SaveMapSpot(ctx, "amy", spot))
	assert.Nil(t, db.SaveMapGear(ctx, "amy", "cat", "bike"))
	gear, err = db.GetMapGear(ctx, "amy")
	assert.Nil(t, err)
	assert.Equal(t, *gear.Spot, spot)
	assert.Equal(t, gear.Pet, "cat")
	assert.Equal(t, *gear.Look, look)

	// A spot saved first gets the default ride.
	assert.Nil(t, db.SaveMapSpot(ctx, "bob", spot))
	gear, err = db.GetMapGear(ctx, "bob")
	assert.Nil(t, err)
	assert.Equal(t, gear.Ride, "walk")
	assert.Equal(t, gear.Spot.Dir, "left")
}

func TestMapLookValidate(t *testing.T) {
	assert.Nil(t, validLook().Validate())
	for _, broken := range []func(*MapLook){
		func(l *MapLook) { l.Avatar = nil },
		func(l *MapLook) { delete(l.Avatar, "skin") },
		func(l *MapLook) { l.Avatar["eyes"] = -1 },
		func(l *MapLook) { l.Avatar["hair"] = 22 },
		func(l *MapLook) { l.Avatar["beard"] = -2 },
		func(l *MapLook) { l.Avatar["wings"] = 0 },
		func(l *MapLook) { l.Car.Color = VehicleColorCount },
		func(l *MapLook) { l.Cat.Coat = CatCoatCount },
		func(l *MapLook) { l.Car.Style = "" },
		func(l *MapLook) { l.Dog.Color = PetColorCount },
		func(l *MapLook) { l.Cat.Color = -1 },
	} {
		l := validLook()
		broken(&l)
		assert.NotNil(t, l.Validate())
	}
}
