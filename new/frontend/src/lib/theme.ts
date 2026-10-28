import { persistentAtom } from '@nanostores/persistent';

import { request } from './realtime';
import { $alert, $wsStatus } from './stores';

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

// Saved per user on the server; localStorage is a cache so layouts/Layout.astro
// can apply the theme before first paint.
export const $theme = persistentAtom<ThemeChoice>('owlchirp:theme', 'system');

type Settings = { theme: string };

function isThemeChoice(name: string): name is ThemeChoice {
  return name === 'system' || (THEMES as readonly string[]).includes(name);
}

export async function setTheme(choice: ThemeChoice): Promise<void> {
  $theme.set(choice);
  try {
    await request('settings.save', { theme: choice });
  } catch (e) {
    console.error('save settings', e);
    $alert.set({ kind: 'warning', message: 'Theme could not be saved to your account.' });
  }
}

// On each (re)connect the server's settings win. An account with none saved
// adopts this browser's choice, carrying over themes picked before settings
// moved to the server.
async function syncSettings(): Promise<void> {
  try {
    const settings = await request<Settings>('settings.get');
    if (isThemeChoice(settings.theme)) $theme.set(settings.theme);
    else if ($theme.get() !== 'system') await request('settings.save', { theme: $theme.get() });
  } catch {
    // Not enabled for this user, or the connection dropped; retried on reconnect.
  }
}

$wsStatus.subscribe((status) => {
  if (status === 'open') void syncSettings();
});

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
