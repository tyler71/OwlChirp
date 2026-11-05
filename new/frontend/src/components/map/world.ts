// The Map's town: a 128x96 tile default layout (Techline HQ in a park in the
// middle, blocks of building lots joined by roads), with ground painted over
// it, decorations, and buildings placed anywhere. Sizes, HQ, the default lots
// and the tile/decoration kinds mirror the backend
// (internal/database/mapworld.go); update both together.

export const TILE = 16;
export const COLS = 128;
export const ROWS = 96;
export const WORLD_W = COLS * TILE;
export const WORLD_H = ROWS * TILE;

export const BUILDING_LIMIT = 104;
export const BUILDING_SIZE = 4;

export const TILE_KINDS = ['grass', 'flowers', 'road', 'path', 'plaza', 'sand', 'water', 'lot'] as const;
export type Tile = (typeof TILE_KINDS)[number];

export const PROP_KINDS = ['tree', 'pine', 'bush', 'rock', 'flowerpot', 'bench', 'lamp', 'fountain', 'fence', 'sign'] as const;
export type PropKind = (typeof PROP_KINDS)[number];

/** Decorations you can walk over; everything else blocks. */
const WALK_THROUGH: ReadonlySet<PropKind> = new Set(['flowerpot']);

/** A rectangle in tiles. */
export type Rect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };
export type Prop = { id: number; kind: PropKind; x: number; y: number };
/** A building's footprint: top-left tile, BUILDING_SIZE square. */
export type Footprint = { id: number; x: number; y: number };

export const HQ: Rect = { x: 60, y: 44, w: 10, h: 7 };
export const HQ_DOOR: Point = { x: 65 * TILE, y: 51 * TILE };
const HQ_DOOR_TILE: Point = { x: 64, y: 51 };
/** The park around HQ, kept free of default lots. */
const RESERVE: Rect = { x: 45, y: 32, w: 40, h: 30 };
const POND: Rect = { x: 49, y: 36, w: 7, h: 5 };

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function buildingRect(p: Point): Rect {
  return { x: p.x, y: p.y, w: BUILDING_SIZE, h: BUILDING_SIZE };
}

export const tileKey = (x: number, y: number) => y * COLS + x;
export const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < COLS && y < ROWS;

/** Spots new buildings go in, nearest HQ first. Mirrors DefaultLots in Go. */
export const DEFAULT_LOTS: Rect[] = (() => {
  const lots: Rect[] = [];
  for (let band = 0; band < 12; band++) {
    for (let col = 0; col < 20; col++) {
      const r = { x: 3 + 6 * col, y: 1 + 8 * band, w: BUILDING_SIZE, h: BUILDING_SIZE };
      if (!overlaps(r, RESERVE)) lots.push(r);
    }
  }
  const cx = HQ.x + Math.floor(HQ.w / 2);
  const cy = HQ.y + Math.floor(HQ.h / 2);
  const d2 = (r: Rect) => (r.x + 2 - cx) ** 2 + (r.y + 2 - cy) ** 2;
  lots.sort((a, b) => d2(a) - d2(b) || a.y - b.y || a.x - b.x);
  return lots.slice(0, BUILDING_LIMIT);
})();

/** Where calls from unknown numbers enter the map: road ends at the edges. */
export const EDGE_ENTRIES: Point[] = [
  { x: 0, y: 6 },
  { x: COLS - 1, y: 6 },
  { x: 0, y: 94 },
  { x: COLS - 1, y: 94 },
];

