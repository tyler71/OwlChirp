// The Map canvas: one requestAnimationFrame loop draws the town, everyone's
// character, and pulses for incoming calls. Stores are read through refs so
// React never re-renders per frame.
import { useEffect, useRef } from 'react';

import { STATUS_LUNCH, STATUS_OFFLINE, STATUS_ON_CALL, STATUS_TICKET_BREAK } from '../../lib/const';
import { $queuedCount } from '../../lib/flowCalls';
import { agentName } from '../../lib/helpers';
import {
  $buildings,
  $highlightBuilding,
  $mapPlayers,
  matchBuilding,
  onCallPulse,
  sendMove,
  type CallPulse,
  type Dir,
} from '../../lib/map';
import { $can, $metrics } from '../../lib/stores';
import { drawBuilding, drawCharacter, drawEmptyLot, drawHQ, drawTree, drawWater, renderGround, type Pose } from './sprites';
import {
  EDGE_ENTRIES,
  HQ,
  LOTS,
  TILE,
  TREES,
  WORLD_H,
  WORLD_W,
  isSolid,
  pathLength,
  pointAlong,
  routeToHQ,
  type Point,
} from './world';

const SPEED = 72; // px per second
const SEND_INTERVAL_MS = 100;
const PULSE_TRAVEL_MS = 2400;
const RING_MS = 1200;
const BUILDING_FLASH_MS = 3500;
// Half-width of the box at a character's feet used for collisions.
const FOOT_W = 4;
const FOOT_H = 3;

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

/** A character as drawn: where it is now, easing toward where it should be. */
type Sprite = { x: number; y: number; tx: number; ty: number; dir: Dir; movingUntil: number };

