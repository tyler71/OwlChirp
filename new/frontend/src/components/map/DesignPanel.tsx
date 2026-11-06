// Design how you look on the Map: your character, car, bike, dog and cat.
// Saved on the server, so it follows you to any browser.
import { useStore } from '@nanostores/react';
import { useEffect, useRef, useState } from 'react';

import { $myGear, $myLook, saveLook, type MapLook, type Pet, type Ride } from '../../lib/map';
import { Button } from '../ui';
import { AVATAR_PARTS, LAYERS, REQUIRED_PARTS, loadMapAssets, type AvatarPart } from './assets';
import Segmented from './Segmented';
import {
  CAR_STYLES,
  CAT_COATS,
  CAT_MARKINGS,
  DOG_COATS,
  DOG_MARKINGS,
  VEHICLE_COLORS,
  defaultLook,
  randomAvatar,
  resolveLook,
  drawCharacter,
  drawPet,
  drawVehicle,
  type Facing,
} from './sprites';

type Tab = 'avatar' | 'car' | 'bike' | 'dog' | 'cat';

const TABS: { value: Tab; label: string }[] = [
  { value: 'avatar', label: '🧍 You' },
  { value: 'car', label: '🚗 Car' },
  { value: 'bike', label: '🚲 Bike' },
  { value: 'dog', label: '🐶 Dog' },
  { value: 'cat', label: '🐱 Cat' },
];

const FACINGS: Facing[] = ['down', 'left', 'up', 'right'];

