import { atom, computed, map, type ReadableAtom } from 'nanostores';
import { persistentAtom, persistentMap } from '@nanostores/persistent';
import { SIDELINE_STATUSES, type STATUS } from './const';

export type AppConfig = {
  connectDomain: string;
  connectInstance: string;
  timeZone: string;
  telemetryUrl: string;
};

export type ActiveUser = {
  user_id: string;
  status: { name: STATUS };
  user: { username: string; first_name: string; last_name: string };
};

export type Metrics = {
  queue_count?: number;
  available_count?: number;
  active_agent_count?: number;
  user_list?: ActiveUser[];
  handled_incoming?: number;
};

// "available/active+sideline" agent counter (e.g. 0/3+2) with its tooltip,
// or null until the counts and user list have loaded.
export function agentCountLabel(m: Metrics): { text: string; title: string } | null {
  const { available_count, active_agent_count, user_list } = m;
  if (available_count === undefined || active_agent_count === undefined || user_list === undefined) return null;
  const sideline = user_list.filter((u) => SIDELINE_STATUSES.has(u.status.name.toLowerCase())).length;
  return {
    text: `${available_count}/${active_agent_count}${sideline > 0 ? `+${sideline}` : ''}`,
    title:
      `${available_count} able to take a call now, ${active_agent_count} taking calls.` +
      (sideline > 0 ? ` ${sideline} ready to help` : ''),
  };
}

// A Recent Calls entry. Inbound calls the flow poller saw carry their Connect
// details (ms epoch); calls only a browser logged (e.g. outbound) don't.
export type Call = {
  agent: string;
  phoneNumber: string;
  timestamp: number;
  contactId: string;
  agentName?: string;
  queueName?: string;
  initiatedAt?: number;
  enqueuedAt?: number;
  connectedAt?: number;
  disconnectedAt?: number;
};

export type CallerId = {
  phoneNumber: string;
  name: string | null;
};

export type Mood = 'intense' | 'friendly' | 'spam';

export type Wrapup = {
  contactId: string;
  phoneNumber: string;
  agent: string;
  incident: string;
  mood: Mood | '';
  thoughts: string;
  timestamp: number;
};

export type WrapupFeed = {
  phoneNumber: string;
  items: Wrapup[];
  loading: boolean;
};

// An inbound call seen in the Connect contact flow. Times are ms epoch; 0
// means the call hasn't reached that stage.
export type FlowCall = {
  contactId: string;
  phoneNumber: string;
  queueName: string;
  agentName: string;
  agentUsername: string;
  initiatedAt: number;
  enqueuedAt: number;
  connectedAt: number;
  disconnectedAt: number;
};

export type Alert = {
  kind: 'welcome' | 'warning' | 'none';
  message?: string;
};

// ---- Transient state ----

export const $config = atom<AppConfig | null>(null);

// The CCP agent, set once the CCP has initialised.
export const $agent = atom<connect.Agent | null>(null);

// Realtime metrics, merged key by key from the WebSocket.
export const $metrics = map<Metrics>({});

export const $calls = atom<Call[] | null>(null);

// Current Recent Calls page (1-based) and the total number of calls in scope.
export const $callsPage = atom<{ page: number; total: number }>({ page: 1, total: 0 });

export const $callerId = atom<CallerId | null>(null);

// Past wrap-ups for the number of the current (or last) contact.
export const $wrapups = atom<WrapupFeed | null>(null);
/** Inbound calls from the current contact's number (Phone tab call history). */
export const $numberCalls = atom<{ phoneNumber: string; calls: FlowCall[]; loading: boolean } | null>(null);

// Wrap-ups for the number looked up in the Feed view.
export const $numberFeed = atom<WrapupFeed | null>(null);

// Inbound calls from the contact flow, newest first; null until loaded.
export const $flowCalls = atom<FlowCall[] | null>(null);

export type FlowCallBucket = {
  start: number;
  total: number;
  answered: number;
  abandoned: number;
  calls: FlowCall[];
};

export type FlowTimeline = {
  generatedAt: number;
  hours: number;
  bucketMinutes: number;
  buckets: FlowCallBucket[];
};

export const $timeline = atom<FlowTimeline | null>(null);

// Which main view the sidebar has selected.
export type View = 'phone' | 'calls' | 'feed' | 'flow' | 'timeline' | 'map' | 'callerids' | 'admin' | 'settings' | 'log';
export const $view = atom<View>('phone');

export const $alert = atom<Alert>({ kind: 'welcome' });

export const $wsStatus = atom<'connecting' | 'open' | 'closed'>('connecting');

