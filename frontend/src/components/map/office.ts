// Office Space: the inside of Techline HQ, through its glass doors. A small
// editable room of desks, a meeting table and a break corner, walled in, with
// the way back out through a doormat in the bottom wall. The size, locked
// tiles (walls and exit) and starting furniture mirror the backend
// (internal/database/mapscenes.go); update both together.
import { OFFICE_PROP_KINDS, OFFICE_TILE_KINDS, TILE, type Rect, type SceneDef, type Tile } from './world';

export const OFFICE_COLS = 24;
export const OFFICE_ROWS = 16;

/** The two doormat tiles in the bottom wall. */
const EXIT: Rect = { x: 11, y: OFFICE_ROWS - 1, w: 2, h: 1 };

const locked = (x: number, y: number) => x === 0 || x === OFFICE_COLS - 1 || y <= 1 || y === OFFICE_ROWS - 1;

function buildTiles(): Tile[][] {
  const t: Tile[][] = Array.from({ length: OFFICE_ROWS }, () => Array<Tile>(OFFICE_COLS).fill('carpet'));
  const fill = (x0: number, y0: number, x1: number, y1: number, tile: Tile) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) t[y][x] = tile;
  };
  fill(16, 2, 22, 8, 'wood'); // break room
  fill(19, 9, 22, 14, 'tilefloor'); // copy corner
  fill(10, 9, 13, 14, 'tilefloor'); // the walk in from the door
  for (let y = 0; y < OFFICE_ROWS; y++) {
    for (let x = 0; x < OFFICE_COLS; x++) if (locked(x, y)) t[y][x] = 'wall';
  }
  fill(EXIT.x, EXIT.y, EXIT.x + EXIT.w - 1, EXIT.y, 'exit');
  return t;
}

export const OFFICE: SceneDef = {
  id: 'office',
  name: 'Office Space',
  cols: OFFICE_COLS,
  rows: OFFICE_ROWS,
  tiles: buildTiles(),
  trees: [],
  tileKinds: OFFICE_TILE_KINDS,
  propKinds: OFFICE_PROP_KINDS,
  solid: new Set<Tile>(['wall']),
  baseTile: 'carpet',
  locked,
  // Step down onto the doormat to go back out.
  doors: [
    {
      to: 'town',
      trigger: { x: EXIT.x * TILE, y: EXIT.y * TILE + 2, w: EXIT.w * TILE, h: TILE },
      dir: 'down',
      click: { x: EXIT.x * TILE, y: EXIT.y * TILE, w: EXIT.w * TILE, h: TILE },
    },
  ],
  arrival: { x: 12 * TILE, y: 13 * TILE + 12 },
  backdrop: '#2b2233',
  rides: false,
};

