import { atom, computed, map } from 'nanostores';
import { persistentAtom, persistentMap } from '@nanostores/persistent';
import type { STATUS } from './const';

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
export type View = 'phone' | 'calls' | 'feed' | 'flow' | 'timeline' | 'callerids' | 'admin' | 'settings' | 'log';
export const $view = atom<View>('phone');

export const $alert = atom<Alert>({ kind: 'welcome' });

export const $wsStatus = atom<'connecting' | 'open' | 'closed'>('connecting');

// Permission levels from the owlchirp feature flag. Each level includes
// everything below it, so compare with >=.
export const PERMISSION = { standard: 0, power: 1, admin: 2 } as const;

// This agent's permission level, sent by the server after socket auth.
export const $permission = atom<number>(PERMISSION.standard);
// Power unlocks the timeline, flow calls and feed; admin also shows agent names.
export const $isPower = computed($permission, (p) => p >= PERMISSION.power);
export const $isAdmin = computed($permission, (p) => p >= PERMISSION.admin);

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
