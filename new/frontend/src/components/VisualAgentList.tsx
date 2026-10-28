import { useStore } from '@nanostores/react';

import {
  CURSOR_HELP_CLASS,
  EXCLUDED_STATUSES,
  LOADING_CLASS,
  SIDELINE_STATUSES,
  STATUS_AFTERCALL,
  STATUS_AVAILABLE,
  STATUS_BREAK,
  STATUS_ERROR,
  STATUS_IN_MEETING,
  STATUS_LUNCH,
  STATUS_MISSED_CALL,
  STATUS_OFFLINE,
  STATUS_ON_CALL,
  STATUS_ON_CONTACT,
  STATUS_PROJECT,
  STATUS_TICKET_BREAK,
} from '../lib/const';
import { $metrics, type ActiveUser } from '../lib/stores';

import type { STATUS } from '../lib/const';

// Rendered via ::after on each agent chip (see data-emoji below).
const STATUS_EMOJI: Record<string, string> = {
  [STATUS_AVAILABLE]: '',
  [STATUS_ON_CALL]: '📞',
  [STATUS_ON_CONTACT]: '💬',
  [STATUS_AFTERCALL]: '📝',
  [STATUS_MISSED_CALL]: '❗',
  [STATUS_ERROR]: '❗',
  [STATUS_BREAK]: '☕',
  [STATUS_TICKET_BREAK]: '🎫',
  [STATUS_PROJECT]: '🛠️',
  [STATUS_IN_MEETING]: '👥',
  [STATUS_LUNCH]: '🍔',
  [STATUS_OFFLINE]: '💤',
};

function statusClass(status: STATUS): string {
  const sn = status.toLowerCase();
  if (sn === STATUS_ERROR || sn === STATUS_MISSED_CALL) return 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300';
  if (sn === STATUS_ON_CALL) return 'bg-primary-100 text-primary-700 dark:bg-primary-500/20 dark:text-primary-300';
  if (SIDELINE_STATUSES.has(sn)) return 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300';
  if (EXCLUDED_STATUSES.has(sn)) return 'bg-secondary-100 text-secondary-400 line-through dark:bg-secondary-800';
  return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300';
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
    return <div className={`h-6 grow select-none ${LOADING_CLASS}`} />;
  }

  const sorted = [...userList].sort((a, b) => a.user.first_name.localeCompare(b.user.first_name));
  const letters = initials(sorted);

  return (
    <div className="flex min-w-0 grow flex-wrap justify-center gap-1 select-none">
      {sorted.map((u, i) => (
        <span
          key={u.user_id}
          className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-xs font-bold after:ml-0.5 after:inline-block after:text-[10px] after:content-[attr(data-emoji)] ${CURSOR_HELP_CLASS} ${statusClass(u.status.name)}`}
          data-emoji={STATUS_EMOJI[u.status.name.toLowerCase()] ?? ''}
          title={`${u.user.first_name} ${u.user.last_name}: ${u.status.name}`}
        >
          {letters[i]}
        </span>
      ))}
    </div>
  );
}
