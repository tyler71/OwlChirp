import { RECENT_CALLS_MAX } from './const';
import { sleep } from './helpers';
import { onEvent, request } from './realtime';
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

function upsertLocal(call: Call): void {
  const others = ($calls.get() ?? []).filter((c) => !call.contactId || c.contactId !== call.contactId);
  $calls.set(sortNewestFirst([call, ...others]).slice(0, MAX_LOCAL_CALLS));
}

// Another tab or device signed in as this agent logged a call.
onEvent<Call>('call.logged', (call) => {
  if ($calls.get() !== null && call.agent === $agent.get()?.getConfiguration().username) {
    upsertLocal(call);
  }
});

/** Load the agent's recent calls, retrying until the backend answers. */
export async function refreshCalls(): Promise<Call[]> {
  for (let delay = 1000; ; delay = Math.min(delay * 1.5, 30000)) {
    try {
      const calls = sortNewestFirst((await request<Call[]>('calls.agent', { maxRecords: RECENT_CALLS_MAX })) ?? []);
      $calls.set(calls);
      return calls;
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

  upsertLocal(call);

  try {
    await request('calls.log', call);
  } catch (e) {
    console.error('Failed to save call', e);
  }
}
