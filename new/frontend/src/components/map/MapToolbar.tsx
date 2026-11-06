// The Map's menu bar: design your look, pick a pet and a ride for everyone
// to see, and with
// Map design, Create / Destroy tools and moving buildings.
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { useStore } from "@nanostores/react";
import { useState, type ReactNode } from "react";

import {
  $mapBrush,
  $mapMode,
  $mapPanelOffsets,
  $mapPanelsMinimized,
  $mapSize,
  $myGear,
  $myScene,
  MAP_SIZES,
  resetPanelOffsets,
  sendGear,
  type Brush,
  type MapMode,
  type Pet,
  type Ride,
} from "../../lib/map";
import { $can } from "../../lib/stores";
import { Button } from "../ui";
import type { VoiceMode } from "../../lib/theme";
import {
  $voiceDeafened,
  $voiceMode,
  $voiceMuted,
  $voiceOnCall,
  $voicePttHeld,
  $voiceStatus,
  $voiceTalking,
  setPttHeld,
} from "../../lib/voice";
import Segmented, { ROW_LABEL } from "./Segmented";
import { GROUND, PROP_INFO } from "./sprites";
import { SCENES } from "./scenes";

const PETS: { value: Pet; label: string }[] = [
  { value: "", label: "None" },
  { value: "dog", label: "🐶 Dog" },
  { value: "cat", label: "🐱 Cat" },
];
const RIDES: { value: Ride; label: string }[] = [
  { value: "walk", label: "🚶 Walk" },
  { value: "bike", label: "🚲 Bike" },
  { value: "car", label: "🚗 Car" },
];
const MODES: { value: MapMode; label: string; hint: string }[] = [
  {
    value: "create",
    label: "✏️ Create",
    hint: "Click or drag on the map to paint ground or place what you picked below.",
  },
  {
    value: "destroy",
    label: "🧨 Destroy",
    hint: "Click or drag to remove decorations and trees, then painted ground.",
  },
  {
    value: "move",
    label: "✋ Move",
    hint: "Drag a building or decoration to anywhere it fits: green means it fits.",
  },
];

const LABEL =
  "text-xs font-semibold text-secondary-500 uppercase dark:text-secondary-400";

function sameBrush(a: Brush, b: Brush): boolean {
  return a.type === "tile"
    ? b.type === "tile" && a.tile === b.tile
    : b.type === "prop" && a.kind === b.kind;
}

