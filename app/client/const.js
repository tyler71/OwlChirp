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
export const SIDELINE_STATUSES = {"quick break": 1, "on a project": 1, "ticket break": 1, "missed": 1}
export const EXCLUDED_STATUSES = {"offline": 1, "on contact": 1, "in a meeting": 1, "lunch": 1};
export const BREAK_STATUSES = {"quick break": 10, "aftercallwork": 10, "lunch": 65, "missedcallagent": 5}

export const MAX_QUEUE_COUNT = 1;
export const MIN_AGENT_STAFFED = 1;

export const LOADING_CLASS = 'alert-secondary'
