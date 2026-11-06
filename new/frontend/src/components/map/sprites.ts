// Pixel art for the Map. Characters are composited from the sprite layers
// in src/assets/map/sprite (see assets.ts); vehicles, pets, buildings and
// the rest are grids of palette keys drawn in code, rendered once per colour
// scheme to an offscreen canvas and cached.
import type { MapLook, Pet, Ride } from '../../lib/map';
import { AVATAR_PARTS, LAYERS, REQUIRED_PARTS, SHEET_FRAME, SHEET_ROWS, img, type AvatarPart } from './assets';
import { BUILDING_SIZE, DEFAULT_LOTS, HQ, TILE, hash, type FlowerKind, type PropKind, type Rect, type Tile, type World } from './world';

type Grid = readonly string[];
type Palette = Record<string, string>;
type Swatch = { hex: string; label: string };

// Shared colours. Keys are single characters used in the grids.
const BASE: Palette = {
  o: '#2b2233', // outline
  w: '#ffffff',
};

// Palettes people pick from in the Design panel. Their lengths are mirrored
// by the *Count constants in the backend's internal/database/maplooks.go.
export const VEHICLE_COLORS: Swatch[] = [
  { hex: '#e4572e', label: 'Tomato' },
  { hex: '#29b6a8', label: 'Teal' },
  { hex: '#5b7fde', label: 'Blue' },
  { hex: '#f2a541', label: 'Orange' },
  { hex: '#9b5de5', label: 'Purple' },
  { hex: '#3fa34d', label: 'Green' },
  { hex: '#e5487a', label: 'Pink' },
  { hex: '#2f9bd6', label: 'Sky' },
];


/** Fur colours for pets: Natural keeps the sprite's own colours, the rest
 * are main/shade/deep ramps swapped in for the coat's fur tones. */
export const PET_COLORS: (Swatch & { ramp: readonly [string, string, string] | null })[] = [
  { hex: '#ffffff', label: 'Natural', ramp: null },
  { hex: '#e8843c', label: 'Ginger', ramp: ['#e8843c', '#b35f1d', '#7a3c14'] },
  { hex: '#9a6238', label: 'Brown', ramp: ['#9a6238', '#6b4423', '#3f2716'] },
  { hex: '#e3b863', label: 'Golden', ramp: ['#e3b863', '#b5813a', '#7c5524'] },
  { hex: '#f0dfb8', label: 'Cream', ramp: ['#f0dfb8', '#c9b48a', '#8f7a58'] },
  { hex: '#9aa0aa', label: 'Grey', ramp: ['#9aa0aa', '#6b707a', '#454a54'] },
  { hex: '#3a3340', label: 'Black', ramp: ['#3a3340', '#26212b', '#15121a'] },
  { hex: '#f6f3ee', label: 'White', ramp: ['#f6f3ee', '#cfc8bd', '#9c948a'] },
];

/** Pet coats: one craftpix sheet each (src/assets/map/pets/N/N.png). fur
 * lists the sheet's fur colours, lightest first; each maps onto the same
 * step of a PET_COLORS ramp. */
type PetCoat = { value: number; label: string; file: string; fur: readonly string[] };
export const PET_COATS: Record<Exclude<Pet, ''>, PetCoat[]> = {
  dog: [
    { value: 0, label: 'Corgi', file: 'pets/1/1.png', fur: ['#ff8142', '#a36d3e'] },
    { value: 1, label: 'Patched', file: 'pets/2/2.png', fur: ['#a36d3e', '#683c34', '#341e1a'] },
  ],
  cat: [
    { value: 0, label: 'Light', file: 'pets/3/3.png', fur: ['#cce2e1', '#8babbf', '#566a89'] },
    { value: 1, label: 'Dark', file: 'pets/4/4.png', fur: ['#222a5c', '#38002c'] },
  ],
};

export const CAR_STYLES: { value: MapLook['car']['style']; label: string }[] = [
  { value: 'sedan', label: 'Car' },
  { value: 'truck', label: 'Truck' },
];
// ---- Characters ----
// A 48x48 sheet frame is drawn at half size: 24x24 world px, feet on its
// bottom row, so 2x zoom shows every sprite pixel.

const FRAME = SHEET_FRAME / 2;
/** Footprint of a standing character, for labels and hit boxes. */
export const CHAR_W = 16;
export const CHAR_H = 23;

export type Facing = 'up' | 'down' | 'left' | 'right';


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

function pickIndex(length: number, seed: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return (h >>> 0) % length;
}

/** The avatar someone gets until they design their own, derived from their username. */
export function defaultAvatar(username: string): MapLook['avatar'] {
  const pick = (list: readonly number[], salt: number) => list[pickIndex(list.length, username, salt)];
  // Everyday picks only: natural skin, eyes and hair, plain clothes.
  return {
    skin: pick([0, 1, 2, 3], 668265263),
    eyes: pick([0, 1, 2, 3, 6], 2246822519),
    brows: pick([2, 3], 3266489917),
    hair: pick([0, 1, 2, 4, 5, 6, 7, 8, 11, 12, 17, 18, 19, 20], 374761393),
    pants: pick([0, 1, 2], 1103515245),
    outfit: pick([1, 3, 4, 5], 2166136261),
  };
}

/** The look someone gets until they design their own, derived from their username. */
export function defaultLook(username: string): MapLook {
  const color = pickIndex(VEHICLE_COLORS.length, username, 2166136261);
  return {
    avatar: defaultAvatar(username),
    car: { color, style: 'sedan' },
    bike: { color },
    dog: { coat: pickIndex(PET_COATS.dog.length, username, 3266489917), color: 0 },
    cat: { coat: pickIndex(PET_COATS.cat.length, username, 374761393), color: 0 },
  };
}

/** A random avatar for the Design panel's Randomize. Rarely-worn parts are often left off. */
export function randomAvatar(): MapLook['avatar'] {
  const out: MapLook['avatar'] = {};
  for (const part of AVATAR_PARTS) {
    const n = LAYERS[part].length;
    const optional = !REQUIRED_PARTS.has(part);
    const skip = optional && Math.random() < (part === 'hair' || part === 'brows' || part === 'outfit' ? 0.15 : 0.8);
    out[part] = skip ? -1 : Math.floor(Math.random() * n);
  }
  return out;
}

export type AvatarBase = 'masculine' | 'feminine';

/** Hair layers that suit each base (indexes into LAYERS.hair, manifest order). */
const BASE_HAIR: Record<AvatarBase, number[]> = {
  // Short, spiked and curtain.
  masculine: [0, 1, 7, 8, 14, 15, 16, 17, 18, 19, 20, 21],
  // Ponytails, long, messy long and curtain.
  feminine: [2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 17, 18, 19, 20, 21],
};

/** The brows layer matching each hair layer's colour (gray 0, blonde 1, brown 2, black 3, red 4). */
const HAIR_BROW = [1, 4, 0, 1, 4, 2, 3, 2, 3, 3, 4, 2, 3, 3, 3, 1, 3, 3, 3, 4, 1, 0];

/** The beard layer matching each brows layer's colour. */
const BROW_BEARD = [3, 2, 0, 4, 1];

/** A random starting design in a masculine or feminine style, from everyday picks. */
export function baseAvatar(base: AvatarBase): MapLook['avatar'] {
  const pick = (list: readonly number[]) => list[Math.floor(Math.random() * list.length)];
  const hair = pick(BASE_HAIR[base]);
  const brows = HAIR_BROW[hair] ?? 2;
  const out: MapLook['avatar'] = Object.fromEntries(AVATAR_PARTS.map((p) => [p, -1]));
  Object.assign(out, {
    skin: pick([0, 1, 2, 3]),
    eyes: pick([0, 1, 2, 3, 6]),
    pants: pick([0, 1, 2]),
    outfit: pick([1, 3, 4, 5]),
    hair,
    brows,
  });
  if (base === 'masculine' && Math.random() < 0.5) out.beard = BROW_BEARD[brows];
  if (base === 'feminine' && Math.random() < 0.25) out.accessory = 6; // Ruby Necklace
  return out;
}

const resolve = (username: string, look: MapLook | null | undefined) => resolveLook(username, look);

const at = <T>(list: T[], i: number): T => list[i] ?? list[0];

