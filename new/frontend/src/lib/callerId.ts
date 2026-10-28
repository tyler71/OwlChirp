import { onEvent, request } from './realtime';
import { $callerId, type CallerId } from './stores';

type SavedCallerId = { phoneNumber: string; name: string };

// Any agent renaming the current caller updates everyone's display.
onEvent<SavedCallerId>('callerid.updated', ({ phoneNumber, name }) => {
  if ($callerId.get()?.phoneNumber === phoneNumber) {
    $callerId.set({ phoneNumber, name });
  }
});

export async function getCallerIdName(phoneNumber: string): Promise<string | null> {
  const data = await request<SavedCallerId | null>('callerid.get', { phoneNumber });
  return data?.name || null;
}

export async function loadCallerId(phoneNumber: string): Promise<void> {
  $callerId.set({ phoneNumber, name: null });
  const name = await getCallerIdName(phoneNumber);
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
  if ($callerId.get()?.phoneNumber === phoneNumber) {
    $callerId.set({ phoneNumber, name });
  }
  return true;
}
