export const API = '/api';

export const CONNECT_DOMAIN = "_REPLACE_CONNECT_DOMAIN";
export const CCP_URL = `${CONNECT_DOMAIN}/connect/ccp-v2`;
export const TIME_ZONE = "_REPLACE_TIME_ZONE";

export const TABLE_INFO_CLASS = 'table-info';
export const TABLE_ALERT_CLASS = 'table-warning';
export const TABLE_DANGER_CLASS = 'table-danger';
export const CURSOR_HELP_CLASS = 'helpCursor';

// Sideline statuses can receive notifications.
// Excluded statuses are not notified
const STATUS_AFTERCALL = "aftercallwork";
const STATUS_BREAK = "quick break";
const STATUS_IN_MEETING = "in a meeting";
const STATUS_LUNCH = "lunch";
const STATUS_MISSED_CALL = "missedcallagent";
const STATUS_OFFLINE = "offline";
const STATUS_ON_CONTACT = "on contact";
const STATUS_PROJECT = "on a project";
const STATUS_TICKET_BREAK = "ticket break";

export const SIDELINE_STATUSES = {[STATUS_BREAK]: 1, [STATUS_PROJECT]: 1, [STATUS_TICKET_BREAK]: 1}
export const EXCLUDED_STATUSES = {[STATUS_OFFLINE]: 1, [STATUS_ON_CONTACT]: 1, [STATUS_IN_MEETING]: 1, [STATUS_LUNCH]: 1};
export const BREAK_STATUSES = {[STATUS_BREAK]: 10, [STATUS_AFTERCALL]: 10, [STATUS_LUNCH]: 65, [STATUS_MISSED_CALL]: 5}

console.debug(SIDELINE_STATUSES)
export const MAX_QUEUE_COUNT = -1;
export const MIN_AGENT_STAFFED = 1;

export const LOADING_CLASS = 'alert-secondary'
