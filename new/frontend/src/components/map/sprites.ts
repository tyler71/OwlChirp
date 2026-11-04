// Pixel art for the Map, drawn in code: each sprite is a grid of palette
// keys, rendered once per colour scheme to an offscreen canvas and cached.
import { COLS, HQ, LOTS, POND, ROWS, TILE, TILES, hash, type Rect } from './world';

type Grid = readonly string[];
type Palette = Record<string, string>;

// Shared colours. Keys are single characters used in the grids.
const BASE: Palette = {
  o: '#2b2233', // outline
  s: '#f2c79b', // skin
  e: '#2b2233', // eyes
  k: '#3b3140', // shoes
  p: '#3f4a6b', // trousers
  w: '#ffffff',
};

const SHIRTS = ['#e4572e', '#29b6a8', '#5b7fde', '#f2a541', '#9b5de5', '#3fa34d', '#e5487a', '#2f9bd6'];
const HAIR = ['#4a2f23', '#2b2233', '#c68642', '#e8c170', '#8c3b2a', '#6b6b6b'];
const SKIN = ['#f2c79b', '#d9a066', '#a8714a', '#7a4e2d', '#f6d8b8'];

// ---- Characters: 10x14, feet on the bottom row. ----

const HEAD_DOWN: Grid = [
  '...oooo...',
  '..ohhhho..',
  '.ohhhhhho.',
  '.ohssssho.',
  '.osesseso.',
  '.osssssso.',
];
const HEAD_UP: Grid = [
  '...oooo...',
  '..ohhhho..',
  '.ohhhhhho.',
  '.ohhhhhho.',
  '.ohhhhhho.',
  '.oshhhhso.',
];
const HEAD_SIDE: Grid = [
  '...oooo...',
  '..ohhhho..',
  '.ohhhhhho.',
  '.osshhhho.',
  '.oesshhho.',
  '.osssssho.',
];
const BODY_FRONT: Grid = ['..oobboo..', '.obbbbbbo.', 'osbbbbbbso', 'osbbbbbbso', '.oppppppo.'];
const BODY_SIDE: Grid = ['..oobbo...', '..obbbbo..', '..obsbbo..', '..obsbbo..', '..oppppo..'];
const LEGS_APART: Grid = ['..op..po..', '..ok..ko..', '..........'];
const LEGS_TOGETHER: Grid = ['...oppo...', '...okko...', '..........'];

export const CHAR_W = 10;
export const CHAR_H = 14;

export type Facing = 'up' | 'down' | 'left' | 'right';

function character(facing: Facing, frame: number): Grid {
  const head = facing === 'up' ? HEAD_UP : facing === 'down' ? HEAD_DOWN : HEAD_SIDE;
  const body = facing === 'up' || facing === 'down' ? BODY_FRONT : BODY_SIDE;
  return [...head, ...body, ...(frame ? LEGS_TOGETHER : LEGS_APART)];
}

// Chewing: mouth open on alternate frames.
const FACE_EATING: Grid = [...HEAD_DOWN.slice(0, 5), '.ossoosso.'];

/** Lying down under a blanket, 17x7, eyes shut: drawn for Offline. */
const SLEEPING: Grid = [
  '..oooo...........',
  '.ohhhho.oooooooo.',
  'ohhssssobbbbbbbbo',
  'ohseesobbbbbbbbbo',
  'ohsssssobbbbbbbbo',
  '.ohsssoobbbbbbbbo',
  '..ooooooooooooooo',
];
const PILLOW: Grid = ['.oooooo.', 'owwwwwwo', 'owwwwwwo', 'owwwwwwo', '.oooooo.'];

const BURGER: Grid = ['.oooo.', 'oyyyyo', 'oggggo', 'orrrro', 'oyyyyo', '.oooo.'];
const PHONE: Grid = ['ooo', 'oRo', 'oRo', '.oR', '.oR', 'oRo', 'ooo'];
const LAPTOP: Grid = ['.oooooooo.', '.oddddddo.', '.oddddddo.', 'ommmmmmmmo', 'oooooooooo'];
const DESK: Grid = ['tttttttttttt', 'oooooooooooo', '.t........t.', '.t........t.'];

const ITEM_COLORS: Palette = {
  y: '#e6a23c',
  g: '#5bbf4a',
  r: '#7a3e1d',
  R: '#e5484d',
  d: '#20344f',
  m: '#b8c2cc',
  t: '#a0703f',
};

// ---- Rendering helpers ----

const cache = new Map<string, HTMLCanvasElement>();

