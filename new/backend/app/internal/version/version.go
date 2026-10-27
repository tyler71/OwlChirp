package version

import (
	"fmt"
	"runtime/debug"
)

func Get() string {
	if BuildVersion != "" {
		return BuildVersion
	}

	bi, ok := debug.ReadBuildInfo()
	if ok {
		return bi.Main.Version
	}

	return "unavailable"
}

func GetRevision() string {
	var revision string
	var modified bool

	bi, ok := debug.ReadBuildInfo()
	if ok {
		for _, s := range bi.Settings {
			switch s.Key {
			case "vcs.revision":
				revision = s.Value
			case "vcs.modified":
				if s.Value == "true" {
					modified = true
				}
			}
		}
	}

	if revision == "" {
		return "unavailable"
	}

	if modified {
		return fmt.Sprintf("%s+dirty", revision)
	}

	return revision
}

// BuildVersion is set at build time with -ldflags "-X .../version.BuildVersion=..."
var BuildVersion = ""
