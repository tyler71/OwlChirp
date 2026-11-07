// Map view state: buildings that incoming calls are matched to, the
// characters of everyone with Owlchirp open, and new-call pulses.
import { persistentAtom } from "@nanostores/persistent";
import { atom, computed } from "nanostores";

import type { AvatarPart } from "../components/map/assets";
import type { PropKind, SceneId, Tile } from "../components/map/world";

import { onEvent, request } from "./realtime";
import { $flowCalls, $wsStatus, type FlowCall } from "./stores";

export type Dir = "up" | "down" | "left" | "right";

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
  /** Which scene they're in: the town, or Office Space inside HQ. */
  scene: SceneId;
  x: number;
  y: number;
  dir: Dir;
  pet: Pet;
  ride: Ride;
  /** Null until they design one: then it's derived from their username. */
  look: MapLook | null;
};

export type CarStyle = "sedan" | "truck";

/** How someone designed their character, vehicles and pets. Colours are
 * indexes into the palettes in components/map/sprites.ts. */
export type MapLook = {
  /** One sprite layer per part: an index into the part's layers, or -1 for none. */
  avatar: Partial<Record<AvatarPart, number>>;
  car: { color: number; style: CarStyle };
  bike: { color: number };
  /** coat picks the sprite sheet, color a fur colour (0 keeps its own). */
  dog: { coat: number; color: number };
  cat: { coat: number; color: number };
};

export type Pet = "" | "dog" | "cat";
export type Ride = "walk" | "bike" | "car";
export type MapTile = { scene: SceneId; x: number; y: number; tile: Tile };
export type MapProp = {
  id: number;
  scene: SceneId;
  kind: PropKind;
  x: number;
  y: number;
};

/** How much of the screen the map takes: the content area, or a smaller
 * bordered box that's cheaper to draw. */
export type MapSize = "fill" | "medium";

export const MAP_SIZES: { value: MapSize; label: string; title: string }[] = [
  { value: "fill", label: "Fill", title: "Fill the page" },
  { value: "medium", label: "Medium", title: "Bordered, 960×600" },
];

const SIZE_VALUES = MAP_SIZES.map((s) => s.value);

/** Map size, remembered across reloads. */
export const $mapSize = persistentAtom<MapSize>("owlchirp:map:size", "fill", {
  encode: (v) => v,
  decode: (v) =>
    (SIZE_VALUES as string[]).includes(v) ? (v as MapSize) : "fill",
});

/** Panels floating over the map that can be dragged around. */
export type MapPanelId = "status" | "design" | "toolbar" | "who";
export type PanelOffset = { x: number; y: number };
type PanelOffsets = Partial<Record<MapPanelId, PanelOffset>>;

function decodeOffsets(raw: string): PanelOffsets {
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return {};
    const out: PanelOffsets = {};
    for (const [k, o] of Object.entries(v as Record<string, unknown>)) {
      const { x, y } = (o ?? {}) as Partial<PanelOffset>;
      if (Number.isFinite(x) && Number.isFinite(y))
        out[k as MapPanelId] = { x: x as number, y: y as number };
    }
    return out;
  } catch {
    return {};
  }
}

/** How far each panel was dragged from its usual spot, remembered across reloads. */
export const $mapPanelOffsets = persistentAtom<PanelOffsets>(
  "owlchirp:map:panels",
  {},
  {
    encode: JSON.stringify,
    decode: decodeOffsets,
  },
);

export function setPanelOffset(id: MapPanelId, off: PanelOffset | null) {
  const next = { ...$mapPanelOffsets.get() };
  if (off && (off.x || off.y)) next[id] = off;
  else delete next[id];
  $mapPanelOffsets.set(next);
}

type PanelFlags = Partial<Record<MapPanelId, true>>;

function decodeFlags(raw: string): PanelFlags {
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return {};
    const out: PanelFlags = {};
    for (const [k, on] of Object.entries(v as Record<string, unknown>))
      if (on === true) out[k as MapPanelId] = true;
    return out;
  } catch {
    return {};
  }
}

/** Panels shrunk down to their title, remembered across reloads. */
export const $mapPanelsMinimized = persistentAtom<PanelFlags>(
  "owlchirp:map:minimized",
  {},
  {
    encode: JSON.stringify,
    decode: decodeFlags,
  },
);

export function setPanelMinimized(id: MapPanelId, on: boolean) {
  const cur = $mapPanelsMinimized.get();
  if (!!cur[id] === on) return;
  const next = { ...cur };
  if (on) next[id] = true;
  else delete next[id];
  $mapPanelsMinimized.set(next);
}

