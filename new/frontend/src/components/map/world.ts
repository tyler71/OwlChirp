// Fixed layout of the Map: a 48x32 tile town with Techline HQ in the middle,
// building lots around it joined by roads. Sizes and the lot count mirror
// the backend (cmd/api/mappresence.go and database.MapSlotCount).

export const TILE = 16;
export const COLS = 48;
export const ROWS = 32;
export const WORLD_W = COLS * TILE;
export const WORLD_H = ROWS * TILE;

export type Tile = 'grass' | 'road' | 'path' | 'plaza' | 'water' | 'lot' | 'flowers';

/** A rectangle in tiles. */
export type Rect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };

export type Lot = {
  rect: Rect;
  /** Pixel point at the foot of the door, where pulses start. */
  door: Point;
  /** Tile on the path in front of the door. */
  doorTile: Point;
};

export const HQ: Rect = { x: 19, y: 10, w: 10, h: 7 };
export const HQ_DOOR: Point = { x: 24 * TILE, y: 17 * TILE };
const HQ_DOOR_TILE: Point = { x: 23, y: 17 };

export const POND: Rect = { x: 11, y: 12, w: 5, h: 5 };

// Lots in fill order: the middle of the top and bottom rows first, so a few
// buildings look balanced around HQ, then outward.
function topLot(i: number): Lot {
  const x = 3 + 6 * i;
  return { rect: { x, y: 3, w: 4, h: 4 }, door: { x: (x + 2) * TILE, y: 7 * TILE }, doorTile: { x: x + 1, y: 7 } };
}
function bottomLot(i: number): Lot {
  const x = 3 + 6 * i;
  return { rect: { x, y: 24, w: 4, h: 4 }, door: { x: (x + 2) * TILE, y: 28 * TILE }, doorTile: { x: x + 1, y: 28 } };
}
const LEFT_LOT: Lot = { rect: { x: 1, y: 13, w: 4, h: 4 }, door: { x: 3 * TILE, y: 17 * TILE }, doorTile: { x: 2, y: 17 } };
const RIGHT_LOT: Lot = { rect: { x: 43, y: 13, w: 4, h: 4 }, door: { x: 45 * TILE, y: 17 * TILE }, doorTile: { x: 44, y: 17 } };

export const LOTS: Lot[] = [
  topLot(3), bottomLot(3), topLot(2), topLot(4), bottomLot(2), bottomLot(4), LEFT_LOT, RIGHT_LOT,
  topLot(1), topLot(5), bottomLot(1), bottomLot(5), topLot(0), topLot(6), bottomLot(0), bottomLot(6),
];

/** Where calls from unknown numbers enter the map: road ends at the edges. */
export const EDGE_ENTRIES: Point[] = [
  { x: 0, y: 8 },
  { x: COLS - 1, y: 8 },
  { x: 0, y: 29 },
  { x: COLS - 1, y: 29 },
];

// Deterministic pseudo-random in [0, 1) for decoration placement.
export function hash(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

function buildTiles(): Tile[][] {
  const t: Tile[][] = Array.from({ length: ROWS }, () => Array<Tile>(COLS).fill('grass'));
  const fill = (x0: number, y0: number, x1: number, y1: number, tile: Tile) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) t[y][x] = tile;
  };

  // Roads: top and bottom avenues edge to edge, two side streets, and the
  // street in front of HQ.
  fill(0, 8, COLS - 1, 9, 'road');
  fill(0, 29, COLS - 1, 30, 'road');
  fill(7, 8, 8, 30, 'road');
  fill(37, 8, 38, 30, 'road');
  fill(7, 21, 38, 22, 'road');

  fill(18, 17, 29, 20, 'plaza');
  fill(POND.x, POND.y, POND.x + POND.w - 1, POND.y + POND.h - 1, 'water');

  for (const lot of LOTS) {
    const r = lot.rect;
    fill(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1, 'lot');
  }
  // Paths from each door to its road.
  for (let i = 0; i < 7; i++) {
    const x = 3 + 6 * i;
    fill(x + 1, 7, x + 2, 7, 'path');
    fill(x + 1, 28, x + 2, 28, 'path');
  }
  fill(1, 17, 6, 17, 'path');
  fill(39, 17, 46, 17, 'path');

  // Flower beds.
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (t[y][x] === 'grass' && hash(x, y, 7) < 0.05) t[y][x] = 'flowers';
    }
  }
  return t;
}

