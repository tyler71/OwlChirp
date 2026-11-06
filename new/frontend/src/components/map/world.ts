// The Map's scenes. The town: a 128x96 tile default layout (Techline HQ in a
// park in the middle, blocks of building lots joined by roads), with ground
// painted over it, decorations, and buildings placed anywhere. Office Space,
// inside HQ, is in office.ts. Sizes, HQ, the default lots and the
// tile/decoration kinds mirror the backend (internal/database/mapworld.go and
// mapscenes.go); update both together.
import type { Dir } from '../../lib/map';

export const TILE = 16;
export const COLS = 128;
export const ROWS = 96;
export const WORLD_W = COLS * TILE;
export const WORLD_H = ROWS * TILE;

export const BUILDING_LIMIT = 104;
export const BUILDING_SIZE = 4;

export const TILE_KINDS = ['grass', 'flowers', 'road', 'path', 'plaza', 'sand', 'water', 'lot'] as const;
/** Office floors and walls; 'exit' is the doormat, never painted. */
export const OFFICE_TILE_KINDS = ['carpet', 'wood', 'tilefloor', 'wall'] as const;
export type Tile = (typeof TILE_KINDS)[number] | (typeof OFFICE_TILE_KINDS)[number] | 'exit';

export const PROP_KINDS = [
  'tree', 'pine', 'bush', 'rock', 'flowerpot', 'bench', 'lamp', 'fountain', 'fence', 'sign',
  'fruittree', 'stump', 'boulder', 'ruin', 'wildflowers',
  'bluebells', 'lilies', 'alliums', 'starflowers', 'poppies', 'phlox', 'tulips',
  'daisies', 'irises', 'violets', 'buttercups', 'heather', 'lavender', 'forgetmenots',
] as const;
/** Flower beds from flowers/Flowers.png, one family each. */
export const FLOWER_KINDS = [
  'bluebells', 'lilies', 'alliums', 'starflowers', 'poppies', 'phlox', 'tulips',
  'daisies', 'irises', 'violets', 'buttercups', 'heather', 'lavender', 'forgetmenots',
] as const satisfies readonly PropKind[];
export type FlowerKind = (typeof FLOWER_KINDS)[number];
export const OFFICE_PROP_KINDS = [
  'desk', 'table', 'chair', 'plant', 'couch', 'whiteboard', 'watercooler', 'coffee', 'printer', 'bookshelf',
  'globe', 'rug',
] as const;
export type PropKind = (typeof PROP_KINDS)[number] | (typeof OFFICE_PROP_KINDS)[number];

/** Decorations you can walk over; everything else blocks. */
const WALK_THROUGH: ReadonlySet<PropKind> = new Set<PropKind>(['flowerpot', 'chair', 'wildflowers', 'rug', ...FLOWER_KINDS]);

export type SceneId = 'town' | 'office';

/**
 * A way into another scene. It fires when your feet are inside trigger
 * (pixels) and you're heading dir, or you clicked on click (pixels) to walk
 * there.
 */
export type Door = { to: SceneId; trigger: Rect; dir: Dir; click: Rect };

/** A scene: its size, default ground, what can be placed, and its doors. */
export type SceneDef = {
  id: SceneId;
  name: string;
  cols: number;
  rows: number;
  tiles: readonly (readonly Tile[])[];
  /** Default tree trunks by tile key. */
  trees: readonly number[];
  tileKinds: readonly Tile[];
  propKinds: readonly PropKind[];
  /** Ground nobody can walk on. */
  solid: ReadonlySet<Tile>;
  /** What "destroy" leaves behind. */
  baseTile: Tile;
  /** Tiles that can't be painted or decorated. */
  locked: (x: number, y: number) => boolean;
  doors: readonly Door[];
  /** Canvas colour around the scene. */
  backdrop: string;
  /** Whether bikes and cars can be used here; if not, everyone walks. */
  rides: boolean;
};

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

/** Town tile keys; a World's own are world.key. */
export const tileKey = (x: number, y: number) => y * COLS + x;

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

/** The glass doors on the front of HQ, in pixels. */
const HQ_GLASS: Rect = { x: HQ_DOOR.x - 14, y: HQ_DOOR.y - 26, w: 28, h: 26 };