function render(grid: Grid, palette: Palette, flip = false): HTMLCanvasElement {
  const w = Math.max(...grid.map((r) => r.length));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = grid.length;
  const ctx = c.getContext('2d')!;
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(flip ? w - 1 - x : x, y, 1, 1);
    }
  });
  return c;
}

function cached(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
  let c = cache.get(key);
  if (!c) cache.set(key, (c = make()));
  return c;
}

function pick<T>(list: T[], seed: string, salt: number): T {
  let h = salt;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return list[(h >>> 0) % list.length];
}

/** The fixed look for one person, derived from their username. */
export function lookFor(username: string): Palette {
  return {
    ...BASE,
    ...ITEM_COLORS,
    b: pick(SHIRTS, username, 2166136261),
    h: pick(HAIR, username, 374761393),
    s: pick(SKIN, username, 668265263),
  };
}

export type Pose = 'stand' | 'walk' | 'phone' | 'typing' | 'eating' | 'sleeping';

/**
 * Draw one character with its feet at (x, y). t is seconds, for idle
 * animation.
 */
export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  username: string,
  x: number,
  y: number,
  facing: Facing,
  pose: Pose,
  t: number,
): void {
  const look = lookFor(username);
  const sprite = (name: string, grid: Grid, flip = false) =>
    cached(`${username}:${name}:${flip}`, () => render(grid, look, flip));
  const left = Math.round(x - CHAR_W / 2);
  const top = Math.round(y - CHAR_H);

  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(left + 1, Math.round(y) - 2, CHAR_W - 2, 2);

  if (pose === 'sleeping') {
    const sx = Math.round(x - 8);
    const sy = Math.round(y - 7);
    ctx.drawImage(cached('pillow', () => render(PILLOW, BASE)), sx - 3, sy + 2);
    ctx.drawImage(sprite('sleep', SLEEPING), sx, sy);
    return;
  }

  if (pose === 'typing') {
    // Seated behind a desk facing the viewer, face visible over the laptop.
    const items = { ...BASE, ...ITEM_COLORS };
    const body = sprite('down0', character('down', 0));
    ctx.drawImage(body, 0, 0, CHAR_W, 9, left, top + 2, CHAR_W, 9);
    ctx.drawImage(cached('laptop', () => render(LAPTOP, items)), left, top + 8);
    ctx.drawImage(cached('desk', () => render(DESK, items)), left - 1, top + 12);
    // Screen flicker and hands bouncing on the keys.
    const tap = Math.floor(t * 8) % 4;
    ctx.fillStyle = '#7fe3ff';
    ctx.fillRect(left + 2 + tap, top + 9 + (tap % 2), 2, 1);
    ctx.fillStyle = look.s;
    ctx.fillRect(left + 1 + (tap % 2), top + 11, 2, 1);
    ctx.fillRect(left + 7 - (tap % 2), top + 11, 2, 1);
    return;
  }

  if (pose === 'walk' || pose === 'stand') {
    const frame = pose === 'walk' ? Math.floor(t * 8) % 2 : 0;
    const flip = facing === 'right';
    const dir = facing === 'right' ? 'left' : facing;
    ctx.drawImage(sprite(`${dir}${frame}`, character(dir, frame), flip), left, top - (frame ? 1 : 0));
    return;
  }

  // Facing the viewer with something in hand.
  const head = pose === 'eating' && Math.floor(t * 3) % 2 ? FACE_EATING : HEAD_DOWN;
  const grid = [...head, ...BODY_FRONT, ...LEGS_TOGETHER];
  ctx.drawImage(sprite(`${pose}-${head === HEAD_DOWN ? 0 : 1}`, grid), left, top);

  if (pose === 'eating') {
    const bob = Math.floor(t * 3) % 2;
    ctx.drawImage(cached('burger', () => render(BURGER, { ...BASE, ...ITEM_COLORS })), left + 7, top + 5 - bob);
  } else if (pose === 'phone') {
    ctx.drawImage(cached('phone', () => render(PHONE, { ...BASE, ...ITEM_COLORS })), left + 8, top + 2);
    // Sound waves.
    const phase = (t * 1.5) % 1;
    ctx.strokeStyle = `rgba(255,255,255,${0.9 - phase * 0.8})`;
    ctx.lineWidth = 1;
    for (const r of [3, 6]) {
      ctx.beginPath();
      ctx.arc(left + 11, top + 4, r + phase * 2, -Math.PI / 3, Math.PI / 3);
      ctx.stroke();
    }
  }
}

// ---- Buildings ----

