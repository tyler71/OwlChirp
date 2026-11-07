import { atom, type WritableAtom } from 'nanostores';
import { onEvent, request } from './realtime';
import { $numberFeed, $wrapups, type Mood, type Wrapup, type WrapupFeed } from './stores';

const MAX_WRAPUPS = 50;
const MAX_FEED = 200;

export const MOODS: { value: Mood; emoji: string; label: string }[] = [
  { value: 'intense', emoji: '😤', label: 'Intense' },
  { value: 'friendly', emoji: '😊', label: 'Friendly' },
  { value: 'spam', emoji: '🚫', label: 'Spam' },
];

export const INCIDENT_MAX_LENGTH = 100;
export const THOUGHTS_MAX_LENGTH = 4000;

export type WrapupInput = Pick<Wrapup, 'contactId' | 'phoneNumber' | 'incident' | 'mood' | 'thoughts'>;

/** Insert or replace (by contact) a wrap-up in a feed if it's for that feed's number. */
function applyTo(store: WritableAtom<WrapupFeed | null>, wrapup: Wrapup): void {
  const feed = store.get();
  if (!feed || feed.phoneNumber !== wrapup.phoneNumber) return;

  const items = [wrapup, ...feed.items.filter((w) => w.contactId !== wrapup.contactId)].sort(
    (a, b) => b.timestamp - a.timestamp,
  );
  store.set({ ...feed, items });
}

function applyWrapup(wrapup: Wrapup): void {
  applyTo($wrapups, wrapup);
  applyTo($numberFeed, wrapup);
}

onEvent<Wrapup>('wrapup.saved', applyWrapup);

async function loadInto(store: WritableAtom<WrapupFeed | null>, phoneNumber: string, maxRecords: number): Promise<void> {
  store.set({ phoneNumber, items: [], loading: true });

  let items: Wrapup[] = [];
  try {
    items = (await request<Wrapup[]>('wrapups.list', { phoneNumber, maxRecords })) ?? [];
  } catch (e) {
    console.error('loadWrapups', e);
  }

  // Ignore stale responses if another number was loaded meanwhile.
  const feed = store.get();
  if (feed?.phoneNumber === phoneNumber) {
    // Keep anything pushed by wrapup.saved while the list was loading.
    const pushed = feed.items.filter((p) => !items.some((w) => w.contactId === p.contactId));
    store.set({ phoneNumber, items: [...pushed, ...items], loading: false });
  }
}

/** Load history for the current contact's number (shown in the call panel). */
export function loadWrapups(phoneNumber: string): Promise<void> {
  return loadInto($wrapups, phoneNumber, MAX_WRAPUPS);
}

/** Load history for a number looked up in the Feed view. */
export function loadNumberFeed(phoneNumber: string): Promise<void> {
  return loadInto($numberFeed, phoneNumber, MAX_FEED);
}

export function isEmptyWrapup(input: WrapupInput): boolean {
  return !input.incident.trim() && !input.mood && !input.thoughts.trim();
}

export async function saveWrapup(input: WrapupInput): Promise<Wrapup> {
  const saved = await request<Wrapup>('wrapups.save', input);
  applyWrapup(saved);
  return saved;
}

// ---- Draft for the contact on the line ----
// Kept in a store (not component state) so it carries over from the live call
// into after-call work, where Finish call saves it.

export type DraftStatus = { saving: boolean; saved: boolean; error: string | null };

export const $wrapupDraft = atom<WrapupInput | null>(null);
export const $wrapupStatus = atom<DraftStatus>({ saving: false, saved: false, error: null });

export function emptyDraft(contactId: string, phoneNumber: string): WrapupInput {
  return { contactId, phoneNumber, incident: '', mood: '', thoughts: '' };
}

/** Start a draft for contactId unless one is already in progress. */
export function draftFor(contactId: string, phoneNumber: string): void {
  if ($wrapupDraft.get()?.contactId === contactId) return;
  $wrapupDraft.set(emptyDraft(contactId, phoneNumber));
  $wrapupStatus.set({ saving: false, saved: false, error: null });
}

export function updateDraft(patch: Partial<Omit<WrapupInput, 'contactId' | 'phoneNumber'>>): void {
  const draft = $wrapupDraft.get();
  if (!draft) return;
  $wrapupDraft.set({ ...draft, ...patch });
  $wrapupStatus.set({ ...$wrapupStatus.get(), saved: false });
}

/**
 * Save the current draft if it has unsaved, non-empty changes. The draft is
 * kept so the agent can keep editing; saving again updates the same entry.
 */
export async function saveDraft(): Promise<boolean> {
  const draft = $wrapupDraft.get();
  const status = $wrapupStatus.get();
  if (!draft || status.saved || status.saving || isEmptyWrapup(draft)) return true;

  $wrapupStatus.set({ saving: true, saved: false, error: null });
  try {
    await saveWrapup(draft);
  } catch (e) {
    $wrapupStatus.set({ saving: false, saved: false, error: e instanceof Error ? e.message : 'Could not save' });
    return false;
  }
  // Edits made while the request was in flight still need saving.
  const unchanged = $wrapupDraft.get() === draft;
  $wrapupStatus.set({ saving: false, saved: unchanged, error: null });
  return true;
}
