import { useStore } from '@nanostores/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { LOADING_CLASS } from '../lib/const';
import { agentName, formatCallTime, formatPhoneNumber, normalizePhoneNumber } from '../lib/helpers';
import { $agent, $contactSnapshot, $isAdmin, $numberFeed, $wrapups, type Wrapup } from '../lib/stores';
import { loadNumberFeed, MOODS } from '../lib/wrapups';
import { Button, Card } from './ui';

// One wrap-up as chat bubbles: a mood card (the emoji stands in for the file
// icon of the "file content" bubble), a text bubble for thoughts, then meta.
function Message({ wrapup, mine }: { wrapup: Wrapup; mine: boolean }) {
  const isAdmin = useStore($isAdmin);
  const author = mine ? 'You' : isAdmin ? agentName(wrapup.agent) : null;
  const mood = MOODS.find((m) => m.value === wrapup.mood);
  const tail = mine ? 'rounded-br-none' : 'rounded-bl-none';
  const showIncidentInText = !mood && wrapup.incident;

  return (
    <div className={`flex flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
      {mood && (
        <div
          className={`relative flex max-w-full items-center gap-2 rounded-2xl ${tail} bg-secondary-100 px-3 py-2.5 text-sm sm:max-w-[80%] dark:bg-secondary-700/50`}
        >
          <span className="flex size-9 flex-none items-center justify-center text-3xl leading-none" role="img" aria-label={mood.label}>
            {mood.emoji}
          </span>
          <div className="min-w-0 grow">
            <h3 className="font-semibold break-words">{wrapup.incident || mood.label}</h3>
            <p className="mt-0.5 text-xs text-secondary-600 dark:text-secondary-400">
              {mood.label}
              {author && ` • ${author}`}
            </p>
          </div>
        </div>
      )}

      {(wrapup.thoughts || showIncidentInText) && (
        <div
          className={`relative max-w-full rounded-2xl ${tail} px-3 py-2.5 text-sm sm:max-w-[80%] ${
            mine ? 'bg-primary-700 text-white' : 'bg-secondary-100 dark:bg-secondary-700/50'
          }`}
        >
          {showIncidentInText && <p className="font-semibold break-words">{wrapup.incident}</p>}
          {wrapup.thoughts && <p className="break-words whitespace-pre-wrap">{wrapup.thoughts}</p>}
        </div>
      )}

      <div className="flex h-6 items-center gap-1 text-xs font-medium text-secondary-500 dark:text-secondary-400">
        <time dateTime={new Date(wrapup.timestamp).toISOString()}>{formatCallTime(wrapup.timestamp)}</time>
        {author && (
          <>
            <span className="opacity-50">•</span>
            <span className={mine ? 'text-primary-700 dark:text-primary-400' : undefined}>{author}</span>
          </>
        )}
      </div>
    </div>
  );
}

/** Full wrap-up history for one phone number, laid out as a chat thread. */
export default function Feed() {
  const feed = useStore($numberFeed);
  const agent = useStore($agent);
  const me = agent?.getConfiguration().username;
  const [input, setInput] = useState(() => {
    const initial = feed?.phoneNumber || $contactSnapshot.get()?.phoneNumber || $wrapups.get()?.phoneNumber || '';
    return initial ? formatPhoneNumber(initial) : '';
  });
  const bottomRef = useRef<HTMLDivElement>(null);

  function load(value: string): void {
    const phoneNumber = normalizePhoneNumber(value);
    if (phoneNumber) void loadNumberFeed(phoneNumber);
  }

  // Load the prefilled number on open unless that feed is already in memory.
  useEffect(() => {
    if (input && !feed) load(input);
  }, []);

  // Oldest first, like a chat.
  const items = feed ? [...feed.items].reverse() : [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [items.length, feed?.phoneNumber]);

  function onSubmit(e: FormEvent): void {
    e.preventDefault();
    load(input);
  }

  return (
    <Card
      title={feed?.phoneNumber ? `Feed · ${formatPhoneNumber(feed.phoneNumber)}` : 'Feed'}
      actions={
        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <input
            type="tel"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Phone number"
            aria-label="Phone number"
            className="w-40 rounded-lg border border-secondary-200 bg-white px-3 py-1.5 text-sm focus:border-primary-500 focus:ring-3 focus:ring-primary-500/25 focus:outline-none dark:border-secondary-700 dark:bg-secondary-800"
          />
          <Button type="submit" size="sm" variant="primary" icon="search" className="gap-1.5">
            Load
          </Button>
        </form>
      }
    >
      <div className="flex max-h-[70vh] min-h-64 grow flex-col gap-4 overflow-y-auto p-6">
        {!feed ? (
          <p className="m-auto text-sm text-secondary-500 dark:text-secondary-400">Enter a phone number to see its feed</p>
        ) : feed.loading ? (
          <div className="flex flex-col gap-4">
            <div className={`h-10 w-2/3 ${LOADING_CLASS}`} />
            <div className={`ml-auto h-10 w-1/2 ${LOADING_CLASS}`} />
            <div className={`h-10 w-3/5 ${LOADING_CLASS}`} />
          </div>
        ) : items.length === 0 ? (
          <p className="m-auto text-sm text-secondary-500 dark:text-secondary-400">No wrap-ups for this number yet</p>
        ) : (
          items.map((w) => <Message key={w.contactId} wrapup={w} mine={!!me && w.agent === me} />)
        )}
        <div ref={bottomRef} />
      </div>
    </Card>
  );
}