/** Someone's look: what they designed, or their default. Looks saved before
 * avatars came from sprite layers have no avatar and get the default one. */
export function resolveLook(username: string, look: MapLook | null | undefined): MapLook {
  if (!look) return defaultLook(username);
  let out = look;
  if (!look.avatar || look.avatar.skin === undefined) out = { ...out, avatar: defaultAvatar(username) };
  // Pets saved before the sprite sheets had more coats and no colour.
  const pet = (p: MapLook['dog'] | undefined, coats: number) => ({
    coat: p && p.coat >= 0 && p.coat < coats ? p.coat : 0,
    color: p && p.color >= 0 && p.color < PET_COLORS.length ? p.color : 0,
  });
  const dog = pet(out.dog, PET_COATS.dog.length);
  const cat = pet(out.cat, PET_COATS.cat.length);
  if (JSON.stringify([dog, cat]) !== JSON.stringify([out.dog, out.cat])) out = { ...out, dog, cat };
  return out;
}

/** A layer index for part, or -1 when none (or out of range). */
function partIndex(avatar: MapLook['avatar'], part: AvatarPart): number {
  const i = avatar[part] ?? -1;
  if (i >= 0 && i < LAYERS[part].length) return i;
  return REQUIRED_PARTS.has(part) ? 0 : -1;
}

/** The full 144x192 sheet for an avatar: its layers stacked in PSD order.
 * closedEyes swaps the eyes layer for shut lids on the facing-down frames.
 * Undefined until the layer images have loaded. */