type BuildingStyle = { wall: string; wallDark: string; roof: string; roofDark: string; trim: string };

export const BUILDING_STYLES: (BuildingStyle & { label: string })[] = [
  { label: 'Brick', wall: '#c8644b', wallDark: '#9e4a37', roof: '#5a4a6b', roofDark: '#463955', trim: '#f4e4c1' },
  { label: 'Teal', wall: '#e9e2cf', wallDark: '#c8bfa8', roof: '#2a9d8f', roofDark: '#1f7a6f', trim: '#ffffff' },
  { label: 'Sky', wall: '#dfe8f2', wallDark: '#b8c6d6', roof: '#3d6fb6', roofDark: '#2e558c', trim: '#ffffff' },
  { label: 'Sunset', wall: '#f3d9a4', wallDark: '#d9b97c', roof: '#d9534f', roofDark: '#ad3e3b', trim: '#fff6e0' },
];

function px(r: Rect) {
  return { x: r.x * TILE, y: r.y * TILE, w: r.w * TILE, h: r.h * TILE };
}

function windowAt(ctx: CanvasRenderingContext2D, x: number, y: number, lit: boolean, trim: string) {
  ctx.fillStyle = '#2b2233';
  ctx.fillRect(x - 1, y - 1, 8, 8);
  ctx.fillStyle = lit ? '#ffe28a' : '#6fa8dc';
  ctx.fillRect(x, y, 6, 6);
  ctx.fillStyle = trim;
  ctx.fillRect(x + 3, y, 1, 6);
  ctx.fillRect(x, y + 3, 6, 1);
}

