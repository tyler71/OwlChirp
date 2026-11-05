// The Map canvas: one requestAnimationFrame loop draws the part of town
// around you (the camera follows your character), everyone's character, pet
// and ride, and pulses for incoming calls, plus a minimap of the whole town.
// With Map design it also paints ground, places and removes decorations, and
// drags buildings. Stores are read through refs so React never re-renders
// per frame.
import { persistentAtom } from '@nanostores/persistent';
import { useStore } from '@nanostores/react';
import { useEffect, useRef } from 'react';

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
  createProp,
  deleteProp,
  liveCalls,
  matchBuilding,
  moveBuilding,
  onCallEnd,
  onCallPulse,
  paintTiles,
  sendMove,
  type CallPulse,
  type Dir,
  type MapTile,
  type Pet,
  type Ride,
} from '../../lib/map';
import { $can, $metrics } from '../../lib/stores';
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
  type Pose,
} from './sprites';
import {
  BUILDING_SIZE,
  COLS,
  EDGE_ENTRIES,
  HQ,
  ROWS,
  TILE,
  WORLD_H,
  WORLD_W,
  World,
  buildingRect,
  inMap,
  inRect,
  overlaps,
  pathLength,
  pointAlong,
  tileKey,
  type Point,
  type Rect,
} from './world';

const SPEED: Record<Ride, number> = { walk: 72, bike: 140, car: 220 }; // px per second
// Half-width of the box at a character's feet used for collisions.
const FOOT_W: Record<Ride, number> = { walk: 4, bike: 5, car: 9 };
const FOOT_H = 3;
const SEND_INTERVAL_MS = 100;
const PAINT_FLUSH_MS = 150;
const MAX_PAINT_BATCH = 400;
const PULSE_TRAVEL_MS = 3200;
const PULSE_GAP_MS = 5000; // pause between laps of a live call
const RING_MS = 1200;
const BUILDING_FLASH_MS = 3500;
const MINIMAP_SCALE = 1.5; // css px per tile
const ZOOMS = [1, 2, 3, 4];

/** Map zoom (world px → css px), remembered across reloads. */
const $zoom = persistentAtom<string>('owlchirp:map:zoom', '2');

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

type PetState = { x: number; y: number; dir: Dir; movingUntil: number };

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
  petState: PetState;
};

