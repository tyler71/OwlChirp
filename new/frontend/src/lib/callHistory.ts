import { RECENT_CALLS_PAGE_SIZE } from './const';
import { sleep } from './helpers';
import { onEvent, request } from './realtime';
import { $agent, $calls, $callsPage, $isAdmin, type Call, type FlowCall } from './stores';

type CallPage = { calls: Call[]; total: number };

function username(): string {
  const agent = $agent.get();
  if (!agent) throw new Error('CCP agent not ready');
  return agent.getConfiguration().username;
}

function sortNewestFirst(calls: Call[]): Call[] {
  return [...calls].sort((a, b) => b.timestamp - a.timestamp);
}

export function totalPages(total: number): number {
  return Math.max(1, Math.ceil(total / RECENT_CALLS_PAGE_SIZE));
}

// Calls already added to the total since the last server load, so a call
// logged here and echoed back as call.logged is only counted once.
const counted = new Set<string>();
const callKey = (call: Call) => call.contactId || `${call.agent}-${call.timestamp}`;

// A call newer than anything loaded: bump the total, and show it if on page 1.
function noteNewCall(call: Call): void {
  const { page, total } = $callsPage.get();
  const key = callKey(call);
  if (!counted.has(key)) {
    counted.add(key);
    $callsPage.set({ page, total: total + 1 });
  }
  if (page !== 1) return;
  const calls = $calls.get() ?? [];
  const existing = call.contactId ? calls.find((c) => c.contactId === call.contactId) : undefined;
  // A bare browser-logged entry never replaces one with Connect details.
  if (existing?.connectedAt && !call.connectedAt) return;
  const others = calls.filter((c) => c !== existing);
  $calls.set(sortNewestFirst([call, ...others]).slice(0, RECENT_CALLS_PAGE_SIZE));
}

// When the shown page was last loaded from the server; calls answered before
// then are already in its total.
let loadedAt = 0;

// Apply a flow call update: refresh a shown call in place, or add a new one.
function noteFlowCall(call: Call): void {
  const calls = $calls.get();
  if (calls === null) return;
  if (calls.some((c) => c.contactId === call.contactId)) {
    counted.add(callKey(call));
    $calls.set(calls.map((c) => (c.contactId === call.contactId ? call : c)));
  } else if ((call.connectedAt ?? 0) >= loadedAt) {
    noteNewCall(call);
  }
}

// A call was logged elsewhere: admins see every agent's calls, everyone else
// only their own (from another tab or device).
onEvent<Call>('call.logged', (call) => {
  if ($calls.get() === null) return;
  if ($isAdmin.get() || isMine(call.agent)) {
    noteNewCall(call);
  }
});

/** The Recent Calls entry for an answered flow call (same shape the server pages return). */
export function flowCallToCall(fc: FlowCall): Call {
  return {
    agent: fc.agentUsername,
    phoneNumber: fc.phoneNumber,
    timestamp: fc.connectedAt,
    contactId: fc.contactId,
    agentName: fc.agentName,
    queueName: fc.queueName,
    initiatedAt: fc.initiatedAt,
    enqueuedAt: fc.enqueuedAt,
    connectedAt: fc.connectedAt,
    disconnectedAt: fc.disconnectedAt,
  };
}

const isMine = (agent: string) => agent.toLowerCase() === $agent.get()?.getConfiguration().username.toLowerCase();

// The flow poller (shared with the Timeline) saw a call answered or updated;
// it replaces any bare entry the browser logged for the same contact.
onEvent<FlowCall>('flowcall.updated', (fc) => {
  if (!fc.connectedAt || !fc.agentUsername) return;
  if ($isAdmin.get() || isMine(fc.agentUsername)) {
    noteFlowCall(flowCallToCall(fc));
  }
});

// Permission can arrive or change after the first load; reload in the new scope.
$isAdmin.listen(() => {
  if ($calls.get() !== null) void loadCallsPage(1);
});

async function fetchPage(page: number): Promise<CallPage> {
  const res = await request<CallPage>($isAdmin.get() ? 'calls.all' : 'calls.agent', {
    maxRecords: RECENT_CALLS_PAGE_SIZE,
    offset: (page - 1) * RECENT_CALLS_PAGE_SIZE,
  });
  return { calls: sortNewestFirst(res?.calls ?? []), total: res?.total ?? 0 };
}

// Fetch a page; if it's past the end (calls shrank), fall back to the last page.
async function load(page: number): Promise<Call[]> {
  const requestedAt = Date.now();
  let res = await fetchPage(page);
  const last = totalPages(res.total);
  if (page > last) {
    page = last;
    res = await fetchPage(page);
  }
  counted.clear();
  loadedAt = requestedAt;
  $calls.set(res.calls);
  $callsPage.set({ page, total: res.total });
  return res.calls;
}

/** Load the current page of recent calls (all agents for admins, otherwise the agent's own), retrying until the backend answers. */
export async function refreshCalls(): Promise<Call[]> {
  for (let delay = 1000; ; delay = Math.min(delay * 1.5, 30000)) {
    try {
      return await load($callsPage.get().page);
    } catch (e) {
      console.error('refreshCalls', e);
    }
    await sleep(delay);
  }
}

/** Switch to another page of recent calls; keeps the current page shown if the request fails. */
export async function loadCallsPage(page: number): Promise<void> {
  const previous = $calls.get();
  $calls.set(null);
  try {
    await load(Math.max(1, page));
  } catch (e) {
    console.error('loadCallsPage', e);
    $calls.set(previous);
  }
}

export async function addCall(contactId: string, phoneNumber: string): Promise<void> {
  const call: Call = {
    contactId,
    phoneNumber,
    timestamp: Date.now(),
    agent: username(),
  };

  if ($calls.get() !== null) noteNewCall(call);

  try {
    await request('calls.log', call);
  } catch (e) {
    console.error('Failed to save call', e);
  }
}
