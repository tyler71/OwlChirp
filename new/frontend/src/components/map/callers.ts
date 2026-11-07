// Callers on the Map: every live incoming call is a person named after the
// caller. They drive from their building (or in from the edge of town for an
// unknown number) along the roads to Techline HQ, park at the curb below the
// plaza, walk up and go inside, then browse
// Office Space at random. Once an agent answers, they follow that agent,
// through the doors too, until the call ends. Then they walk back out to
// their car and drive home (or off the edge of town), and fade away there.
//
// Runs outside any canvas so callers keep going across scene changes and the
// map closing. Movement is by the clock, not by frames: a caller walks a
// route from a start time, so wherever you look (or when you come back)
// they're where they should be. Each client simulates its own; the RNG is
// seeded from the contact ID so everyone sees much the same thing.
import {
  $buildings,
  $mapPlayers,
  $mapProps,
  $mapTiles,
  callAgent,
  liveCalls,
  matchBuilding,
  onCallEnd,
} from '../../lib/map';
import { sceneOf } from './scenes';
import {
  EDGE_ENTRIES,
  TILE,
  World,
  hash,
  pathLength,
  pointAlong,
  type Point,
  type PropKind,
  type SceneId,
} from './world';

const SPEED = 72; // px per second, like someone walking
const CAR_SPEED = 220; // px per second, like a player's car
const FOOT_W = 4;
const FADE_MS = 600;
/** How far behind the agent a caller stops. */
const FOLLOW_GAP = 18;
const REPLAN_MS = 400;
/** Things worth browsing up to in the office. */
const BROWSE_KINDS: ReadonlySet<PropKind> = new Set<PropKind>([
  'desk', 'table', 'plant', 'couch', 'whiteboard', 'watercooler', 'coffee', 'printer', 'bookshelf', 'globe',
]);

type Phase = 'driving' | 'arriving' | 'browsing' | 'following' | 'leaving' | 'departing';

type CallerNpc = {
  contactId: string;
  phoneNumber: string;
  scene: SceneId;
  phase: Phase;
  /** Px per second along route: a car while driving, walking after. */
  speed: number;
  /** Where they left the car, once they've parked. */
  car: { x: number; y: number; dir: CallerNpc['dir'] } | null;
  /** The drive in, from home (or the edge of town) to the curb; driven backwards to leave. */
  home: Point[];
  route: Point[];
  length: number;
  /** When the walk along route began (ms since the epoch). */
  routeStart: number;
  /** Browsing: when to pick the next spot. */
  pauseUntil: number;
  x: number;
  y: number;
  dir: 'up' | 'down' | 'left' | 'right';
  moving: boolean;
  /** Following: the agent spot route was planned to, and when. */
  planned: Point | null;
  plannedAt: number;
  /** Following: the agent already rang on arrival. */
  reached: boolean;
  rng: number;
  /** Home again after the call: fading out since then. */
  goneAt: number;
};

export type CallerView = {
  contactId: string;
  phoneNumber: string;
  x: number;
  y: number;
  dir: CallerNpc['dir'];
  moving: boolean;
  ride: 'car' | 'walk';
  /** 0..1, for fading out. */
  alpha: number;
};

export type ParkedCarView = {
  contactId: string;
  x: number;
  y: number;
  dir: CallerNpc['dir'];
  alpha: number;
};

export type CallerEvent =
  | { kind: 'hq' }
  | { kind: 'agent'; name: string }
  | { kind: 'building'; id: number };

const npcs = new Map<string, CallerNpc>();
const listeners = new Set<(e: CallerEvent) => void>();

