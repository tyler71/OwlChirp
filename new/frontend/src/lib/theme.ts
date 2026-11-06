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

// Map proximity voice: when off, voice starts with mic and speakers muted
// each session (see voice.ts); when on, mute choices are remembered.
export const $proximityChat = persistentAtom<boolean>('owlchirp:proximityChat', false, {
  encode: JSON.stringify,
  decode: (v) => v === 'true',
});

// How map voice decides when to send, by default: voice threshold or push to talk.
export type VoiceMode = 'threshold' | 'ptt';
export const $voiceModeDefault = persistentAtom<VoiceMode>('owlchirp:voiceMode', 'threshold', {
  encode: String,
  decode: (v) => (v === 'ptt' ? 'ptt' : 'threshold'),
});

// Mic level (dBFS) that opens map voice in threshold mode. The range mirrors
// minVoiceThreshold/maxVoiceThreshold in backend ws_handlers.go.
export const DEFAULT_VOICE_THRESHOLD = -50;
export const MIN_VOICE_THRESHOLD = -80;
export const MAX_VOICE_THRESHOLD = -20;

export function clampVoiceThreshold(db: number): number {
  if (!Number.isFinite(db)) return DEFAULT_VOICE_THRESHOLD;
  return Math.min(MAX_VOICE_THRESHOLD, Math.max(MIN_VOICE_THRESHOLD, Math.round(db)));
}

export const $voiceThreshold = persistentAtom<number>('owlchirp:voiceThreshold', DEFAULT_VOICE_THRESHOLD, {
  encode: String,
  decode: (v) => (v === '' ? DEFAULT_VOICE_THRESHOLD : clampVoiceThreshold(Number(v))),
});

// Start live call transcription automatically when a call connects.
export const $autoTranscribe = persistentAtom<boolean>('owlchirp:autoTranscribe', true, {
  encode: JSON.stringify,
  decode: (v) => v !== 'false',
});

// Phone tab edit mode: cards can only be rearranged while on. Local only.
export const $phoneEditMode = persistentAtom<boolean>('owlchirp:phoneEditMode', false, {
  encode: JSON.stringify,
  decode: (v) => v === 'true',
});

export function setPhoneEditMode(enabled: boolean): void {
  $phoneEditMode.set(enabled);
}

// Phone tab cards the agent can rearrange, by column. Kept in this file with
// the other synced settings.
export const PHONE_CARDS = ['call', 'transcript', 'functions', 'flow', 'timeline'] as const;
export type PhoneCard = (typeof PHONE_CARDS)[number];
export type PhoneColumn = 'left' | 'right';
export type PhoneLayout = Record<PhoneColumn, PhoneCard[]>;

export const DEFAULT_PHONE_LAYOUT: PhoneLayout = {
  left: ['call', 'transcript', 'functions'],
  right: ['flow', 'timeline'],
};

function isPhoneCard(id: unknown): id is PhoneCard {
  return (PHONE_CARDS as readonly unknown[]).includes(id);
}

/**
 * Drops unknown and repeated cards and puts any missing ones back in their
 * default column, so a saved layout survives cards being added or removed.
 */
export function normalizePhoneLayout(raw: unknown): PhoneLayout {
  const seen = new Set<PhoneCard>();
  const out: PhoneLayout = { left: [], right: [] };
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<PhoneColumn, unknown>>;
  for (const col of ['left', 'right'] as const) {
    const ids = Array.isArray(src[col]) ? (src[col] as unknown[]) : [];
    for (const id of ids) {
      if (isPhoneCard(id) && !seen.has(id)) {
        seen.add(id);
        out[col].push(id);
      }
    }
  }
  for (const col of ['left', 'right'] as const) {
    for (const id of DEFAULT_PHONE_LAYOUT[col]) if (!seen.has(id)) out[col].push(id);
  }
  return out;
}

function isDefaultPhoneLayout(layout: PhoneLayout): boolean {
  return JSON.stringify(layout) === JSON.stringify(DEFAULT_PHONE_LAYOUT);
}

export const $phoneLayout = persistentAtom<PhoneLayout>('owlchirp:phoneLayout', DEFAULT_PHONE_LAYOUT, {
  encode: JSON.stringify,
  decode: (v) => {
    try {
      return normalizePhoneLayout(JSON.parse(v));
    } catch {
      return DEFAULT_PHONE_LAYOUT;
    }
  },
});

type Settings = {
  theme: string;
  phoneLayout?: PhoneLayout;
  followTeamMeeting?: boolean;
  hideCallerIds?: boolean;
  helpQueueThreshold?: number;
  proximityChat?: boolean;
  autoTranscribe?: boolean;
  voiceMode?: VoiceMode;
  voiceThreshold?: number;
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
      proximityChat: $proximityChat.get(),
      autoTranscribe: $autoTranscribe.get(),
      voiceMode: $voiceModeDefault.get(),
      voiceThreshold: $voiceThreshold.get(),
      phoneLayout: $phoneLayout.get(),
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

export function setProximityChat(enabled: boolean): Promise<void> {
  $proximityChat.set(enabled);
  return saveSettings('Proximity chat setting');
}

export function setVoiceModeDefault(mode: VoiceMode): Promise<void> {
  $voiceModeDefault.set(mode);
  return saveSettings('Voice setting');
}

/** Set the map voice threshold (dBFS) and save it to the account. */
export function setVoiceThreshold(db: number): Promise<void> {
  $voiceThreshold.set(clampVoiceThreshold(db));
  return saveSettings('Voice threshold');
}

export function setAutoTranscribe(enabled: boolean): Promise<void> {
  $autoTranscribe.set(enabled);
  return saveSettings('Transcription setting');
}

export function setPhoneLayout(layout: PhoneLayout): Promise<void> {
  $phoneLayout.set(normalizePhoneLayout(layout));
  return saveSettings('Card layout');
}

export function resetPhoneLayout(): Promise<void> {
  return setPhoneLayout(DEFAULT_PHONE_LAYOUT);
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
      $proximityChat.set(settings.proximityChat ?? false);
      $autoTranscribe.set(settings.autoTranscribe ?? true);
      $voiceModeDefault.set(settings.voiceMode === 'ptt' ? 'ptt' : 'threshold');
      $voiceThreshold.set(settings.voiceThreshold == null ? DEFAULT_VOICE_THRESHOLD : clampVoiceThreshold(settings.voiceThreshold));
      $phoneLayout.set(normalizePhoneLayout(settings.phoneLayout));
    } else if (
      $theme.get() !== 'system' ||
      $followTeamMeeting.get() ||
      $hideCallerIds.get() ||
      $helpQueueThreshold.get() !== DEFAULT_HELP_QUEUE_THRESHOLD ||
      $proximityChat.get() ||
      !$autoTranscribe.get() ||
      $voiceModeDefault.get() !== 'threshold' ||
      $voiceThreshold.get() !== DEFAULT_VOICE_THRESHOLD ||
      !isDefaultPhoneLayout($phoneLayout.get())
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
