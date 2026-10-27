import { apiFetch } from './auth';
import { API, RECENT_CALLS_MAX } from './const';
import { sleep } from './helpers';
import { $agent, $calls, type Call } from './stores';

const MAX_LOCAL_CALLS = 50;

function username(): string {
  const agent = $agent.get();
  if (!agent) throw new Error('CCP agent not ready');
  return agent.getConfiguration().username;
}

function sortNewestFirst(calls: Call[]): Call[] {
  return [...calls].sort((a, b) => b.timestamp - a.timestamp);
}

/** Load the agent's recent calls, retrying until the backend answers. */
export async function refreshCalls(): Promise<Call[]> {
  const params = new URLSearchParams({ username: username(), max_records: String(RECENT_CALLS_MAX) });

  for (let delay = 1000; ; delay = Math.min(delay * 1.5, 30000)) {
    try {
      const res = await apiFetch(`${API}/calls/agent?${params}`);
      if (res.ok) {
        const calls = sortNewestFirst((await res.json()) ?? []);
        $calls.set(calls);
        return calls;
      }
    } catch (e) {
      console.error('refreshCalls', e);
    }
    await sleep(delay);
  }
}

export async function addCall(contactId: string, phoneNumber: string): Promise<void> {
  const call: Call = {
    contactId,
    phoneNumber,
    timestamp: Date.now(),
    agent: username(),
  };

  $calls.set(sortNewestFirst([call, ...($calls.get() ?? [])]).slice(0, MAX_LOCAL_CALLS));

  const res = await apiFetch(`${API}/calls/agent`, {
    method: 'POST',
    body: JSON.stringify(call),
  });
  if (!res.ok) {
    console.error('Failed to save call', res.status);
  }
}
