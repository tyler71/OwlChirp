// Single-key shortcuts while the Map is open: T ride, P pet, M mute all,
// B cycle build tools (ending back at walking).
import { useEffect } from "react";

import { $mapMode, $myGear, $myScene, sendGear } from "../../lib/map";
import { can } from "../../lib/stores";
import { $voiceDeafened, $voiceMuted, isTyping } from "../../lib/voice";
import { MODES, PETS, RIDES } from "./MapToolbar";
import { SCENES } from "./scenes";

/** The item after `current` in `list`, wrapping around. */
function next<T>(list: readonly T[], current: T): T {
  return list[(list.indexOf(current) + 1) % list.length];
}

export default function useMapShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      if (isTyping(e.target)) return;
      // Leave keys alone while a dialog (e.g. Reset layout) is open.
      if (document.querySelector('[role="dialog"]')) return;

      const gear = $myGear.get();
      switch (e.key.toLowerCase()) {
        case "t":
          if (!SCENES[$myScene.get()].rides) return;
          sendGear(gear.pet, next(RIDES.map((r) => r.value), gear.ride));
          break;
        case "p":
          sendGear(next(PETS.map((p) => p.value), gear.pet), gear.ride);
          break;
        case "m": {
          const allMuted = $voiceMuted.get() && $voiceDeafened.get();
          $voiceMuted.set(!allMuted);
          $voiceDeafened.set(!allMuted);
          break;
        }
        case "b":
          if (!can("mapDesign")) return;
          $mapMode.set(
            next(["walk" as const, ...MODES.map((m) => m.value)], $mapMode.get()),
          );
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
