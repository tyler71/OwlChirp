import { RECENT_CALLS_PAGE_SIZE } from './const';
import { sleep } from './helpers';
import { onEvent, request } from './realtime';
import { $agent, $calls, $callsPage, $isAdmin, type Call } from './stores';

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
  const others = ($calls.get() ?? []).filter((c) => !call.contactId || c.contactId !== call.contactId);
  $calls.set(sortNewestFirst([call, ...others]).slice(0, RECENT_CALLS_PAGE_SIZE));
}

// A call was logged elsewhere: admins see every agent's calls, everyone else
// only their own (from another tab or device).
onEvent<Call>('call.logged', (call) => {
  if ($calls.get() === null) return;
  if ($isAdmin.get() || call.agent === $agent.get()?.getConfiguration().username) {
    noteNewCall(call);
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
  let res = await fetchPage(page);
  const last = totalPages(res.total);
  if (page > last) {
    page = last;
    res = await fetchPage(page);
  }
  counted.clear();
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
