import { atom, map } from 'nanostores';
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

export type Call = {
  agent: string;
  phoneNumber: string;
  timestamp: number;
  contactId: string;
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

export const $callerId = atom<CallerId | null>(null);

// Past wrap-ups for the number of the current (or last) contact.
export const $wrapups = atom<WrapupFeed | null>(null);

// Wrap-ups for the number looked up in the Feed view.
export const $numberFeed = atom<WrapupFeed | null>(null);

// Which main view the sidebar has selected.
export type View = 'phone' | 'feed' | 'settings';
export const $view = atom<View>('phone');

export const $alert = atom<Alert>({ kind: 'welcome' });

export const $wsStatus = atom<'connecting' | 'open' | 'closed'>('connecting');

// The owlchirp feature flag for this agent, sent by the server after socket
// auth. null until the first connection reports it.
export const $owlchirpEnabled = atom<boolean | null>(null);

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

export const $contactSnapshot = atom<ContactSnapshot | null>(null);

export const $quickConnects = atom<QuickConnect[] | null>(null);

// ---- Persisted across reloads (localStorage) ----

// Last time (ms epoch) a notification tag was shown, so reloading the CCP
// doesn't immediately repeat or un-snooze notifications.
export const $notifyTimes = persistentMap<Record<string, string>>('owlchirp:notify:', {});

export const $recentCallsExpanded = persistentAtom<boolean>('owlchirp:recentCallsExpanded', false, {
  encode: JSON.stringify,
  decode: JSON.parse,
});
