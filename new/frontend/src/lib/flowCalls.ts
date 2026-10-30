import { onEvent, request } from './realtime';
import { $flowCalls, $wsStatus, type FlowCall } from './stores';

const HISTORY_HOURS = 24;
const HISTORY_MS = HISTORY_HOURS * 60 * 60 * 1000;

export type FlowStage = 'flow' | 'queued' | 'answered' | 'abandonedFlow' | 'abandonedQueue';

export function flowStage(call: FlowCall): FlowStage {
  if (call.connectedAt) return 'answered';
  if (call.disconnectedAt) return call.enqueuedAt ? 'abandonedQueue' : 'abandonedFlow';
  return call.enqueuedAt ? 'queued' : 'flow';
}

/** Still in the flow or queue, not yet with an agent. */
export function isLive(call: FlowCall): boolean {
  return !call.connectedAt && !call.disconnectedAt;
}

onEvent<FlowCall>('flowcall.updated', (call) => {
  const calls = $flowCalls.get();
  if (calls === null) return;
  const cutoff = Date.now() - HISTORY_MS;
  $flowCalls.set(
    [call, ...calls.filter((c) => c.contactId !== call.contactId)]
      .filter((c) => c.initiatedAt >= cutoff)
      .sort((a, b) => b.initiatedAt - a.initiatedAt),
  );
});

// Updates pushed while the socket was down are lost; reload once it's back.
$wsStatus.listen((status) => {
  if (status === 'open' && $flowCalls.get() !== null) {
    loadFlowCalls().catch((e) => console.error('loadFlowCalls', e));
  }
});

export async function loadFlowCalls(): Promise<void> {
  const calls = (await request<FlowCall[]>('flowcalls.list', { hours: HISTORY_HOURS })) ?? [];
  $flowCalls.set(calls);
}