function Palette() {
  const brush = useStore($mapBrush);
  const { tileKinds, propKinds } = SCENES[useStore($myScene)];
  const item = (b: Brush, label: ReactNode, title: string) => (
    <button
      key={title}
      type="button"
      title={title}
      tabIndex={-1}
      aria-pressed={sameBrush(b, brush)}
      onClick={() => $mapBrush.set(b)}
      className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium ${
        sameBrush(b, brush)
          ? "border-primary-500 bg-primary-50 text-primary-800 dark:bg-primary-500/15 dark:text-primary-200"
          : "border-secondary-200 bg-base-100 hover:bg-secondary-100 dark:border-secondary-700 dark:bg-secondary-800 dark:hover:bg-secondary-700"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-2 border-t border-secondary-100 px-4 py-3 dark:border-secondary-800">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-20 text-xs font-semibold text-secondary-500 uppercase dark:text-secondary-400">
          Ground
        </span>
        {tileKinds.map((tile) =>
          item(
            { type: "tile", tile },
            <>
              <span
                className="size-3.5 rounded-sm border border-black/20"
                style={{ background: GROUND[tile].colors[0] }}
              />
              {GROUND[tile].label}
            </>,
            GROUND[tile].label,
          ),
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-20 text-xs font-semibold text-secondary-500 uppercase dark:text-secondary-400">
          Things
        </span>
        {propKinds.map((kind) =>
          item(
            { type: "prop", kind },
            <>
              <span aria-hidden>{PROP_INFO[kind].emoji}</span>
              {PROP_INFO[kind].label}
            </>,
            PROP_INFO[kind].label,
          ),
        )}
      </div>
    </div>
  );
}

const VOICE_MODES: { value: VoiceMode; label: ReactNode }[] = [
  {
    value: "threshold",
    label: (
      <span title="Your mic opens on its own when you speak">🎚️ Auto</span>
    ),
  },
  {
    value: "ptt",
    label: (
      <span title="Hold Space (or the Talk button) to talk">
        ⌨️ Push to talk
      </span>
    ),
  },
];

const VOICE_LABEL: Record<string, { text: string; title: string }> = {
  off: { text: "Voice off", title: "Voice is off" },
  connecting: { text: "Connecting…", title: "Connecting to map voice" },
  live: {
    text: "Live",
    title: "People within 10 tiles hear you, louder the closer they are",
  },
  listenOnly: {
    text: "Listen only",
    title:
      "The microphone isn't available, so you can hear others but they can't hear you",
  },
  elsewhere: {
    text: "In another tab",
    title: "Map voice is running in another Owlchirp tab",
  },
  unsupported: {
    text: "Not supported",
    title: "This browser can't do map voice (needs WebCodecs)",
  },
  error: {
    text: "Unavailable",
    title: "Map voice isn't available for your account",
  },
};

function ToggleButton({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
        on
          ? "border-rose-700 bg-rose-600 text-white"
          : "border-secondary-200 bg-base-100 hover:bg-secondary-100 dark:border-secondary-700 dark:bg-secondary-800 dark:hover:bg-secondary-700"
      }`}
    >
      {children}
    </button>
  );
}

function VoiceControl() {
  const status = useStore($voiceStatus);
  const muted = useStore($voiceMuted);
  const deafened = useStore($voiceDeafened);
  const onCall = useStore($voiceOnCall);
  const talking = useStore($voiceTalking);
  const mode = useStore($voiceMode);
  const pttHeld = useStore($voicePttHeld);
  const canTalk = status === "live";
  const canHear = status === "live" || status === "listenOnly";
  const label =
    onCall && canHear
      ? {
          text: "Paused: on a call",
          title: "Map voice is muted both ways while you are on a call",
        }
      : VOICE_LABEL[status];
  const dot =
    onCall || !canHear
      ? "bg-secondary-400"
      : muted || deafened || !canTalk
        ? "bg-rose-500"
        : talking
          ? "bg-emerald-400 animate-pulse"
          : "bg-emerald-600";

  return (
    <div className="flex items-start gap-2">
      <span className={`${LABEL} ${ROW_LABEL} pt-1.5`}>Voice</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 text-xs font-medium"
          title={label.title}
        >
          <span className={`size-2 rounded-full ${dot}`} aria-hidden />
          {label.text}
        </span>
        {canTalk && (
          <ToggleButton
            on={muted}
            onClick={() => $voiceMuted.set(!muted)}
            title={
              muted
                ? "Your mic is muted: click so people nearby can hear you"
                : "Mute your mic"
            }
          >
            {muted ? "🔇 Mic off" : "🎙️ Mic on"}
          </ToggleButton>
        )}
        {canTalk && (
          <Segmented
            label="Mode"
            options={VOICE_MODES}
            value={mode}
            onChange={(m) => $voiceMode.set(m)}
          />
        )}
        {canTalk && mode === "ptt" && !muted && (
          <button
            type="button"
            tabIndex={-1}
            aria-pressed={pttHeld}
            title="Hold to talk (or hold Space)"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setPttHeld(true);
            }}
            onPointerUp={() => setPttHeld(false)}
            onPointerCancel={() => setPttHeld(false)}
            onLostPointerCapture={() => setPttHeld(false)}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold select-none ${
              pttHeld
                ? "border-emerald-700 bg-emerald-600 text-white"
                : "border-secondary-200 bg-base-100 hover:bg-secondary-100 dark:border-secondary-700 dark:bg-secondary-800 dark:hover:bg-secondary-700"
            }`}
          >
            🗣️ Hold to talk
          </button>
        )}
        {canHear && (
          <ToggleButton
            on={deafened}
            onClick={() => $voiceDeafened.set(!deafened)}
            title={
              deafened
                ? "Everyone is muted: click to hear people nearby"
                : "Mute everyone else"
            }
          >
            {deafened ? "🔈 Sound off" : "🔊 Sound on"}
          </ToggleButton>
        )}
      </div>
    </div>
  );
}

