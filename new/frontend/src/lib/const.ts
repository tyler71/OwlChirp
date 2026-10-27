export const API = '/api';

export const TABLE_ALERT_CLASS = 'table-warning';
export const CURSOR_HELP_CLASS = 'helpCursor';
export const LOADING_CLASS = 'alert-secondary';

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
export const MIN_AGENT_STAFFED = 1;

export const STATE_CHECK_INTERVAL_MS = 5000;
export const RECENT_CALLS_MAX = 10;
