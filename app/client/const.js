export const API = '/api';

export const SPS_CONNECT_DOMAIN = new URL('https://sps-connect-poc.my.connect.aws');
export const INSTANCE_URL = "https://sps-connect-poc.my.connect.aws/connect/ccp-v2";
export const TIME_ZONE = 'America/Los_Angeles';

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
