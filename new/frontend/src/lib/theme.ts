import { persistentAtom } from '@nanostores/persistent';

import { DEFAULT_HELP_QUEUE_THRESHOLD } from './const';
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

// Switch to "In a meeting" when most of the team is in one (see teamMeeting.ts).
export const $followTeamMeeting = persistentAtom<boolean>('owlchirp:followTeamMeeting', false, {
  encode: JSON.stringify,
  decode: (v) => v === 'true',
});

// Opt out of caller ID names replacing phone numbers (see callerId.ts).
export const $hideCallerIds = persistentAtom<boolean>('owlchirp:hideCallerIds', false, {
  encode: JSON.stringify,
  decode: (v) => v === 'true',
});

// Queue count at which a non-routable agent is alerted to help (0 = off).
export const $helpQueueThreshold = persistentAtom<number>('owlchirp:helpQueueThreshold', DEFAULT_HELP_QUEUE_THRESHOLD, {
  encode: String,
  decode: (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : DEFAULT_HELP_QUEUE_THRESHOLD;
  },
});

type Settings = {
  theme: string;
  followTeamMeeting?: boolean;
  hideCallerIds?: boolean;
  helpQueueThreshold?: number;
};

function isThemeChoice(name: string): name is ThemeChoice {
  return name === 'system' || (THEMES as readonly string[]).includes(name);
}

// settings.save replaces the whole record, so always send every field.
async function saveSettings(what: string): Promise<void> {
  try {
    await request('settings.save', {
      theme: $theme.get(),
      followTeamMeeting: $followTeamMeeting.get(),
      hideCallerIds: $hideCallerIds.get(),
      helpQueueThreshold: $helpQueueThreshold.get(),
    });
  } catch (e) {
    console.error('save settings', e);
    $alert.set({ kind: 'warning', message: `${what} could not be saved to your account.` });
  }
}

export function setTheme(choice: ThemeChoice): Promise<void> {
  $theme.set(choice);
  return saveSettings('Theme');
}

export function setFollowTeamMeeting(enabled: boolean): Promise<void> {
  $followTeamMeeting.set(enabled);
  return saveSettings('Meeting setting');
}

export function setHideCallerIds(hidden: boolean): Promise<void> {
  $hideCallerIds.set(hidden);
  return saveSettings('Caller ID setting');
}

export function setHelpQueueThreshold(count: number): Promise<void> {
  $helpQueueThreshold.set(Number.isFinite(count) ? Math.max(0, Math.floor(count)) : DEFAULT_HELP_QUEUE_THRESHOLD);
  return saveSettings('Help alert setting');
}

// On each (re)connect the server's settings win. An account with none saved
// adopts this browser's choices, carrying over themes picked before settings
// moved to the server.
async function syncSettings(): Promise<void> {
  try {
    const settings = await request<Settings>('settings.get');
    if (isThemeChoice(settings.theme)) {
      $theme.set(settings.theme);
      $followTeamMeeting.set(settings.followTeamMeeting ?? false);
      $hideCallerIds.set(settings.hideCallerIds ?? false);
      $helpQueueThreshold.set(settings.helpQueueThreshold ?? DEFAULT_HELP_QUEUE_THRESHOLD);
    } else if (
      $theme.get() !== 'system' ||
      $followTeamMeeting.get() ||
      $hideCallerIds.get() ||
      $helpQueueThreshold.get() !== DEFAULT_HELP_QUEUE_THRESHOLD
    ) {
      await saveSettings('Settings');
    }
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