/** Hear callers ringing HQ or their agent, and leaving their building. */
export function onCallerEvent(listener: (e: CallerEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const emit = (e: CallerEvent) => {
  for (const l of listeners) l(e);
};

onCallEnd((contactId) => {
  const n = npcs.get(contactId);
  if (n) leave(n, Date.now());
});

// ---- Worlds ----
// One per scene, rebuilt when the tiles, props or buildings change.
type Cached = { world: World; tiles: unknown; props: unknown; buildings: unknown };
const worlds = new Map<SceneId, Cached>();

function worldFor(scene: SceneId): World {
  const tiles = $mapTiles.get();
  const props = $mapProps.get();
  const buildings = $buildings.get();
  const c = worlds.get(scene);
  if (c && c.tiles === tiles && c.props === props && c.buildings === buildings) return c.world;
  const world = new World(sceneOf(scene));
  const here = <T extends { scene?: string }>(rows: readonly T[]) => rows.filter((r) => (r.scene || 'town') === scene);
  for (const t of here(tiles)) world.setTile(t.x, t.y, t.tile);
  world.setProps(here(props));
  if (scene === 'town') world.buildings = (buildings ?? []).map((b) => ({ id: b.id, x: b.x, y: b.y }));
  worlds.set(scene, { world, tiles, props, buildings });
  return world;
}

// ---- Movement ----

/** Next pseudo-random number in [0, 1) for n. */
const rand = (n: CallerNpc) => hash(n.rng++, 7, n.contactId.length * 977 + n.contactId.charCodeAt(0));

function walk(n: CallerNpc, route: Point[], start: number): void {
  n.route = [{ x: n.x, y: n.y }, ...route];
  n.length = pathLength(n.route);
  n.routeStart = start;
}

const walkDone = (n: CallerNpc, now: number) => (now - n.routeStart) * (n.speed / 1000) >= n.length;

/** Put n on its route at now, and work out which way it's facing. */
function place(n: CallerNpc, now: number): void {
  if (!n.route.length) {
    n.moving = false;
    return;
  }
  const along = n.length ? ((now - n.routeStart) * n.speed) / 1000 / n.length : 1;
  const p = pointAlong(n.route, along, n.length);
  const dx = p.x - n.x;
  const dy = p.y - n.y;
  n.moving = along < 1 && n.length > 0;
  if (Math.abs(dx) + Math.abs(dy) > 0.01) {
    n.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
  }
  n.x = p.x;
  n.y = p.y;
}

/** Arrive through the door into scene. */
function enter(n: CallerNpc, scene: SceneId, now: number): void {
  const at = sceneOf(scene).arrival;
  n.scene = scene;
  n.x = at.x;
  n.y = at.y;
  n.dir = scene === 'office' ? 'up' : 'down';
  n.route = [];
  n.length = 0;
  n.routeStart = now;
  n.planned = null;
  n.pauseUntil = now + 800;
}

/** Head for the door to scene, and go through once there. */
function goThroughDoor(n: CallerNpc, scene: SceneId, now: number): void {
  const world = worldFor(n.scene);
  const door = world.def.doors.find((d) => d.to === scene);
  if (!door) {
    enter(n, scene, now);
    return;
  }
  const to = { x: door.trigger.x + door.trigger.w / 2, y: door.trigger.y + door.trigger.h / 2 };
  const last = n.route[n.route.length - 1];
  const headingThere = last && Math.hypot(last.x - to.x, last.y - to.y) < 1;
  if (headingThere) {
    if (walkDone(n, now)) {
      if (scene === 'office') emit({ kind: 'hq' });
      enter(n, scene, now);
    }
    return;
  }
  walk(n, world.findPath({ x: n.x, y: n.y }, to, FOOT_W) ?? [to], now);
}

/** A random open spot in the office, usually beside some furniture. */
function browseSpot(n: CallerNpc, world: World): Point | null {
  const near = rand(n) < 0.75;
  let fallback: Point | null = null;
  for (let tries = 0; tries < 40; tries++) {
    const x = 1 + Math.floor(rand(n) * (world.cols - 2));
    const y = 2 + Math.floor(rand(n) * (world.rows - 3));
    const p = { x: x * TILE + TILE / 2, y: y * TILE + TILE - 2 };
    if (world.blocked(p.x, p.y, FOOT_W) || Math.hypot(p.x - n.x, p.y - n.y) < TILE * 2) continue;
    fallback ??= p;
    if (!near) return p;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const prop = world.has(x + dx, y + dy) ? world.props.get(world.key(x + dx, y + dy)) : undefined;
      if (prop && BROWSE_KINDS.has(prop.kind)) return p;
    }
  }
  return fallback;
}

function browse(n: CallerNpc, now: number): void {
  if (n.scene !== 'office') {
    goThroughDoor(n, 'office', now);
    return;
  }
  if (!walkDone(n, now) || now < n.pauseUntil) return;
  if (n.route.length) {
    // Just got there: look around a while.
    n.route = [];
    n.length = 0;
    n.pauseUntil = now + 2000 + rand(n) * 4000;
    return;
  }
  const world = worldFor('office');
  const spot = browseSpot(n, world);
  if (!spot) {
    n.pauseUntil = now + 2000;
    return;
  }
  walk(n, world.findPath({ x: n.x, y: n.y }, spot, FOOT_W) ?? [], now);
}

/** Cut the last gap px off route, so the walker stops short of its end. */
function stopShort(route: Point[], from: Point, gap: number): Point[] {
  const pts = [from, ...route];
  let len = pathLength(pts);
  if (len <= gap) return [];
  const keep = (len - gap) / len;
  const end = pointAlong(pts, keep, len);
  const out: Point[] = [];
  let acc = 0;
  len *= keep;
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc >= len) break;
    out.push(pts[i]);
  }
  out.push(end);
  return out;
}

