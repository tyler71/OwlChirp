import { useStore } from '@nanostores/react';
import { map } from 'nanostores';
import { useEffect } from 'react';

import { formatPhoneNumber } from './helpers';
import { onEvent, request } from './realtime';
import { $callerId, type CallerId } from './stores';
import { $hideCallerIds } from './theme';

export type SavedCallerId = { phoneNumber: string; name: string };

// Every number looked up this page load → its saved name (null = none saved).
// Kept live by the callerid.* events so all displays follow renames.
export const $callerNames = map<Record<string, string | null>>({});
const pending = new Map<string, Promise<void>>();

function rememberName(phoneNumber: string, name: string | null): void {
  $callerNames.setKey(phoneNumber, name);
}

// Any agent renaming a caller updates everyone's display.
onEvent<SavedCallerId>('callerid.updated', ({ phoneNumber, name }) => {
  rememberName(phoneNumber, name);
  if ($callerId.get()?.phoneNumber === phoneNumber) {
    $callerId.set({ phoneNumber, name });
  }
});

// A deleted caller ID falls back to showing the number.
onEvent<{ phoneNumber: string }>('callerid.deleted', ({ phoneNumber }) => {
  rememberName(phoneNumber, null);
  if ($callerId.get()?.phoneNumber === phoneNumber) {
    $callerId.set({ phoneNumber, name: null });
  }
});

export async function getCallerIdName(phoneNumber: string): Promise<string | null> {
  const data = await request<SavedCallerId | null>('callerid.get', { phoneNumber });
  return data?.name || null;
}

// Looks a number up once per page load; failures are retried on next use.
export function ensureCallerName(phoneNumber: string): void {
  if (!phoneNumber || phoneNumber in $callerNames.get() || pending.has(phoneNumber)) return;
  const lookup = getCallerIdName(phoneNumber)
    .then((name) => rememberName(phoneNumber, name))
    .catch(() => {})
    .finally(() => pending.delete(phoneNumber));
  pending.set(phoneNumber, lookup);
}

/** Saved caller ID name for a number, or null. Ignores the opt-out setting. */
export function useCallerName(phoneNumber: string): string | null {
  const names = useStore($callerNames);
  useEffect(() => ensureCallerName(phoneNumber), [phoneNumber]);
  return (phoneNumber && names[phoneNumber]) || null;
}

/** Caller ID name if shown, else null. Respects the agent's opt-out. */
export function useDisplayName(phoneNumber: string): string | null {
  const name = useCallerName(phoneNumber);
  const hidden = useStore($hideCallerIds);
  return hidden ? null : name;
}

/** What to show for a phone number: its caller ID name, or the formatted number. */
export function usePhoneLabel(phoneNumber: string): string {
  return useDisplayName(phoneNumber) ?? formatPhoneNumber(phoneNumber);
}

export async function loadCallerId(phoneNumber: string): Promise<void> {
  $callerId.set({ phoneNumber, name: null });
  const name = await getCallerIdName(phoneNumber);
  rememberName(phoneNumber, name);
  // Ignore stale responses if another call came in meanwhile.
  if ($callerId.get()?.phoneNumber === phoneNumber) {
    $callerId.set({ phoneNumber, name } satisfies CallerId);
  }
}

export async function saveCallerId(phoneNumber: string, name: string): Promise<boolean> {
  try {
    await request('callerid.set', { phoneNumber, name });
  } catch (e) {
    console.error('Failed to update caller Id', e);
    return false;
  }
  rememberName(phoneNumber, name);
  if ($callerId.get()?.phoneNumber === phoneNumber) {
    $callerId.set({ phoneNumber, name });
  }
  return true;
}

// Admin only: every saved caller ID, ordered by name.
export function listCallerIds(): Promise<SavedCallerId[]> {
  return request<SavedCallerId[]>('callerid.list');
}

// Admin only.
export async function deleteCallerId(phoneNumber: string): Promise<void> {
  await request('callerid.delete', { phoneNumber });
}
