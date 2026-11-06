// The Map canvas: one requestAnimationFrame loop draws the part of the scene
// you're in around you (the camera follows your character), everyone in it
// with their pet and ride, and in town pulses for incoming calls, plus a
// minimap of the whole scene. Walking into a door (HQ's glass doors, the
// office's doormat) takes you to the other scene, and the loop starts over.
// With Map design it also paints ground, places and removes decorations, and
// drags buildings. Stores are read through refs so React never re-renders
// per frame.
import { persistentAtom } from '@nanostores/persistent';
import { useStore } from '@nanostores/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { STATUS_LUNCH, STATUS_OFFLINE, STATUS_ON_CALL, STATUS_TICKET_BREAK } from '../../lib/const';
import { $queuedCount } from '../../lib/flowCalls';
import { agentName } from '../../lib/helpers';
import {
  $buildings,
  $highlightBuilding,
  $mapBrush,
  $mapFocus,
  $mapMode,
  $mapPlayers,
  $mapProps,
  $mapTiles,
  $myGear,
  $myLook,
  $myScene,
  createProp,
  enterScene,
  deleteProp,
  callAgent,
  liveCalls,
  matchBuilding,
  moveBuilding,
  moveProp,
  onCallEnd,
  onCallPulse,
  paintTiles,
  sendMove,
  type CallPulse,
  type Dir,
  type MapTile,
  type MapLook,
  type Pet,
  type Ride,
} from '../../lib/map';
import { $metrics } from '../../lib/stores';
import { isSpeaking, VOICE_RANGE } from '../../lib/voice';
import { Icon } from '../ui';
import {
  BUILDING_STYLES,
  drawBuilding,
  drawCharacter,
  drawEmptyLot,
  drawHQ,
  drawPet,
  drawProp,
  drawTree,
  drawWater,
  emptyLots,
  paintGround,
  renderGround,
  type PetAnim,
  type Pose,
} from './sprites';
import { assetsReady, loadMapAssets } from './assets';
import { sceneOf } from './scenes';
import {
  BUILDING_SIZE,
  EDGE_ENTRIES,
  FLOWER_KINDS,
  HQ,
  TILE,
  World,
  buildingRect,
  hash,
  inRect,
  overlaps,
  pathLength,
  pointAlong,
  type Door,
  type Point,
  type Prop,
  type PropKind,
  type Rect,
} from './world';

/** Low flowers that sort under whoever stands on them; tall irises and alliums don't. */
const LOW_FLOWERS: ReadonlySet<PropKind> = new Set<PropKind>([
  'flowerpot',
  'wildflowers',
  ...FLOWER_KINDS.filter((k) => k !== 'irises' && k !== 'alliums'),
]);

const SPEED: Record<Ride, number> = { walk: 72, bike: 140, car: 220 }; // px per second
// Half-width of the box at a character's feet used for collisions.
const FOOT_W: Record<Ride, number> = { walk: 4, bike: 5, car: 9 };
const SEND_INTERVAL_MS = 100;
const PAINT_FLUSH_MS = 150;
const MAX_PAINT_BATCH = 400;
const PULSE_TRAVEL_MS = 3200;
const PULSE_GAP_MS = 5000; // pause between laps of a live call
const RING_MS = 1200;
const BUILDING_FLASH_MS = 3500;
const MINIMAP_SCALE = 1.5; // css px per tile; small scenes get bigger tiles
const minimapScale = (cols: number) => Math.max(MINIMAP_SCALE, Math.min(6, 120 / cols));
const FADE_MS = 350; // fade in after going through a door
const ZOOMS = [1, 2, 3, 4];
const TOWN_AVATAR_SCALE = 2 / 3; // people and pets are drawn smaller outside

/** Map zoom (world px → css px), remembered across reloads. */
const $zoom = persistentAtom<string>('owlchirp:map:zoom', '2');

/** Move the zoom up (+1) or down (-1) one level, clamped to ZOOMS. */
const stepZoom = (step: number) => {
  const i = ZOOMS.indexOf(Number($zoom.get()) || 2);
  $zoom.set(String(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 1 : i) + step))]));
};

const KEY_DIRS: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  W: 'up',
  S: 'down',
  A: 'left',
  D: 'right',
};

type PetState = {
  x: number;
  y: number;
  /** Which way it faces: the sheets only have side views. */
  side: 'left' | 'right';
  anim: PetAnim;
  movingUntil: number;
  /** When it last settled beside its owner, for idle → sit → sleep. */
  stillSince: number;
};

/** A character as drawn: where it is now, easing toward where it should be. */
type Sprite = {
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Dir;
  movingUntil: number;
  pet: Pet;
  ride: Ride;
  look: MapLook | null;
  petState: PetState;
};

/**
 * A live call's pulse, lapping from its building to HQ (or, once answered,
 * to the answering agent if they're on the map) until the call ends.
 */
type ActivePulse = {
  pulse: CallPulse;
  route: Point[];
  length: number;
  start: number;
  /** Sprite name this lap runs to, or '' for HQ. */
  target: string;
  /** The call disconnected: finish this lap, then stop. */
  ended: boolean;
};

const STATUS_DOT: Record<string, string> = {
  available: '#3fbf5f',
  'on call': '#5b7fde',
  aftercallwork: '#9b5de5',
  'quick break': '#f2a541',
  'on a project': '#f2a541',
  'ticket break': '#f2a541',
  error: '#e5484d',
  missedcallagent: '#e5484d',
};