/** Follow agent; false when they're not on the map. */
function follow(n: CallerNpc, agent: string, now: number): boolean {
  const players = $mapPlayers.get() ?? {};
  const found = Object.values(players).find((p) => p.username.toLowerCase() === agent);
  if (!found) return false;
  const scene: SceneId = found.scene || 'town';
  if (scene !== n.scene) {
    n.planned = null;
    goThroughDoor(n, scene, now);
    return true;
  }
  const at = { x: found.x, y: found.y };
  const dist = Math.hypot(at.x - n.x, at.y - n.y);
  if (!n.reached && dist <= FOLLOW_GAP + 6) {
    n.reached = true;
    emit({ kind: 'agent', name: found.username });
  }
  const moved = !n.planned || Math.hypot(at.x - n.planned.x, at.y - n.planned.y) > TILE * 0.75;
  if (!moved || now - n.plannedAt < REPLAN_MS) return true;
  n.planned = at;
  n.plannedAt = now;
  if (dist <= FOLLOW_GAP + 2) return true;
  const from = { x: n.x, y: n.y };
  const path = worldFor(n.scene).findPath(from, at, FOOT_W) ?? [at];
  walk(n, stopShort(path, from, FOLLOW_GAP), now);
  return true;
}

// ---- Spawning ----

/** Where h's car parks: a slot on the street just below HQ's plaza. */
function curbSpot(h: number): Point {
  return { x: (57 + (Math.abs(h) % 15)) * TILE + TILE / 2, y: 54 * TILE + TILE / 2 };
}

/** The middle of the glass doors' trigger, which takes callers inside. */
function doorCenter(town: World): Point {
  const door = town.def.doors[0];
  return { x: door.trigger.x + door.trigger.w / 2, y: door.trigger.y + door.trigger.h / 2 };
}

/** Parked: leave the car at the curb and walk up into HQ, from when the car got there. */
function park(n: CallerNpc): void {
  const town = worldFor('town');
  const arrivedAt = n.routeStart + (n.length / CAR_SPEED) * 1000;
  n.car = { x: n.x, y: n.y, dir: n.dir };
  n.speed = SPEED;
  n.phase = 'arriving';
  const door = doorCenter(town);
  walk(n, town.findPath({ x: n.x, y: n.y }, door, FOOT_W) ?? [door], arrivedAt);
}

/** The call ended: walk back to the car, or turn round if still driving in. */
function leave(n: CallerNpc, now: number): void {
  if (n.phase === 'leaving' || n.phase === 'departing' || n.goneAt) return;
  if (n.phase === 'driving' || !n.car) {
    place(n, now);
    depart(n, now);
    return;
  }
  n.phase = 'leaving';
  n.speed = SPEED;
  n.planned = null;
  n.route = [];
  n.length = 0;
}

/** Back at the car (or still in it): drive the way they came, backwards. */
function depart(n: CallerNpc, now: number): void {
  let back: Point[];
  if (n.phase === 'driving') {
    // Only as far as they got: the route's points already passed.
    const done = ((now - n.routeStart) * n.speed) / 1000;
    back = [];
    let acc = 0;
    for (let i = 0; i < n.route.length; i++) {
      if (i) acc += Math.hypot(n.route[i].x - n.route[i - 1].x, n.route[i].y - n.route[i - 1].y);
      if (acc >= done) break;
      back.push(n.route[i]);
    }
  } else {
    back = n.home;
    if (n.car) {
      n.x = n.car.x;
      n.y = n.car.y;
    }
  }
  n.car = null;
  n.scene = 'town';
  n.phase = 'departing';
  n.speed = CAR_SPEED;
  walk(n, [...back].reverse(), now);
}

/** Leaving: out of the office if inside, then over to the car. */
function walkToCar(n: CallerNpc, now: number): void {
  if (n.scene !== 'town') {
    goThroughDoor(n, 'town', now);
    return;
  }
  const car = n.car!;
  const last = n.route[n.route.length - 1];
  if (!last || Math.hypot(last.x - car.x, last.y - car.y) >= 1) {
    walk(n, [...(worldFor('town').findPath({ x: n.x, y: n.y }, car, FOOT_W) ?? []), car], now);
    return;
  }
  if (walkDone(n, now)) depart(n, now);
}

