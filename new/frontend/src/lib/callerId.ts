import { apiFetch } from './auth';
import { API } from './const';
import { $callerId } from './stores';

export async function getCallerIdName(phoneNumber: string): Promise<string | null> {
  const params = new URLSearchParams({ phone_number: phoneNumber });
  const res = await apiFetch(`${API}/calls/callerid?${params}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.name || null;
}

export async function loadCallerId(phoneNumber: string): Promise<void> {
  $callerId.set({ phoneNumber, name: null });
  const name = await getCallerIdName(phoneNumber);
  // Ignore stale responses if another call came in meanwhile.
  if ($callerId.get()?.phoneNumber === phoneNumber) {
    $callerId.set({ phoneNumber, name });
  }
}

export async function saveCallerId(phoneNumber: string, name: string): Promise<boolean> {
  const res = await apiFetch(`${API}/calls/callerid`, {
    method: 'PUT',
    body: JSON.stringify({ phone_number: phoneNumber, name }),
  });
  if (!res.ok) {
    console.error('Failed to update caller Id, network error');
    return false;
  }
  if ($callerId.get()?.phoneNumber === phoneNumber) {
    $callerId.set({ phoneNumber, name });
  }
  return true;
}