const LABEL = 'w-16 shrink-0 text-xs font-semibold text-secondary-500 uppercase dark:text-secondary-400';

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function Swatches({ label, colors, value, onChange }: { label: string; colors: { hex: string; label: string }[]; value: number; onChange: (i: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className={LABEL}>{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {colors.map((c, i) => (
          <button
            key={c.label + i}
            type="button"
            role="radio"
            aria-checked={i === value}
            aria-label={c.label}
            title={c.label}
            onClick={() => onChange(i)}
            className={`size-6 rounded-full border-2 ${i === value ? 'border-primary-500 ring-2 ring-primary-500/40' : 'border-black/20 dark:border-white/20'}`}
            style={{ background: c.hex }}
          />
        ))}
      </div>
    </div>
  );
}

const PART_LABELS: Record<AvatarPart, string> = {
  skin: 'Skin',
  eyes: 'Eyes',
  brows: 'Brows',
  hair: 'Hair',
  beard: 'Beard',
  face: 'Face',
  facepaint: 'Paint',
  ears: 'Ears',
  pants: 'Pants',
  outfit: 'Outfit',
  tabard: 'Tabard',
  cape: 'Cape',
  accessory: 'Extra',
  glasses: 'Glasses',
  headwear: 'Hat',
};

/** One avatar part: step through its layers, or None for optional parts. */
function PartPicker({ part, value, onChange }: { part: AvatarPart; value: number; onChange: (i: number) => void }) {
  const layers = LAYERS[part];
  const optional = !REQUIRED_PARTS.has(part);
  const lo = optional ? -1 : 0;
  const span = layers.length - lo;
  const step = (d: number) => onChange(((((value - lo + d) % span) + span) % span) + lo);
  const name = value >= 0 ? (layers[value]?.label ?? '?') : 'None';
  const arrow = 'rounded-md border border-secondary-200 px-2 py-0.5 text-xs hover:bg-secondary-100 dark:border-secondary-700 dark:hover:bg-secondary-800';
  return (
    <div className="flex items-center gap-2">
      <span className={LABEL}>{PART_LABELS[part]}</span>
      <button type="button" className={arrow} aria-label={`Previous ${PART_LABELS[part]}`} onClick={() => step(-1)}>
        ‹
      </button>
      <span className="min-w-0 flex-1 truncate text-center text-xs" title={name}>
        {name}
        {layers.length > 1 && value >= 0 && <span className="text-secondary-400"> · {value + 1}/{layers.length}</span>}
      </span>
      <button type="button" className={arrow} aria-label={`Next ${PART_LABELS[part]}`} onClick={() => step(1)}>
        ›
      </button>
    </div>
  );
}

const PREVIEW_W = 64;
const PREVIEW_H = 48;
const SCALE = 4;

/** The draft look, animated at 4x: the tab's subject turned to facing. */
function Preview({ username, look, tab, facing }: { username: string; look: MapLook; tab: Tab; facing: Facing }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const draw = useRef({ look, tab, facing });
  draw.current = { look, tab, facing };

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    void loadMapAssets();
    const start = performance.now();
    const frame = (now: number) => {
      const { look, tab, facing } = draw.current;
      const t = (now - start) / 1000;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      const x = PREVIEW_W / 2;
      const y = PREVIEW_H - 8;
      if (tab === 'avatar') {
        drawCharacter(ctx, username, look, x, y, facing, 'walk', t);
      } else if (tab === 'car' || tab === 'bike') {
        drawCharacter(ctx, username, look, x, y, facing, 'walk', t, tab);
      } else {
        drawPet(ctx, tab, username, look, x, y, facing, true, t);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [username]);

  return (
    <canvas
      ref={ref}
      width={PREVIEW_W * SCALE}
      height={PREVIEW_H * SCALE}
      className="h-48 w-64 rounded-lg border border-secondary-200 bg-emerald-200/60 [image-rendering:pixelated] dark:border-secondary-700 dark:bg-emerald-900/40"
      aria-label="Preview"
    />
  );
}

/** A small car or bike on its own, for the ride tabs' side view. */
function VehicleThumb({ username, look, ride }: { username: string; look: MapLook; ride: Exclude<Ride, 'walk'> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, 96, 48);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    drawVehicle(ctx, username, look, ride, 24, 22, 'left');
  }, [username, look, ride]);
  return <canvas ref={ref} width={96} height={48} className="h-12 w-24 [image-rendering:pixelated]" aria-hidden />;
}

export default function DesignPanel({ username, onClose }: { username: string; onClose: () => void }) {
  const saved = useStore($myLook);
  const gear = useStore($myGear);
  const [draft, setDraft] = useState<MapLook>(() => resolveLook(username, saved));
  const [tab, setTab] = useState<Tab>('avatar');
  const [facing, setFacing] = useState<Facing>('down');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const set = (patch: Partial<MapLook>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setNote('');
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(resolveLook(username, saved));

  const run = async (look: MapLook | null, done: string) => {
    setBusy(true);
    setError('');
    try {
      await saveLook(look);
      if (look === null) setDraft(defaultLook(username));
      setNote(done);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const turn = () => setFacing((f) => FACINGS[(FACINGS.indexOf(f) + 1) % FACINGS.length]);
  const notUsing = (what: string) => <p className="text-xs text-secondary-500 dark:text-secondary-400">You're not {what} right now: pick one in the menu bar to show it on the map.</p>;
  const petHint = (pet: Exclude<Pet, ''>) => gear.pet !== pet && notUsing(`walking a ${pet}`);
  const rideHint = (ride: Exclude<Ride, 'walk'>) => gear.ride !== ride && notUsing(ride === 'car' ? 'driving' : 'riding a bike');

  return (
    // Mousedown would move focus off the map canvas and stop walking.
    <section
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
      className="flex flex-col overflow-hidden rounded-lg border border-secondary-200 bg-base-100 dark:border-secondary-800 dark:bg-secondary-900"
    >
      <div className="flex items-center justify-between gap-2 border-b border-secondary-100 px-5 py-4 dark:border-secondary-800">
        <div>
          <h2 className="font-semibold">🎨 Design</h2>
          <p className="text-xs text-secondary-500 dark:text-secondary-400">How everyone sees you on the map.</p>
        </div>
        <Button size="sm" onClick={onClose} aria-label="Close">
          ✕
        </Button>
      </div>

      <div className="flex flex-col gap-4 px-5 py-4">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => setTab(t.value)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                tab === t.value
                  ? 'border-primary-500 bg-primary-500 text-primary-content'
                  : 'border-secondary-200 bg-base-100 hover:bg-secondary-100 dark:border-secondary-700 dark:bg-secondary-800 dark:hover:bg-secondary-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col items-center gap-2">
          <Preview username={username} look={draft} tab={tab} facing={facing} />
          <Button size="sm" onClick={turn}>
            ↻ Turn
          </Button>
        </div>

        <div className="flex flex-col gap-3">
          {tab === 'avatar' && (
            <>
              <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
                {AVATAR_PARTS.map((part) => (
                  <PartPicker
                    key={part}
                    part={part}
                    value={draft.avatar[part] ?? -1}
                    onChange={(i) => set({ avatar: { ...draft.avatar, [part]: i } })}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => set({ avatar: randomAvatar() })}>
                  🎲 Randomize
                </Button>
                <Button size="sm" onClick={() => set({ avatar: defaultLook(username).avatar })}>
                  Default
                </Button>
              </div>
            </>
          )}
          {tab === 'car' && (
            <>
              <Segmented label="Model" options={CAR_STYLES} value={draft.car.style} onChange={(style) => set({ car: { ...draft.car, style } })} />
              <Swatches label="Paint" colors={VEHICLE_COLORS} value={draft.car.color} onChange={(color) => set({ car: { ...draft.car, color } })} />
              <VehicleThumb username={username} look={draft} ride="car" />
              {rideHint('car')}
            </>
          )}
          {tab === 'bike' && (
            <>
              <Swatches label="Frame" colors={VEHICLE_COLORS} value={draft.bike.color} onChange={(color) => set({ bike: { color } })} />
              <VehicleThumb username={username} look={draft} ride="bike" />
              {rideHint('bike')}
            </>
          )}
          {tab === 'dog' && (
            <>
              <Swatches label="Coat" colors={DOG_COATS} value={draft.dog.coat} onChange={(coat) => set({ dog: { ...draft.dog, coat } })} />
              <Segmented label="Markings" options={DOG_MARKINGS} value={draft.dog.marking} onChange={(marking) => set({ dog: { ...draft.dog, marking } })} />
              {petHint('dog')}
            </>
          )}
          {tab === 'cat' && (
            <>
              <Swatches label="Coat" colors={CAT_COATS} value={draft.cat.coat} onChange={(coat) => set({ cat: { ...draft.cat, coat } })} />
              <Segmented label="Markings" options={CAT_MARKINGS} value={draft.cat.marking} onChange={(marking) => set({ cat: { ...draft.cat, marking } })} />
              {petHint('cat')}
            </>
          )}
        </div>

        {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        {note && !error && <p className="text-xs text-emerald-700 dark:text-emerald-400">{note}</p>}

        <div className="flex flex-wrap items-center gap-2 border-t border-secondary-100 pt-4 dark:border-secondary-800">
          <Button size="sm" variant="primary" icon="check" disabled={busy || !dirty} onClick={() => void run(draft, 'Saved: everyone sees your new look.')}>
            Save
          </Button>
          <Button size="sm" disabled={busy || !dirty} onClick={() => setDraft(resolveLook(username, saved))}>
            Undo changes
          </Button>
          <Button size="sm" className="ml-auto" disabled={busy || saved === null} onClick={() => void run(null, 'Back to your original look.')}>
            Reset to original
          </Button>
        </div>
      </div>
    </section>
  );
}
