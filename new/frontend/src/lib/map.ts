// Map view state: buildings that incoming calls are matched to, the
// characters of everyone with Owlchirp open, and new-call pulses.
import { persistentJSON } from '@nanostores/persistent';
import { atom } from 'nanostores';

import type { PropKind, Tile } from '../components/map/world';

import { onEvent, request } from './realtime';
import { $flowCalls, $wsStatus, type FlowCall } from './stores';

export type Dir = 'up' | 'down' | 'left' | 'right';

export type MapBuilding = {
  id: number;
  name: string;
  /** Normalized digits: "1206256*" is a prefix, "12062561234" an exact number. */
  patterns: string[];
  /** Top-left tile of the building's footprint. */
  x: number;
  y: number;
  style: number;
};

export type MapPlayer = {
  username: string;
  x: number;
  y: number;
  dir: Dir;
  pet: Pet;
  ride: Ride;
};

export type Pet = '' | 'dog' | 'cat';
export type Ride = 'walk' | 'bike' | 'car';
export type MapTile = { x: number; y: number; tile: Tile };
export type MapProp = { id: number; kind: PropKind; x: number; y: number };

type MapState = { buildings: MapBuilding[]; players: MapPlayer[]; tiles: MapTile[]; props: MapProp[]; limit: number };

const byPosition = (a: MapBuilding, b: MapBuilding) => a.y - b.y || a.x - b.x || a.id - b.id;

/** Buildings top to bottom; null until loaded. */
export const $buildings = atom<MapBuilding[] | null>(null);
/** Everyone on the map by username; null until loaded. */
export const $mapPlayers = atom<Record<string, MapPlayer> | null>(null);
/** Building to highlight on the canvas (hovered in the editor). */
export const $highlightBuilding = atom<number | null>(null);
/** Ground painted over the default layout. */
export const $mapTiles = atom<MapTile[]>([]);
export const $mapProps = atom<MapProp[]>([]);
/** A building to pan the map camera to (set by "Locate"). */
export const $mapFocus = atom<{ x: number; y: number; at: number } | null>(null);

/** This user's pet and ride, remembered across reloads. */
export const $myGear = persistentJSON<{ pet: Pet; ride: Ride }>('owlchirp:map:gear', { pet: '', ride: 'walk' });

export type MapMode = 'walk' | 'create' | 'destroy' | 'move';
export type Brush = { type: 'tile'; tile: Tile } | { type: 'prop'; kind: PropKind };
export const $mapMode = atom<MapMode>('walk');
export const $mapBrush = atom<Brush>({ type: 'tile', tile: 'road' });

export async function loadMapState(): Promise<void> {
  const state = await request<MapState>('map.state');
  $buildings.set((state.buildings ?? []).sort(byPosition));
  $mapTiles.set(state.tiles ?? []);
  $mapProps.set(state.props ?? []);
  const players = Object.fromEntries((state.players ?? []).map((p) => [p.username, p]));
  $mapPlayers.set(players);
  syncGear();
}

/** Send this user's pet and ride if the server's copy differs. */
function syncGear(): void {
  const me = Object.values($mapPlayers.get() ?? {}).find((p) => p.username === $myUsername.get());
  const gear = $myGear.get();
  if (me && (me.pet !== gear.pet || me.ride !== gear.ride)) sendGear(gear.pet, gear.ride);
}

/** Set by MapView so gear can be matched to this user's player. */
export const $myUsername = atom('');
$myUsername.listen(syncGear);

export function sendGear(pet: Pet, ride: Ride): void {
  $myGear.set({ pet, ride });
  request('map.gear', { pet, ride }).catch((e) => console.error('map.gear', e));
}

function setPlayer(p: MapPlayer): void {
  const players = $mapPlayers.get();
  if (players) $mapPlayers.set({ ...players, [p.username]: p });
}

onEvent<MapPlayer>('map.joined', setPlayer);
onEvent<MapPlayer>('map.moved', setPlayer);
onEvent<{ username: string }>('map.left', ({ username }) => {
  const players = $mapPlayers.get();
  if (!players?.[username]) return;
  const { [username]: _, ...rest } = players;
  $mapPlayers.set(rest);
});

onEvent<MapBuilding>('building.updated', (b) => {
  const list = $buildings.get();
  if (!list) return;
  $buildings.set([...list.filter((x) => x.id !== b.id), b].sort(byPosition));
});
onEvent<{ id: number }>('building.deleted', ({ id }) => {
  const list = $buildings.get();
  if (list) $buildings.set(list.filter((b) => b.id !== id));
});

onEvent<{ tiles: MapTile[] }>('map.painted', ({ tiles }) => {
  const byTile = new Map($mapTiles.get().map((t) => [`${t.x},${t.y}`, t]));
  for (const t of tiles) byTile.set(`${t.x},${t.y}`, t);
  $mapTiles.set([...byTile.values()]);
});
onEvent<MapProp>('map.prop.created', (p) => {
  $mapProps.set([...$mapProps.get().filter((x) => x.id !== p.id), p]);
});
onEvent<{ id: number }>('map.prop.deleted', ({ id }) => {
  $mapProps.set($mapProps.get().filter((p) => p.id !== id));
});