/** A house/office on a 4x4 tile lot. glow (0..1) lights it up. */
export function drawBuilding(ctx: CanvasRenderingContext2D, slot: number, style: number, glow: number, t: number) {
  const s = BUILDING_STYLES[style % BUILDING_STYLES.length];
  const { x, y, w, h } = px(LOTS[slot].rect);
  const bx = x + 4;
  const bw = w - 8;
  const roofH = 22;
  const wallTop = y + roofH;
  const wallH = h - roofH - 2;

  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(bx + 3, y + h - 3, bw, 4);

  // Walls.
  ctx.fillStyle = '#2b2233';
  ctx.fillRect(bx - 1, wallTop - 1, bw + 2, wallH + 2);
  ctx.fillStyle = s.wall;
  ctx.fillRect(bx, wallTop, bw, wallH);
  ctx.fillStyle = s.wallDark;
  ctx.fillRect(bx, wallTop + wallH - 3, bw, 3);

  // Roof: stepped gable.
  ctx.fillStyle = '#2b2233';
  ctx.fillRect(bx - 4, wallTop - 4, bw + 8, 5);
  for (let i = 0; i < 9; i++) {
    const inset = i * 3;
    ctx.fillStyle = '#2b2233';
    ctx.fillRect(bx - 3 + inset - 1, wallTop - 4 - (i + 1) * 2, bw + 6 - inset * 2 + 2, 3);
    ctx.fillStyle = i % 2 ? s.roofDark : s.roof;
    ctx.fillRect(bx - 3 + inset, wallTop - 4 - (i + 1) * 2 + 1, bw + 6 - inset * 2, 2);
  }
  ctx.fillStyle = s.roof;
  ctx.fillRect(bx - 3, wallTop - 3, bw + 6, 3);

  // Windows and door.
  const lit = glow > 0.05;
  windowAt(ctx, bx + 5, wallTop + 7, lit, s.trim);
  windowAt(ctx, bx + bw - 11, wallTop + 7, lit, s.trim);
  const doorX = x + w / 2 - 4;
  ctx.fillStyle = '#2b2233';
  ctx.fillRect(doorX - 1, y + h - 17, 10, 15);
  ctx.fillStyle = '#7a4e2d';
  ctx.fillRect(doorX, y + h - 16, 8, 14);
  ctx.fillStyle = '#e6a23c';
  ctx.fillRect(doorX + 6, y + h - 9, 1, 1);

  if (glow > 0) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 12);
    ctx.strokeStyle = `rgba(255, 220, 90, ${glow * (0.5 + 0.5 * pulse)})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx - 6, y - 2, bw + 12, h + 2);
  }
}

/** Techline HQ: the big building in the middle. glow (0..1) for calls. */
export function drawHQ(ctx: CanvasRenderingContext2D, glow: number, ring: number, t: number) {
  const { x, y, w, h } = px(HQ);
  const top = y + 10;

  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(x + 6, y + h - 2, w - 4, 5);

  // Main block.
  ctx.fillStyle = '#2b2233';
  ctx.fillRect(x + 1, top - 1, w - 2, h - 10 + 1);
  ctx.fillStyle = '#e8edf2';
  ctx.fillRect(x + 2, top, w - 4, h - 12);
  ctx.fillStyle = '#c4ccd6';
  ctx.fillRect(x + 2, y + h - 6, w - 4, 4);

  // Flat roof with parapet and antenna.
  ctx.fillStyle = '#2b2233';
  ctx.fillRect(x - 1, top - 6, w + 2, 8);
  ctx.fillStyle = '#4b5d7a';
  ctx.fillRect(x, top - 5, w, 6);
  ctx.fillStyle = '#2b2233';
  ctx.fillRect(x + w - 26, y - 14, 2, 18);
  const blink = Math.floor(t * 2) % 2 === 0 || glow > 0;
  ctx.fillStyle = blink ? (glow > 0 ? '#ffd23f' : '#ff5a5f') : '#7a2d30';
  ctx.fillRect(x + w - 27, y - 16, 4, 3);

  // Sign.
  ctx.fillStyle = '#2b2233';
  ctx.fillRect(x + w / 2 - 34, top + 4, 68, 15);
  ctx.fillStyle = glow > 0 ? '#ffd23f' : '#29b6a8';
  ctx.fillRect(x + w / 2 - 33, top + 5, 66, 13);
  ctx.fillStyle = '#2b2233';
  ctx.font = 'bold 9px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TECHLINE', x + w / 2, top + 12);

  // Windows: two rows.
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 8; i++) {
      if (row === 1 && (i === 3 || i === 4)) continue; // doors go here
      const wx = x + 12 + i * 18;
      const wy = top + 26 + row * 22;
      const lit = glow > 0 ? hash(i, row, Math.floor(t * 6)) < 0.6 + glow * 0.4 : hash(i, row, 9) < 0.35;
      windowAt(ctx, wx, wy, lit, '#ffffff');
    }
  }

  // Glass doors.
  const dx = x + w / 2 - 12;
  ctx.fillStyle = '#2b2233';
  ctx.fillRect(dx - 1, y + h - 23, 26, 21);
  ctx.fillStyle = glow > 0 ? '#fff1a8' : '#8fd3e8';
  ctx.fillRect(dx, y + h - 22, 11, 20);
  ctx.fillRect(dx + 13, y + h - 22, 11, 20);

  if (glow > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x + w / 2, y + h / 2, 10, x + w / 2, y + h / 2, w * 0.8);
    g.addColorStop(0, `rgba(255, 210, 63, ${0.35 * glow})`);
    g.addColorStop(1, 'rgba(255, 210, 63, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - w * 0.3, y - h * 0.5, w * 1.6, h * 2);
    ctx.restore();
  }
  if (ring > 0) {
    // Expanding ring when a call arrives (ring runs 1 → 0).
    const r = 20 + (1 - ring) * 120;
    ctx.strokeStyle = `rgba(255, 210, 63, ${ring})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h - 4, r, r * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

export function drawTree(ctx: CanvasRenderingContext2D, tx: number, ty: number) {
  const x = tx * TILE;
  const y = ty * TILE;
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(x + 2, y + 12, 12, 3);
  ctx.fillStyle = '#2b2233';
  ctx.fillRect(x + 6, y + 6, 4, 9);
  ctx.fillStyle = '#7a4e2d';
  ctx.fillRect(x + 7, y + 6, 2, 8);
  // Canopy over the tile above.
  const shade = hash(tx, ty, 5) < 0.5;
  ctx.fillStyle = '#2b2233';
  ctx.fillRect(x + 1, y - 12, 14, 18);
  ctx.fillRect(x, y - 9, 16, 12);
  ctx.fillStyle = shade ? '#3c8d40' : '#2f7a3a';
  ctx.fillRect(x + 2, y - 11, 12, 16);
  ctx.fillRect(x + 1, y - 8, 14, 10);
  ctx.fillStyle = shade ? '#5bbf4a' : '#4caf50';
  ctx.fillRect(x + 4, y - 10, 6, 5);
  ctx.fillRect(x + 3, y - 6, 3, 3);
}

// ---- Ground ----

const GROUND: Record<string, [string, string]> = {
  grass: ['#7cc36a', '#6db35c'],
  flowers: ['#7cc36a', '#6db35c'],
  lot: ['#c9b27e', '#b9a06c'],
  road: ['#5c5f6b', '#55585f'],
  path: ['#d8c39a', '#c8b086'],
  plaza: ['#d7d2c8', '#c7c0b3'],
  water: ['#4aa3df', '#3d8fc8'],
};

