import { atom, map } from 'nanostores';
import { persistentAtom, persistentMap } from '@nanostores/persistent';

export type AppConfig = {
  connectDomain: string;
  connectInstance: string;
  timeZone: string;
  telemetryUrl: string;
};

export type ActiveUser = {
  user_id: string;
  status: { name: string };
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

export const $alert = atom<Alert>({ kind: 'welcome' });

export const $wsStatus = atom<'connecting' | 'open' | 'closed'>('connecting');

// Whether the CCP iframe can read its Connect cookies (blocked by Firefox ETP
// and other third-party cookie partitioning until the agent allows access).
export const $storageAccess = atom<'unknown' | 'needed' | 'granted' | 'denied'>('unknown');

// ---- Persisted across reloads (localStorage) ----

// Last time (ms epoch) a notification tag was shown, so reloading the CCP
// doesn't immediately repeat or un-snooze notifications.
export const $notifyTimes = persistentMap<Record<string, string>>('owlchirp:notify:', {});

export const $recentCallsExpanded = persistentAtom<boolean>('owlchirp:recentCallsExpanded', false, {
  encode: JSON.stringify,
  decode: JSON.parse,
});