// Deterministic pseudo-random in [0, 1) for decoration placement.
export function hash(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const VERTICAL_ROADS = [19, 43, 85, 109]; // left column of each two-wide road

function buildDefaultTiles(): Tile[][] {
  const t: Tile[][] = Array.from({ length: ROWS }, () => Array<Tile>(COLS).fill('grass'));
  const fill = (x0: number, y0: number, x1: number, y1: number, tile: Tile, skip?: Rect) => {
    for (let y = Math.max(0, y0); y <= Math.min(ROWS - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(COLS - 1, x1); x++) {
        if (!skip || !inRect(skip, x, y)) t[y][x] = tile;
      }
    }
  };

  // A street below every band of lots; the park only keeps the one past HQ.
  for (let band = 0; band < 12; band++) {
    const y = 1 + 8 * band + 5;
    fill(0, y, COLS - 1, y + 1, 'road', y === 54 ? undefined : RESERVE);
  }
  for (const x of VERTICAL_ROADS) fill(x, 0, x + 1, ROWS - 1, 'road');

  // The park: HQ's plaza, a road down to the street below, and a pond.
  fill(56, 51, 73, 53, 'plaza');
  fill(64, 56, 65, 61, 'road');
  fill(POND.x, POND.y, POND.x + POND.w - 1, POND.y + POND.h - 1, 'water');
  fill(POND.x - 1, POND.y + POND.h, POND.x + POND.w, POND.y + POND.h, 'sand');

  for (const lot of DEFAULT_LOTS) {
    fill(lot.x, lot.y, lot.x + lot.w - 1, lot.y + lot.h - 1, 'lot');
    fill(lot.x + 1, lot.y + lot.h, lot.x + 2, lot.y + lot.h, 'path');
  }

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (t[y][x] === 'grass' && hash(x, y, 7) < 0.05) t[y][x] = 'flowers';
    }
  }
  return t;
}

const DEFAULT_TILES = buildDefaultTiles();

const isGreen = (t: Tile | undefined) => t === 'grass' || t === 'flowers';

/** Default tree trunks by tile key; painting a tile clears its tree. */
const DEFAULT_TREES: number[] = (() => {
  const keep: Rect = { x: 52, y: 40, w: 26, h: 18 }; // HQ grounds stay open
  const trees: Point[] = [];
  const taken = new Set<number>();
  for (let y = 1; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!isGreen(DEFAULT_TILES[y][x]) || !isGreen(DEFAULT_TILES[y - 1][x]) || inRect(keep, x, y)) continue;
      if (hash(x, y, 1) >= 0.09) continue;
      // Space them out so canopies don't clump.
      if ([-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => taken.has(tileKey(x + dx, y + dy))))) continue;
      taken.add(tileKey(x, y));
      trees.push({ x, y });
    }
  }
  return trees.map((p) => tileKey(p.x, p.y));
})();

const routableTile = (t: Tile) => t === 'road' || t === 'path' || t === 'plaza';

/** The town as it is now. Mutated in place as paint, props and buildings change. */
export class World {
  readonly tiles: Tile[][] = DEFAULT_TILES.map((row) => row.slice());
  readonly trees = new Set<number>(DEFAULT_TREES);
  /** Decorations by tile key. */
  props = new Map<number, Prop>();
  buildings: Footprint[] = [];
  /** Steps from each tile to HQ's door along roads (Infinity if unreachable). */
  private dist = new Float64Array(COLS * ROWS);
  private distDirty = true;

  tile(x: number, y: number): Tile | undefined {
    return this.tiles[y]?.[x];
  }

  /** Paint one tile. Returns whether anything changed. */
  setTile(x: number, y: number, tile: Tile): boolean {
    if (!inMap(x, y) || inRect(HQ, x, y)) return false;
    const hadTree = this.trees.delete(tileKey(x, y));
    if (this.tiles[y][x] === tile && !hadTree) return false;
    this.tiles[y][x] = tile;
    this.distDirty = true;
    return true;
  }

  setProps(props: readonly Prop[]): void {
    this.props = new Map(props.map((p) => [tileKey(p.x, p.y), p]));
  }

  buildingAt(x: number, y: number): Footprint | undefined {
    return this.buildings.find((b) => inRect(buildingRect(b), x, y));
  }

