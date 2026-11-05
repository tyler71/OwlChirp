// The Map's menu bar: pick a pet and a ride for everyone to see, and with
// Map design, Create / Destroy tools and moving buildings.
import { useStore } from '@nanostores/react';
import type { ReactNode } from 'react';

import { $mapBrush, $mapMode, $myGear, sendGear, type Brush, type MapMode, type Pet, type Ride } from '../../lib/map';
import { $can } from '../../lib/stores';
import { $voiceMuted, $voiceOnCall, $voiceStatus, $voiceTalking } from '../../lib/voice';
import { GROUND, PROP_INFO } from './sprites';
import { PROP_KINDS, TILE_KINDS } from './world';

const PETS: { value: Pet; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'dog', label: '🐶 Dog' },
  { value: 'cat', label: '🐱 Cat' },
];
const RIDES: { value: Ride; label: string }[] = [
  { value: 'walk', label: '🚶 Walk' },
  { value: 'bike', label: '🚲 Bike' },
  { value: 'car', label: '🚗 Car' },
];
const MODES: { value: MapMode; label: string; hint: string }[] = [
  { value: 'create', label: '✏️ Create', hint: 'Click or drag on the map to paint ground or place what you picked below.' },
  { value: 'destroy', label: '🧨 Destroy', hint: 'Click or drag to remove decorations and trees, then painted ground.' },
  { value: 'move', label: '✋ Move buildings', hint: 'Drag a building to anywhere it fits: green means it fits.' },
];

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold text-secondary-500 uppercase dark:text-secondary-400">{label}</span>
      <div role="radiogroup" aria-label={label} className="inline-flex overflow-hidden rounded-lg border border-secondary-200 dark:border-secondary-700">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
            className={`border-r border-secondary-200 px-2.5 py-1.5 text-xs font-semibold last:border-r-0 dark:border-secondary-700 ${
              o.value === value
                ? 'bg-primary-500 text-primary-content'
                : 'bg-base-100 text-secondary-700 hover:bg-secondary-100 dark:bg-secondary-800 dark:text-secondary-200 dark:hover:bg-secondary-700'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function sameBrush(a: Brush, b: Brush): boolean {
  return a.type === 'tile' ? b.type === 'tile' && a.tile === b.tile : b.type === 'prop' && a.kind === b.kind;
}

function Palette() {
  const brush = useStore($mapBrush);
  const item = (b: Brush, label: ReactNode, title: string) => (
    <button
      key={title}
      type="button"
      title={title}
      aria-pressed={sameBrush(b, brush)}
      onClick={() => $mapBrush.set(b)}
      className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium ${
        sameBrush(b, brush)
          ? 'border-primary-500 bg-primary-50 text-primary-800 dark:bg-primary-500/15 dark:text-primary-200'
          : 'border-secondary-200 bg-base-100 hover:bg-secondary-100 dark:border-secondary-700 dark:bg-secondary-800 dark:hover:bg-secondary-700'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-2 border-t border-secondary-100 px-4 py-3 dark:border-secondary-800">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-20 text-xs font-semibold text-secondary-500 uppercase dark:text-secondary-400">Ground</span>
        {TILE_KINDS.map((tile) =>
          item(
            { type: 'tile', tile },
            <>
              <span className="size-3.5 rounded-sm border border-black/20" style={{ background: GROUND[tile].colors[0] }} />
              {GROUND[tile].label}
            </>,
            GROUND[tile].label,
          ),
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-20 text-xs font-semibold text-secondary-500 uppercase dark:text-secondary-400">Things</span>
        {PROP_KINDS.map((kind) =>
          item(
            { type: 'prop', kind },
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

const VOICE_LABEL: Record<string, { text: string; title: string }> = {
  off: { text: 'Voice off', title: 'Voice is off' },
  connecting: { text: 'Connecting…', title: 'Connecting to map voice' },
  live: { text: 'Live', title: 'People within 10 tiles hear you, louder the closer they are' },
  listenOnly: { text: 'Listen only', title: "The microphone isn't available, so you can hear others but they can't hear you" },
  elsewhere: { text: 'In another tab', title: 'Map voice is running in another Owlchirp tab' },
  unsupported: { text: 'Not supported', title: "This browser can't do map voice (needs WebCodecs)" },
  error: { text: 'Unavailable', title: "Map voice isn't available for your account" },
};

function VoiceControl() {
  const status = useStore($voiceStatus);
  const muted = useStore($voiceMuted);
  const onCall = useStore($voiceOnCall);
  const talking = useStore($voiceTalking);
  const canTalk = status === 'live';
  const label = onCall && (status === 'live' || status === 'listenOnly') ? { text: 'Paused: on a call', title: 'Map voice is muted both ways while you are on a call' } : VOICE_LABEL[status];
  const dot = onCall || !canTalk ? 'bg-secondary-400' : muted ? 'bg-rose-500' : talking ? 'bg-emerald-400 animate-pulse' : 'bg-emerald-600';

  return (
    <div className="flex items-center gap-2" title={label.title}>
      <span className="text-xs font-semibold text-secondary-500 uppercase dark:text-secondary-400">Voice</span>
      <span className="inline-flex items-center gap-1.5 text-xs font-medium">
        <span className={`size-2 rounded-full ${dot}`} aria-hidden />
        {label.text}
      </span>
      {canTalk && (
        <button
          type="button"
          aria-pressed={muted}
          onClick={() => $voiceMuted.set(!muted)}
          className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
            muted
              ? 'border-rose-700 bg-rose-600 text-white'
              : 'border-secondary-200 bg-base-100 hover:bg-secondary-100 dark:border-secondary-700 dark:bg-secondary-800 dark:hover:bg-secondary-700'
          }`}
        >
          {muted ? '🔇 Unmute' : '🎙️ Mute'}
        </button>
      )}
    </div>
  );
}