type ActivePulse = {
  pulse: CallPulse;
  route: Point[];
  length: number;
  start: number;
  slot: number | null;
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

export default function MapCanvas({ me }: { me: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    const ground = renderGround();
    const reduced = prefersReducedMotion();

    let scale = 1; // device pixels per world pixel
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const fit = (wrap.clientWidth * dpr) / WORLD_W;
      // Whole-number scales keep pixels crisp; below 1x there's no choice.
      scale = fit >= 1 ? Math.floor(fit) : fit;
      canvas.width = Math.round(WORLD_W * scale);
      canvas.height = Math.round(WORLD_H * scale);
      canvas.style.width = `${canvas.width / dpr}px`;
      canvas.style.height = `${canvas.height / dpr}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

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
          sprites.set(p.username, { x: p.x, y: p.y, tx: p.x, ty: p.y, dir: p.dir, movingUntil: 0 });
        } else if (p.username !== me) {
          if (p.x !== s.tx || p.y !== s.ty) s.movingUntil = performance.now() + 250;
          s.tx = p.x;
          s.ty = p.y;
          s.dir = p.dir;
        }
      }
    };
    syncPlayers();
    const offPlayers = $mapPlayers.listen(syncPlayers);

    const builtSlots = () => new Set(($buildings.get() ?? []).map((b) => b.slot));
    const blocked = (x: number, y: number, built: Set<number>) =>
      isSolid(x - FOOT_W, y - FOOT_H, built) ||
      isSolid(x + FOOT_W, y - FOOT_H, built) ||
      isSolid(x - FOOT_W, y - 1, built) ||
      isSolid(x + FOOT_W, y - 1, built);

    const onKeyDown = (e: KeyboardEvent) => {
      const dir = KEY_DIRS[e.key];
      if (!dir) return;
      e.preventDefault();
      target = null;
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
      const rect = canvas.getBoundingClientRect();
      target = {
        x: ((e.clientX - rect.left) / rect.width) * WORLD_W,
        y: ((e.clientY - rect.top) / rect.height) * WORLD_H,
      };
    };
    canvas.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('blur', onBlur);
    canvas.addEventListener('pointerdown', onPointerDown);

    const moveMe = (dt: number, now: number) => {
      const s = sprites.get(me);
      if (!s) return;
      let dx = 0;
      let dy = 0;
      const dir = keys[keys.length - 1];
      if (dir) {
        dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
        dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
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
        const built = builtSlots();
        const step = Math.min(SPEED * dt, 8);
        const nx = s.x + dx * step;
        const ny = s.y + dy * step;
        // Slide along walls: try each axis on its own.
        let moved = false;
        if (!blocked(nx, s.y, built)) {
          s.x = nx;
          moved = true;
        }
        if (!blocked(s.x, ny, built)) {
          s.y = ny;
          moved = true;
        }
        if (!moved) target = null;
        s.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
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

    // ---- Pulses ----
    const pulses: ActivePulse[] = [];
    const rings: number[] = []; // start times
    const flashes = new Map<number, number>(); // slot → start time

    const offPulse = onCallPulse((pulse) => {
      const building = matchBuilding(pulse.phoneNumber, $buildings.get() ?? []);
      const now = performance.now();
      if (building) flashes.set(building.slot, now);
      if (reduced) {
        rings.push(now);
        return;
      }
      let route: Point[];
      if (building && LOTS[building.slot]) {
        const lot = LOTS[building.slot];
        route = routeToHQ(lot.doorTile, lot.door);
      } else {
        let h = 0;
        for (const ch of pulse.contactId) h = (h * 31 + ch.charCodeAt(0)) | 0;
        const edge = EDGE_ENTRIES[Math.abs(h) % EDGE_ENTRIES.length];
        route = routeToHQ(edge, { x: edge.x === 0 ? -8 : WORLD_W + 8, y: edge.y * TILE + TILE / 2 });
      }
      pulses.push({ pulse, route, length: pathLength(route), start: now, slot: building?.slot ?? null });
    });

    // ---- Drawing ----
    const canSeeNames = $can('agentNames');
    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const motion = reduced ? 0 : t;

      moveMe(dt, now);
      for (const [name, s] of sprites) {
        if (name === me) continue;
        // Ease toward the last reported spot.
        const k = Math.min(1, dt * 10);
        s.x += (s.tx - s.x) * k;
        s.y += (s.ty - s.y) * k;
      }

      const buildings = $buildings.get() ?? [];
      const built = new Set(buildings.map((b) => b.slot));
      const highlight = $highlightBuilding.get();
      const statuses = new Map(
        ($metrics.get().user_list ?? []).map((u) => [u.user.username.toLowerCase(), u.status.name.toLowerCase()]),
      );

      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(ground, 0, 0);
      drawWater(ctx, motion);
      LOTS.forEach((_, slot) => {
        if (!built.has(slot)) drawEmptyLot(ctx, slot);
      });

      // Everything with height, back to front.
      const queued = $queuedCount.get();
      const ringAge = rings.length ? now - rings[rings.length - 1] : Infinity;
      while (rings.length && now - rings[0] > RING_MS) rings.shift();
      const ring = reduced ? (ringAge < BUILDING_FLASH_MS ? 1 : 0) : Math.max(0, 1 - ringAge / RING_MS);
      const hqGlow = queued > 0 ? (reduced ? 1 : 0.6 + 0.4 * Math.sin(t * 3)) : 0;

      const drawables: { y: number; draw: () => void }[] = [];
      for (const tree of TREES) drawables.push({ y: (tree.y + 1) * TILE, draw: () => drawTree(ctx, tree.x, tree.y) });
      for (const b of buildings) {
        const lot = LOTS[b.slot];
        if (!lot) continue;
        const flashAge = now - (flashes.get(b.slot) ?? -Infinity);
        const glow = b.id === highlight ? 1 : flashAge < BUILDING_FLASH_MS ? 1 - flashAge / BUILDING_FLASH_MS : 0;
        drawables.push({ y: (lot.rect.y + lot.rect.h) * TILE, draw: () => drawBuilding(ctx, b.slot, b.style, glow, motion) });
      }
      drawables.push({ y: (HQ.y + HQ.h) * TILE, draw: () => drawHQ(ctx, Math.max(hqGlow, ring * 0.8), reduced ? 0 : ring, motion) });

      const people: { name: string; s: Sprite; status?: string; pose: Pose }[] = [];
      for (const [name, s] of sprites) {
        const status = statuses.get(name.toLowerCase());
        const walking = now < s.movingUntil;
        const pose = walking ? 'walk' : poseFor(status);
        people.push({ name, s, status, pose });
        drawables.push({ y: s.y, draw: () => drawCharacter(ctx, name, s.x, s.y, s.dir, pose, motion) });
      }
      drawables.sort((a, b) => a.y - b.y);
      for (const d of drawables) d.draw();

      // Pulses travel the roads to HQ, then ring it.
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        const f = (now - p.start) / PULSE_TRAVEL_MS;
        if (f >= 1) {
          pulses.splice(i, 1);
          rings.push(now);
          continue;
        }
        const eased = 1 - (1 - f) * (1 - f);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let j = 6; j >= 0; j--) {
          const pt = pointAlong(p.route, eased - j * 0.012, p.length);
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

      // Labels in screen space so text stays sharp at any scale.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const dpr = window.devicePixelRatio || 1;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      for (const { name, s, status, pose } of people) {
        const sx = s.x * scale;
        const top = (s.y - (pose === 'sleeping' ? 10 : 17)) * scale;
        if (pose === 'sleeping') {
          ctx.font = `bold ${10 * dpr}px ui-monospace, monospace`;
          const bob = reduced ? 0 : (t * 0.8) % 1;
          ctx.fillStyle = `rgba(255,255,255,${1 - bob * 0.7})`;
          ctx.fillText('z Z', sx + 10 * scale, top - bob * 8 * scale);
        }
        const isMe = name === me;
        const label = isMe ? 'You' : canSeeNames.get() ? agentName(name) : '';
        const dot = status && pose === 'stand' ? STATUS_DOT[status] : undefined;
        if (!label && !dot) continue;
        ctx.font = `${isMe ? 'bold ' : ''}${11 * dpr}px ui-sans-serif, system-ui, sans-serif`;
        const w = label ? ctx.measureText(label).width + 8 * dpr : 0;
        const dotW = dot ? 10 * dpr : 0;
        const h = 14 * dpr;
        const bx = sx - (w + dotW) / 2;
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

      // Building names under their doors.
      ctx.font = `600 ${10 * dpr}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      for (const b of buildings) {
        const lot = LOTS[b.slot];
        if (!lot) continue;
        const cx = (lot.rect.x + lot.rect.w / 2) * TILE * scale;
        const y = lot.rect.y * TILE * scale - 14 * dpr;
        const w = ctx.measureText(b.name).width + 8 * dpr;
        ctx.fillStyle = b.id === highlight ? 'rgba(255, 210, 63, 0.95)' : 'rgba(255, 255, 255, 0.85)';
        ctx.beginPath();
        ctx.roundRect(cx - w / 2, y, w, 13 * dpr, 3 * dpr);
        ctx.fill();
        ctx.fillStyle = '#2b2233';
        ctx.fillText(b.name, cx, y + 1.5 * dpr);
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      offPlayers();
      offPulse();
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [me]);

  return (
    <div ref={wrapRef} className="flex w-full justify-center overflow-hidden rounded-lg bg-[#5c5f6b]">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label="Team map. Click the map, then use the arrow keys or WASD to walk, or click where you want to go."
        className="block touch-none outline-none focus-visible:ring-3 focus-visible:ring-primary-500/60"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
}