/** A live call's pulse, lapping from its building to HQ until the call ends. */
type ActivePulse = {
  pulse: CallPulse;
  route: Point[];
  length: number;
  start: number;
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

export default function MapCanvas({ me }: { me: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const followRef = useRef<() => void>(() => undefined);
  const zoom = Number(useStore($zoom)) || 2;
  const mode = useStore($mapMode);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const mini = miniRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    const mctx = mini.getContext('2d')!;
    const reduced = prefersReducedMotion();

    // ---- World ----
    const world = new World();
    for (const t of $mapTiles.get()) world.setTile(t.x, t.y, t.tile);
    world.setProps($mapProps.get());
    const syncBuildings = () => (world.buildings = ($buildings.get() ?? []).map((b) => ({ id: b.id, x: b.x, y: b.y })));
    syncBuildings();
    const ground = renderGround(world);
    const repaint = (x: number, y: number) => paintGround(ground, world, x - 2, y - 2, x + 2, y + 2);

    const offTiles = $mapTiles.listen((tiles) => {
      const changed: MapTile[] = tiles.filter((t) => world.setTile(t.x, t.y, t.tile));
      if (changed.length > 300) paintGround(ground, world, 0, 0, COLS - 1, ROWS - 1);
      else for (const t of changed) repaint(t.x, t.y);
    });
    const offProps = $mapProps.listen((props) => world.setProps(props));
    const offBuildings = $buildings.listen(syncBuildings);

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
      mini.width = Math.round(COLS * MINIMAP_SCALE * dpr);
      mini.height = Math.round(ROWS * MINIMAP_SCALE * dpr);
      snap = true;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    const offZoom = $zoom.listen(() => requestAnimationFrame(resize));

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
      if (!f) return;
      lookAtPoint({ x: (f.x + BUILDING_SIZE / 2) * TILE, y: (f.y + BUILDING_SIZE / 2) * TILE });
    });

    // ---- Characters ----
    const sprites = new Map<string, Sprite>();
    const keys: Dir[] = [];
    let target: Point | null = null; // click-to-walk
    let lastSent = 0;
    let sentMoving = false;

    const syncPlayers = () => {
      const players = $mapPlayers.get() ?? {};
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
            ride: p.ride ?? 'walk',
            petState: { x: p.x + 12, y: p.y + 1, dir: 'down', movingUntil: 0 },
          });
        } else {
          s.pet = p.pet ?? '';
          s.ride = p.ride ?? 'walk';
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

    const blocked = (x: number, y: number, footW: number) =>
      world.isSolid(x - footW, y - FOOT_H) ||
      world.isSolid(x + footW, y - FOOT_H) ||
      world.isSolid(x - footW, y - 1) ||
      world.isSolid(x + footW, y - 1);

    const moveMe = (dt: number, now: number) => {
      const s = sprites.get(me);
      if (!s) return;
      const gear = $myGear.get();
      s.pet = gear.pet;
      s.ride = gear.ride;
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
      } else if (target) {
        const ddx = target.x - s.x;
        const ddy = target.y - s.y;
        const dist = Math.hypot(ddx, ddy);
        if (dist < 2) {
          target = null;
        } else {
          dx = ddx / dist;
          dy = ddy / dist;
        }
      }

      const moving = dx !== 0 || dy !== 0;
      if (moving) {
        const footW = FOOT_W[gear.ride];
        // Someone may have built on top of us: walk out freely.
        const stuck = blocked(s.x, s.y, footW);
        const step = Math.min(SPEED[gear.ride] * dt, 8);
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
        if (!moved) target = null;
        s.dir = keyDir
          ? keyDir
          : Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
        s.tx = s.x;
        s.ty = s.y;
        s.movingUntil = moved ? now + 50 : 0;
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

    /** Pets trail behind their owner and sit beside them when they stop. */
    const movePet = (s: Sprite, dt: number, now: number) => {
      const p = s.petState;
      const moving = now < s.movingUntil;
      const behind: Record<Dir, [number, number]> = { left: [14, 1], right: [-14, 1], up: [8, 8], down: [8, -6] };
      const [ox, oy] = moving ? behind[s.dir] : [12, 1];
      const tx = s.x + ox;
      const ty = s.y + oy;
      const dx = tx - p.x;
      const dy = ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 240) {
        p.x = tx;
        p.y = ty;
      } else if (d > 1.5) {
        const step = Math.min(d, Math.max(50, d * 6) * dt);
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
        p.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
        if (step > 0.3) p.movingUntil = now + 80;
      } else if (!moving) {
        p.dir = 'down';
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
      pendingPaint.set(tileKey(x, y), { x, y, tile: world.tile(x, y)! });
      repaint(x, y);
    };

    const createAt = (x: number, y: number) => {
      if (!inMap(x, y) || inRect(HQ, x, y) || world.buildingAt(x, y)) return;
      const brush = $mapBrush.get();
      const k = tileKey(x, y);
      if (brush.type === 'tile') {
        if (world.setTile(x, y, brush.tile)) queuePaint(x, y);
        return;
      }
      if (world.props.has(k) || world.trees.has(k) || world.tile(x, y) === 'water') return;
      const temp = { id: nextTempId--, kind: brush.kind, x, y };
      world.props.set(k, temp);
      createProp(brush.kind, x, y).catch((err) => {
        console.error('map.props.create', err);
        if (world.props.get(k) === temp) world.props.delete(k);
      });
    };

    const destroyAt = (x: number, y: number) => {
      if (!inMap(x, y) || inRect(HQ, x, y)) return;
      const k = tileKey(x, y);
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
      if (world.tile(x, y) !== 'grass' && !world.buildingAt(x, y) && world.setTile(x, y, 'grass')) queuePaint(x, y);
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
      target = null;
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
        target = p;
        follow = true;
        lookAt = null;
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      if (mode === 'move') {
        const b = world.buildingAt(tile.x, tile.y);
        if (b) drag = { id: b.id, offX: p.x / TILE - b.x, offY: p.y / TILE - b.y, at: { x: b.x, y: b.y }, from: { x: b.x, y: b.y } };
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
      else if (painting) applyTool(hover);
    };
    const onPointerUp = () => {
      painting = false;
      lastTile = null;
      flushPaint(Infinity);
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

    /** Route the next lap (re-matched each time, so moved or new buildings count) and flash its building. */
    const lap = (p: ActivePulse, start: number) => {
      const building = matchBuilding(p.pulse.phoneNumber, $buildings.get() ?? []);
      if (building) {
        flashes.set(building.id, performance.now());
        p.route = world.routeFromBuilding(building);
      } else {
        let h = 0;
        for (const ch of p.pulse.contactId) h = (h * 31 + ch.charCodeAt(0)) | 0;
        const edge = EDGE_ENTRIES[Math.abs(h) % EDGE_ENTRIES.length];
        p.route = world.routeToHQ(edge, { x: edge.x === 0 ? -8 : WORLD_W + 8, y: edge.y * TILE + TILE / 2 });
      }
      p.length = pathLength(p.route);
      p.start = start;
    };
    const startPulse = (pulse: CallPulse) => {
      if (pulses.some((p) => p.pulse.contactId === pulse.contactId)) return;
      const p: ActivePulse = { pulse, route: [], length: 0, start: 0, ended: false };
      lap(p, performance.now());
      pulses.push(p);
    };
    for (const pulse of liveCalls()) startPulse(pulse);
    const offPulse = onCallPulse(startPulse);
    const offEnd = onCallEnd((contactId) => {
      for (const p of pulses) if (p.pulse.contactId === contactId) p.ended = true;
    });

    // ---- Drawing ----
    const canSeeNames = $can('agentNames');
    let raf = 0;
    let last = performance.now();
    let frameNo = 0;

    const drawMinimap = () => {
      const k = mini.width / WORLD_W;
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.imageSmoothingEnabled = true;
      mctx.drawImage(ground, 0, 0, mini.width, mini.height);
      mctx.fillStyle = '#e8edf2';
      mctx.fillRect(HQ.x * TILE * k, HQ.y * TILE * k, HQ.w * TILE * k, HQ.h * TILE * k);
      for (const b of $buildings.get() ?? []) {
        mctx.fillStyle = BUILDING_STYLES[b.style % BUILDING_STYLES.length].roof;
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
        if (s.pet) movePet(s, dt, now);
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

      const buildings = $buildings.get() ?? [];
      const highlight = $highlightBuilding.get();
      const statuses = new Map(
        ($metrics.get().user_list ?? []).map((u) => [u.user.username.toLowerCase(), u.status.name.toLowerCase()]),
      );

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#5c5f6b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, -ox, -oy);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(ground, 0, 0);
      drawWater(ctx, world, viewTiles, motion);
      for (const lot of emptyLots(world)) {
        if (overlaps(lot, viewTiles)) drawEmptyLot(ctx, lot);
      }

      // Everything with height, back to front.
      const queued = $queuedCount.get();
      const ringAge = rings.length ? now - rings[rings.length - 1] : Infinity;
      while (rings.length && now - rings[0] > RING_MS) rings.shift();
      const ring = reduced ? (ringAge < BUILDING_FLASH_MS ? 1 : 0) : Math.max(0, 1 - ringAge / RING_MS);
      const hqGlow = queued > 0 ? (reduced ? 1 : 0.6 + 0.4 * Math.sin(t * 3)) : 0;

      const drawables: { y: number; draw: () => void }[] = [];
      for (const k of world.trees) {
        const x = k % COLS;
        const y = Math.floor(k / COLS);
        if (!inRect(viewTiles, x, y) || world.buildingAt(x, y)) continue;
        drawables.push({ y: (y + 1) * TILE, draw: () => drawTree(ctx, x, y) });
      }
      for (const p of world.props.values()) {
        if (!inRect(viewTiles, p.x, p.y) || world.buildingAt(p.x, p.y)) continue;
        drawables.push({ y: (p.y + 1) * TILE - (p.kind === 'flowerpot' ? 8 : 0), draw: () => drawProp(ctx, p.kind, p.x, p.y, motion) });
      }
      for (const b of buildings) {
        if (drag?.id === b.id) continue;
        if (!overlaps(buildingRect(b), viewTiles)) continue;
        const flashAge = now - (flashes.get(b.id) ?? -Infinity);
        const glow = b.id === highlight ? 1 : flashAge < BUILDING_FLASH_MS ? 1 - flashAge / BUILDING_FLASH_MS : 0;
        drawables.push({ y: (b.y + BUILDING_SIZE) * TILE, draw: () => drawBuilding(ctx, b.x, b.y, b.style, glow, motion) });
      }
      if (overlaps(HQ, viewTiles)) {
        drawables.push({ y: (HQ.y + HQ.h) * TILE, draw: () => drawHQ(ctx, Math.max(hqGlow, ring * 0.8), reduced ? 0 : ring, motion) });
      }

      const people: { name: string; s: Sprite; status?: string; pose: Pose }[] = [];
      for (const [name, s] of sprites) {
        if (!inView(s.x, s.y)) continue;
        const status = statuses.get(name.toLowerCase());
        const walking = now < s.movingUntil;
        const pose = walking ? 'walk' : poseFor(status);
        people.push({ name, s, status, pose });
        drawables.push({ y: s.y, draw: () => drawCharacter(ctx, name, s.x, s.y, s.dir, pose, motion, s.ride) });
        if (s.pet) {
          const pet = s.pet;
          const p = s.petState;
          drawables.push({ y: p.y, draw: () => drawPet(ctx, pet, p.x, p.y, p.dir, now < p.movingUntil, motion) });
        }
      }
      drawables.sort((a, b) => a.y - b.y);
      for (const d of drawables) d.draw();

      // Pulses travel the roads to HQ, ring it, and go again until the call ends.
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        const f = (now - p.start) / PULSE_TRAVEL_MS;
        if (f < 0) continue; // between laps
        if (f >= 1) {
          rings.push(now);
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
        const height = pose === 'sleeping' ? 10 : riding ? (s.ride === 'car' ? 14 : 22) : 17;
        const x = sx(s.x);
        const top = sy(s.y - height);
        if (pose === 'sleeping') {
          ctx.font = `bold ${10 * dpr}px ui-monospace, monospace`;
          const bob = reduced ? 0 : (t * 0.8) % 1;
          ctx.fillStyle = `rgba(255,255,255,${1 - bob * 0.7})`;
          ctx.fillText('z Z', x + 10 * scale, top - bob * 8 * scale);
        }
        const isMe = name === me;
        if (isSpeaking(name)) {
          // Sound waves beside the head; my own carry range while I talk.
          const wave = reduced ? 0.5 : (t * 2) % 1;
          ctx.lineWidth = 1.5 * dpr;
          for (let i = 0; i < 3; i++) {
            const r = (3 + i * 3 + wave * 3) * scale;
            ctx.strokeStyle = `rgba(255,255,255,${0.9 - i * 0.25 - wave * 0.2})`;
            ctx.beginPath();
            ctx.arc(x + 5 * scale, top + 4 * scale, r, -Math.PI / 4, Math.PI / 4);
            ctx.stroke();
          }
          if (isMe) {
            ctx.strokeStyle = 'rgba(41, 182, 168, 0.35)';
            ctx.setLineDash([4 * dpr, 4 * dpr]);
            ctx.beginPath();
            ctx.arc(x, sy(s.y - 8), VOICE_RANGE * scale, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        const label = isMe ? 'You' : canSeeNames.get() ? agentName(name) : '';
        const dot = status && (pose === 'stand' || riding) ? STATUS_DOT[status] : undefined;
        if (!label && !dot) continue;
        ctx.font = `${isMe ? 'bold ' : ''}${11 * dpr}px ui-sans-serif, system-ui, sans-serif`;
        const w = label ? ctx.measureText(label).width + 8 * dpr : 0;
        const dotW = dot ? 10 * dpr : 0;
        const h = 14 * dpr;
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

      if (frameNo % 4 === 0) drawMinimap();
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      flushPaint(Infinity);
      observer.disconnect();
      offZoom();
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
  }, [me]);

  const setZoom = (step: number) => {
    const i = ZOOMS.indexOf(zoom);
    $zoom.set(String(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 1 : i) + step))]));
  };
  const overlayButton =
    'flex size-8 items-center justify-center rounded-md bg-white/85 text-base font-bold text-secondary-800 shadow-sm hover:bg-white disabled:opacity-40 dark:bg-secondary-900/85 dark:text-secondary-100 dark:hover:bg-secondary-900';
  const cursor = mode === 'move' ? 'cursor-grab' : mode === 'walk' ? 'cursor-pointer' : 'cursor-crosshair';

  return (
    <div ref={wrapRef} className="relative h-[min(70vh,760px)] min-h-80 w-full overflow-hidden rounded-lg bg-[#5c5f6b]">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label="Team map. Click the map, then use the arrow keys or WASD to walk, or click where you want to go."
        className={`block touch-none outline-none focus-visible:ring-3 focus-visible:ring-primary-500/60 ${cursor}`}
        style={{ imageRendering: 'pixelated' }}
      />
      <div className="absolute top-2 right-2 flex flex-col gap-1">
        <button type="button" className={overlayButton} onClick={() => setZoom(1)} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} aria-label="Zoom in" title="Zoom in">
          +
        </button>
        <button type="button" className={overlayButton} onClick={() => setZoom(-1)} disabled={zoom <= ZOOMS[0]} aria-label="Zoom out" title="Zoom out">
          −
        </button>
        <button type="button" className={overlayButton} onClick={() => followRef.current()} aria-label="Back to me" title="Back to me">
          <Icon name="user" className="size-4" />
        </button>
      </div>
      <canvas
        ref={miniRef}
        aria-label="Minimap. Click to look around the town."
        className="absolute right-2 bottom-2 hidden cursor-pointer touch-none rounded border-2 border-white/80 shadow-md sm:block"
        style={{ width: COLS * MINIMAP_SCALE, height: ROWS * MINIMAP_SCALE }}
      />
    </div>
  );
}