function ToggleButtonPlain({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
        on
          ? "border-primary-500 bg-primary-500 text-primary-content"
          : "border-secondary-200 bg-base-100 hover:bg-secondary-100 dark:border-secondary-700 dark:bg-secondary-800 dark:hover:bg-secondary-700"
      }`}
    >
      {children}
    </button>
  );
}

// Asks before putting every map panel back where it started.
function ResetLayoutDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div
        className="fixed inset-0 bg-secondary-900/40 backdrop-blur-xs"
        aria-hidden
      />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-sm rounded-lg bg-base-100 p-6 text-base-content shadow-xl ring-1 shadow-secondary-500/10 ring-black/5 dark:bg-secondary-800 dark:shadow-secondary-900 dark:ring-secondary-700">
          <DialogTitle className="text-base font-semibold">
            Reset map layout?
          </DialogTitle>
          <p className="mt-1 text-sm text-secondary-600 dark:text-secondary-300">
            This puts all map panels back where they started and expands them.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                resetPanelOffsets();
                onClose();
              }}
            >
              Reset
            </Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

export default function MapToolbar({
  buildingsOpen,
  onToggleBuildings,
  designOpen,
  onToggleDesign,
}: {
  buildingsOpen?: boolean;
  onToggleBuildings?: () => void;
  designOpen?: boolean;
  onToggleDesign?: () => void;
}) {
  const gear = useStore($myGear);
  const ridesHere = SCENES[useStore($myScene)].rides;
  const mode = useStore($mapMode);
  const canDesign = useStore($can("mapDesign"));
  const isAdmin = useStore($can("admin"));
  const [confirmReset, setConfirmReset] = useState(false);
  const size = useStore($mapSize);
  const hint = MODES.find((m) => m.value === mode)?.hint;
  const minimized = useStore($mapPanelsMinimized);
  const moved =
    Object.keys(useStore($mapPanelOffsets)).length > 0 ||
    Object.keys(minimized).length > 0;

  return (
    // Mousedown would move focus off the map canvas and stop walking; buttons
    // still get their click.
    <>
      <div
        onMouseDown={(e) => e.preventDefault()}
        className="flex max-w-md flex-col overflow-hidden rounded-lg border border-secondary-200 bg-base-100/90 shadow-lg backdrop-blur-sm dark:border-secondary-800 dark:bg-secondary-900/90"
      >
        <div className="flex flex-col gap-2 px-3 py-2">
          {onToggleDesign && (
            <div className="flex items-center gap-2">
              <span className={`${LABEL} ${ROW_LABEL}`}>Look</span>
              <ToggleButtonPlain on={!!designOpen} onClick={onToggleDesign}>
                🎨 Design
              </ToggleButtonPlain>
            </div>
          )}
          <Segmented
            row
            label="Pet"
            options={PETS}
            value={gear.pet}
            onChange={(pet) => sendGear(pet, gear.ride)}
          />
          {ridesHere ? (
            <Segmented
              row
              label="Ride"
              options={RIDES}
              value={gear.ride}
              onChange={(ride) => sendGear(gear.pet, ride)}
            />
          ) : (
            <div className="flex items-center gap-2">
              <span className={`${LABEL} ${ROW_LABEL}`}>Ride</span>
              <span className="text-xs text-secondary-500">
                On foot indoors — rides wait outside
              </span>
            </div>
          )}
          <VoiceControl />
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Segmented
                row
                label="Size"
                options={MAP_SIZES.map((s) => ({
                  value: s.value,
                  label: <span title={s.title}>{s.label}</span>,
                }))}
                value={size}
                onChange={(v) => $mapSize.set(v)}
              />
            </div>
            {isAdmin && moved && (
              <button
                type="button"
                tabIndex={-1}
                title="Put the map panels back where they started and expand them"
                onClick={() => setConfirmReset(true)}
                className="shrink-0 rounded-lg border border-secondary-200 px-2.5 py-1.5 text-xs font-semibold hover:bg-secondary-100 dark:border-secondary-700 dark:hover:bg-secondary-700"
              >
                ↺ Reset layout
              </button>
            )}
          </div>
          {(onToggleBuildings || canDesign) && (
            <div className="flex items-start gap-2">
              <span className={`${LABEL} ${ROW_LABEL} pt-1.5`}>Build</span>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {onToggleBuildings && (
                  <ToggleButtonPlain
                    on={!!buildingsOpen}
                    onClick={onToggleBuildings}
                  >
                    🏢 Buildings
                  </ToggleButtonPlain>
                )}
                {canDesign && (
                  <>
                    {MODES.map((m) => (
                      <button
                        key={m.value}
                        type="button"
                        tabIndex={-1}
                        aria-pressed={mode === m.value}
                        onClick={() =>
                          $mapMode.set(mode === m.value ? "walk" : m.value)
                        }
                        className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                          mode === m.value
                            ? m.value === "destroy"
                              ? "border-rose-700 bg-rose-600 text-white"
                              : "border-primary-500 bg-primary-500 text-primary-content"
                            : "border-secondary-200 bg-base-100 hover:bg-secondary-100 dark:border-secondary-700 dark:bg-secondary-800 dark:hover:bg-secondary-700"
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                    {mode !== "walk" && (
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => $mapMode.set("walk")}
                        className="rounded-lg border border-secondary-200 px-2.5 py-1.5 text-xs font-semibold hover:bg-secondary-100 dark:border-secondary-700 dark:hover:bg-secondary-700"
                      >
                        Done
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        {canDesign && hint && (
          <p className="border-t border-secondary-100 px-4 py-2 text-xs text-secondary-500 dark:border-secondary-800 dark:text-secondary-400">
            {hint} Press Esc to go back to walking.
          </p>
        )}
        {canDesign && mode === "create" && <Palette />}
      </div>
      {/* Outside the toolbar so its mousedown guard doesn't reach the dialog
        (portal events still bubble through React parents). */}
      <ResetLayoutDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
      />
    </>
  );
}