function spawn(contactId: string, phoneNumber: string, initiatedAt: number, now: number): CallerNpc {
  const town = worldFor('town');
  const n: CallerNpc = {
    contactId,
    phoneNumber,
    scene: 'town',
    phase: 'driving',
    speed: CAR_SPEED,
    car: null,
    home: [],
    route: [],
    length: 0,
    routeStart: Math.min(now, initiatedAt || now),
    pauseUntil: 0,
    x: 0,
    y: 0,
    dir: 'down',
    moving: true,
    planned: null,
    plannedAt: 0,
    reached: false,
    rng: 1,
    goneAt: 0,
  };
  let h = 0;
  for (const ch of contactId) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const curb = curbSpot(h);
  const building = matchBuilding(phoneNumber, $buildings.get() ?? []);
  let route: Point[];
  if (building) {
    route = town.routeFromBuilding(building, curb);
    if (now - n.routeStart < 5000) emit({ kind: 'building', id: building.id });
  } else {
    const edge = EDGE_ENTRIES[Math.abs(h) % EDGE_ENTRIES.length];
    const from = { x: edge.x === 0 ? -8 : town.w + 8, y: edge.y * TILE + TILE / 2 };
    route = town.routeTo(curb, edge, from);
  }
  n.x = route[0].x;
  n.y = route[0].y;
  n.route = route;
  n.home = route;
  n.length = pathLength(route);
  return n;
}

// ---- Each frame ----

/** Bring every caller up to now. Call once a frame from the map. */
export function updateCallers(): void {
  const now = Date.now();
  const calls = liveCalls();
  const liveIds = new Set(calls.map((c) => c.contactId));
  // Wait for the buildings so callers set off from the right one.
  for (const c of $buildings.get() ? calls : []) {
    if (!npcs.has(c.contactId)) npcs.set(c.contactId, spawn(c.contactId, c.phoneNumber, c.initiatedAt, now));
  }
  for (const [id, n] of npcs) {
    if (!liveIds.has(id)) leave(n, now);
    if (n.goneAt) {
      if (now - n.goneAt > FADE_MS) npcs.delete(id);
      continue;
    }
    place(n, now);
    if (n.phase === 'leaving') {
      walkToCar(n, now);
      continue;
    }
    if (n.phase === 'departing') {
      if (walkDone(n, now)) n.goneAt = now;
      continue;
    }
    if (n.phase === 'driving') {
      if (!walkDone(n, now)) continue;
      park(n);
      place(n, now);
    }
    const agent = callAgent(id);
    if (n.phase === 'arriving') {
      if (agent) n.phase = 'following';
      else if (walkDone(n, now)) {
        emit({ kind: 'hq' });
        enter(n, 'office', now);
        n.phase = 'browsing';
      }
      if (n.phase === 'arriving') continue;
    }
    if (agent) {
      n.phase = 'following';
      if (follow(n, agent, now)) continue;
    } else {
      n.reached = false;
    }
    if (n.phase === 'following') {
      // Nobody to follow (unanswered again, or off the map): back to browsing.
      n.phase = 'browsing';
      n.route = [];
      n.length = 0;
      n.pauseUntil = now;
    }
    browse(n, now);
  }
}

/** The callers in scene, as of the last update. */
export function callersIn(scene: SceneId): CallerView[] {
  const now = Date.now();
  const out: CallerView[] = [];
  for (const n of npcs.values()) {
    if (n.scene !== scene) continue;
    out.push({
      contactId: n.contactId,
      phoneNumber: n.phoneNumber,
      x: n.x,
      y: n.y,
      dir: n.dir,
      moving: n.moving && !n.goneAt,
      ride: n.phase === 'driving' || n.phase === 'departing' ? 'car' : 'walk',
      alpha: n.goneAt ? Math.max(0, 1 - (now - n.goneAt) / FADE_MS) : 1,
    });
  }
  return out;
}

/** The cars callers left parked in scene. */
export function callerCarsIn(scene: SceneId): ParkedCarView[] {
  if (scene !== 'town') return [];
  const now = Date.now();
  const out: ParkedCarView[] = [];
  for (const n of npcs.values()) {
    if (!n.car) continue;
    out.push({
      contactId: n.contactId,
      ...n.car,
      alpha: n.goneAt ? Math.max(0, 1 - (now - n.goneAt) / FADE_MS) : 1,
    });
  }
  return out;
}