export function avatarSheet(avatar: MapLook['avatar'], closedEyes = false): HTMLCanvasElement | undefined {
  const files = [LAYERS.shadow[0]];
  let eyes: (typeof files)[number] | undefined;
  for (const part of AVATAR_PARTS) {
    const i = partIndex(avatar, part);
    if (i < 0) continue;
    files.push(LAYERS[part][i]);
    if (part === 'eyes') eyes = LAYERS[part][i];
  }
  files.sort((a, b) => a.order - b.order);
  const key = `avatar:${files.map((f) => f.order).join('.')}${closedEyes ? ':closed' : ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const images = files.map((f) => img(f.file));
  if (images.some((im) => !im)) return undefined;
  const c = document.createElement('canvas');
  c.width = SHEET_FRAME * 3;
  c.height = SHEET_FRAME * 4;
  const ctx = c.getContext('2d')!;
  files.forEach((f, n) => {
    if (closedEyes && f === eyes) {
      // Lids over the lower half of each eye, still under hair and glasses.
      ctx.fillStyle = '#2b2233';
      for (let col = 0; col < 3; col++) {
        const ox = col * SHEET_FRAME;
        const oy = SHEET_ROWS.down * SHEET_FRAME + (col === 1 ? 24 : 23);
        ctx.fillRect(ox + 17, oy, 3, 2);
        ctx.fillRect(ox + 27, oy, 3, 2);
      }
      return;
    }
    ctx.drawImage(images[n]!, 0, 0);
  });
  cache.set(key, c);
  return c;
}

/** Draw one sheet frame (col 0-2, facing row) at half size with its
 * top-left at (dx, dy), optionally only the top srcH source rows. */
function blitFrame(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLCanvasElement,
  facing: Facing,
  col: number,
  dx: number,
  dy: number,
  srcH = SHEET_FRAME,
) {
  ctx.drawImage(sheet, col * SHEET_FRAME, SHEET_ROWS[facing] * SHEET_FRAME, SHEET_FRAME, srcH, dx, dy, FRAME, srcH / 2);
}

/** Walk cycle column: step, stand, step, stand. Column 1 is standing. */
const walkCol = (t: number) => [0, 1, 2, 1][Math.floor(t * 8) % 4];

/** Draw 2x a small grid sprite, so props and rides keep pace with the characters. */
function blit2(ctx: CanvasRenderingContext2D, c: HTMLCanvasElement, x: number, y: number) {
  ctx.drawImage(c, Math.round(x), Math.round(y), c.width * 2, c.height * 2);
}

export type Pose = 'stand' | 'walk' | 'phone' | 'typing' | 'eating' | 'sleeping';

/**
 * Draw one character with its feet at (x, y). t is seconds, for idle
 * animation. On a bike or in a car they ride it unless they're busy, when
 * it's parked beside them. look null draws the one derived from username.
 */
export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  username: string,
  lookIn: MapLook | null | undefined,
  x: number,
  y: number,
  facing: Facing,
  pose: Pose,
  t: number,
  ride: Ride = 'walk',
): void {
  const l = resolve(username, lookIn);
  if (ride !== 'walk') {
    if (pose === 'stand' || pose === 'walk' || pose === 'phone') {
      drawRiding(ctx, l, x, y, facing, ride, pose === 'walk', t);
      return;
    }
    drawParked(ctx, l, x, y, facing, ride);
  }
  const sheet = avatarSheet(l.avatar);
  if (!sheet) return;
  const left = Math.round(x - FRAME / 2);
  const top = Math.round(y - FRAME + 1);
  const items = { ...BASE, ...ITEM_COLORS };

  if (pose === 'sleeping') {
    // Dozing upright: standing still where they stopped, eyes shut.
    blitFrame(ctx, avatarSheet(l.avatar, true) ?? sheet, facing, 1, left, top);
    return;
  }

  if (pose === 'typing') {
    // Seated behind a desk facing the viewer, head and shoulders over the laptop.
    blitFrame(ctx, sheet, 'down', 1, left, top + 2, 30);
    blit2(ctx, cached('laptop', () => render(LAPTOP, items)), x - 10, y - 15);
    blit2(ctx, cached('desk', () => render(DESK, items)), x - 12, y - 7);
    // Screen flicker.
    const tap = Math.floor(t * 8) % 4;
    ctx.fillStyle = '#7fe3ff';
    ctx.fillRect(Math.round(x - 6 + tap * 2), Math.round(y - 12 + (tap % 2)), 3, 1);
    return;
  }

  if (pose === 'walk' || pose === 'stand') {
    blitFrame(ctx, sheet, facing, pose === 'walk' ? walkCol(t) : 1, left, top);
    return;
  }

  // Standing where they stopped with something in hand: on the left when
  // facing left, held in front (behind the body) when facing away.
  const bob = Math.floor(t * 3) % 2;
  const prop =
    pose === 'eating'
      ? { c: cached('burger', () => render(BURGER, items)), dx: 2, dy: -10 - bob * 2 }
      : pose === 'phone'
        ? { c: cached('phone', () => render(PHONE, items)), dx: 5, dy: -17 }
        : undefined;
  const drawHeld = () => {
    if (!prop) return;
    const px = facing === 'left' ? x - prop.dx - prop.c.width : x + prop.dx;
    ctx.drawImage(prop.c, Math.round(px), Math.round(y + prop.dy));
  };
  if (facing === 'up') drawHeld();
  blitFrame(ctx, sheet, facing, 1, left, top);
  if (facing !== 'up') drawHeld();
  if (pose === 'phone') {
    // Sound waves.
    const phase = (t * 1.5) % 1;
    ctx.strokeStyle = `rgba(255,255,255,${0.9 - phase * 0.8})`;
    ctx.lineWidth = 1;
    for (const r of [3, 6]) {
      ctx.beginPath();
      ctx.arc(Math.round(x + 8), Math.round(y - 14), r + phase * 2, -Math.PI / 3, Math.PI / 3);
      ctx.stroke();
    }
  }
}

// ---- Rides ----

const RIDE_COLORS: Palette = {
  ...BASE,
  w: 'rgba(170, 220, 255, 0.55)', // glass: the driver's head shows through
  y: '#ffe28a', // headlights
  R: '#e5484d', // tail lights
  k: '#2b2233', // tyres
  m: '#b8c2cc', // hubs
};

// Car seen from the side, front on the left. 22x10.
const CAR_SIDE: Grid = [
  '......oooooooooo......',
  '.....owwwwowwwwwo.....',
  '....owwwwwowwwwwwo....',
  '..oooCCCCCCCCCCCCCooo.',
  '.oCCCCCCCCCCCCCCCCCCCo',
  'oyCCCCCCCCCCCCCCCCCCCo',
  'oCCCCCCCCCCCCCCCCCCCRo',
  'oDDDookkooDDDDookkoDDo',
  '....okmmko....okmmko..',
  '.....okko......okko...',
];
// Car from the front (lights 'L' are headlights or tail lights). 14x10.
const CAR_END: Grid = [
  '..oooooooooo..',
  '.owwwwwwwwwwo.',
  '.owwwwwwwwwwo.',
  'oooCCCCCCCCooo',
  'oCCCCCCCCCCCCo',
  'oLLCCCCCCCCLLo',
  'oCCCCCCCCCCCCo',
  'oDDDDDDDDDDDDo',
  'okkooooooookko',
  '.kk........kk.',
];
// Pickup truck from the side: cab on the left, open bed behind. 22x10.
const TRUCK_SIDE: Grid = [
  '....oooooo............',
  '...owwwwwo............',
  '..owwwwwwo............',
  '.ooCCCCCCCooooooooooo.',
  'oyCCCCCCCCCDDDDDDDDDCo',
  'oCCCCCCCCCCCCCCCCCCCCo',
  'oCCCCCCCCCCCCCCCCCCCRo',
  'oDDDookkooDDDDookkoDDo',
  '....okmmko....okmmko..',
  '.....okko......okko...',
];
// Truck from the front: a narrower, taller cab. 14x10.
const TRUCK_END: Grid = [
  '...oooooooo...',
  '..owwwwwwwwo..',
  '..owwwwwwwwo..',
  'oooCCCCCCCCooo',
  'oCCCCCCCCCCCCo',
  'oLLCCCCCCCCLLo',
  'oCCCCCCCCCCCCo',
  'oDDDDDDDDDDDDo',
  'okkooooooookko',
  '.kk........kk.',
];
// Bicycle from the side, front on the left. 14x9.
const BIKE_SIDE: Grid = [
  '.oo.....ooo...',
  '..o......o....',
  '..oFFFFFFo....',
  '..o.F..F.o....',
  '.ooo.FF..ooo..',
  'o...o.o.o...o.',
  'o.o.o...o.o.o.',
  'o...o...o...o.',
  '.ooo.....ooo..',
];
const BIKE_END: Grid = ['oooooo', '..oo..', '..FF..', '..FF..', '..oo..', '..oo..', '..oo..', '..oo..', '..oo..'];

function darken(hex: string, f = 0.75): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) =>
    Math.round(v * f)
      .toString(16)
      .padStart(2, '0');
  return `#${c(n >> 16)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

function vehicle(l: MapLook, ride: Ride, facing: Facing): HTMLCanvasElement {
  const body = at(VEHICLE_COLORS, ride === 'car' ? l.car.color : l.bike.color).hex;
  const palette = { ...RIDE_COLORS, C: body, D: darken(body), F: body, L: facing === 'up' ? '#e5484d' : '#ffe28a' };
  const side = facing === 'left' || facing === 'right';
  const truck = l.car.style === 'truck';
  const grid = ride === 'car' ? (truck ? (side ? TRUCK_SIDE : TRUCK_END) : side ? CAR_SIDE : CAR_END) : side ? BIKE_SIDE : BIKE_END;
  const flip = facing === 'right';
  const model = ride === 'car' ? `car-${l.car.style}` : 'bike';
  return cached(`ride:${model}:${body}:${side ? 'side' : facing}:${flip}`, () => render(grid, palette, flip));
}

/** A character riding with feet at (x, y). Rides are drawn at 2x. */
function drawRiding(ctx: CanvasRenderingContext2D, l: MapLook, x: number, y: number, facing: Facing, ride: Ride, moving: boolean, t: number) {
  const v = vehicle(l, ride, facing);
  const vw = v.width * 2;
  const vh = v.height * 2;
  const vx = Math.round(x - vw / 2);
  const vy = Math.round(y - vh);
  const bump = moving && Math.floor(t * 10) % 2 ? 1 : 0;
  const sheet = avatarSheet(l.avatar);

  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(vx + 2, Math.round(y) - 3, vw - 4, 4);

  if (ride === 'car') {
    // Head and shoulders behind the glass, then the car over them.
    if (sheet) {
      const truck = l.car.style === 'truck';
      const hx = facing === 'left' ? vx + (truck ? 12 : 17) : facing === 'right' ? vx + vw - (truck ? 12 : 17) : x;
      blitFrame(ctx, sheet, facing, 1, Math.round(hx - FRAME / 2), vy - 9 - bump, 34);
    }
    ctx.drawImage(v, vx, vy - bump, vw, vh);
    return;
  }
  // Bike: the rider's legs pedalling, the frame over them.
  if (sheet) blitFrame(ctx, sheet, facing, moving ? walkCol(t) : 1, Math.round(x - FRAME / 2), vy - FRAME + 14);
  ctx.drawImage(v, vx, vy, vw, vh);
}

/** A parked bike or car beside someone who's busy. */
function drawParked(ctx: CanvasRenderingContext2D, l: MapLook, x: number, y: number, facing: Facing, ride: Ride) {
  const v = vehicle(l, ride, facing);
  const px = Math.round(x + 12);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(px + 2, Math.round(y) - 3, v.width * 2 - 4, 3);
  blit2(ctx, v, px, y - v.height * 2);
}

/** Draw a bike or car on its own (no rider) with its wheels at (x, y), for previews. */
export function drawVehicle(ctx: CanvasRenderingContext2D, username: string, look: MapLook | null | undefined, ride: Exclude<Ride, 'walk'>, x: number, y: number, facing: Facing) {
  const v = vehicle(resolve(username, look), ride, facing);
  blit2(ctx, v, x - v.width, y - v.height * 2);
}

// ---- Pets ----

// Sheets are 6x6 grids of 48x48 frames facing right, one animation per row,
// feet on each frame's bottom row. Pets are drawn 1:1, a little coarser
// than the half-size characters, so they read at map zoom.

export type PetAnim = 'idle' | 'sleep' | 'walk' | 'run' | 'sit' | 'speak';
const PET_ROWS: Record<PetAnim, number> = { idle: 0, sleep: 1, walk: 2, run: 3, sit: 4, speak: 5 };
const PET_FPS: Record<PetAnim, number> = { idle: 5, sleep: 3, walk: 10, run: 14, sit: 4, speak: 8 };
const PET_COLS = 6;

const hexRGB = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** The coat's sheet with its fur recoloured, or the sheet itself for
 * Natural. Undefined until the image has loaded. */
function petSheet(coat: PetCoat, colorIndex: number): CanvasImageSource | undefined {
  const src = img(coat.file);
  if (!src) return undefined;
  const ramp = at(PET_COLORS, colorIndex).ramp;
  if (!ramp) return src;
  return cached(`pet:${coat.file}:${colorIndex}`, () => {
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const swap = new Map<number, number[]>();
    coat.fur.forEach((hex, i) => {
      const [r, g, b] = hexRGB(hex);
      swap.set((r << 16) | (g << 8) | b, hexRGB(ramp[Math.min(i, ramp.length - 1)]));
    });
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const to = swap.get((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      if (to) [d[i], d[i + 1], d[i + 2]] = to;
    }
    ctx.putImageData(data, 0, 0);
    return c;
  });
}

/** A pet with its feet at (x, y), styled by its owner's look. The sheets
 * only have side views: facing up or down shows it facing right. */
export function drawPet(
  ctx: CanvasRenderingContext2D,
  pet: Exclude<Pet, ''>,
  owner: string,
  lookIn: MapLook | null | undefined,
  x: number,
  y: number,
  facing: Facing,
  anim: PetAnim,
  t: number,
) {
  const l = resolve(owner, lookIn);
  const style = pet === 'dog' ? l.dog : l.cat;
  const coat = at(PET_COATS[pet], style?.coat ?? 0);
  const sheet = petSheet(coat, style?.color ?? 0);
  if (!sheet) return;
  const col = Math.floor(t * PET_FPS[anim]) % PET_COLS;
  const row = PET_ROWS[anim];
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(Math.round(x) - 8, Math.round(y) - 2, 16, 3);
  const dx = Math.round(x - SHEET_FRAME / 2);
  const dy = Math.round(y - SHEET_FRAME);
  const src = [col * SHEET_FRAME, row * SHEET_FRAME, SHEET_FRAME, SHEET_FRAME] as const;
  if (facing === 'left') {
    ctx.save();
    ctx.translate(dx + SHEET_FRAME, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(sheet, ...src, 0, 0, SHEET_FRAME, SHEET_FRAME);
    ctx.restore();
  } else {
    ctx.drawImage(sheet, ...src, dx, dy, SHEET_FRAME, SHEET_FRAME);
  }
}

// ---- Buildings ----

/** crop: the sprite's opaque bounding box [x0, y0, x1, y1] in sprite px. */
type BuildingStyle = { label: string; file: string; color: string; crop: readonly [number, number, number, number] };

const BUILDING_DIR = 'medieval-village-buildings/PNG/Houses and Warehouses_';

/** Building sprites, indexed by MapBuilding.style. Mirrors MapStyleCount in
 * internal/database/mapworld.go. Each is cropped to its opaque area and scaled
 * to the footprint's width, so higher levels stand taller; color is the minimap swatch. */
export const BUILDING_STYLES: BuildingStyle[] = [
  { label: 'Brick House I', file: `${BUILDING_DIR}Brick House - Level 1.png`, color: '#8a5a44', crop: [20, 24, 282, 394] },
  { label: 'Wooden House I', file: `${BUILDING_DIR}Wooden House - Level 1.png`, color: '#9c6b3f', crop: [20, 30, 281, 382] },
  { label: 'Brick Warehouse I', file: `${BUILDING_DIR}Brick Warehouse - Level 1.png`, color: '#7d4f45', crop: [36, 57, 293, 385] },
  { label: 'Wooden Warehouse I', file: `${BUILDING_DIR}Wooden Warehouse - Level 1.png`, color: '#b0705a', crop: [36, 57, 280, 377] },
  { label: 'Brick House II', file: `${BUILDING_DIR}Brick House - Level 2.png`, color: '#8a5a44', crop: [30, 14, 332, 434] },
  { label: 'Wooden House II', file: `${BUILDING_DIR}Wooden House - Level 2.png`, color: '#9c6b3f', crop: [20, 4, 326, 423] },
  { label: 'Brick Warehouse II', file: `${BUILDING_DIR}Brick Warehouse - Level 2.png`, color: '#7d4f45', crop: [35, 17, 326, 425] },
  { label: 'Wooden Warehouse II', file: `${BUILDING_DIR}Wooden Warehouse - Level 2.png`, color: '#b0705a', crop: [31, 17, 319, 417] },
  { label: 'Brick House III', file: `${BUILDING_DIR}Brick House - Level 3.png`, color: '#8a5a44', crop: [43, 13, 426, 561] },
  { label: 'Wooden House III', file: `${BUILDING_DIR}Wooden House - Level 3.png`, color: '#9c6b3f', crop: [43, 19, 426, 575] },
  { label: 'Brick Warehouse III', file: `${BUILDING_DIR}Brick Warehouse - Level 3.png`, color: '#7d4f45', crop: [6, 86, 429, 568] },
  { label: 'Wooden Warehouse III', file: `${BUILDING_DIR}Wooden Warehouse - Level 3.png`, color: '#b0705a', crop: [6, 95, 425, 557] },
  { label: 'Brick House IV', file: `${BUILDING_DIR}Brick House - Level 4.png`, color: '#8a5a44', crop: [8, 31, 592, 621] },
  { label: 'Wooden House IV', file: `${BUILDING_DIR}Wooden House - Level 4.png`, color: '#9c6b3f', crop: [8, 31, 592, 635] },
  { label: 'Brick Warehouse IV', file: `${BUILDING_DIR}Brick Warehouse - Level 4.png`, color: '#7d4f45', crop: [45, 13, 621, 628] },
  { label: 'Wooden Warehouse IV', file: `${BUILDING_DIR}Wooden Warehouse - Level 4.png`, color: '#b0705a', crop: [45, 13, 621, 617] },
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

/** Procedural stand-in while the building sprites load. */
function drawBuildingFallback(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  const bx = x + 4;
  const bw = w - 8;
  const wallTop = y + 22;
  const wallH = h - 24;
  ctx.fillStyle = '#2b2233';
  ctx.fillRect(bx - 1, wallTop - 1, bw + 2, wallH + 2);
  ctx.fillStyle = '#d8cdb4';
  ctx.fillRect(bx, wallTop, bw, wallH);
  ctx.fillStyle = '#2b2233';
  ctx.fillRect(bx - 4, wallTop - 5, bw + 8, 5);
  ctx.fillStyle = color;
  ctx.fillRect(bx - 3, wallTop - 4, bw + 6, 3);
}

/** A school/office whose footprint's top-left tile is (tx, ty). glow (0..1) lights it up. */
export function drawBuilding(ctx: CanvasRenderingContext2D, tx: number, ty: number, style: number, glow: number, t: number) {
  const s = BUILDING_STYLES[style % BUILDING_STYLES.length];
  const { x, y, w, h } = px({ x: tx, y: ty, w: BUILDING_SIZE, h: BUILDING_SIZE });
  const im = img(s.file);

  // Sprite bounds: the opaque area spans the footprint's width, sits on its
  // bottom edge, and may rise above it.
  const sx = x;
  const sw = w;
  let sy = y;
  let sh = h;
  if (im) {
    const [x0, y0, x1, y1] = s.crop;
    const cw = x1 - x0;
    const ch = y1 - y0;
    sh = Math.round((ch * w) / cw);
    sy = y + h - sh;
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(im, x0, y0, cw, ch, sx, sy, sw, sh);
    ctx.imageSmoothingEnabled = smooth;
  } else {
    drawBuildingFallback(ctx, x, y, w, h, s.color);
  }

  if (glow > 0) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 12);
    ctx.strokeStyle = `rgba(255, 220, 90, ${glow * (0.5 + 0.5 * pulse)})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(sx - 3, sy - 3, sw + 6, sh + 5);
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


// ---- Image art (src/assets/map) ----

const trims = new Map<string, HTMLCanvasElement | null>();

/** An image cropped to its opaque pixels, cached. Undefined until loaded. */
function trimmed(path: string): HTMLCanvasElement | undefined {
  const hit = trims.get(path);
  if (hit) return hit;
  const im = img(path);
  if (!im) return undefined;
  const c = document.createElement('canvas');
  c.width = im.width;
  c.height = im.height;
  const cx = c.getContext('2d', { willReadFrequently: true })!;
  cx.drawImage(im, 0, 0);
  const { data } = cx.getImageData(0, 0, c.width, c.height);
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (data[(y * c.width + x) * 4 + 3] === 0) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  const out = document.createElement('canvas');
  out.width = Math.max(1, x1 - x0 + 1);
  out.height = Math.max(1, y1 - y0 + 1);
  if (x1 >= 0) out.getContext('2d')!.drawImage(im, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  trims.set(path, out);
  return out;
}

/** Draw an image's opaque part, bottom-centred on (cx, bottom). Grasslands
 * art is twice the world's density, so it's drawn at half size. */
function art(ctx: CanvasRenderingContext2D, path: string, cx: number, bottom: number, scale = 0.5): boolean {
  const c = trimmed(path);
  if (!c) return false;
  const w = Math.round(c.width * scale);
  const h = Math.round(c.height * scale);
  ctx.drawImage(c, Math.round(cx - w / 2), Math.round(bottom - h), w, h);
  return true;
}

/** Tile index i of a 16px tileset image (cols wide), drawn at (dx, dy). */
function tileFrom(ctx: CanvasRenderingContext2D, path: string, i: number, dx: number, dy: number): boolean {
  const im = img(path);
  if (!im) return false;
  const cols = im.width / TILE;
  ctx.drawImage(im, (i % cols) * TILE, Math.floor(i / cols) * TILE, TILE, TILE, dx, dy, TILE, TILE);
  return true;
}

const GRASS = 'grasslands/';
const pickOf = <T>(list: readonly T[], tx: number, ty: number, salt: number): T => list[Math.floor(hash(tx, ty, salt) * list.length) % list.length];

// Library furniture in office/Interior_objects.png, at the world's density.
// Long pieces are sliced: a left cap, a middle and a right cap, each 16px
// wide, joined up with neighbours of the same kind.
type Slices = { y: number; h: number; left: number; mids: number[]; right: number };
const SLICED: Partial<Record<PropKind, Slices>> = {
  desk: { y: 23, h: 25, left: 238, mids: [254, 258], right: 274 },
  table: { y: 25, h: 23, left: 558, mids: [574], right: 594 },
  couch: { y: 359, h: 19, left: 557, mids: [573], right: 594 },
  bookshelf: { y: 84, h: 50, left: 4, mids: [20, 36, 52, 68], right: 85 },
  rug: { y: 341, h: 22, left: 426, mids: [442, 458, 474, 490], right: 527 },
};
// Single pieces: source rect, drawn bottom-centred on the tile.
const PIECES: Partial<Record<PropKind, [number, number, number, number]>> = {
  chair: [165, 254, 13, 19],
  plant: [139, 337, 17, 37],
  globe: [11, 349, 25, 28],
};
const INTERIOR = 'office/Interior_objects.png';

function drawSliced(ctx: CanvasRenderingContext2D, s: Slices, tx: number, ty: number, same: (dx: number) => boolean, flat: boolean): boolean {
  const im = img(INTERIOR);
  if (!im) return false;
  const x = tx * TILE;
  const bottom = flat ? ty * TILE + TILE / 2 + s.h / 2 : (ty + 1) * TILE + 2;
  const top = Math.round(bottom - s.h);
  const mid = pickOf(s.mids, tx, ty, 41);
  // Each half of the tile is a cap where there's no neighbour, else middle.
  const lx = same(-1) ? mid : s.left;
  const rx = same(1) ? mid + 8 : s.right + 8;
  ctx.drawImage(im, lx, s.y, 8, s.h, x, top, 8, s.h);
  ctx.drawImage(im, rx, s.y, 8, s.h, x + 8, top, 8, s.h);
  return true;
}

// Flower beds in flowers/Flowers.png: source rects [x, y, w, h] per family,
// biggest first. The sheet isn't a strict grid, so each sprite is listed.
type SrcRect = readonly [number, number, number, number];
const FLOWER_SHEET = 'flowers/Flowers.png';
const FLOWER_BEDS: Record<FlowerKind, readonly SrcRect[]> = {
  bluebells: [[7, 6, 19, 20], [40, 7, 16, 19], [73, 9, 13, 13]],
  lilies: [[102, 2, 20, 30], [136, 5, 18, 24], [169, 7, 14, 20]],
  alliums: [[197, 4, 25, 43], [231, 4, 19, 27], [265, 7, 14, 22]],
  starflowers: [[4, 32, 25, 32], [38, 35, 20, 29], [74, 41, 14, 20]],
  poppies: [[100, 34, 23, 30], [136, 39, 14, 21], [172, 41, 12, 17]],
  phlox: [[3, 64, 26, 32], [39, 67, 19, 26], [71, 72, 17, 17]],
  tulips: [[101, 71, 21, 19], [136, 72, 17, 15], [129, 97, 13, 13]],
  daisies: [[169, 70, 15, 18], [195, 64, 11, 16], [212, 65, 9, 15], [194, 81, 13, 15], [212, 81, 10, 14]],
  irises: [[231, 52, 19, 38], [257, 56, 14, 33], [275, 51, 13, 28]],
  violets: [[241, 33, 13, 13], [259, 35, 10, 10], [275, 36, 9, 8], [193, 96, 14, 16], [209, 99, 14, 12], [228, 99, 8, 11]],
  buttercups: [[0, 101, 16, 23], [19, 104, 11, 17], [35, 97, 9, 15]],
  heather: [[35, 113, 11, 15], [48, 103, 16, 20], [66, 103, 13, 19]],
  lavender: [[81, 104, 14, 19], [98, 96, 13, 16], [115, 98, 10, 13]],
  forgetmenots: [[146, 97, 13, 14], [163, 98, 12, 12], [180, 99, 8, 11]],
};
/** Little flowers for scattering: wildflowers, pots and flower tiles. */
const SMALL_FLOWERS: readonly SrcRect[] = Object.values(FLOWER_BEDS).flat().filter((r) => r[3] <= 16);
/** Petal colours per family, for the procedural fallback. */
const FLOWER_COLORS: Record<FlowerKind, string> = {
  bluebells: '#5b7be0', lilies: '#e8807a', alliums: '#e45c9a', starflowers: '#d8333f', poppies: '#f08a2c',
  phlox: '#c040e0', tulips: '#d06a2a', daisies: '#e8f0ff', irises: '#3a6ad8', violets: '#7a3ac0',
  buttercups: '#ffd23f', heather: '#9a4a7a', lavender: '#5ab8e8', forgetmenots: '#4ab0f0',
};

/** Draw a sprite from the flower sheet, bottom-centred on (cx, bottom). */
function flowerArt(ctx: CanvasRenderingContext2D, [sx, sy, sw, sh]: SrcRect, cx: number, bottom: number, scale = 0.5): boolean {
  const im = img(FLOWER_SHEET);
  if (!im) return false;
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  ctx.drawImage(im, sx, sy, sw, sh, Math.round(cx - w / 2), Math.round(bottom - h), w, h);
  return true;
}

const isFlower = (kind: PropKind): kind is FlowerKind => kind in FLOWER_BEDS;

/** Library and grasslands art for a prop, when it has some. */
function drawPropArt(ctx: CanvasRenderingContext2D, kind: PropKind, tx: number, ty: number, same: (dx: number) => boolean): boolean {
  const cx = tx * TILE + TILE / 2;
  const bottom = (ty + 1) * TILE;
  const slices = SLICED[kind];
  if (slices) return drawSliced(ctx, slices, tx, ty, same, kind === 'rug');
  if (isFlower(kind)) {
    const jitter = Math.floor(hash(tx, ty, 8) * 5) - 2;
    return flowerArt(ctx, pickOf(FLOWER_BEDS[kind], tx, ty, 7), cx + jitter, bottom + 1);
  }
  const piece = PIECES[kind];
  if (piece) {
    const im = img(INTERIOR);
    if (!im) return false;
    const [sx, sy, w, h] = piece;
    ctx.drawImage(im, sx, sy, w, h, Math.round(cx - w / 2), bottom - h + 1, w, h);
    return true;
  }
  switch (kind) {
    case 'tree':
      return art(ctx, GRASS + pickOf(['Tree1.png', 'Tree2.png'], tx, ty, 7), cx, bottom + 2);
    case 'fruittree':
      return art(ctx, GRASS + pickOf(['Tree3.png', 'Tree4.png'], tx, ty, 7), cx, bottom + 2);
    case 'bush':
      return art(ctx, GRASS + pickOf(['Bush1.png', 'Bush2.png', 'Bush3.png', 'Bush4.png', 'Bush5.png', 'Bush6.png', 'Bush14.png', 'Bush17.png'], tx, ty, 7), cx, bottom + 1);
    case 'rock':
      return art(ctx, GRASS + pickOf(['Stone3_grass_shadow.png', 'Stone4_grass_shadow.png', 'Stone2_grass_shadow.png'], tx, ty, 7), cx, bottom + 1);
    case 'boulder':
      return art(ctx, GRASS + pickOf(['Rpck_grass1.png', 'Rpck_grass2.png', 'Rpck_grass3.png', 'Rpck_grass4.png', 'Stone1_grass_shadow.png'], tx, ty, 7), cx, bottom + 2);
    case 'stump':
      return art(ctx, GRASS + pickOf(['Broken_tree1.png', 'Broken_tree2.png', 'Broken_tree4.png', 'Broken_tree5.png'], tx, ty, 7), cx, bottom + 1);
    case 'ruin':
      return art(ctx, GRASS + pickOf(['Ruin1_grass_shadow.png', 'Ruin2_grass_shadow.png', 'Ruin3_grass_shadow.png', 'Ruin4_grass_shadow.png'], tx, ty, 7), cx, bottom + 3);
    case 'wildflowers': {
      let ok = true;
      for (let i = 0; i < 3; i++) {
        const f = pickOf(SMALL_FLOWERS, tx, ty, 50 + i);
        ok = flowerArt(ctx, f, tx * TILE + 3 + i * 5, ty * TILE + 8 + (i % 2) * 6) && ok;
      }
      return ok;
    }
  }
  return false;
}

// Office floors and walls from the library tilesets.
const FLOOR2 = 'office/Walls_floor2.png';
const WALLS = 'office/Walls_main.png';
const WOOD_TILES = [73, 74, 75, 76, 77, 86, 87, 88, 89, 90, 99, 100, 101, 102, 103];

/** Library tile art for an office tile, when it has some. */
function paintOfficeTile(ctx: CanvasRenderingContext2D, tile: Tile, tx: number, ty: number): boolean {
  const x = tx * TILE;
  const y = ty * TILE;
  switch (tile) {
    case 'wood':
      return tileFrom(ctx, FLOOR2, pickOf(WOOD_TILES, tx, ty, 3), x, y);
    case 'tilefloor':
      return tileFrom(ctx, FLOOR2, 63, x, y);
    case 'carpet': {
      const im = img(INTERIOR);
      if (!im) return false;
      ctx.drawImage(im, 556 + (tx % 2) * 8, 124 + (ty % 3) * 16, TILE, TILE, x, y, TILE, TILE);
      return true;
    }
    case 'wall': {
      // The top two rows are the back wall's brick face; the rest of the
      // walls are seen from above, as their top edge.
      if (ty <= 1) return tileFrom(ctx, WALLS, pickOf(ty === 0 ? [22, 23, 24, 25, 26] : [29, 30, 31, 32, 33], tx, ty, 3), x, y);
      return tileFrom(ctx, WALLS, 16, x, y);
    }
  }
  return false;
}

/** Grass tufts and pebbles from the grasslands pack, sprinkled on the ground. */
function paintDecal(ctx: CanvasRenderingContext2D, tile: Tile, tx: number, ty: number) {
  const r = hash(tx, ty, 61);
  const cx = tx * TILE + 4 + Math.floor(hash(tx, ty, 62) * 8);
  const bottom = ty * TILE + 6 + Math.floor(hash(tx, ty, 63) * 9);
  if ((tile === 'grass' && r < 0.08) || (tile === 'flowers' && r < 0.04)) {
    art(ctx, GRASS + pickOf(['grass_element1.png', 'grass_element2.png', 'grass_element3.png', 'Bush9.png', 'Bush16.png', 'Bush19.png', 'Rock_grass_element12.png', 'Rock_grass_element14.png'], tx, ty, 64), cx, bottom);
  } else if ((tile === 'path' || tile === 'sand' || tile === 'lot') && r < 0.05) {
    art(ctx, GRASS + pickOf(['ground_element22.png', 'ground_element23.png', 'ground_element24.png', 'ground_element21.png'], tx, ty, 64), cx, bottom);
  }
}

// ---- Trees and decorations ----

export function drawTree(ctx: CanvasRenderingContext2D, tx: number, ty: number) {
  if (drawPropArt(ctx, 'tree', tx, ty, () => false)) return;
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

/** Labels and colours for the Create palette. */
export const PROP_INFO: Record<PropKind, { label: string; emoji: string }> = {
  tree: { label: 'Tree', emoji: '🌳' },
  pine: { label: 'Pine', emoji: '🌲' },
  bush: { label: 'Bush', emoji: '🌿' },
  rock: { label: 'Rock', emoji: '🪨' },
  flowerpot: { label: 'Flowers', emoji: '🌷' },
  bench: { label: 'Bench', emoji: '🪑' },
  lamp: { label: 'Lamp', emoji: '💡' },
  fountain: { label: 'Fountain', emoji: '⛲' },
  fence: { label: 'Fence', emoji: '🚧' },
  sign: { label: 'Sign', emoji: '🪧' },
  desk: { label: 'Desk', emoji: '🖥️' },
  table: { label: 'Table', emoji: '🟫' },
  chair: { label: 'Chair', emoji: '🪑' },
  plant: { label: 'Plant', emoji: '🪴' },
  couch: { label: 'Couch', emoji: '🛋️' },
  whiteboard: { label: 'Whiteboard', emoji: '📋' },
  watercooler: { label: 'Water cooler', emoji: '🚰' },
  coffee: { label: 'Coffee', emoji: '☕' },
  printer: { label: 'Printer', emoji: '🖨️' },
  bookshelf: { label: 'Bookshelf', emoji: '📚' },
  fruittree: { label: 'Fruit tree', emoji: '🍎' },
  stump: { label: 'Stump', emoji: '🪵' },
  boulder: { label: 'Boulder', emoji: '⛰️' },
  ruin: { label: 'Ruin', emoji: '🏛️' },
  wildflowers: { label: 'Wildflowers', emoji: '🌼' },
  bluebells: { label: 'Bluebells', emoji: '🔵' },
  lilies: { label: 'Lilies', emoji: '🌸' },
  alliums: { label: 'Alliums', emoji: '🎀' },
  starflowers: { label: 'Star flowers', emoji: '🌺' },
  poppies: { label: 'Poppies', emoji: '🏵️' },
  phlox: { label: 'Phlox', emoji: '💮' },
  tulips: { label: 'Tulips', emoji: '🌷' },
  daisies: { label: 'Daisies', emoji: '🤍' },
  irises: { label: 'Irises', emoji: '💙' },
  violets: { label: 'Violets', emoji: '🪻' },
  buttercups: { label: 'Buttercups', emoji: '🌼' },
  heather: { label: 'Heather', emoji: '🍂' },
  lavender: { label: 'Lavender', emoji: '🌾' },
  forgetmenots: { label: 'Forget-me-nots', emoji: '🫐' },
  globe: { label: 'Globe', emoji: '🌍' },
  rug: { label: 'Rug', emoji: '🟥' },
};

/** A decoration standing on tile (tx, ty). */
export function drawProp(ctx: CanvasRenderingContext2D, kind: PropKind, tx: number, ty: number, t: number, same: (dx: number) => boolean = () => false) {
  if (drawPropArt(ctx, kind, tx, ty, same)) return;
  const x = tx * TILE;
  const y = ty * TILE;
  const O = '#2b2233';
  const rect = (c: string, rx: number, ry: number, w: number, h: number) => {
    ctx.fillStyle = c;
    ctx.fillRect(x + rx, y + ry, w, h);
  };
  if (isFlower(kind)) {
    rect(O, 7, 6, 2, 9);
    rect('#3c8d40', 7, 7, 2, 7);
    rect(O, 4, 3, 8, 5);
    rect(FLOWER_COLORS[kind], 5, 4, 6, 3);
    return;
  }
  switch (kind) {
    case 'tree':
      drawTree(ctx, tx, ty);
      return;
    case 'pine':
      rect('rgba(0,0,0,0.2)', 3, 12, 10, 3);
      rect(O, 6, 8, 4, 7);
      rect('#7a4e2d', 7, 8, 2, 6);
      for (let i = 0; i < 4; i++) {
        const w = 6 + i * 3;
        rect(O, 8 - w / 2 - 1, -14 + i * 6, w + 2, 7);
        rect(i % 2 ? '#2f6e3a' : '#3c8d4a', 8 - w / 2, -13 + i * 6, w, 5);
      }
      return;
    case 'bush':
      rect('rgba(0,0,0,0.18)', 2, 13, 12, 2);
      rect(O, 1, 5, 14, 10);
      rect(O, 3, 3, 10, 2);
      rect('#4caf50', 2, 6, 12, 8);
      rect('#4caf50', 4, 4, 8, 2);
      rect('#7ed36f', 4, 5, 4, 3);
      return;
    case 'rock':
      rect('rgba(0,0,0,0.18)', 2, 13, 12, 2);
      rect(O, 2, 6, 12, 9);
      rect(O, 4, 4, 7, 2);
      rect('#9aa0aa', 3, 7, 10, 7);
      rect('#9aa0aa', 5, 5, 5, 2);
      rect('#c4c9d1', 5, 6, 3, 2);
      return;
    case 'flowerpot': {
      rect(O, 4, 9, 8, 6);
      rect('#c8644b', 5, 10, 6, 4);
      if (flowerArt(ctx, pickOf(SMALL_FLOWERS, tx, ty, 9), x + TILE / 2, y + 10)) return;
      rect('#3c8d40', 7, 4, 2, 6);
      const colors = ['#ff6b8b', '#ffd23f', '#b38cff'];
      colors.forEach((c, i) => rect(c, 3 + i * 4, 2 + (i % 2) * 2, 3, 3));
      return;
    }
    case 'bench':
      rect('rgba(0,0,0,0.18)', 1, 13, 14, 2);
      rect(O, 0, 4, 16, 4);
      rect('#a0703f', 1, 5, 14, 2);
      rect(O, 0, 8, 16, 3);
      rect('#c08a52', 1, 9, 14, 1);
      rect(O, 2, 11, 2, 4);
      rect(O, 12, 11, 2, 4);
      return;
    case 'lamp': {
      rect('rgba(0,0,0,0.2)', 4, 13, 8, 2);
      rect(O, 7, -10, 2, 25);
      rect(O, 4, -14, 8, 6);
      const on = 0.75 + 0.25 * Math.sin(t * 3);
      rect(`rgba(255, 226, 138, ${on})`, 5, -13, 6, 4);
      return;
    }
    case 'fountain': {
      rect('rgba(0,0,0,0.2)', 0, 12, 16, 3);
      rect(O, 0, 6, 16, 9);
      rect('#c4ccd6', 1, 7, 14, 7);
      rect('#4aa3df', 2, 8, 12, 4);
      rect(O, 7, 0, 2, 8);
      const p = Math.floor(t * 6) % 3;
      ctx.fillStyle = 'rgba(200, 235, 255, 0.9)';
      ctx.fillRect(x + 6 - p, y - 2 + p, 1, 2);
      ctx.fillRect(x + 9 + p, y - 2 + p, 1, 2);
      ctx.fillRect(x + 7, y - 3, 2, 2);
      return;
    }
    case 'fence':
      rect(O, 0, 5, 16, 2);
      rect(O, 0, 9, 16, 2);
      rect('#e9e2cf', 0, 6, 16, 1);
      rect('#e9e2cf', 0, 10, 16, 1);
      for (const fx of [1, 7, 13]) {
        rect(O, fx, 2, 3, 13);
        rect('#f4efe0', fx + 1, 3, 1, 11);
      }
      return;
    case 'sign':
      rect('rgba(0,0,0,0.18)', 5, 13, 6, 2);
      rect(O, 7, 4, 2, 11);
      rect(O, 1, -2, 14, 8);
      rect('#d9b97c', 2, -1, 12, 6);
      rect('#7a4e2d', 4, 1, 8, 1);
      rect('#7a4e2d', 4, 3, 5, 1);
      return;
    case 'desk': {
      // Desktop with a monitor; legs below. The screen flickers now and then.
      rect('rgba(0,0,0,0.2)', 0, 13, 16, 3);
      rect(O, 0, 3, 16, 9);
      rect('#c08a52', 1, 4, 14, 4);
      rect('#a0703f', 1, 8, 14, 3);
      rect(O, 1, 11, 2, 4);
      rect(O, 13, 11, 2, 4);
      rect(O, 4, -6, 9, 8);
      const glow = hash(tx, ty, Math.floor(t * 2)) < 0.15 ? '#a8e6ff' : '#6fc3e8';
      rect(glow, 5, -5, 7, 5);
      rect(O, 8, 2, 1, 2);
      rect('#e8edf2', 5, 5, 5, 2); // keyboard
      return;
    }
    case 'table':
      rect('rgba(0,0,0,0.2)', 0, 13, 16, 3);
      rect(O, 0, 3, 16, 9);
      rect('#e8d6b5', 1, 4, 14, 5);
      rect('#cdb892', 1, 9, 14, 2);
      rect(O, 1, 11, 2, 4);
      rect(O, 13, 11, 2, 4);
      return;
    case 'chair':
      rect('rgba(0,0,0,0.2)', 4, 13, 8, 2);
      rect(O, 4, 2, 8, 6);
      rect('#3f4a6b', 5, 3, 6, 4);
      rect(O, 3, 7, 10, 4);
      rect('#4f5d85', 4, 8, 8, 2);
      rect(O, 7, 11, 2, 3);
      rect(O, 4, 13, 8, 1);
      return;
    case 'plant':
      rect('rgba(0,0,0,0.2)', 3, 13, 10, 2);
      rect(O, 4, 8, 8, 7);
      rect('#d9d2c3', 5, 9, 6, 5);
      rect(O, 2, -4, 12, 13);
      rect('#3c8d40', 3, -3, 10, 11);
      rect('#5bbf4a', 4, -2, 3, 4);
      rect('#5bbf4a', 9, 1, 3, 3);
      return;
    case 'couch':
      rect('rgba(0,0,0,0.2)', 0, 13, 16, 3);
      rect(O, 0, 0, 16, 14);
      rect('#9b5de5', 1, 1, 14, 6);
      rect('#b07ef0', 1, 7, 14, 5);
      rect('#7d45c4', 1, 12, 14, 1);
      return;
    case 'whiteboard':
      rect(O, 0, -12, 16, 14);
      rect('#f7f9fb', 1, -11, 14, 11);
      rect('#5b7fde', 3, -9, 7, 1);
      rect('#e5484d', 3, -6, 9, 1);
      rect('#3fa34d', 3, -3, 5, 1);
      rect('#9aa0aa', 1, 0, 14, 2);
      rect(O, 3, 2, 2, 12);
      rect(O, 11, 2, 2, 12);
      return;
    case 'watercooler':
      rect('rgba(0,0,0,0.2)', 3, 13, 10, 2);
      rect(O, 3, 3, 10, 12);
      rect('#e8edf2', 4, 4, 8, 10);
      rect('#5b7fde', 6, 7, 1, 1);
      rect('#e5484d', 9, 7, 1, 1);
      rect(O, 4, -8, 8, 12);
      rect('#8fd3e8', 5, -7, 6, 10);
      rect('#c9eefa', 6, -6, 2, 6);
      return;
    case 'coffee': {
      rect('rgba(0,0,0,0.2)', 1, 13, 14, 2);
      rect(O, 1, 4, 14, 11);
      rect('#a0703f', 2, 5, 12, 9);
      rect(O, 4, -6, 8, 11);
      rect('#5c5f6b', 5, -5, 6, 9);
      rect('#e5484d', 6, -4, 1, 1);
      rect('#f7f9fb', 7, 2, 3, 3);
      const steam = Math.floor(t * 3) % 2;
      rect('rgba(255,255,255,0.7)', 8 + steam, -1, 1, 2);
      return;
    }
    case 'printer':
      rect('rgba(0,0,0,0.2)', 0, 13, 16, 3);
      rect(O, 0, 3, 16, 12);
      rect('#c4ccd6', 1, 4, 14, 10);
      rect('#9aa0aa', 1, 9, 14, 1);
      rect('#f7f9fb', 4, 1, 8, 4);
      rect(O, 3, 6, 10, 1);
      rect('#3fbf5f', 12, 11, 2, 1);
      return;
    case 'bookshelf': {
      rect('rgba(0,0,0,0.2)', 0, 13, 16, 3);
      rect(O, 0, -12, 16, 27);
      rect('#7a4e2d', 1, -11, 14, 25);
      const books = ['#e5484d', '#5b7fde', '#f2a541', '#3fa34d', '#9b5de5', '#29b6a8'];
      for (let shelf = 0; shelf < 3; shelf++) {
        const sy = -10 + shelf * 8;
        rect(O, 1, sy + 6, 14, 1);
        for (let i = 0; i < 6; i++) {
          rect(books[Math.floor(hash(tx * 7 + i, ty + shelf, 3) * books.length)], 2 + i * 2, sy + (i % 3 === 0 ? 1 : 0), 2, 6 - (i % 3 === 0 ? 1 : 0));
        }
      }
      return;
    }
  }
}

// ---- Ground ----

export const GROUND: Record<Tile, { label: string; colors: [string, string] }> = {
  grass: { label: 'Grass', colors: ['#7cc36a', '#6db35c'] },
  flowers: { label: 'Flowers', colors: ['#7cc36a', '#6db35c'] },
  road: { label: 'Road', colors: ['#5c5f6b', '#55585f'] },
  path: { label: 'Path', colors: ['#d8c39a', '#c8b086'] },
  plaza: { label: 'Plaza', colors: ['#d7d2c8', '#c7c0b3'] },
  sand: { label: 'Sand', colors: ['#ecdcab', '#ddc98f'] },
  water: { label: 'Water', colors: ['#4aa3df', '#3d8fc8'] },
  lot: { label: 'Lot', colors: ['#c9b27e', '#b9a06c'] },
  carpet: { label: 'Carpet', colors: ['#5d6b8a', '#56637f'] },
  wood: { label: 'Wood floor', colors: ['#b98a5a', '#a87b4e'] },
  tilefloor: { label: 'Tile floor', colors: ['#dfe3e8', '#cfd4db'] },
  wall: { label: 'Wall', colors: ['#3d3548', '#3d3548'] },
  exit: { label: 'Exit', colors: ['#7a3b3b', '#6a3232'] },
};

/** A canvas holding the whole map's ground. Repaint parts with paintGround. */
export function renderGround(world: World): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = world.w;
  c.height = world.h;
  paintGround(c, world, 0, 0, world.cols - 1, world.rows - 1);
  return c;
}

/** Repaint the ground tiles from (x0, y0) to (x1, y1) inclusive. */
export function paintGround(c: HTMLCanvasElement, world: World, x0: number, y0: number, x1: number, y1: number) {
  const ctx = c.getContext('2d')!;
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(world.cols - 1, x1);
  y1 = Math.min(world.rows - 1, y1);
  const at = (x: number, y: number) => world.tile(x, y);

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const tile = at(tx, ty)!;
      const [base, alt] = GROUND[tile].colors;
      const x = tx * TILE;
      const y = ty * TILE;
      ctx.fillStyle = base;
      ctx.fillRect(x, y, TILE, TILE);
      if (paintOfficeTile(ctx, tile, tx, ty)) continue;
      ctx.fillStyle = alt;
      for (let i = 0; i < 6; i++) {
        const sx = Math.floor(hash(tx, ty, i) * 15);
        const sy = Math.floor(hash(ty, tx, i + 11) * 15);
        ctx.fillRect(x + sx, y + sy, tile === 'grass' || tile === 'flowers' ? 1 : 2, tile === 'grass' ? 2 : 1);
      }
      if (tile === 'flowers' && img(FLOWER_SHEET)) {
        for (let i = 0; i < 2; i++) {
          flowerArt(ctx, pickOf(SMALL_FLOWERS, tx, ty, 20 + i), x + 4 + Math.floor(hash(tx, ty, 30 + i) * 8), y + 6 + Math.floor(hash(tx, ty, 40 + i) * 9));
        }
      } else if (tile === 'flowers') {
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

      if (tile === 'road') {
        // Dashed centre lines on two-wide roads, not across junctions.
        const road = (dx: number, dy: number) => at(tx + dx, ty + dy) === 'road';
        ctx.fillStyle = '#e8d36a';
        if (road(0, -1) && !road(0, -2) && !road(0, 1) && tx % 2 === 0) ctx.fillRect(x + 3, y - 1, 10, 2);
        if (road(-1, 0) && !road(-2, 0) && !road(1, 0) && ty % 2 === 0) ctx.fillRect(x - 1, y + 3, 2, 10);
      }
      if (tile === 'water') {
        // Banks where water meets land.
        ctx.fillStyle = '#2b2233';
        const land = (dx: number, dy: number) => {
          const n = at(tx + dx, ty + dy);
          return n !== undefined && n !== 'water';
        };
        if (land(0, -1)) {
          ctx.fillRect(x, y, TILE, 2);
          ctx.fillStyle = '#c9e7f7';
          ctx.fillRect(x, y + 2, TILE, 2);
          ctx.fillStyle = '#2b2233';
        }
        if (land(0, 1)) ctx.fillRect(x, y + TILE - 2, TILE, 2);
        if (land(-1, 0)) ctx.fillRect(x, y, 2, TILE);
        if (land(1, 0)) ctx.fillRect(x + TILE - 2, y, 2, TILE);
      }
      if (tile === 'carpet' && (tx + ty) % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(x, y, TILE, TILE);
      }
      if (tile === 'wood') {
        // Planks, staggered by row.
        ctx.fillStyle = 'rgba(60, 35, 15, 0.35)';
        ctx.fillRect(x, y + 7, TILE, 1);
        ctx.fillRect(x, y + 15, TILE, 1);
        ctx.fillRect(x + (ty % 2 ? 4 : 11), y, 1, 7);
        ctx.fillRect(x + (ty % 2 ? 12 : 3), y + 8, 1, 7);
      }
      if (tile === 'tilefloor') {
        ctx.fillStyle = 'rgba(80, 90, 110, 0.25)';
        ctx.fillRect(x, y + TILE - 1, TILE, 1);
        ctx.fillRect(x + TILE - 1, y, 1, TILE);
      }
      if (tile === 'wall') {
        // Seen from above at an angle: a wall with open floor below shows
        // its face; the rest is the top of the wall.
        const below = at(tx, ty + 1);
        if (below !== undefined && below !== 'wall' && below !== 'exit') {
          ctx.fillStyle = '#d9d2c3';
          ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = '#c4bcab';
          ctx.fillRect(x, y + 4, TILE, 1);
          ctx.fillStyle = '#7a6a58';
          ctx.fillRect(x, y + TILE - 3, TILE, 3);
          ctx.fillStyle = '#2b2233';
          ctx.fillRect(x, y, TILE, 1);
        } else {
          ctx.fillStyle = '#4b4258';
          ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
        }
      }
      if (tile === 'exit') {
        // Doormat with an arrow pointing out.
        ctx.fillStyle = '#2b2233';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = '#8a4545';
        ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
        ctx.fillStyle = '#e6c9a8';
        ctx.fillRect(x + 7, y + 3, 2, 7);
        ctx.fillRect(x + 5, y + 8, 6, 1);
        ctx.fillRect(x + 6, y + 9, 4, 1);
        ctx.fillRect(x + 7, y + 10, 2, 1);
      }
      if (tile === 'lot') {
        // Dashed edge around each lot.
        const lot = (dx: number, dy: number) => at(tx + dx, ty + dy) === 'lot';
        ctx.fillStyle = 'rgba(80, 60, 30, 0.35)';
        for (let i = 0; i < TILE; i += 6) {
          if (!lot(0, -1)) ctx.fillRect(x + i, y + 2, 3, 1);
          if (!lot(0, 1)) ctx.fillRect(x + i, y + TILE - 3, 3, 1);
          if (!lot(-1, 0)) ctx.fillRect(x + 2, y + i, 1, 3);
          if (!lot(1, 0)) ctx.fillRect(x + TILE - 3, y + i, 1, 3);
        }
      }
    }
  }
  // Decorations on top, once the ground under them is down.
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) paintDecal(ctx, at(tx, ty)!, tx, ty);
  }
}

/** The little sign on an empty default lot. */
export function drawEmptyLot(ctx: CanvasRenderingContext2D, r: Rect) {
  const p = px(r);
  const x = p.x + p.w / 2 - 6;
  const y = p.y + p.h / 2 - 6;
  ctx.fillStyle = '#2b2233';
  ctx.fillRect(x + 5, y + 6, 2, 10);
  ctx.fillRect(x - 1, y - 1, 14, 9);
  ctx.fillStyle = '#f4e4c1';
  ctx.fillRect(x, y, 12, 7);
  ctx.fillStyle = '#9e4a37';
  ctx.fillRect(x + 2, y + 2, 8, 1);
  ctx.fillRect(x + 2, y + 4, 5, 1);
}

/** Empty default lots: still lot ground and not built on. */
export function emptyLots(world: World): Rect[] {
  return DEFAULT_LOTS.filter(
    (r) => world.tile(r.x, r.y) === 'lot' && world.tile(r.x + 3, r.y + 3) === 'lot' && !world.buildingAt(r.x + 1, r.y + 1),
  );
}

/** Water shimmer on the visible water tiles. */
export function drawWater(ctx: CanvasRenderingContext2D, world: World, view: Rect, t: number) {
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let ty = view.y; ty < view.y + view.h; ty++) {
    for (let tx = view.x; tx < view.x + view.w; tx++) {
      if (world.tile(tx, ty) !== 'water' || hash(tx, ty, 13) > 0.35) continue;
      const phase = (t * 0.6 + hash(tx, ty, 2)) % 1;
      ctx.globalAlpha = Math.sin(phase * Math.PI) * 0.8;
      ctx.fillRect(tx * TILE + 3 + Math.floor(phase * 4), ty * TILE + 4 + Math.floor(hash(tx, ty, 4) * 8), 5, 1);
    }
  }
  ctx.globalAlpha = 1;
}