export const TOWN: SceneDef = {
  id: 'town',
  name: 'Town',
  cols: COLS,
  rows: ROWS,
  tiles: DEFAULT_TILES,
  trees: DEFAULT_TREES,
  tileKinds: TILE_KINDS,
  propKinds: PROP_KINDS,
  solid: new Set<Tile>(['water']),
  baseTile: 'grass',
  locked: (x, y) => inRect(HQ, x, y),
  // Walk up into HQ's glass doors (the row just below them).
  doors: [{ to: 'office', trigger: { x: HQ_GLASS.x, y: HQ_DOOR.y, w: HQ_GLASS.w, h: TILE }, dir: 'up', click: HQ_GLASS }],
  backdrop: '#5c5f6b',
  rides: true,
};

/** A scene as it is now. Mutated in place as paint, props and buildings change. */
export class World {
  readonly cols: number;
  readonly rows: number;
  /** Size in pixels. */
  readonly w: number;
  readonly h: number;
  readonly tiles: Tile[][];
  readonly trees: Set<number>;
  /** Decorations by tile key. */
  props = new Map<number, Prop>();
  buildings: Footprint[] = [];
  /** Steps from each tile to HQ's door along roads (Infinity if unreachable). */
  private dist: Float64Array<ArrayBuffer>;
  private distDirty = true;

  constructor(readonly def: SceneDef = TOWN) {
    this.cols = def.cols;
    this.rows = def.rows;
    this.w = def.cols * TILE;
    this.h = def.rows * TILE;
    this.tiles = def.tiles.map((row) => row.slice());
    this.trees = new Set(def.trees);
    this.dist = new Float64Array(def.cols * def.rows);
  }

  key(x: number, y: number): number {
    return y * this.cols + x;
  }