/** Put every panel back where it started, expanded. */
export function resetPanelOffsets() {
  $mapPanelOffsets.set({});
  $mapPanelsMinimized.set({});
}

type MapState = {
  buildings: MapBuilding[];
  players: MapPlayer[];
  tiles: MapTile[];
  props: MapProp[];
  limit: number;
};

const byPosition = (a: MapBuilding, b: MapBuilding) =>
  a.y - b.y || a.x - b.x || a.id - b.id;

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
export const $mapFocus = atom<{ x: number; y: number; at: number } | null>(
  null,
);

/** This user's pet and ride, as saved on the server. */
export const $myGear = atom<{ pet: Pet; ride: Ride }>({
  pet: "",
  ride: "walk",
});
/** This user's designed look, or null for the one derived from their username. */
export const $myLook = atom<MapLook | null>(null);

/** Set by MapView so gear can be matched to this user's player. */
export const $myUsername = atom("");

/** The scene this user is in. */
export const $myScene = computed(
  [$mapPlayers, $myUsername],
  (players, me): SceneId => players?.[me]?.scene ?? "town",
);

let entering = false;

/** Go through a door into scene; the server decides where you land. */
export async function enterScene(scene: SceneId): Promise<void> {
  if (entering || $myScene.get() === scene) return;
  entering = true;
  try {
    setPlayer(await request<MapPlayer>("map.enter", { scene }));
  } finally {
    entering = false;
  }
}

export type MapMode = "walk" | "create" | "destroy" | "move";
export type Brush =
  { type: "tile"; tile: Tile } | { type: "prop"; kind: PropKind };
export const $mapMode = atom<MapMode>("walk");
export const $mapBrush = atom<Brush>({ type: "tile", tile: "road" });
// A brush from the other scene can't be used here: pick this scene's first.
$myScene.listen((scene) =>
  $mapBrush.set({ type: "tile", tile: scene === "office" ? "carpet" : "road" }),
);

export async function loadMapState(): Promise<void> {
  const state = await request<MapState>("map.state");
  $buildings.set((state.buildings ?? []).sort(byPosition));
  $mapTiles.set(state.tiles ?? []);
  $mapProps.set(state.props ?? []);
  const players = Object.fromEntries(
    (state.players ?? []).map((p) => [p.username, p]),
  );
  $mapPlayers.set(players);
  migrateLegacyGear();
}

function syncMine(): void {
  const me = $mapPlayers.get()?.[$myUsername.get()];
  if (!me) return;
  const gear = $myGear.get();
  if (me.pet !== gear.pet || me.ride !== gear.ride)
    $myGear.set({ pet: me.pet ?? "", ride: me.ride ?? "walk" });
  if (me.look !== $myLook.get()) $myLook.set(me.look ?? null);
}

// Pet and ride used to be kept in the browser: hand them to the server once.
const LEGACY_GEAR_KEY = "owlchirp:map:gear";
function migrateLegacyGear(): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_GEAR_KEY);
  } catch {
    return;
  }
  if (raw === null) return;
  const me = $mapPlayers.get()?.[$myUsername.get()];
  if (!me) return;
  localStorage.removeItem(LEGACY_GEAR_KEY);
  try {
    const old = JSON.parse(raw) as { pet?: Pet; ride?: Ride };
    if (
      me.pet === "" &&
      me.ride === "walk" &&
      (old.pet || (old.ride && old.ride !== "walk"))
    )
      sendGear(old.pet ?? "", old.ride ?? "walk");
  } catch {
    // Unreadable: drop it.
  }
}

$mapPlayers.listen(syncMine);
$myUsername.listen(() => {
  syncMine();
  migrateLegacyGear();
});

export function sendGear(pet: Pet, ride: Ride): void {
  $myGear.set({ pet, ride });
  const me = $mapPlayers.get()?.[$myUsername.get()];
  if (me) setPlayer({ ...me, pet, ride });
  request("map.gear", { pet, ride }).catch((e) => console.error("map.gear", e));
}

/** Save this user's look (null goes back to the derived one). */
export async function saveLook(look: MapLook | null): Promise<void> {
  const player = await request<MapPlayer>("map.look", look);
  setPlayer(player);
}

function setPlayer(p: MapPlayer): void {
  const players = $mapPlayers.get();
  if (players) $mapPlayers.set({ ...players, [p.username]: p });
}

