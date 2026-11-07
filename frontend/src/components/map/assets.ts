// Image assets for the Map (craftpix packs in src/assets/map). Everything is
// bundled by Vite and preloaded once with loadMapAssets(); drawing code asks
// for images with img() and falls back to procedural art until they've
// loaded.
import manifest from '../../assets/map/sprite/manifest.json';

const URLS = import.meta.glob<string>('../../assets/map/**/*.png', { eager: true, query: '?url', import: 'default' });
const PREFIX = '../../assets/map/';

const images = new Map<string, HTMLImageElement>();
let loading: Promise<void> | null = null;
let ready = false;

/** Load every map image. Resolves once all have loaded (or failed). */
export function loadMapAssets(): Promise<void> {
  loading ??= Promise.all(
    Object.entries(URLS).map(
      ([path, url]) =>
        new Promise<void>((resolve) => {
          const im = new Image();
          im.onload = () => {
            images.set(path.slice(PREFIX.length), im);
            resolve();
          };
          im.onerror = () => resolve();
          im.src = url;
        }),
    ),
  ).then(() => {
    ready = true;
  });
  return loading;
}

export const assetsReady = () => ready;

/** A loaded image by its path under src/assets/map, e.g. 'grasslands/Tree1.png'. */
export function img(path: string): HTMLImageElement | undefined {
  return images.get(path);
}

// ---- Character sprite layers ----

/** Avatar parts in the order the editor lists them. */
export const AVATAR_PARTS = [
  'skin', 'eyes', 'brows', 'hair', 'beard', 'face', 'facepaint', 'ears',
  'pants', 'outfit', 'tabard', 'cape', 'accessory', 'glasses', 'headwear',
] as const;
export type AvatarPart = (typeof AVATAR_PARTS)[number];
/** Parts that can't be left off. Mirrors AvatarParts in internal/database/maplooks.go. */
export const REQUIRED_PARTS: ReadonlySet<AvatarPart> = new Set(['skin', 'eyes', 'pants']);

export type SpriteLayer = { label: string; file: string; order: number };
type Entry = { cat: string; label: string; file: string };

/** Layers per part, in PSD order. order is the PSD index, which is also draw order. */
export const LAYERS: Record<AvatarPart | 'shadow', SpriteLayer[]> = (() => {
  const out = Object.fromEntries([...AVATAR_PARTS, 'shadow'].map((p) => [p, [] as SpriteLayer[]])) as Record<
    AvatarPart | 'shadow',
    SpriteLayer[]
  >;
  for (const e of manifest as Entry[]) {
    const list = out[e.cat as AvatarPart];
    if (list) list.push({ label: e.label, file: `sprite/layers/${e.file}`, order: parseInt(e.file.split('/')[1], 10) });
  }
  return out;
})();

/** Character sheet: 3 walk frames across, rows facing down, left, right, up. */
export const SHEET_FRAME = 48;
export const SHEET_ROWS = { down: 0, left: 1, right: 2, up: 3 } as const;
