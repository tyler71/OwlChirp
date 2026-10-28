import { persistentAtom } from '@nanostores/persistent';

// All daisyUI 5 themes (enabled with `themes: all` in global.css).
export const THEMES = [
  'light', 'dark', 'cupcake', 'bumblebee', 'emerald', 'corporate', 'synthwave', 'retro', 'cyberpunk',
  'valentine', 'halloween', 'garden', 'forest', 'aqua', 'lofi', 'pastel', 'fantasy', 'wireframe', 'black',
  'luxury', 'dracula', 'cmyk', 'autumn', 'business', 'acid', 'lemonade', 'night', 'coffee', 'winter', 'dim',
  'nord', 'sunset', 'caramellatte', 'abyss', 'silk',
] as const;

export type ThemeName = (typeof THEMES)[number];
export type ThemeChoice = 'system' | ThemeName;

// Themes declaring `color-scheme: dark`. Keep in sync with the inline script
// in layouts/Layout.astro.
export const DARK_THEMES: ReadonlySet<string> = new Set([
  'abyss', 'aqua', 'black', 'business', 'coffee', 'dark', 'dim', 'dracula', 'forest', 'halloween', 'luxury',
  'night', 'sunset', 'synthwave',
]);

export const $theme = persistentAtom<ThemeChoice>('owlchirp:theme', 'system');

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(choice: ThemeChoice): void {
  const name = choice === 'system' ? (systemDark.matches ? 'dark' : 'light') : choice;
  const root = document.documentElement;
  root.dataset.theme = name;
  root.dataset.scheme = DARK_THEMES.has(name) ? 'dark' : 'light';
}

$theme.subscribe(applyTheme);
systemDark.addEventListener('change', () => {
  if ($theme.get() === 'system') applyTheme('system');
});
