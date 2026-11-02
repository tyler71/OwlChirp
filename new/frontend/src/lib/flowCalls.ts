import { onEvent, request } from './realtime';
import { normalizePhoneNumber } from './helpers';
import { $flowCalls, $numberCalls, $wsStatus, type FlowCall } from './stores';

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

onEvent<FlowCall>('flowcall.updated', (call) => {
  const history = $numberCalls.get();
  if (!history || normalizePhoneNumber(history.phoneNumber) !== normalizePhoneNumber(call.phoneNumber)) return;
  $numberCalls.set({
    ...history,
    calls: [call, ...history.calls.filter((c) => c.contactId !== call.contactId)].sort(
      (a, b) => b.initiatedAt - a.initiatedAt,
    ),
  });
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

/** Load the inbound call history for phoneNumber (the current contact's caller). */
export async function loadNumberCalls(phoneNumber: string): Promise<void> {
  $numberCalls.set({ phoneNumber, calls: [], loading: true });
  let calls: FlowCall[] = [];
  try {
    calls = (await request<FlowCall[]>('flowcalls.number', { phoneNumber: normalizePhoneNumber(phoneNumber) })) ?? [];
  } catch (e) {
    console.error('loadNumberCalls', e);
  }
  // Ignore stale responses; keep calls pushed by flowcall.updated meanwhile.
  const current = $numberCalls.get();
  if (current?.phoneNumber !== phoneNumber) return;
  const pushed = current.calls.filter((p) => !calls.some((c) => c.contactId === p.contactId));
  $numberCalls.set({
    phoneNumber,
    calls: [...pushed, ...calls].sort((a, b) => b.initiatedAt - a.initiatedAt),
    loading: false,
  });
}
