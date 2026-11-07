// Walls between people in Office Space. Voice uses wallBetween to muffle a
// speaker heard through a wall. The office's tiles are its default layout
// with everyone's paint on top, kept current from $mapTiles.
import { $mapTiles } from '../../lib/map';
import { OFFICE } from './office';
import { TILE, type Point, type Tile } from './world';

let grid: Tile[][] | null = null;

function officeGrid(): Tile[][] {
  if (!grid) {
    const g = OFFICE.tiles.map((row) => row.slice());
    for (const t of $mapTiles.get()) {
      if (t.scene === 'office' && g[t.y]?.[t.x] !== undefined) g[t.y][t.x] = t.tile;
    }
    grid = g;
  }
  return grid;
}

$mapTiles.listen(() => {
  grid = null;
});

/**
 * Whether a wall tile lies between two pixel points in the office, not
 * counting the tiles they stand on. Walks every tile the line crosses.
 */
export function wallBetween(a: Point, b: Point): boolean {
  const g = officeGrid();
  let x = Math.floor(a.x / TILE);
  let y = Math.floor(a.y / TILE);
  const ex = Math.floor(b.x / TILE);
  const ey = Math.floor(b.y / TILE);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  // Distance along the line (as a fraction) to the next tile edge, and per tile.
  const tDeltaX = stepX ? TILE / Math.abs(dx) : Infinity;
  const tDeltaY = stepY ? TILE / Math.abs(dy) : Infinity;
  let tMaxX = stepX ? ((stepX > 0 ? (x + 1) * TILE - a.x : a.x - x * TILE) / Math.abs(dx)) : Infinity;
  let tMaxY = stepY ? ((stepY > 0 ? (y + 1) * TILE - a.y : a.y - y * TILE) / Math.abs(dy)) : Infinity;
  for (let i = 0; i < 256 && (x !== ex || y !== ey); i++) {
    if (tMaxX < tMaxY) {
      x += stepX;
      tMaxX += tDeltaX;
    } else {
      y += stepY;
      tMaxY += tDeltaY;
    }
    if (x === ex && y === ey) break;
    if (g[y]?.[x] === 'wall') return true;
  }
  return false;
}
