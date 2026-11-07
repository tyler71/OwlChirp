import { EXCLUDED_STATUSES, STATUS_AFTERCALL } from './const';
import { $agent, $config } from './stores';

export function formatSecondsToTime(seconds: number): string {
  const date = new Date(0);
  date.setSeconds(seconds);
  return date.toISOString().substring(11, 19);
}

export function formatPhoneNumber(phone: string): string {
  let fn = String(phone).split(/ /)[0].replace(/\D/g, '');
  if (fn.length > 10) {
    fn = fn.slice(fn.length - 10);
  }
  return `(${fn.slice(0, 3)}) ${fn.slice(3, 6)}-${fn.slice(6, 10)}`;
}

/** Best-effort E.164 for a typed number; US numbers without a country code get +1. */
export function normalizePhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  if (phone.trim().startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

/** Short display name for a Connect username (drops any email domain). */
export function agentName(username: string): string {
  return username.split('@')[0];
}

const callTimeFormat = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  hour: 'numeric',
  minute: 'numeric',
});

export function formatCallTime(value: number | string | Date): string {
  return callTimeFormat.format(new Date(value));
}

export async function sha256Hex(value: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function telemetry(agent: connect.Agent): Promise<void> {
  const url = $config.get()?.telemetryUrl;
  if (!url) return;

  const name = agent.getName().toLocaleLowerCase();
  const rest = await sha256Hex(name);
  const body = {
    name: `${name.substring(0, 2)}${rest.substring(0, 23)}`,
    call_count: 1,
  };

  console.info(`Incrementing call count to ${url}`);
  try {
    await fetch(url, { method: 'POST', body: JSON.stringify(body) });
  } catch (e) {
    console.error('telemetry failed', e);
  }
}

// Agent id from the agent's personal queue ARN:
// arn:aws:connect:{region}:{account}:instance/{instance}/queue/agent/{agentId}
const AGENT_QUEUE_PATTERN = /arn:aws:connect:([\w|-]+):(\w+):instance\/([\w|-]+)\/queue\/agent\/([\w|-]+)/;

export function getAgentId(agent: connect.Agent): string | null {
  const queue = agent.getConfiguration().routingProfile.queues.find((q) => q.name === null);
  const groups = queue ? AGENT_QUEUE_PATTERN.exec(queue.queueARN) : null;
  return groups ? groups[4] : null;
}

export function setToState(agent: connect.Agent, state: string): void {
  const requested = agent.getAgentStates().find((s) => s.name === state);
  if (requested) agent.setState(requested);
}

// An agent on the "sideline" is not routable, but could be.
export function agentSideline(): boolean {
  const agent = $agent.get();
  if (!agent) return false;

  const state = agent.getState();
  const name = state.name.toLowerCase();
  const notRoutable = state.type === connect.AgentStateType.NOT_ROUTABLE || name === STATUS_AFTERCALL;
  return notRoutable && !EXCLUDED_STATUSES.has(name);
}

const INCIDENT_SEARCH_URL = 'https://seattleschools.service-now.com/text_search_exact_match.do?sysparm_search=';

/** ServiceNow exact-match search URL for an incident number. */
export function incidentUrl(incident: string): string {
  return INCIDENT_SEARCH_URL + encodeURIComponent(incident.trim());
}