  has(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  /** The tile a pixel point is on, clamped to the scene. */
  pixelTile(p: Point): Point {
    return {
      x: Math.max(0, Math.min(this.cols - 1, Math.floor(p.x / TILE))),
      y: Math.max(0, Math.min(this.rows - 1, Math.floor(p.y / TILE))),
    };
  }

  tile(x: number, y: number): Tile | undefined {
    return this.tiles[y]?.[x];
  }

  /** Paint one tile. Returns whether anything changed. */
  setTile(x: number, y: number, tile: Tile): boolean {
    if (!this.has(x, y) || this.def.locked(x, y)) return false;
    const hadTree = this.trees.delete(this.key(x, y));
    if (this.tiles[y][x] === tile && !hadTree) return false;
    this.tiles[y][x] = tile;
    this.distDirty = true;
    return true;
  }

  setProps(props: readonly Prop[]): void {
    this.props = new Map(props.map((p) => [this.key(p.x, p.y), p]));
  }

  buildingAt(x: number, y: number): Footprint | undefined {
    return this.buildings.find((b) => inRect(buildingRect(b), x, y));
  }

  /** Whether a building fits at p without overlapping others (except skipId). */
  canPlaceBuilding(p: Point, skipId?: number): boolean {
    const r = buildingRect(p);
    if (r.x < 0 || r.y < 0 || r.x + r.w > this.cols || r.y + r.h > this.rows || overlaps(r, HQ)) return false;
    return !this.buildings.some((b) => b.id !== skipId && overlaps(r, buildingRect(b)));
  }

  /** Whether a pixel point blocks walking. */
  isSolid(px: number, py: number): boolean {
    if (px < 0 || py < 0 || px >= this.w || py >= this.h) return true;
    const x = Math.floor(px / TILE);
    const y = Math.floor(py / TILE);
    const k = this.key(x, y);
    if (this.def.solid.has(this.tiles[y][x]) || this.trees.has(k) || (this.def.id === 'town' && inRect(HQ, x, y))) return true;
    const prop = this.props.get(k);
    if (prop && !WALK_THROUGH.has(prop.kind)) return true;
    return this.buildingAt(x, y) !== undefined;
  }

  /** Whether a character with feet at (x, y) and a foot box footW wide each side, footH tall, hits anything. */
  blocked(x: number, y: number, footW: number, footH = FOOT_H): boolean {
    return (
      this.isSolid(x - footW, y - footH) ||
      this.isSolid(x + footW, y - footH) ||
      this.isSolid(x - footW, y - 1) ||
      this.isSolid(x + footW, y - 1)
    );
  }

  /**
   * The shortest walk from pixel point from to pixel point to for feet footW
   * wide, as pixel waypoints (excluding from), going around anything solid.
   * A* over tiles, then pulled taut with line-of-sight checks. If to can't be
   * reached it gets as close as it can; null when from is boxed in.
   *
   * With roadsOnly (cars), leaving the road is very costly, so the walk
   * heads onto the nearest road, keeps to roads, and ends on the road tile
   * nearest to (or the click itself when that's on a road).
   */
  findPath(from: Point, to: Point, footW: number, roadsOnly = false): Point[] | null {
    const N = this.cols * this.rows;
    // 0 unknown, 1 open, 2 solid; isSolid scans buildings, so cache per search.
    const pass = new Uint8Array(N);
    const passable = (x: number, y: number) => {
      if (!this.has(x, y)) return false;
      const k = this.key(x, y);
      if (!pass[k]) pass[k] = this.blocked(spot(x, y).x, spot(x, y).y, footW) ? 2 : 1;
      return pass[k] === 1;
    };
    const clear = (a: Point, b: Point) => {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(len / 2));
      for (let i = 0; i <= steps; i++) {
        const f = i / steps;
        if (this.blocked(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, footW)) return false;
      }
      return true;
    };

    const isRoad = (x: number, y: number) => this.tiles[y]?.[x] === 'road';

    const startTile = nearestTile(this.pixelTile(from), passable, 3, (t) => clear(from, spot(t.x, t.y)));
    if (!startTile) return null;
    const goalTile =
      (roadsOnly && nearestTile(this.pixelTile(to), (x, y) => passable(x, y) && isRoad(x, y), 40)) ||
      nearestTile(this.pixelTile(to), passable, 40);
    if (!goalTile) return null;

    // A*, 8 directions, no squeezing diagonally between two solid tiles.
    const g = new Float64Array(N).fill(Infinity);
    const parent = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const gx = goalTile.x;
    const gy = goalTile.y;
    const h = (x: number, y: number) => {
      const dx = Math.abs(x - gx);
      const dy = Math.abs(y - gy);
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    };
    const open = new MinHeap();
    const s = this.key(startTile.x, startTile.y);
    const goal = this.key(gx, gy);
    g[s] = 0;
    open.push(s, h(startTile.x, startTile.y));
    let best = s;
    let bestH = h(startTile.x, startTile.y);
    while (open.size) {
      const k = open.pop();
      if (closed[k]) continue;
      closed[k] = 1;
      const x = k % this.cols;
      const y = (k - x) / this.cols;
      const hk = h(x, y);
      if (hk < bestH) {
        best = k;
        bestH = hk;
      }
      if (k === goal) break;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!passable(nx, ny)) continue;
        if (dx && dy && (!passable(x + dx, y) || !passable(x, y + dy))) continue;
        const nk = this.key(nx, ny);
        if (closed[nk]) continue;
        const ng = g[k] + (dx && dy ? Math.SQRT2 : 1) + (roadsOnly && !isRoad(nx, ny) ? OFF_ROAD_COST : 0);
        if (ng < g[nk]) {
          g[nk] = ng;
          parent[nk] = k;
          open.push(nk, ng + h(nx, ny));
        }
      }
    }

    const nodes: Point[] = [];
    // Tiles the search chose; a car may cut corners only over these and roads.
    const fromTile = this.pixelTile(from);
    const used = new Set<number>([this.key(fromTile.x, fromTile.y)]);
    for (let k = best; k >= 0; k = parent[k]) {
      used.add(k);
      nodes.push(spot(k % this.cols, Math.floor(k / this.cols)));
    }
    nodes.reverse();
    const onTrack = (a: Point, b: Point) => {
      if (!roadsOnly) return true;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(len / 2));
      for (let i = 0; i <= steps; i++) {
        const f = i / steps;
        const t = this.pixelTile({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
        if (!isRoad(t.x, t.y) && !used.has(this.key(t.x, t.y))) return false;
      }
      return true;
    };
    const inSight = (a: Point, b: Point) => clear(a, b) && onTrack(a, b);
    // End on the exact click when it's open and in view of the last tile
    // (for a car, only when the click is on the road).
    const last = nodes[nodes.length - 1];
    const toTile = this.pixelTile(to);
    if (
      best === goal &&
      (!roadsOnly || isRoad(toTile.x, toTile.y)) &&
      !this.blocked(to.x, to.y, footW) &&
      inSight(last, to)
    ) {
      nodes.push(to);
    }

    // Pull taut: from each anchor, run ahead while the next point stays in sight.
    const out: Point[] = [];
    let anchor = from;
    let i = 0;
    while (i < nodes.length) {
      let j = i;
      while (j + 1 < nodes.length && inSight(anchor, nodes[j + 1])) j++;
      out.push(nodes[j]);
      anchor = nodes[j];
      i = j + 1;
    }
    return out;
  }

  /** Road steps from every tile to the from tile (Infinity where unreachable). */
  private distanceField(from: Point, into: Float64Array = new Float64Array(this.cols * this.rows)): Float64Array {
    const d = into.fill(Infinity);
    const queue: number[] = [this.key(from.x, from.y)];
    d[queue[0]] = 0;
    for (let i = 0; i < queue.length; i++) {
      const x = queue[i] % this.cols;
      const y = Math.floor(queue[i] / this.cols);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const nk = this.key(nx, ny);
        if (this.has(nx, ny) && routableTile(this.tiles[ny][nx]) && d[nk] === Infinity) {
          d[nk] = d[queue[i]] + 1;
          queue.push(nk);
        }
      }
    }
    return d;
  }

  /** The HQ field, cached until paint changes. */
  private distances(): Float64Array {
    if (!this.distDirty) return this.dist;
    this.distanceField(HQ_DOOR_TILE, this.dist);
    this.distDirty = false;
    return this.dist;
  }

  /** The nearest tile to start that has a road to HQ, or null. */
  nearestRoad(start: Point, maxSteps = 40): Point | null {
    const d = this.distances();
    const seen = new Set([this.key(start.x, start.y)]);
    let frontier = [start];
    for (let step = 0; step <= maxSteps && frontier.length; step++) {
      const next: Point[] = [];
      for (const p of frontier) {
        if (d[this.key(p.x, p.y)] < Infinity) return p;
        for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
          const q = { x: p.x + dx, y: p.y + dy };
          const k = this.key(q.x, q.y);
          if (this.has(q.x, q.y) && !seen.has(k)) {
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
   * Pixel waypoints from start (a tile) down field d to its zero tile, then
   * to end, with straight runs merged. Without a road it's a straight line.
   */
  private routeAlong(d: Float64Array, start: Point, from: Point | undefined, end: Point): Point[] {
    const at = (p: Point) => (this.has(p.x, p.y) ? d[this.key(p.x, p.y)] : Infinity);
    const tiles: Point[] = [start];
    let cur = start;
    let dir: [number, number] = [0, 0];
    for (let guard = 0; guard < this.cols * this.rows && at(cur) > 0 && at(cur) < Infinity; guard++) {
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
    const points = [...(from ? [from] : []), ...tiles.map(center), end];
    return points.filter((p, i) => {
      if (i === 0 || i === points.length - 1) return true;
      const a = points[i - 1];
      const b = points[i + 1];
      return (a.x - p.x) * (b.y - p.y) !== (a.y - p.y) * (b.x - p.x);
    });
  }

  /** Pixel waypoints along the roads from start (a tile) to HQ's door. */
  routeToHQ(start: Point, from?: Point): Point[] {
    return this.routeAlong(this.distances(), start, from, HQ_DOOR);
  }

  /**
   * The field leading to dest (a pixel spot, e.g. an agent), from the road
   * nearest it; null when no road there joins the network.
   */
  private fieldTo(dest: Point): Float64Array | null {
    const tile = { x: Math.floor(dest.x / TILE), y: Math.floor(dest.y / TILE) };
    if (!this.has(tile.x, tile.y)) return null;
    const road = this.nearestRoad(tile);
    return road ? this.distanceField(road) : null;
  }

  /** Pixel waypoints along the roads from start (a tile) to dest (pixels). */
  routeTo(dest: Point, start: Point, from?: Point): Point[] {
    const d = this.fieldTo(dest);
    const linked = d && this.has(start.x, start.y) && d[this.key(start.x, start.y)] < Infinity;
    return linked ? this.routeAlong(d, start, from, dest) : [from ?? center(start), dest];
  }

  /**
   * The route a call from building b takes to HQ (or to dest, in pixels):
   * out the side that touches the road network closest to it, then along
   * the roads. Only a building with no road beside it hops straight to the
   * nearest one.
   */
  routeFromBuilding(b: Point, dest?: Point): Point[] {
    const d = dest ? this.fieldTo(dest) : this.distances();
    const end = dest ?? HQ_DOOR;
    const S = BUILDING_SIZE;
    const doorTile = { x: b.x + 1, y: b.y + S };
    const door = { x: (b.x + S / 2) * TILE, y: (b.y + S) * TILE };
    if (!d) return [door, end];
    // Tiles bordering the footprint with the wall point beside each; bottom
    // first so a lot's own driveway wins ties.
    const sides: { tile: Point; wall: Point }[] = [];
    for (let i = 0; i < S; i++) {
      sides.push({ tile: { x: b.x + i, y: b.y + S }, wall: { x: (b.x + i) * TILE + TILE / 2, y: (b.y + S) * TILE } });
    }
    for (let i = 0; i < S; i++) {
      sides.push({ tile: { x: b.x - 1, y: b.y + i }, wall: { x: b.x * TILE, y: (b.y + i) * TILE + TILE / 2 } });
      sides.push({ tile: { x: b.x + S, y: b.y + i }, wall: { x: (b.x + S) * TILE, y: (b.y + i) * TILE + TILE / 2 } });
      sides.push({ tile: { x: b.x + i, y: b.y - 1 }, wall: { x: (b.x + i) * TILE + TILE / 2, y: b.y * TILE } });
    }
    let best: { tile: Point; wall: Point } | null = null;
    let bestDist = Infinity;
    for (const s of sides) {
      const dist = this.has(s.tile.x, s.tile.y) ? d[this.key(s.tile.x, s.tile.y)] : Infinity;
      if (dist < bestDist) {
        best = s;
        bestDist = dist;
      }
    }
    if (best) return this.routeAlong(d, best.tile, best.wall, end);

    const road = this.nearestRoad(doorTile);
    return road && d[this.key(road.x, road.y)] < Infinity ? this.routeAlong(d, road, door, end) : [door, end];
  }
}

const center = (p: Point): Point => ({ x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2 });

/** Extra cost of each off-road step when routing a car. */
const OFF_ROAD_COST = 50;

/** Default height of a character's foot box, in pixels above their feet. */
export const FOOT_H = 3;

const NEIGHBOURS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** Where a character stands on tile (x, y): feet low in the middle, foot box inside the tile. */
const spot = (x: number, y: number): Point => ({ x: x * TILE + TILE / 2, y: y * TILE + 12 });


/** The nearest tile to t (by rings) that's passable and, if given, ok. */
function nearestTile(
  t: Point,
  passable: (x: number, y: number) => boolean,
  maxRing: number,
  ok: (p: Point) => boolean = () => true,
): Point | null {
  for (let r = 0; r <= maxRing; r++) {
    let best: Point | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const p = { x: t.x + dx, y: t.y + dy };
        const d = dx * dx + dy * dy;
        if (d < bestD && passable(p.x, p.y) && ok(p)) {
          best = p;
          bestD = d;
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** A binary min-heap of tile keys by priority. */
class MinHeap {
  private keys: number[] = [];
  private pri: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(key: number, p: number) {
    const { keys, pri } = this;
    let i = keys.length;
    keys.push(key);
    pri.push(p);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (pri[up] <= p) break;
      keys[i] = keys[up];
      pri[i] = pri[up];
      i = up;
    }
    keys[i] = key;
    pri[i] = p;
  }
  pop(): number {
    const { keys, pri } = this;
    const top = keys[0];
    const key = keys.pop()!;
    const p = pri.pop()!;
    const n = keys.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && pri[c + 1] < pri[c]) c++;
        if (pri[c] >= p) break;
        keys[i] = keys[c];
        pri[i] = pri[c];
        i = c;
      }
      keys[i] = key;
      pri[i] = p;
    }
    return top;
  }
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