export default function MapToolbar() {
  const gear = useStore($myGear);
  const mode = useStore($mapMode);
  const canDesign = useStore($can('mapDesign'));
  const hint = MODES.find((m) => m.value === mode)?.hint;

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-secondary-200 bg-base-100 dark:border-secondary-800 dark:bg-secondary-900">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
        <Segmented label="Pet" options={PETS} value={gear.pet} onChange={(pet) => sendGear(pet, gear.ride)} />
        <Segmented label="Ride" options={RIDES} value={gear.ride} onChange={(ride) => sendGear(gear.pet, ride)} />
        <VoiceControl />
        {canDesign && (
          <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                aria-pressed={mode === m.value}
                onClick={() => $mapMode.set(mode === m.value ? 'walk' : m.value)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                  mode === m.value
                    ? m.value === 'destroy'
                      ? 'border-rose-700 bg-rose-600 text-white'
                      : 'border-primary-500 bg-primary-500 text-primary-content'
                    : 'border-secondary-200 bg-base-100 hover:bg-secondary-100 dark:border-secondary-700 dark:bg-secondary-800 dark:hover:bg-secondary-700'
                }`}
              >
                {m.label}
              </button>
            ))}
            {mode !== 'walk' && (
              <button
                type="button"
                onClick={() => $mapMode.set('walk')}
                className="rounded-lg border border-secondary-200 px-2.5 py-1.5 text-xs font-semibold hover:bg-secondary-100 dark:border-secondary-700 dark:hover:bg-secondary-700"
              >
                Done
              </button>
            )}
          </div>
        )}
      </div>
      {canDesign && hint && (
        <p className="border-t border-secondary-100 px-4 py-2 text-xs text-secondary-500 dark:border-secondary-800 dark:text-secondary-400">
          {hint} Press Esc to go back to walking.
        </p>
      )}
      {canDesign && mode === 'create' && <Palette />}
    </div>
  );
}
