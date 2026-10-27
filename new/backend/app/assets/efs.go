package assets

import (
	"embed"
)

//go:embed "schema.sql"
var Schema string

// Web holds the built Astro frontend. `just embed` copies frontend/dist here.
//
//go:embed all:web
var Web embed.FS