// Features an admin can grant each user. Phone and Settings are always
// available. Mirrors internal/features in the backend; update both together.
export const FEATURES = [
  { key: 'feed', label: 'Feed', detail: 'Team call wrapups' },
  { key: 'flow', label: 'Flow Calls', detail: 'Live calls in flow and queue, queue badge, call flow card' },
  { key: 'timeline', label: 'Timeline', detail: 'Call volume over time' },
  { key: 'calls', label: 'Recent Calls', detail: 'Own call history' },
  { key: 'callsAll', label: 'All calls', detail: "Every agent's calls in Recent Calls" },
  { key: 'callerHistory', label: 'Caller history', detail: 'Past calls from the active caller' },
  { key: 'transcription', label: 'Voice transcription', detail: 'Live transcript of the current call on the Phone tab' },
  { key: 'callerIds', label: 'Caller IDs', detail: 'Manage outbound caller IDs' },
  { key: 'agentNames', label: 'Agent names', detail: 'Agent names in Feed, Flow Calls, Timeline and call details' },
  { key: 'map', label: 'Map', detail: 'Team map with live incoming calls' },
  { key: 'mapEdit', label: 'Map buildings', detail: 'Manage Map buildings and the numbers they match' },
  { key: 'mapDesign', label: 'Map design', detail: 'Move Map buildings, paint ground and place decorations' },
  { key: 'admin', label: 'Admin', detail: 'Admin page and user permissions' },
] as const;

export type Feature = (typeof FEATURES)[number]['key'];

export const ALL_FEATURES: Feature[] = FEATURES.map((f) => f.key);

// Feature sets matching the old permission levels.
export const PRESETS: { key: string; label: string; features: Feature[] }[] = [
  { key: 'standard', label: 'Standard', features: ['map'] },
  {
    key: 'power',
    label: 'Power',
    features: ['feed', 'flow', 'timeline', 'calls', 'callerHistory', 'transcription', 'callerIds', 'map', 'mapEdit', 'mapDesign'],
  },
  { key: 'admin', label: 'Admin', features: ALL_FEATURES },
];

// This agent's features, sent by the server after socket auth.
export const $features = atom<Feature[]>([]);

/** Whether this agent has feature right now. */
export function can(feature: Feature): boolean {
  return $features.get().includes(feature);
}

const featureStores = new Map<Feature, ReadableAtom<boolean>>();

/** A store that is true while this agent has feature; use with useStore. */
export function $can(feature: Feature): ReadableAtom<boolean> {
  let store = featureStores.get(feature);
  if (!store) featureStores.set(feature, (store = computed($features, (list) => list.includes(feature))));
  return store;
}

// Whether the CCP iframe can read its Connect cookies (blocked by Firefox ETP
// and other third-party cookie partitioning until the agent allows access).
export const $storageAccess = atom<'unknown' | 'needed' | 'granted' | 'denied'>('unknown');

// ---- Softphone ----
// Streams objects mutate in place, so the UI renders from plain snapshots
// that lib/softphone.ts refreshes on every agent/contact event.

export type AgentSnapshot = {
  name: string;
  stateName: string;
  stateType: string;
  stateStartedAt: number;
  nextStateName: string | null;
  states: connect.AgentStateDefinition[];
  muted: boolean;
};

export type ConnectionSnapshot = {
  id: string;
  isInitial: boolean;
  label: string;
  // Set for phone number endpoints so the label can show a caller ID name.
  phoneNumber?: string;
  status: string;
  statusStartedAt: number;
};

export type ContactSnapshot = {
  contactId: string;
  status: string;
  statusStartedAt: number;
  isInbound: boolean;
  phoneNumber: string;
  connections: ConnectionSnapshot[];
};

export type QuickConnect = {
  endpointARN: string;
  name: string;
  type: string;
};

export const $agentSnapshot = atom<AgentSnapshot | null>(null);

// A teammate asking agents who aren't taking calls to become available.
export type HelpRequest = {
  agent: string;
  name: string;
  queueCount: number;
  timestamp: number;
};

// The help request shown to this agent; null when there is none.
export const $helpRequest = atom<HelpRequest | null>(null);

// When this agent last asked for help (ms epoch), for the button cooldown.
export const $helpRequestedAt = atom<number>(0);

export const $contactSnapshot = atom<ContactSnapshot | null>(null);

export const $quickConnects = atom<QuickConnect[] | null>(null);

// ---- Persisted across reloads (localStorage) ----

// Last time (ms epoch) a notification tag was shown, so reloading the CCP
// doesn't immediately repeat or un-snooze notifications.
export const $notifyTimes = persistentMap<Record<string, string>>('owlchirp:notify:', {});

// Timeline grouping interval in minutes (one of TIMELINE_INTERVALS).
export const $timelineInterval = persistentAtom<string>('owlchirp:timeline:interval', '15');