// Events sent while the socket was down are lost; reload once it's back.
$wsStatus.listen((status) => {
  if (status === 'open' && $buildings.get() !== null) {
    loadMapState().catch((e) => console.error('loadMapState', e));
  }
});

export function sendMove(x: number, y: number, dir: Dir): void {
  request('map.move', { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, dir }).catch(() => undefined);
}

export async function createBuilding(name: string, patterns: string[], style: number): Promise<MapBuilding> {
  return request<MapBuilding>('buildings.create', { name, patterns, style });
}

export async function updateBuilding(b: Pick<MapBuilding, 'id' | 'name' | 'patterns' | 'style'>): Promise<MapBuilding> {
  return request<MapBuilding>('buildings.update', b);
}

export async function deleteBuilding(id: number): Promise<void> {
  await request('buildings.delete', { id });
}

export type SchoolImport = { created: number; renamed: number; existing: number; mapFull: boolean };

// Gives every saved 206-252-* caller ID (a school) its own building.
export async function importSchoolBuildings(): Promise<SchoolImport> {
  return request<SchoolImport>('buildings.import');
}

export async function moveBuilding(id: number, x: number, y: number): Promise<MapBuilding> {
  return request<MapBuilding>('buildings.move', { id, x, y });
}

export async function paintTiles(tiles: MapTile[]): Promise<void> {
  await request('map.paint', { tiles });
}

export async function createProp(kind: PropKind, x: number, y: number): Promise<MapProp> {
  return request<MapProp>('map.props.create', { kind, x, y });
}

export async function deleteProp(id: number): Promise<void> {
  await request('map.props.delete', { id });
}

/**
 * The building an incoming number belongs to: an exact number beats a prefix,
 * and the longest prefix wins. Null when nothing matches.
 */
export function matchBuilding(phoneNumber: string, buildings: MapBuilding[]): MapBuilding | null {
  const digits = phoneNumber.replace(/\D/g, '');
  if (!digits) return null;
  let best: MapBuilding | null = null;
  let bestScore = -1;
  for (const b of buildings) {
    for (const p of b.patterns) {
      let score = -1;
      if (p.endsWith('*')) {
        const prefix = p.slice(0, -1);
        if (digits.startsWith(prefix)) score = prefix.length;
      } else if (digits === p) {
        score = 1000;
      }
      if (score > bestScore) {
        best = b;
        bestScore = score;
      }
    }
  }
  return best;
}

/** "1206256*" → "+1 206-256-*", "12062561234" → "+1 206-256-1234". */
export function formatPattern(p: string): string {
  const prefix = p.endsWith('*');
  const digits = prefix ? p.slice(0, -1) : p;
  if (!digits.startsWith('1') || digits.length > 11) return `+${digits}${prefix ? '*' : ''}`;
  const rest = digits.slice(1);
  const groups = [rest.slice(0, 3), rest.slice(3, 6), rest.slice(6)].filter(Boolean);
  let out = `+1 ${groups.join('-')}`;
  if (prefix) {
    const last = groups[groups.length - 1] ?? '';
    out += groups.length < 3 && last.length === 3 ? '-*' : '*';
  }
  return out;
}

// ---- New-call pulses ----

/** A call that just arrived, for the canvas to animate. */
export type CallPulse = { contactId: string; phoneNumber: string; at: number };

// Calls older than this when first seen started before the map was open
// and don't pulse.
const PULSE_MAX_AGE_MS = 45_000;
const seen = new Set<string>();
const pulseListeners = new Set<(p: CallPulse) => void>();

/** Run listener for every new incoming call. Returns an unsubscribe function. */
export function onCallPulse(listener: (p: CallPulse) => void): () => void {
  pulseListeners.add(listener);
  return () => pulseListeners.delete(listener);
}

function seed(calls: readonly FlowCall[] | null): void {
  for (const c of calls ?? []) seen.add(c.contactId);
}
// Only whole-list loads seed; single pushes update $flowCalls before the
// handler below runs and must still pulse.
seed($flowCalls.get());
$flowCalls.listen((calls, old) => {
  if (old === null) seed(calls);
});

// flowcall.updated reaches everyone, so this works without the Flow feature.
onEvent<FlowCall>('flowcall.updated', (call) => {
  if (seen.has(call.contactId)) return;
  seen.add(call.contactId);
  if (Date.now() - call.initiatedAt > PULSE_MAX_AGE_MS) return;
  const pulse = { contactId: call.contactId, phoneNumber: call.phoneNumber, at: Date.now() };
  for (const l of pulseListeners) l(pulse);
});
