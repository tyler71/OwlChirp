import { useStore } from '@nanostores/react';

import {
  CURSOR_HELP_CLASS,
  EXCLUDED_STATUSES,
  LOADING_CLASS,
  SIDELINE_STATUSES,
  STATUS_ERROR,
  STATUS_MISSED_CALL,
  STATUS_ON_CALL,
} from '../lib/const';
import { $metrics, type ActiveUser } from '../lib/stores';

function statusClass(status: string): string | undefined {
  const sn = status.toLowerCase();
  if (sn === STATUS_ERROR || sn === STATUS_MISSED_CALL) return 'visual_list_error';
  if (sn === STATUS_ON_CALL) return 'visual_list_on_call';
  if (SIDELINE_STATUSES.has(sn)) return 'visual_list_sideline_status';
  if (EXCLUDED_STATUSES.has(sn)) return 'visual_list_excluded_status';
  return undefined;
}

// Agents shown by initial; two letters when initials collide.
function initials(users: ActiveUser[]): string[] {
  const counts = new Map<string, number>();
  for (const u of users) {
    const fl = (u.user.first_name[0] ?? '?').toUpperCase();
    counts.set(fl, (counts.get(fl) ?? 0) + 1);
  }
  return users.map((u) => {
    const name = u.user.first_name || '?';
    return (counts.get(name[0].toUpperCase()) ?? 0) > 1 ? name.slice(0, 2) : name[0];
  });
}

export default function VisualAgentList() {
  const userList = useStore($metrics, { keys: ['user_list'] }).user_list;

  if (!userList) {
    return <div id="visualAgentList" className={`${LOADING_CLASS} noselect`} />;
  }

  const sorted = [...userList].sort((a, b) => a.user.first_name.localeCompare(b.user.first_name));
  const letters = initials(sorted);

  return (
    <div id="visualAgentList" className="noselect">
      {sorted.map((u, i) => (
        <span
          key={u.user_id}
          className={[CURSOR_HELP_CLASS, statusClass(u.status.name)].filter(Boolean).join(' ')}
          data-toggle="tooltip"
          data-placement="bottom"
          title={`${u.user.first_name} ${u.user.last_name}: ${u.status.name}`}
        >
          {letters[i]}
        </span>
      ))}
    </div>
  );
}
