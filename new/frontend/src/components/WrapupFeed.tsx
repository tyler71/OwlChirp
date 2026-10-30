import { useStore } from '@nanostores/react';

import { LOADING_CLASS } from '../lib/const';
import { agentName, formatCallTime } from '../lib/helpers';
import { $wrapups, type Wrapup } from '../lib/stores';
import { MOODS } from '../lib/wrapups';
import { Icon } from './ui';

function Entry({ wrapup }: { wrapup: Wrapup }) {
  const mood = MOODS.find((m) => m.value === wrapup.mood);
  return (
    <li className="flex gap-3 px-4 py-2.5">
      <span className="w-6 flex-none text-center text-lg leading-6" title={mood?.label} aria-label={mood?.label}>
        {mood?.emoji ?? '·'}
      </span>
      <div className="min-w-0 grow">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-secondary-500 dark:text-secondary-400">
          <time dateTime={new Date(wrapup.timestamp).toISOString()}>{formatCallTime(wrapup.timestamp)}</time>
          <span>· {agentName(wrapup.agent)}</span>
          {wrapup.incident && (
            <span className="rounded-md bg-secondary-100 px-1.5 py-0.5 font-mono font-medium text-base-content dark:bg-secondary-800">
              {wrapup.incident}
            </span>
          )}
        </p>
        {wrapup.thoughts && <p className="mt-0.5 text-sm break-words whitespace-pre-wrap">{wrapup.thoughts}</p>}
      </div>
    </li>
  );
}

/**
 * Earlier wrap-ups for phoneNumber, newest first. Collapsible renders it as a
 * closed <details> so it stays out of the way during a live call.
 */
export default function WrapupFeed({ phoneNumber, collapsible = false }: { phoneNumber: string; collapsible?: boolean }) {
  const feed = useStore($wrapups);

  if (!phoneNumber || feed?.phoneNumber !== phoneNumber) return null;

  const spamCount = feed.items.filter((w) => w.mood === 'spam').length;
  const title = feed.loading ? 'Caller history' : `Caller history (${feed.items.length})`;

  const body = (
    <>
      {spamCount > 0 && (
        <p className="flex items-center gap-2 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
          <Icon name="exclamation" className="size-4" />
          Marked spam {spamCount}×
        </p>
      )}
      {feed.loading ? (
        <div className="space-y-2 px-4 py-3">
          <div className={`h-4 ${LOADING_CLASS}`} />
          <div className={`h-4 w-2/3 ${LOADING_CLASS}`} />
        </div>
      ) : feed.items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-secondary-500 dark:text-secondary-400">No previous notes for this number</p>
      ) : (
        <ul className="max-h-64 divide-y divide-secondary-100 overflow-y-auto dark:divide-secondary-800">
          {feed.items.map((w) => (
            <Entry key={w.contactId} wrapup={w} />
          ))}
        </ul>
      )}
    </>
  );

  if (collapsible) {
    return (
      <details className="group border-t border-secondary-100 dark:border-secondary-800">
        <summary className="flex cursor-pointer items-center justify-between px-4 py-2.5 text-xs font-semibold text-secondary-600 select-none hover:bg-secondary-50 dark:text-secondary-400 dark:hover:bg-secondary-800/50">
          <span>
            {title}
            {spamCount > 0 && <span className="ml-2 text-rose-600 dark:text-rose-400">🚫 {spamCount}</span>}
          </span>
          <Icon name="chevronDown" className="size-4 transition group-open:rotate-180" />
        </summary>
        {body}
      </details>
    );
  }

  return (
    <div className="w-full border-t border-secondary-100 text-left dark:border-secondary-800">
      <h3 className="px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-secondary-500 uppercase dark:text-secondary-400">{title}</h3>
      {body}
    </div>
  );
}
