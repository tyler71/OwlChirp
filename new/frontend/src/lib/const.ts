// Always ends in '/'; '/' at the root or e.g. '/owlchirp/' under BASE_PATH.
export const BASE = import.meta.env.BASE_URL;
export const API = `${BASE}api`;

export const TABLE_ALERT_CLASS = 'bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200';
export const CURSOR_HELP_CLASS = 'cursor-help';
export const LOADING_CLASS = 'animate-pulse rounded-sm bg-secondary-200 dark:bg-secondary-700';

export const STATUS_AFTERCALL = 'aftercallwork';
export const STATUS_AVAILABLE = 'available';
export const STATUS_BREAK = 'quick break';
export const STATUS_IN_MEETING = 'in a meeting';
export const STATUS_LUNCH = 'lunch';
export const STATUS_MISSED_CALL = 'missedcallagent';
export const STATUS_OFFLINE = 'offline';
export const STATUS_ON_CONTACT = 'on contact';
export const STATUS_ON_CALL = 'on call';
export const STATUS_PROJECT = 'on a project';
export const STATUS_TICKET_BREAK = 'ticket break';
export const STATUS_ERROR = 'error';

export type STATUS =
    typeof STATUS_AFTERCALL
  | typeof STATUS_AVAILABLE
  | typeof STATUS_BREAK
  | typeof STATUS_IN_MEETING
  | typeof STATUS_LUNCH
  | typeof STATUS_MISSED_CALL
  | typeof STATUS_OFFLINE
  | typeof STATUS_ON_CONTACT
  | typeof STATUS_ON_CALL
  | typeof STATUS_PROJECT
  | typeof STATUS_TICKET_BREAK
  | typeof STATUS_ERROR

// Sideline statuses can receive notifications.
// Excluded statuses are not notified.
export const SIDELINE_STATUSES = new Set([STATUS_BREAK, STATUS_PROJECT, STATUS_TICKET_BREAK, STATUS_ERROR]);
export const EXCLUDED_STATUSES = new Set([STATUS_OFFLINE, STATUS_ON_CONTACT, STATUS_IN_MEETING, STATUS_LUNCH]);
// Minutes allowed in a status before the agent is reminded.
export const BREAK_STATUSES: Record<string, number> = {
  [STATUS_BREAK]: 10,
  [STATUS_AFTERCALL]: 10,
  [STATUS_LUNCH]: 65,
  [STATUS_MISSED_CALL]: 1,
  [STATUS_ERROR]: 1,
};

// Seconds between repeated notifications of the same kind.
export const SIDELINE_NOTIFICATION_INTERVAL = 120;
export const HIGH_QUEUE_COUNT_NOTIFICATION_INTERVAL = 10;
export const LONG_BREAK_NOTIFICATION_INTERVAL = 60;
export const LONG_BREAK_SNOOZE_MINUTES = 15;

export const MAX_QUEUE_COUNT = 1;
// Default queue count at which a non-routable agent is alerted to help.
export const DEFAULT_HELP_QUEUE_THRESHOLD = 2;
export const MIN_AGENT_STAFFED = 1;

// Matches the server's per-agent help request cooldown.
export const HELP_REQUEST_COOLDOWN_MS = 30_000;

export const STATE_CHECK_INTERVAL_MS = 5000;
// Share of other (non-offline) agents In a meeting that pulls this agent in too.
export const TEAM_MEETING_THRESHOLD = 0.75;
// Recent Calls page size; divides evenly into the 1/2/3-column grid.
export const RECENT_CALLS_PAGE_SIZE = 12;
