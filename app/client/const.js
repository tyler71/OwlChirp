export const API = '/api';

export const CONNECT_INSTANCE = "_REPLACE_CONNECT_INSTANCE";
export const CONNECT_DOMAIN = "_REPLACE_CONNECT_DOMAIN";
export const TIME_ZONE = "_REPLACE_TIME_ZONE";

export const TABLE_INFO_CLASS = 'table-info';
export const TABLE_ALERT_CLASS = 'table-warning';
export const TABLE_DANGER_CLASS = 'table-danger';
export const CURSOR_HELP_CLASS = 'helpCursor';

export const LOADING_CLASS = 'alert-secondary'

export const STATUS_AFTERCALL = "aftercallwork";
export const STATUS_AVAILABLE = "available";
export const STATUS_BREAK = "quick break";
export const STATUS_IN_MEETING = "in a meeting";
export const STATUS_LUNCH = "lunch";
export const STATUS_MISSED_CALL = "missedcallagent";
export const STATUS_OFFLINE = "offline";
export const STATUS_ON_CONTACT = "on contact";
export const STATUS_PROJECT = "on a project";
export const STATUS_TICKET_BREAK = "ticket break";
export const STATUS_ERROR = "error";

// Sideline statuses can receive notifications.
// Excluded statuses are not notified
export const SIDELINE_STATUSES = {[STATUS_BREAK]: 1, [STATUS_PROJECT]: 1, [STATUS_TICKET_BREAK]: 1, [STATUS_ERROR]: 1};
export const EXCLUDED_STATUSES = {[STATUS_OFFLINE]: 1, [STATUS_ON_CONTACT]: 1, [STATUS_IN_MEETING]: 1, [STATUS_LUNCH]: 1};
export const BREAK_STATUSES = {[STATUS_BREAK]: 10, [STATUS_AFTERCALL]: 10, [STATUS_LUNCH]: 65, [STATUS_MISSED_CALL]: 3, [STATUS_ERROR]: 3};


export const SIDELINE_NOTIFICATION_INTERVAL = 120;
export const HIGH_QUEUE_COUNT_NOTIFICATION_INTERVAL = 10;


export const MAX_QUEUE_COUNT = 1;
export const MIN_AGENT_STAFFED = 1;