onEvent<MapPlayer>("map.joined", setPlayer);
onEvent<MapPlayer>("map.moved", setPlayer);
onEvent<{ username: string }>("map.left", ({ username }) => {
  const players = $mapPlayers.get();
  if (!players?.[username]) return;
  const { [username]: _, ...rest } = players;
  $mapPlayers.set(rest);
});

onEvent<MapBuilding>("building.updated", (b) => {
  const list = $buildings.get();
  if (!list) return;
  $buildings.set([...list.filter((x) => x.id !== b.id), b].sort(byPosition));
});
onEvent<{ id: number }>("building.deleted", ({ id }) => {
  const list = $buildings.get();
  if (list) $buildings.set(list.filter((b) => b.id !== id));
});

onEvent<{ tiles: MapTile[] }>("map.painted", ({ tiles }) => {
  const at = (t: MapTile) => `${t.scene},${t.x},${t.y}`;
  const byTile = new Map($mapTiles.get().map((t) => [at(t), t]));
  for (const t of tiles) byTile.set(at(t), t);
  $mapTiles.set([...byTile.values()]);
});
const upsertProp = (p: MapProp) =>
  $mapProps.set([...$mapProps.get().filter((x) => x.id !== p.id), p]);
onEvent<MapProp>("map.prop.created", upsertProp);
onEvent<MapProp>("map.prop.updated", upsertProp);
onEvent<{ id: number }>("map.prop.deleted", ({ id }) => {
  $mapProps.set($mapProps.get().filter((p) => p.id !== id));
});

// Events sent while the socket was down are lost; reload once it's back.
$wsStatus.listen((status) => {
  if (status === "open" && $buildings.get() !== null) {
    loadMapState().catch((e) => console.error("loadMapState", e));
  }
});

export function sendMove(x: number, y: number, dir: Dir): void {
  request("map.move", {
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    dir,
  }).catch(() => undefined);
}

export async function createBuilding(
  name: string,
  patterns: string[],
  style: number,
): Promise<MapBuilding> {
  return request<MapBuilding>("buildings.create", { name, patterns, style });
}

export async function updateBuilding(
  b: Pick<MapBuilding, "id" | "name" | "patterns" | "style">,
): Promise<MapBuilding> {
  return request<MapBuilding>("buildings.update", b);
}

export async function deleteBuilding(id: number): Promise<void> {
  await request("buildings.delete", { id });
}

export type SchoolImport = {
  created: number;
  renamed: number;
  existing: number;
  mapFull: boolean;
};

// Gives every saved 206-252-* caller ID (a school) its own building.
export async function importSchoolBuildings(): Promise<SchoolImport> {
  return request<SchoolImport>("buildings.import");
}

export async function moveBuilding(
  id: number,
  x: number,
  y: number,
): Promise<MapBuilding> {
  return request<MapBuilding>("buildings.move", { id, x, y });
}

export async function paintTiles(tiles: MapTile[]): Promise<void> {
  await request("map.paint", { tiles });
}

export async function createProp(
  scene: SceneId,
  kind: PropKind,
  x: number,
  y: number,
): Promise<MapProp> {
  return request<MapProp>("map.props.create", { scene, kind, x, y });
}

export async function moveProp(
  id: number,
  x: number,
  y: number,
): Promise<MapProp> {
  return request<MapProp>("map.props.move", { id, x, y });
}

export async function deleteProp(id: number): Promise<void> {
  await request("map.props.delete", { id });
}

/**
 * The building an incoming number belongs to: an exact number beats a prefix,
 * and the longest prefix wins. Null when nothing matches.
 */