export const TILES = buildTiles();

/** Tree trunks (tile positions); they block walking. */
export const TREES: Point[] = (() => {
  const trees: Point[] = [];
  const free = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < COLS && y < ROWS && (TILES[y][x] === 'grass' || TILES[y][x] === 'flowers');
  for (let y = 1; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!free(x, y) || !free(x, y - 1)) continue;
      if (inRect({ x: 17, y: 9, w: 14, h: 12 }, x, y)) continue; // keep HQ grounds open
      if (y === 23 || y === 2 || y === 31 || y === 1) {
        if (hash(x, y, 3) < 0.35) trees.push({ x, y });
      } else if (hash(x, y, 1) < 0.07) {
        trees.push({ x, y });
      }
    }
  }
  // Space them out so canopies don't clump.
  return trees.filter((p, i) => !trees.slice(0, i).some((q) => Math.abs(q.x - p.x) <= 1 && Math.abs(q.y - p.y) <= 1));
})();

const treeSet = new Set(TREES.map((p) => `${p.x},${p.y}`));

/**
 * Whether a pixel point blocks walking. Lots block only while they have a
 * building, HQ always does.
 */
export function isSolid(px: number, py: number, builtSlots: Set<number>): boolean {
  if (px < 0 || py < 0 || px >= WORLD_W || py >= WORLD_H) return true;
  const x = Math.floor(px / TILE);
  const y = Math.floor(py / TILE);
  if (TILES[y][x] === 'water' || treeSet.has(`${x},${y}`) || inRect(HQ, x, y)) return true;
  return LOTS.some((lot, slot) => builtSlots.has(slot) && inRect(lot.rect, x, y));
}

// ---- Pulse routing ----

const routable = (x: number, y: number) =>
  x >= 0 && y >= 0 && x < COLS && y < ROWS && ['road', 'path', 'plaza'].includes(TILES[y][x]);

// Steps from every routable tile to HQ's door, by breadth-first search.
const DIST: number[][] = (() => {
  const d = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(Infinity));
  const queue: Point[] = [HQ_DOOR_TILE];
  d[HQ_DOOR_TILE.y][HQ_DOOR_TILE.x] = 0;
  for (let i = 0; i < queue.length; i++) {
    const { x, y } = queue[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (routable(nx, ny) && d[ny][nx] === Infinity) {
        d[ny][nx] = d[y][x] + 1;
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return d;
})();

const center = (p: Point): Point => ({ x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2 });

/**
 * Pixel waypoints along the roads from start (a routable tile) to HQ's door,
 * with straight runs merged.
 */
export function routeToHQ(start: Point, from?: Point): Point[] {
  const tiles: Point[] = [start];
  let cur = start;
  let dir: [number, number] = [0, 0];
  for (let guard = 0; guard < COLS * ROWS && DIST[cur.y]?.[cur.x] > 0; guard++) {
    // Keep going straight on ties so the pulse sticks to one lane.
    const options: [number, number][] = [dir, [1, 0], [-1, 0], [0, 1], [0, -1]];
    const next = options
      .map(([dx, dy]) => ({ x: cur.x + dx, y: cur.y + dy, dx, dy }))
      .filter((p) => (p.dx || p.dy) && routable(p.x, p.y) && DIST[p.y][p.x] < DIST[cur.y][cur.x])[0];
    if (!next) break;
    dir = [next.dx, next.dy];
    cur = { x: next.x, y: next.y };
    tiles.push(cur);
  }
  const points = [...(from ? [from] : []), ...tiles.map(center), HQ_DOOR];
  return points.filter((p, i) => {
    if (i === 0 || i === points.length - 1) return true;
    const a = points[i - 1];
    const b = points[i + 1];
    return (a.x - p.x) * (b.y - p.y) !== (a.y - p.y) * (b.x - p.x);
  });
}

export function pathLength(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return len;
}

/** The point a fraction t (0..1) of the way along points. */
export function pointAlong(points: Point[], t: number, total = pathLength(points)): Point {
  let remaining = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= seg || i === points.length - 1) {
      const f = seg === 0 ? 0 : Math.min(1, remaining / seg);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    remaining -= seg;
  }
  return points[points.length - 1];
}