  /** Whether a building fits at p without overlapping others (except skipId). */
  canPlaceBuilding(p: Point, skipId?: number): boolean {
    const r = buildingRect(p);
    if (r.x < 0 || r.y < 0 || r.x + r.w > COLS || r.y + r.h > ROWS || overlaps(r, HQ)) return false;
    return !this.buildings.some((b) => b.id !== skipId && overlaps(r, buildingRect(b)));
  }

  /** Whether a pixel point blocks walking. */
  isSolid(px: number, py: number): boolean {
    if (px < 0 || py < 0 || px >= WORLD_W || py >= WORLD_H) return true;
    const x = Math.floor(px / TILE);
    const y = Math.floor(py / TILE);
    const k = tileKey(x, y);
    if (this.tiles[y][x] === 'water' || this.trees.has(k) || inRect(HQ, x, y)) return true;
    const prop = this.props.get(k);
    if (prop && !WALK_THROUGH.has(prop.kind)) return true;
    return this.buildingAt(x, y) !== undefined;
  }

  private distances(): Float64Array {
    if (!this.distDirty) return this.dist;
    const d = this.dist.fill(Infinity);
    const queue: number[] = [tileKey(HQ_DOOR_TILE.x, HQ_DOOR_TILE.y)];
    d[queue[0]] = 0;
    for (let i = 0; i < queue.length; i++) {
      const x = queue[i] % COLS;
      const y = Math.floor(queue[i] / COLS);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const nk = tileKey(nx, ny);
        if (inMap(nx, ny) && routableTile(this.tiles[ny][nx]) && d[nk] === Infinity) {
          d[nk] = d[queue[i]] + 1;
          queue.push(nk);
        }
      }
    }
    this.distDirty = false;
    return d;
  }

  /** The nearest tile to start that has a road to HQ, or null. */
  nearestRoad(start: Point, maxSteps = 40): Point | null {
    const d = this.distances();
    const seen = new Set([tileKey(start.x, start.y)]);
    let frontier = [start];
    for (let step = 0; step <= maxSteps && frontier.length; step++) {
      const next: Point[] = [];
      for (const p of frontier) {
        if (d[tileKey(p.x, p.y)] < Infinity) return p;
        for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
          const q = { x: p.x + dx, y: p.y + dy };
          const k = tileKey(q.x, q.y);
          if (inMap(q.x, q.y) && !seen.has(k)) {
            seen.add(k);
            next.push(q);
          }
        }
      }
      frontier = next;
    }
    return null;
  }

  /**
   * Pixel waypoints along the roads from start (a tile) to HQ's door, with
   * straight runs merged. Without a road it's a straight line.
   */
  routeToHQ(start: Point, from?: Point): Point[] {
    const d = this.distances();
    const at = (p: Point) => (inMap(p.x, p.y) ? d[tileKey(p.x, p.y)] : Infinity);
    const tiles: Point[] = [start];
    let cur = start;
    let dir: [number, number] = [0, 0];
    for (let guard = 0; guard < COLS * ROWS && at(cur) > 0 && at(cur) < Infinity; guard++) {
      // Keep going straight on ties so the pulse sticks to one lane.
      const options: [number, number][] = [dir, [1, 0], [-1, 0], [0, 1], [0, -1]];
      const next = options
        .map(([dx, dy]) => ({ x: cur.x + dx, y: cur.y + dy, dx, dy }))
        .filter((p) => (p.dx || p.dy) && at(p) < at(cur))[0];
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

  /** The route a call from building b takes to HQ. */
  routeFromBuilding(b: Point): Point[] {
    const doorTile = { x: b.x + 1, y: b.y + BUILDING_SIZE };
    const door = { x: (b.x + BUILDING_SIZE / 2) * TILE, y: (b.y + BUILDING_SIZE) * TILE };
    const road = this.nearestRoad(doorTile);
    return road ? this.routeToHQ(road, door) : [door, HQ_DOOR];
  }
}

const center = (p: Point): Point => ({ x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2 });

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