export function matchBuilding(
  phoneNumber: string,
  buildings: MapBuilding[],
): MapBuilding | null {
  const digits = phoneNumber.replace(/\D/g, "");
  if (!digits) return null;
  let best: MapBuilding | null = null;
  let bestScore = -1;
  for (const b of buildings) {
    for (const p of b.patterns) {
      let score = -1;
      if (p.endsWith("*")) {
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
  const prefix = p.endsWith("*");
  const digits = prefix ? p.slice(0, -1) : p;
  if (!digits.startsWith("1") || digits.length > 11)
    return `+${digits}${prefix ? "*" : ""}`;
  const rest = digits.slice(1);
  const groups = [rest.slice(0, 3), rest.slice(3, 6), rest.slice(6)].filter(
    Boolean,
  );
  let out = `+1 ${groups.join("-")}`;
  if (prefix) {
    const last = groups[groups.length - 1] ?? "";
    out += groups.length < 3 && last.length === 3 ? "-*" : "*";
  }
  return out;
}

// ---- New-call pulses ----

/** A call that just arrived, for the canvas to animate. */
export type CallPulse = {
  contactId: string;
  phoneNumber: string;
  at: number;
  /** When the call came in (ms since the epoch). */
  initiatedAt: number;
};

// Calls older than this when first pushed started before the map was open
// and don't pulse.
const PULSE_MAX_AGE_MS = 45_000;
// A call still "live" after this long has probably lost its disconnect event.
const LIVE_MAX_MS = 60 * 60 * 1000;
const seen = new Set<string>();
/** Calls that haven't disconnected yet, by contact ID. */
const live = new Map<
  string,
  CallPulse & { initiatedAt: number; agent: string }
>();
const pulseListeners = new Set<(p: CallPulse) => void>();
const endListeners = new Set<(contactId: string) => void>();

/** Run listener for every new incoming call. Returns an unsubscribe function. */
export function onCallPulse(listener: (p: CallPulse) => void): () => void {
  pulseListeners.add(listener);
  return () => pulseListeners.delete(listener);
}

/** Run listener when a pulsing call disconnects. Returns an unsubscribe function. */
export function onCallEnd(listener: (contactId: string) => void): () => void {
  endListeners.add(listener);
  return () => endListeners.delete(listener);
}

function endCall(contactId: string): void {
  if (!live.delete(contactId)) return;
  for (const l of endListeners) l(contactId);
}

/** Calls still in progress, so a freshly opened map can pulse them. */
export function liveCalls(): CallPulse[] {
  const cutoff = Date.now() - LIVE_MAX_MS;
  for (const [id, c] of live) if (c.initiatedAt < cutoff) endCall(id);
  return [...live.values()].map(({ contactId, phoneNumber, at, initiatedAt }) => ({
    contactId,
    phoneNumber,
    at,
    initiatedAt,
  }));
}

/** Who answered c (lowercased username), or '' while it's unanswered. */
const agentOf = (c: FlowCall) =>
  c.connectedAt && c.agentUsername ? c.agentUsername.toLowerCase() : "";

const pulseOf = (c: FlowCall) => ({
  contactId: c.contactId,
  phoneNumber: c.phoneNumber,
  at: Date.now(),
  initiatedAt: c.initiatedAt,
  agent: agentOf(c),
});

/** The agent who answered a live call (lowercased username), or '' if nobody has yet. */
export function callAgent(contactId: string): string {
  return live.get(contactId)?.agent ?? "";
}

/** Keep a live call's answering agent current (answers and transfers). */
function noteAgent(c: FlowCall): void {
  const l = live.get(c.contactId);
  if (l) l.agent = agentOf(c);
}

function seed(calls: readonly FlowCall[] | null): void {
  const cutoff = Date.now() - LIVE_MAX_MS;
  for (const c of calls ?? []) {
    seen.add(c.contactId);
    if (!c.disconnectedAt && c.initiatedAt >= cutoff && !live.has(c.contactId))
      live.set(c.contactId, pulseOf(c));
  }
}

/** End calls the list shows as disconnected (or no longer has); note who answered the rest. */
function reconcile(calls: readonly FlowCall[]): void {
  const byId = new Map(calls.map((c) => [c.contactId, c]));
  for (const id of [...live.keys()]) {
    const c = byId.get(id);
    if (!c || c.disconnectedAt) endCall(id);
    else noteAgent(c);
  }
}

// Only whole-list loads seed; single pushes update $flowCalls before the
// handler below runs and must still pulse.
seed($flowCalls.get());
$flowCalls.listen((calls, old) => {
  if (old === null) seed(calls);
  // Every update is the whole 24h list (reloads after a reconnect too), so
  // it also catches disconnects pushed while the socket was down.
  else if (calls) reconcile(calls);
});

// flowcall.updated reaches everyone, so this works without the Flow feature.
onEvent<FlowCall>("flowcall.updated", (call) => {
  if (call.disconnectedAt) {
    seen.add(call.contactId);
    endCall(call.contactId);
    return;
  }
  if (seen.has(call.contactId)) {
    noteAgent(call);
    return;
  }
  seen.add(call.contactId);
  if (Date.now() - call.initiatedAt > PULSE_MAX_AGE_MS) return;
  const pulse = pulseOf(call);
  live.set(call.contactId, pulse);
  for (const l of pulseListeners)
    l({
      contactId: pulse.contactId,
      phoneNumber: pulse.phoneNumber,
      at: pulse.at,
      initiatedAt: pulse.initiatedAt,
    });
});
