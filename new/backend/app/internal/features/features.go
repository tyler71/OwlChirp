// Package features lists the Owlchirp features an admin can grant to each
// user. Phone and Settings are always available and are not features.
package features

import (
	"slices"
)

// Feature keys. The frontend's FEATURES list in lib/stores.ts mirrors these;
// update both together.
const (
	Feed          = "feed"          // Feed view
	Flow          = "flow"          // Flow Calls view, queue badge, CallFlow card
	Timeline      = "timeline"      // Timeline view
	Calls         = "calls"         // Recent Calls view (own calls)
	CallsAll      = "callsAll"      // every agent's calls in Recent Calls
	CallerHistory = "callerHistory" // past calls from the active caller
	CallerIDs     = "callerIds"     // Caller IDs management view
	AgentNames    = "agentNames"    // agent names on calls and wrapups
	Map           = "map"           // Map view
	MapEdit       = "mapEdit"       // manage Map buildings and their numbers
	Admin         = "admin"         // Admin view and user management
)

// All lists every feature in display order.
var All = []string{Feed, Flow, Timeline, Calls, CallsAll, CallerHistory, CallerIDs, AgentNames, Map, MapEdit, Admin}

// Presets are the feature sets matching the old permission levels.
var Presets = map[string][]string{
	"standard": {Map},
	"power":    {Feed, Flow, Timeline, Calls, CallerHistory, CallerIDs, Map, MapEdit},
	"admin":    All,
}

// Valid reports whether key is a known feature.
func Valid(key string) bool {
	return slices.Contains(All, key)
}

// Normalize returns list sorted in All's order with duplicates removed. It
// reports false if list holds an unknown key.
func Normalize(list []string) ([]string, bool) {
	out := []string{}
	for _, f := range All {
		if slices.Contains(list, f) {
			out = append(out, f)
		}
	}
	for _, f := range list {
		if !Valid(f) {
			return nil, false
		}
	}
	return out, true
}

// FromLevel converts an old permission level (0 standard, 1 power, 2 admin)
// to its preset.
func FromLevel(level int) []string {
	switch {
	case level >= 2:
		return slices.Clone(Presets["admin"])
	case level == 1:
		return slices.Clone(Presets["power"])
	default:
		return []string{}
	}
}