function poseFor(status: string | undefined): Pose {
  switch (status?.toLowerCase()) {
    case STATUS_ON_CALL:
      return 'phone';
    case STATUS_TICKET_BREAK:
      return 'typing';
    case STATUS_LUNCH:
      return 'eating';
    case STATUS_OFFLINE:
    case undefined:
      return 'sleeping';
    default:
      return 'stand';
  }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Tiles on the line from a to b, so a fast drag paints without gaps. */
function tilesBetween(a: Point, b: Point): Point[] {
  const out: Point[] = [];
  const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  for (let i = 1; i <= n; i++) {
    out.push({ x: Math.round(a.x + ((b.x - a.x) * i) / n), y: Math.round(a.y + ((b.y - a.y) * i) / n) });
  }
  return out.length ? out : [b];
}

/** `children` go in the bottom-right corner, under the minimap. */
export default function MapCanvas({ me, children }: { me: string; children?: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const followRef = useRef<() => void>(() => undefined);
  const zoom = Number(useStore($zoom)) || 2;
  const mode = useStore($mapMode);
  const scene = useStore($myScene);
  const def = sceneOf(scene);
  const miniScale = minimapScale(def.cols);
  // Sprites and tiles are images: hold off drawing until they've loaded.
  const [ready, setReady] = useState(assetsReady);
  useEffect(() => {
    if (!ready) void loadMapAssets().then(() => setReady(true));
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current!;
    const mini = miniRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    const mctx = mini.getContext('2d')!;
    const reduced = prefersReducedMotion();

    // ---- World ----
    const world = new World(sceneOf(scene));
    // Bikes and cars stay outside: in a scene without rides everyone walks.
    const rideHere = (r: Ride): Ride => (world.def.rides ? r : 'walk');
    const isTown = world.def.id === 'town';
    const avatarScale = isTown ? TOWN_AVATAR_SCALE : 1;
    /** Draw a person or pet scaled about their feet at (x, y). */
    const scaledAt = (x: number, y: number, draw: () => void) => {
      if (avatarScale === 1) return draw();
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(avatarScale, avatarScale);
      ctx.translate(-x, -y);
      draw();
      ctx.restore();
    };
    const { w: WORLD_W, h: WORLD_H } = world;
    const here = <T extends { scene?: string }>(rows: readonly T[]) => rows.filter((r) => (r.scene || 'town') === scene);
    for (const t of here($mapTiles.get())) world.setTile(t.x, t.y, t.tile);
    world.setProps(here($mapProps.get()));
    const sceneBuildings = () => (isTown ? ($buildings.get() ?? []) : []);
    const syncBuildings = () => (world.buildings = sceneBuildings().map((b) => ({ id: b.id, x: b.x, y: b.y })));
    syncBuildings();
    const ground = renderGround(world);
    const repaint = (x: number, y: number) => paintGround(ground, world, x - 2, y - 2, x + 2, y + 2);

    const offTiles = $mapTiles.listen((tiles) => {
      const changed: MapTile[] = here(tiles).filter((t) => world.setTile(t.x, t.y, t.tile));
      if (changed.length > 300) paintGround(ground, world, 0, 0, world.cols - 1, world.rows - 1);
      else for (const t of changed) repaint(t.x, t.y);
    });
    const offProps = $mapProps.listen((props) => world.setProps(here(props)));
    const offBuildings = $buildings.listen(syncBuildings);
    const enteredAt = performance.now();

    // ---- Camera ----
    let dpr = 1;
    let scale = 2; // device pixels per world pixel
    let viewW = 0; // world px visible
    let viewH = 0;
    let camX = 0;
    let camY = 0;
    let follow = true;
    let lookAt: Point | null = null; // free-look centre when not following
    let snap = true; // jump the camera on the next frame instead of easing

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const zoomNow = Number($zoom.get()) || 2;
      canvas.width = Math.max(1, Math.round(wrap.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(wrap.clientHeight * dpr));
      canvas.style.width = `${wrap.clientWidth}px`;
      canvas.style.height = `${wrap.clientHeight}px`;
      scale = zoomNow * dpr;
      viewW = canvas.width / scale;
      viewH = canvas.height / scale;
      mini.width = Math.round(world.cols * miniScale * dpr);
      mini.height = Math.round(world.rows * miniScale * dpr);
      snap = true;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    const offZoom = $zoom.listen(() => requestAnimationFrame(resize));

    // Ctrl/Cmd + wheel (and trackpad pinch, which arrives as ctrl+wheel) steps
    // the map zoom instead of zooming the page. Deltas accumulate so a pinch's
    // many tiny events don't race through every level at once.
    let wheelAcc = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      wheelAcc += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      if (Math.abs(wheelAcc) < 50) return;
      stepZoom(wheelAcc < 0 ? 1 : -1);
      wheelAcc = 0;
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });

    const clampCam = (x: number, y: number): Point => ({
      x: viewW >= WORLD_W ? (WORLD_W - viewW) / 2 : Math.max(0, Math.min(WORLD_W - viewW, x)),
      y: viewH >= WORLD_H ? (WORLD_H - viewH) / 2 : Math.max(0, Math.min(WORLD_H - viewH, y)),
    });
    const lookAtPoint = (p: Point) => {
      follow = false;
      lookAt = p;
    };
    followRef.current = () => {
      follow = true;
      lookAt = null;
    };

    const offFocus = $mapFocus.listen((f) => {
      if (!f || !isTown) return;
      lookAtPoint({ x: (f.x + BUILDING_SIZE / 2) * TILE, y: (f.y + BUILDING_SIZE / 2) * TILE });
    });

    // ---- Characters ----
    const sprites = new Map<string, Sprite>();
    const keys: Dir[] = [];
    // Click-to-walk: the spot clicked and the waypoints left to get there.
    let goal: Point | null = null;
    let route: Point[] = [];
    let routeFootW = 0;
    let routeRoads = false;
    let replanned = false;
    // A door clicked on: going through it once there, whichever way we face.
    let doorGoal: Door | null = null;
    let leaving = false;

    // Cars keep to the roads; walkers and bikes go anywhere open.
    const planTo = (s: Sprite, p: Point, footW: number) => {
      goal = p;
      routeFootW = footW;
      routeRoads = rideHere($myGear.get().ride) === 'car';
      route = world.findPath({ x: s.x, y: s.y }, p, footW, routeRoads) ?? [p];
    };
    const stopRoute = () => {
      goal = null;
      route = [];
      doorGoal = null;
    };

    /** Go through a door when my feet are in it, heading its way (or I clicked it). */
    const tryDoor = (s: Sprite, heading: Dir | null) => {
      for (const door of world.def.doors) {
        if (!inRect(door.trigger, s.x, s.y)) continue;
        if (heading !== door.dir && doorGoal !== door) continue;
        leaving = true;
        keys.length = 0;
        stopRoute();
        sendMove(s.x, s.y, s.dir);
        enterScene(door.to).catch((err) => {
          console.error('map.enter', err);
          leaving = false;
        });
        return;
      }
    };
    let lastSent = 0;
    let sentMoving = false;

    const syncPlayers = () => {
      const all = $mapPlayers.get() ?? {};
      // Only people in this scene; the rest are elsewhere.
      const players = Object.fromEntries(Object.entries(all).filter(([, p]) => (p.scene || 'town') === scene));
      for (const name of sprites.keys()) if (!players[name]) sprites.delete(name);
      for (const p of Object.values(players)) {
        const s = sprites.get(p.username);
        if (!s) {
          sprites.set(p.username, {
            x: p.x,
            y: p.y,
            tx: p.x,
            ty: p.y,
            dir: p.dir,
            movingUntil: 0,
            pet: p.pet ?? '',
            ride: rideHere(p.ride ?? 'walk'),
            look: p.look ?? null,
            petState: { x: p.x + 16, y: p.y + 1, side: 'left', anim: 'sit', movingUntil: 0, stillSince: 0 },
          });
        } else {
          s.pet = p.pet ?? '';
          s.ride = rideHere(p.ride ?? 'walk');
          s.look = p.look ?? null;
          if (p.username !== me) {
            if (p.x !== s.tx || p.y !== s.ty) s.movingUntil = performance.now() + 250;
            s.tx = p.x;
            s.ty = p.y;
            s.dir = p.dir;
          }
        }
      }
    };
    syncPlayers();
    const offPlayers = $mapPlayers.listen(syncPlayers);

    const blocked = (x: number, y: number, footW: number) => world.blocked(x, y, footW);

    const moveMe = (dt: number, now: number) => {
      const s = sprites.get(me);
      if (!s || leaving) return;
      const gear = $myGear.get();
      s.pet = gear.pet;
      const ride = rideHere(gear.ride);
      s.ride = ride;
      s.look = $myLook.get();
      let dx = 0;
      let dy = 0;
      const keyDir = keys[keys.length - 1];
      if (keyDir) {
        // Combine one key per axis; the later-pressed key wins within an axis.
        const l = keys.lastIndexOf('left');
        const r = keys.lastIndexOf('right');
        const u = keys.lastIndexOf('up');
        const d = keys.lastIndexOf('down');
        dx = l > r ? -1 : r > l ? 1 : 0;
        dy = u > d ? -1 : d > u ? 1 : 0;
        if (dx !== 0 && dy !== 0) {
          dx *= Math.SQRT1_2;
          dy *= Math.SQRT1_2;
        }
      } else if (goal) {
        // A new ride has different-sized feet: plan again for them.
        if (FOOT_W[ride] !== routeFootW || (ride === 'car') !== routeRoads) planTo(s, goal, FOOT_W[ride]);
        while (route.length && Math.hypot(route[0].x - s.x, route[0].y - s.y) < 2) {
          route.shift();
          replanned = false;
        }
        const next = route[0];
        if (!next) {
          stopRoute();
        } else {
          const dist = Math.hypot(next.x - s.x, next.y - s.y);
          dx = (next.x - s.x) / dist;
          dy = (next.y - s.y) / dist;
        }
      }

      const moving = dx !== 0 || dy !== 0;
      if (moving) {
        const footW = FOOT_W[ride];
        // Someone may have built on top of us: walk out freely.
        const stuck = blocked(s.x, s.y, footW);
        const step = Math.min(SPEED[ride] * dt, 8);
        const nx = s.x + dx * step;
        const ny = s.y + dy * step;
        // Slide along walls: try each axis on its own.
        let moved = false;
        if (stuck || !blocked(nx, s.y, footW)) {
          s.x = Math.max(0, Math.min(WORLD_W - 1, nx));
          moved = true;
        }
        if (stuck || !blocked(s.x, ny, footW)) {
          s.y = Math.max(1, Math.min(WORLD_H - 1, ny));
          moved = true;
        }
        if (!moved && goal) {
          // Something went up in the way: plan around it once, else give up.
          if (replanned) stopRoute();
          else {
            planTo(s, goal, footW);
            replanned = true;
          }
        }
        s.dir = keyDir
          ? keyDir
          : Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
        s.tx = s.x;
        s.ty = s.y;
        s.movingUntil = moved ? now + 50 : 0;
        if (moved) {
          const heading: Dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
          tryDoor(s, heading);
          if (leaving) return;
        } else if (!stuck) {
          // Pushing against a wall right in a door still goes through it.
          tryDoor(s, s.dir);
          if (leaving) return;
        }
        if (moved && now - lastSent >= SEND_INTERVAL_MS) {
          sendMove(s.x, s.y, s.dir);
          lastSent = now;
          sentMoving = true;
        }
      } else if (sentMoving && now - lastSent >= SEND_INTERVAL_MS) {
        // The server drops moves that come too fast; always send where we stopped.
        sendMove(s.x, s.y, s.dir);
        lastSent = now;
        sentMoving = false;
      }
    };

    /** Pets follow their owner like on a leash: while the owner moves the pet
     * heads toward them, keeping a short gap, from whichever side it's on.
     * When the owner stops, so does the pet, right where it is. Once still it
     * stands, then sits, now and then barks or meows, and after a while curls
     * up asleep. */
    const movePet = (s: Sprite, name: string, dt: number, now: number) => {
      const p = s.petState;
      const moving = now < s.movingUntil;
      const gap = 18 * avatarScale;
      const dx = s.x - p.x;
      const dy = s.y + 1 - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 240) {
        // Too far to walk (teleport, map change): drop in just behind them.
        const behind: Record<Dir, [number, number]> = { left: [22, 1], right: [-22, 1], up: [0, 10], down: [0, -8] };
        const [bx, by] = behind[s.dir];
        p.x = s.x + bx * avatarScale;
        p.y = s.y + by * avatarScale;
      } else if (moving && d > gap) {
        const lag = d - gap;
        const step = Math.min(lag, Math.max(50, lag * 8) * dt);
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
        if (Math.abs(dx) > 0.5) p.side = dx < 0 ? 'left' : 'right';
        if (step > 0.3) {
          p.movingUntil = now + 80;
          // Faster than a stroll (owner on a bike or in a car, or catching up): run.
          p.anim = step / dt > 90 ? 'run' : 'walk';
          p.stillSince = 0;
        }
      }
      if (moving && now < p.movingUntil) return;
      if (!p.stillSince) {
        p.stillSince = now;
        // Settled: face the owner.
        if (Math.abs(dx) > 0.5) p.side = dx < 0 ? 'left' : 'right';
      }
      const still = (now - p.stillSince) / 1000;
      if (still < 2) p.anim = 'idle';
      else if (still > 45) p.anim = 'sleep';
      else {
        // A short bark or meow in some 6-second slots, different per owner.
        const slot = Math.floor(still / 6);
        let seed = 0;
        for (let i = 0; i < name.length; i++) seed = (seed * 31 + name.charCodeAt(i)) | 0;
        p.anim = slot > 0 && hash(slot, 0, seed) < 0.35 && still % 6 < 1 ? 'speak' : 'sit';
      }
    };

    // ---- Design tools ----
    const toWorld = (e: PointerEvent): Point => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: camX + ((e.clientX - rect.left) / rect.width) * viewW,
        y: camY + ((e.clientY - rect.top) / rect.height) * viewH,
      };
    };
    const toTile = (p: Point): Point => ({ x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) });

    let hover: Point | null = null;
    let lastTile: Point | null = null;
    let painting = false;
    let drag: { id: number; offX: number; offY: number; at: Point; from: Point } | null = null;
    let propDrag: { prop: Prop; at: Point } | null = null;
    const pendingPaint = new Map<number, MapTile>();
    let lastFlush = 0;
    let nextTempId = -1;

    const flushPaint = (now: number) => {
      if (!pendingPaint.size || now - lastFlush < PAINT_FLUSH_MS) return;
      lastFlush = now;
      const tiles = [...pendingPaint.values()];
      pendingPaint.clear();
      for (let i = 0; i < tiles.length; i += MAX_PAINT_BATCH) {
        paintTiles(tiles.slice(i, i + MAX_PAINT_BATCH)).catch((err) => console.error('map.paint', err));
      }
    };

    const queuePaint = (x: number, y: number) => {
      pendingPaint.set(world.key(x, y), { scene, x, y, tile: world.tile(x, y)! });
      repaint(x, y);
    };

    /** Whether a decoration can go on this tile: free ground, nothing on it. */
    const canPlaceProp = (x: number, y: number) => {
      if (!world.has(x, y) || world.def.locked(x, y) || world.buildingAt(x, y)) return false;
      const k = world.key(x, y);
      return !world.props.has(k) && !world.trees.has(k) && !world.def.solid.has(world.tile(x, y)!);
    };

    const createAt = (x: number, y: number) => {
      if (!world.has(x, y) || world.def.locked(x, y) || world.buildingAt(x, y)) return;
      const brush = $mapBrush.get();
      const k = world.key(x, y);
      if (brush.type === 'tile') {
        if (world.def.tileKinds.includes(brush.tile) && world.setTile(x, y, brush.tile)) queuePaint(x, y);
        return;
      }
      if (!world.def.propKinds.includes(brush.kind) || !canPlaceProp(x, y)) return;
      const temp = { id: nextTempId--, scene, kind: brush.kind, x, y };
      world.props.set(k, temp);
      createProp(scene, brush.kind, x, y).catch((err) => {
        console.error('map.props.create', err);
        if (world.props.get(k) === temp) world.props.delete(k);
      });
    };

    const destroyAt = (x: number, y: number) => {
      if (!world.has(x, y) || world.def.locked(x, y)) return;
      const k = world.key(x, y);
      const prop = world.props.get(k);
      if (prop) {
        world.props.delete(k);
        if (prop.id > 0) deleteProp(prop.id).catch((err) => console.error('map.props.delete', err));
        return;
      }
      if (world.trees.has(k)) {
        // Painting a tile clears its tree; keep the ground as it is.
        world.setTile(x, y, world.tile(x, y)!);
        queuePaint(x, y);
        return;
      }
      const base = world.def.baseTile;
      if (world.tile(x, y) !== base && !world.buildingAt(x, y) && world.setTile(x, y, base)) queuePaint(x, y);
    };

    const applyTool = (tile: Point) => {
      const mode = $mapMode.get();
      const tiles = lastTile ? tilesBetween(lastTile, tile) : [tile];
      lastTile = tile;
      for (const t of tiles) {
        if (mode === 'create') createAt(t.x, t.y);
        else if (mode === 'destroy') destroyAt(t.x, t.y);
      }
    };

    const ghostAt = (p: Point) => drag && { x: Math.round(p.x / TILE - drag.offX), y: Math.round(p.y / TILE - drag.offY) };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        $mapMode.set('walk');
        return;
      }
      const dir = KEY_DIRS[e.key];
      if (!dir) return;
      e.preventDefault();
      stopRoute();
      follow = true;
      lookAt = null;
      if (!keys.includes(dir)) keys.push(dir);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const dir = KEY_DIRS[e.key];
      if (!dir) return;
      const i = keys.indexOf(dir);
      if (i >= 0) keys.splice(i, 1);
    };
    const onBlur = () => (keys.length = 0);
    const onPointerDown = (e: PointerEvent) => {
      canvas.focus();
      const p = toWorld(e);
      const tile = toTile(p);
      const mode = $mapMode.get();
      if (mode === 'walk') {
        const s = sprites.get(me);
        if (s && !leaving) {
          replanned = false;
          // Clicking a door walks into it and through.
          const door = world.def.doors.find((d) => inRect(d.click, p.x, p.y) || inRect(d.trigger, p.x, p.y));
          const to = door ? { x: door.trigger.x + door.trigger.w / 2, y: door.trigger.y + door.trigger.h / 2 } : p;
          planTo(s, to, FOOT_W[rideHere($myGear.get().ride)]);
          doorGoal = door ?? null;
        }
        follow = true;
        lookAt = null;
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      if (mode === 'move') {
        const b = world.buildingAt(tile.x, tile.y);
        if (b) drag = { id: b.id, offX: p.x / TILE - b.x, offY: p.y / TILE - b.y, at: { x: b.x, y: b.y }, from: { x: b.x, y: b.y } };
        else {
          const prop = world.has(tile.x, tile.y) ? world.props.get(world.key(tile.x, tile.y)) : undefined;
          // Ones still being saved have no id yet.
          if (prop && prop.id > 0) propDrag = { prop, at: tile };
        }
        return;
      }
      painting = true;
      lastTile = null;
      applyTool(tile);
    };
    const onPointerMove = (e: PointerEvent) => {
      const p = toWorld(e);
      hover = toTile(p);
      if (drag) drag.at = ghostAt(p)!;
      else if (propDrag) propDrag.at = hover;
      else if (painting) applyTool(hover);
    };
    const onPointerUp = () => {
      painting = false;
      lastTile = null;
      flushPaint(Infinity);
      if (propDrag) {
        const { prop, at } = propDrag;
        propDrag = null;
        if ((at.x === prop.x && at.y === prop.y) || !canPlaceProp(at.x, at.y)) return;
        // Move it here now; put it back if the server says no.
        const before = $mapProps.get();
        $mapProps.set(before.map((p) => (p.id === prop.id ? { ...p, x: at.x, y: at.y } : p)));
        moveProp(prop.id, at.x, at.y).catch((err) => {
          console.error('map.props.move', err);
          $mapProps.set(before);
        });
        return;
      }
      if (!drag) return;
      const { id, at, from } = drag;
      drag = null;
      if ((at.x === from.x && at.y === from.y) || !world.canPlaceBuilding(at, id)) return;
      // Move it here now; put it back if the server says no.
      const before = $buildings.get();
      $buildings.set((before ?? []).map((b) => (b.id === id ? { ...b, x: at.x, y: at.y } : b)));
      moveBuilding(id, at.x, at.y).catch((err) => {
        console.error('buildings.move', err);
        $buildings.set(before);
      });
    };
    const onPointerLeave = () => (hover = null);
    canvas.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('blur', onBlur);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);

    const offMode = $mapMode.listen(() => {
      painting = false;
      drag = null;
      propDrag = null;
      flushPaint(Infinity);
    });

    // Minimap: click or drag to look around.
    let miniDown = false;
    const miniLook = (e: PointerEvent) => {
      const rect = mini.getBoundingClientRect();
      lookAtPoint({ x: ((e.clientX - rect.left) / rect.width) * WORLD_W, y: ((e.clientY - rect.top) / rect.height) * WORLD_H });
    };
    const onMiniDown = (e: PointerEvent) => {
      miniDown = true;
      mini.setPointerCapture(e.pointerId);
      miniLook(e);
    };
    const onMiniMove = (e: PointerEvent) => miniDown && miniLook(e);
    const onMiniUp = () => (miniDown = false);
    mini.addEventListener('pointerdown', onMiniDown);
    mini.addEventListener('pointermove', onMiniMove);
    mini.addEventListener('pointerup', onMiniUp);
    mini.addEventListener('pointercancel', onMiniUp);

    // ---- Pulses ----
    const pulses: ActivePulse[] = [];
    const rings: number[] = []; // start times
    const flashes = new Map<number, number>(); // building id → start time
    const agentRings = new Map<string, number>(); // sprite name → start time
    /** Where a pulse meets an agent: their middle, not their feet. */
    const agentSpot = (s: Sprite): Point => ({ x: s.x, y: s.y - 12 * avatarScale });

    /**
     * Route the next lap (re-matched each time, so moved or new buildings and
     * a newly answered call count) and flash its building. An answered call
     * runs to its agent when they're on the map, otherwise to HQ.
     */
    const lap = (p: ActivePulse, start: number) => {
      const agent = callAgent(p.pulse.contactId);
      const found = agent ? [...sprites].find(([name]) => name.toLowerCase() === agent) : undefined;
      p.target = found?.[0] ?? '';
      const dest = found && agentSpot(found[1]);
      const building = matchBuilding(p.pulse.phoneNumber, $buildings.get() ?? []);
      if (building) {
        flashes.set(building.id, performance.now());
        p.route = world.routeFromBuilding(building, dest);
      } else {
        let h = 0;
        for (const ch of p.pulse.contactId) h = (h * 31 + ch.charCodeAt(0)) | 0;
        const edge = EDGE_ENTRIES[Math.abs(h) % EDGE_ENTRIES.length];
        const from = { x: edge.x === 0 ? -8 : WORLD_W + 8, y: edge.y * TILE + TILE / 2 };
        p.route = dest ? world.routeTo(dest, edge, from) : world.routeToHQ(edge, from);
      }
      p.length = pathLength(p.route);
      p.start = start;
    };
    const startPulse = (pulse: CallPulse) => {
      if (pulses.some((p) => p.pulse.contactId === pulse.contactId)) return;
      const p: ActivePulse = { pulse, route: [], length: 0, start: 0, target: '', ended: false };
      lap(p, performance.now());
      pulses.push(p);
    };
    // Calls only show in town.
    if (isTown) for (const pulse of liveCalls()) startPulse(pulse);
    const offPulse = isTown ? onCallPulse(startPulse) : () => undefined;
    const offEnd = onCallEnd((contactId) => {
      for (const p of pulses) if (p.pulse.contactId === contactId) p.ended = true;
    });

    // ---- Drawing ----
    let raf = 0;
    let last = performance.now();
    let frameNo = 0;

    const drawMinimap = () => {
      const k = mini.width / WORLD_W;
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.imageSmoothingEnabled = true;
      mctx.drawImage(ground, 0, 0, mini.width, mini.height);
      if (isTown) {
        mctx.fillStyle = '#e8edf2';
        mctx.fillRect(HQ.x * TILE * k, HQ.y * TILE * k, HQ.w * TILE * k, HQ.h * TILE * k);
      }
      for (const b of sceneBuildings()) {
        mctx.fillStyle = BUILDING_STYLES[b.style % BUILDING_STYLES.length].color;
        mctx.fillRect(b.x * TILE * k, b.y * TILE * k, BUILDING_SIZE * TILE * k, BUILDING_SIZE * TILE * k);
      }
      for (const [name, s] of sprites) {
        const isMe = name === me;
        mctx.fillStyle = isMe ? '#29b6a8' : '#ffffff';
        mctx.strokeStyle = '#2b2233';
        mctx.lineWidth = dpr;
        mctx.beginPath();
        mctx.arc(s.x * k, s.y * k, (isMe ? 3.5 : 2.5) * dpr, 0, Math.PI * 2);
        mctx.fill();
        mctx.stroke();
      }
      mctx.strokeStyle = 'rgba(255,255,255,0.95)';
      mctx.lineWidth = 1.5 * dpr;
      mctx.strokeRect(camX * k, camY * k, viewW * k, viewH * k);
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const motion = reduced ? 0 : t;
      frameNo++;

      moveMe(dt, now);
      flushPaint(now);
      for (const [name, s] of sprites) {
        if (name !== me) {
          // Ease toward the last reported spot.
          const k = Math.min(1, dt * 10);
          s.x += (s.tx - s.x) * k;
          s.y += (s.ty - s.y) * k;
        }
        if (s.pet) movePet(s, name, dt, now);
      }

      // Camera: on you, or wherever you're looking.
      const mine = sprites.get(me);
      const focus = follow && mine ? { x: mine.x, y: mine.y - 8 } : (lookAt ?? { x: camX + viewW / 2, y: camY + viewH / 2 });
      const want = clampCam(focus.x - viewW / 2, focus.y - viewH / 2);
      const ease = snap || reduced ? 1 : Math.min(1, dt * 8);
      camX += (want.x - camX) * ease;
      camY += (want.y - camY) * ease;
      snap = false;
      const ox = Math.round(camX * scale);
      const oy = Math.round(camY * scale);
      const inView = (x: number, y: number, margin = 48) =>
        x > camX - margin && x < camX + viewW + margin && y > camY - margin && y < camY + viewH + margin * 2;
      const viewTiles: Rect = {
        x: Math.floor(camX / TILE) - 1,
        y: Math.floor(camY / TILE) - 1,
        w: Math.ceil(viewW / TILE) + 3,
        h: Math.ceil(viewH / TILE) + 3,
      };

      const buildings = sceneBuildings();
      const highlight = $highlightBuilding.get();
      const statuses = new Map(
        ($metrics.get().user_list ?? []).map((u) => [u.user.username.toLowerCase(), u.status.name.toLowerCase()]),
      );

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = world.def.backdrop;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, -ox, -oy);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(ground, 0, 0);
      drawWater(ctx, world, viewTiles, motion);
      if (isTown) {
        for (const lot of emptyLots(world)) {
          if (overlaps(lot, viewTiles)) drawEmptyLot(ctx, lot);
        }
      }

      // Everything with height, back to front.
      const queued = $queuedCount.get();
      const ringAge = rings.length ? now - rings[rings.length - 1] : Infinity;
      while (rings.length && now - rings[0] > RING_MS) rings.shift();
      const ring = reduced ? (ringAge < BUILDING_FLASH_MS ? 1 : 0) : Math.max(0, 1 - ringAge / RING_MS);
      const hqGlow = queued > 0 ? (reduced ? 1 : 0.6 + 0.4 * Math.sin(t * 3)) : 0;

      const drawables: { y: number; draw: () => void }[] = [];
      for (const k of world.trees) {
        const x = k % world.cols;
        const y = Math.floor(k / world.cols);
        if (!inRect(viewTiles, x, y) || world.buildingAt(x, y)) continue;
        drawables.push({ y: (y + 1) * TILE, draw: () => drawTree(ctx, x, y) });
      }
      for (const p of world.props.values()) {
        if (p.id === propDrag?.prop.id) continue;
        if (!inRect(viewTiles, p.x, p.y) || world.buildingAt(p.x, p.y)) continue;
        // Flat things (rugs, flowers) go under whoever stands on them.
        const flat = p.kind === 'rug' ? -1e6 : LOW_FLOWERS.has(p.kind) ? -8 : 0;
        const same = (dx: number) => world.props.get(world.key(p.x + dx, p.y))?.kind === p.kind;
        drawables.push({ y: (p.y + 1) * TILE + flat, draw: () => drawProp(ctx, p.kind, p.x, p.y, motion, same) });
      }
      for (const b of buildings) {
        if (drag?.id === b.id) continue;
        if (!overlaps(buildingRect(b), viewTiles)) continue;
        const flashAge = now - (flashes.get(b.id) ?? -Infinity);
        const glow = b.id === highlight ? 1 : flashAge < BUILDING_FLASH_MS ? 1 - flashAge / BUILDING_FLASH_MS : 0;
        drawables.push({ y: (b.y + BUILDING_SIZE) * TILE, draw: () => drawBuilding(ctx, b.x, b.y, b.style, glow, motion) });
      }
      if (isTown && overlaps(HQ, viewTiles)) {
        drawables.push({ y: (HQ.y + HQ.h) * TILE, draw: () => drawHQ(ctx, Math.max(hqGlow, ring * 0.8), reduced ? 0 : ring, motion) });
      }

      const people: { name: string; s: Sprite; status?: string; pose: Pose }[] = [];
      for (const [name, s] of sprites) {
        if (!inView(s.x, s.y)) continue;
        const status = statuses.get(name.toLowerCase());
        const walking = now < s.movingUntil;
        const pose = walking ? 'walk' : poseFor(status);
        people.push({ name, s, status, pose });
        drawables.push({ y: s.y, draw: () => scaledAt(s.x, s.y, () => drawCharacter(ctx, name, s.look, s.x, s.y, s.dir, pose, motion, s.ride)) });
        if (s.pet) {
          const pet = s.pet;
          const p = s.petState;
          drawables.push({ y: p.y, draw: () => scaledAt(p.x, p.y, () => drawPet(ctx, pet, name, s.look, p.x, p.y, p.side, p.anim, motion)) });
        }
      }
      drawables.sort((a, b) => a.y - b.y);
      for (const d of drawables) d.draw();

      // Pulses travel the roads to HQ (or their agent), ring it, and go again
      // until the call ends.
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        const f = (now - p.start) / PULSE_TRAVEL_MS;
        if (f < 0) continue; // between laps
        // Chase an agent who's walking; if they left, finish on the old route.
        const chased = p.target ? sprites.get(p.target) : undefined;
        if (chased && p.route.length) {
          p.route[p.route.length - 1] = agentSpot(chased);
          p.length = pathLength(p.route);
        }
        if (f >= 1) {
          if (p.target) agentRings.set(p.target, now);
          else rings.push(now);
          if (p.ended) pulses.splice(i, 1);
          else lap(p, now + PULSE_GAP_MS);
          continue;
        }
        if (reduced) continue; // no moving dot; the flash and ring still mark each lap
        const eased = 1 - (1 - f) * (1 - f);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let j = 6; j >= 0; j--) {
          const pt = pointAlong(p.route, eased - j * 0.008, p.length);
          if (!inView(pt.x, pt.y)) continue;
          const a = j === 0 ? 1 : 0.5 - j * 0.07;
          const r = j === 0 ? 5 : 3.5 - j * 0.35;
          const g = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r * 2.5);
          g.addColorStop(0, `rgba(255, 236, 140, ${a})`);
          g.addColorStop(0.4, `rgba(255, 196, 40, ${a * 0.7})`);
          g.addColorStop(1, 'rgba(255, 196, 40, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, r * 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // An agent a pulse reached rings like HQ does.
      const agentRingMs = reduced ? BUILDING_FLASH_MS : RING_MS;
      for (const [name, startedAt] of agentRings) {
        const age = (now - startedAt) / agentRingMs;
        const s = sprites.get(name);
        if (age >= 1 || !s) {
          agentRings.delete(name);
          continue;
        }
        if (!inView(s.x, s.y)) continue;
        const grow = reduced ? 0.5 : age;
        const alpha = reduced ? 0.8 : 1 - age;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(255, 196, 40, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(s.x, s.y - 2, (6 + 12 * grow) * avatarScale, (3 + 6 * grow) * avatarScale, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Tool overlays.
      const mode = $mapMode.get();
      if (drag) {
        const b = buildings.find((x) => x.id === drag!.id);
        const ok = world.canPlaceBuilding(drag.at, drag.id);
        if (b) {
          ctx.globalAlpha = 0.7;
          drawBuilding(ctx, drag.at.x, drag.at.y, b.style, 0, motion);
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = ok ? 'rgba(63, 191, 95, 0.3)' : 'rgba(229, 72, 77, 0.35)';
        ctx.fillRect(drag.at.x * TILE, drag.at.y * TILE, BUILDING_SIZE * TILE, BUILDING_SIZE * TILE);
        ctx.strokeStyle = ok ? '#3fbf5f' : '#e5484d';
        ctx.lineWidth = 1;
        ctx.strokeRect(drag.at.x * TILE + 0.5, drag.at.y * TILE + 0.5, BUILDING_SIZE * TILE - 1, BUILDING_SIZE * TILE - 1);
      } else if (propDrag) {
        const { prop, at } = propDrag;
        const ok = (at.x === prop.x && at.y === prop.y) || canPlaceProp(at.x, at.y);
        ctx.globalAlpha = 0.7;
        drawProp(ctx, prop.kind, at.x, at.y, motion, () => false);
        ctx.globalAlpha = 1;
        ctx.fillStyle = ok ? 'rgba(63, 191, 95, 0.3)' : 'rgba(229, 72, 77, 0.35)';
        ctx.fillRect(at.x * TILE, at.y * TILE, TILE, TILE);
        ctx.strokeStyle = ok ? '#3fbf5f' : '#e5484d';
        ctx.lineWidth = 1;
        ctx.strokeRect(at.x * TILE + 0.5, at.y * TILE + 0.5, TILE - 1, TILE - 1);
      } else if (mode === 'walk' && goal && route.length) {
        // Where click-to-walk is heading.
        const s = sprites.get(me);
        const end = route[route.length - 1];
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(s ? s.x : route[0].x, s ? s.y - 1 : route[0].y);
        for (const p of route) ctx.lineTo(p.x, p.y - 1);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.ellipse(end.x, end.y - 1, 4, 2.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (hover && mode !== 'walk') {
        const b = mode === 'move' ? world.buildingAt(hover.x, hover.y) : undefined;
        const r = b ? buildingRect(b) : { ...hover, w: 1, h: 1 };
        ctx.strokeStyle = mode === 'destroy' ? '#e5484d' : mode === 'move' ? '#ffd23f' : '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x * TILE + 0.5, r.y * TILE + 0.5, r.w * TILE - 1, r.h * TILE - 1);
      }

      // Labels in screen space so text stays sharp at any zoom.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const sx = (x: number) => x * scale - ox;
      const sy = (y: number) => y * scale - oy;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      for (const { name, s, status, pose } of people) {
        const riding = s.ride !== 'walk' && (pose === 'stand' || pose === 'walk' || pose === 'phone');
        const height = (riding ? (s.ride === 'car' ? 29 : 34) : 25) * avatarScale;
        const x = sx(s.x);
        const top = sy(s.y - height);
        if (pose === 'sleeping') {
          ctx.font = `${12 * dpr}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
          const bob = reduced ? 0 : (t * 0.8) % 1;
          ctx.globalAlpha = 0.9;
          ctx.fillText('💤', x + 10 * avatarScale * scale, top - bob * 8 * scale);
          ctx.globalAlpha = 1;
        }
        const isMe = name === me;
        if (isSpeaking(name)) {
          // Sound waves beside the head; my own carry range while I talk.
          const wave = reduced ? 0.5 : (t * 2) % 1;
          ctx.lineWidth = 1.5 * dpr;
          for (let i = 0; i < 3; i++) {
            const r = (3 + i * 3 + wave * 3) * avatarScale * scale;
            ctx.strokeStyle = `rgba(255,255,255,${0.9 - i * 0.25 - wave * 0.2})`;
            ctx.beginPath();
            ctx.arc(x + 7 * avatarScale * scale, top + 7 * avatarScale * scale, r, -Math.PI / 4, Math.PI / 4);
            ctx.stroke();
          }
          if (isMe) {
            ctx.strokeStyle = 'rgba(41, 182, 168, 0.35)';
            ctx.setLineDash([4 * dpr, 4 * dpr]);
            ctx.beginPath();
            ctx.arc(x, sy(s.y - 12 * avatarScale), VOICE_RANGE * scale, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        const label = isMe ? 'You' : agentName(name);
        const dot = status && (pose === 'stand' || riding) ? STATUS_DOT[status] : undefined;
        if (!label && !dot) continue;
        ctx.font = `${isMe ? 'bold ' : ''}${13 * dpr}px ui-sans-serif, system-ui, sans-serif`;
        const w = label ? ctx.measureText(label).width + 8 * dpr : 0;
        const dotW = dot ? 10 * dpr : 0;
        const h = 16 * dpr;
        const bx = x - (w + dotW) / 2;
        const by = top - h - 2 * dpr;
        ctx.fillStyle = isMe ? 'rgba(41, 182, 168, 0.92)' : 'rgba(30, 27, 38, 0.72)';
        ctx.beginPath();
        ctx.roundRect(bx, by, w + dotW, h, 4 * dpr);
        ctx.fill();
        if (dot) {
          ctx.fillStyle = dot;
          ctx.beginPath();
          ctx.arc(bx + 7 * dpr, by + h / 2, 3 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
        if (label) {
          ctx.fillStyle = '#fff';
          ctx.fillText(label, bx + dotW + w / 2, by + h - 2 * dpr);
        }
      }

      // Building names above their roofs.
      ctx.font = `600 ${10 * dpr}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      for (const b of buildings) {
        if (!overlaps(buildingRect(b), viewTiles)) continue;
        const pos = drag?.id === b.id ? drag.at : b;
        const cx = sx((pos.x + BUILDING_SIZE / 2) * TILE);
        const y = sy(pos.y * TILE) - 14 * dpr;
        const w = ctx.measureText(b.name).width + 8 * dpr;
        ctx.fillStyle = b.id === highlight ? 'rgba(255, 210, 63, 0.95)' : 'rgba(255, 255, 255, 0.85)';
        ctx.beginPath();
        ctx.roundRect(cx - w / 2, y, w, 13 * dpr, 3 * dpr);
        ctx.fill();
        ctx.fillStyle = '#2b2233';
        ctx.fillText(b.name, cx, y + 1.5 * dpr);
      }

      // Fade in after coming through a door.
      const fade = reduced ? 0 : 1 - (now - enteredAt) / FADE_MS;
      if (fade > 0) {
        ctx.fillStyle = `rgba(20, 16, 26, ${fade})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      if (frameNo % 4 === 0) drawMinimap();
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      flushPaint(Infinity);
      observer.disconnect();
      offZoom();
      wrap.removeEventListener('wheel', onWheel);
      offFocus();
      offPlayers();
      offPulse();
      offEnd();
      offTiles();
      offProps();
      offBuildings();
      offMode();
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      mini.removeEventListener('pointerdown', onMiniDown);
      mini.removeEventListener('pointermove', onMiniMove);
      mini.removeEventListener('pointerup', onMiniUp);
      mini.removeEventListener('pointercancel', onMiniUp);
    };
  }, [me, scene, miniScale, ready]);

  // Take the keyboard as soon as the map opens so walking works right away.
  useEffect(() => canvasRef.current?.focus({ preventScroll: true }), []);

  const overlayButton =
    'flex size-8 items-center justify-center rounded-md bg-white/85 text-base font-bold text-secondary-800 shadow-sm hover:bg-white disabled:opacity-40 dark:bg-secondary-900/85 dark:text-secondary-100 dark:hover:bg-secondary-900';
  const cursor = mode === 'move' ? 'cursor-grab' : mode === 'walk' ? 'cursor-pointer' : 'cursor-crosshair';

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden" style={{ background: def.backdrop }}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label={`Team map: ${def.name}. Click the map, then use the arrow keys or WASD to walk, or click where you want to go. ${
          scene === 'town' ? 'Walk into the Techline HQ doors to go inside.' : 'Walk onto the doormat to go back outside.'
        }`}
        className={`block touch-none outline-none focus-visible:ring-3 focus-visible:ring-primary-500/60 ${cursor}`}
        style={{ imageRendering: 'pixelated' }}
      />
      {/* Mousedown would take focus off the canvas and stop walking. */}
      <div className="absolute top-2 right-2 flex flex-col gap-1" onMouseDown={(e) => e.preventDefault()}>
        <button type="button" tabIndex={-1} className={overlayButton} onClick={() => stepZoom(1)} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} aria-label="Zoom in" title="Zoom in">
          +
        </button>
        <button type="button" tabIndex={-1} className={overlayButton} onClick={() => stepZoom(-1)} disabled={zoom <= ZOOMS[0]} aria-label="Zoom out" title="Zoom out">
          −
        </button>
        <button type="button" tabIndex={-1} className={overlayButton} onClick={() => followRef.current()} aria-label="Back to me" title="Back to me">
          <Icon name="user" className="size-4" />
        </button>
      </div>
      {/* z-10 keeps the corner above MapView's buildings editor. */}
      <div className="pointer-events-none absolute right-2 bottom-2 z-10 flex max-w-[calc(100%-1rem)] flex-col items-end gap-2">
        <canvas
          ref={miniRef}
          onMouseDown={(e) => e.preventDefault()}
          aria-label={`Minimap of ${def.name}. Click to look around.`}
          className="pointer-events-auto hidden shrink-0 cursor-pointer touch-none rounded border-2 border-white/80 shadow-md sm:block"
          style={{ width: def.cols * miniScale, height: def.rows * miniScale }}
        />
        {children}
      </div>
    </div>
  );
}