/** Paint every ground tile once; the result is drawn as a single image. */
export function renderGround(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = COLS * TILE;
  c.height = ROWS * TILE;
  const ctx = c.getContext('2d')!;
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      const tile = TILES[ty][tx];
      const [base, alt] = GROUND[tile];
      const x = tx * TILE;
      const y = ty * TILE;
      ctx.fillStyle = base;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = alt;
      for (let i = 0; i < 6; i++) {
        const sx = Math.floor(hash(tx, ty, i) * 15);
        const sy = Math.floor(hash(ty, tx, i + 11) * 15);
        ctx.fillRect(x + sx, y + sy, tile === 'grass' || tile === 'flowers' ? 1 : 2, tile === 'grass' ? 2 : 1);
      }
      if (tile === 'flowers') {
        const colors = ['#ff6b8b', '#ffd23f', '#ffffff', '#b38cff'];
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = colors[Math.floor(hash(tx, ty, 20 + i) * colors.length)];
          ctx.fillRect(x + 2 + Math.floor(hash(tx, ty, 30 + i) * 11), y + 2 + Math.floor(hash(tx, ty, 40 + i) * 11), 2, 2);
        }
      }
      if (tile === 'plaza' && (tx + ty) % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x, y, TILE, TILE);
      }
    }
  }

  // Road markings: dashed centre lines on two-tile-wide roads.
  ctx.fillStyle = '#e8d36a';
  for (const yLine of [9, 30, 22]) {
    for (let tx = 0; tx < COLS; tx++) {
      if (TILES[yLine][tx] === 'road' && TILES[yLine - 1][tx] === 'road' && tx % 2 === 0) {
        ctx.fillRect(tx * TILE + 3, yLine * TILE - 1, 10, 2);
      }
    }
  }
  for (const xLine of [8, 38]) {
    for (let ty = 0; ty < ROWS; ty++) {
      if (TILES[ty][xLine] === 'road' && TILES[ty][xLine - 1] === 'road' && ty % 2 === 0 && ty !== 8 && ty !== 9 && ty !== 21 && ty !== 22 && ty !== 29 && ty !== 30) {
        ctx.fillRect(xLine * TILE - 1, ty * TILE + 3, 2, 10);
      }
    }
  }

  // Pond edge.
  const p = px(POND);
  ctx.strokeStyle = '#2b2233';
  ctx.lineWidth = 2;
  ctx.strokeRect(p.x, p.y, p.w, p.h);
  ctx.fillStyle = '#c9e7f7';
  ctx.fillRect(p.x + 2, p.y + 2, p.w - 4, 2);

  // Empty lots get a little "for sale" post.
  for (const lot of LOTS) {
    const r = px(lot.rect);
    ctx.strokeStyle = 'rgba(80, 60, 30, 0.35)';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 2.5, r.y + 2.5, r.w - 5, r.h - 5);
    ctx.setLineDash([]);
  }
  return c;
}

/** The little sign on an empty lot (drawn only while the lot is free). */
export function drawEmptyLot(ctx: CanvasRenderingContext2D, slot: number) {
  const r = px(LOTS[slot].rect);
  const x = r.x + r.w / 2 - 6;
  const y = r.y + r.h / 2 - 6;
  ctx.fillStyle = '#2b2233';
  ctx.fillRect(x + 5, y + 6, 2, 10);
  ctx.fillRect(x - 1, y - 1, 14, 9);
  ctx.fillStyle = '#f4e4c1';
  ctx.fillRect(x, y, 12, 7);
  ctx.fillStyle = '#9e4a37';
  ctx.fillRect(x + 2, y + 2, 8, 1);
  ctx.fillRect(x + 2, y + 4, 5, 1);
}

/** Water shimmer, drawn each frame over the pond. */
export function drawWater(ctx: CanvasRenderingContext2D, t: number) {
  const p = px(POND);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i < 6; i++) {
    const phase = (t * 0.6 + i * 0.37) % 1;
    const sx = p.x + 6 + Math.floor(hash(i, 1, 3) * (p.w - 18));
    const sy = p.y + 8 + Math.floor(hash(i, 2, 3) * (p.h - 16));
    ctx.globalAlpha = Math.sin(phase * Math.PI) * 0.8;
    ctx.fillRect(sx + Math.floor(phase * 4), sy, 5, 1);
  }
  ctx.globalAlpha = 1;
}

