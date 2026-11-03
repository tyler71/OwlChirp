import { useStore } from '@nanostores/react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { flowStage } from '../lib/flowCalls';
import { $can, $timeline, $timelineInterval, type FlowCallBucket } from '../lib/stores';
import {
  groupBuckets,
  intervalLabel,
  intervalPhrase,
  loadTimeline,
  TIMELINE_INTERVALS,
  TIMELINE_PAGE_SIZE,
  windowPhrase,
} from '../lib/timeline';
import { Caller, ConnectLink, StageBadge } from './FlowCalls';
import { Button, Icon, Pagination } from './ui';

export const timeFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

export function dayLabel(ms: number): string {
  const day = new Date(ms).setHours(0, 0, 0, 0);
  const today = new Date().setHours(0, 0, 0, 0);
  if (day === today) return 'Current';
  if (day === today - 86_400_000) return 'Yesterday';
  return dayFormat.format(ms);
}

function Entry({ bucket, width, peak, day }: { bucket: FlowCallBucket; width: number; peak: number; day?: string }) {
  const showNames = useStore($can('agentNames'));
  const [open, setOpen] = useState(false);
  const live = bucket.total - bucket.answered - bucket.abandoned;

  return (
    <li className="relative">
      {/* Dot */}
      <div className="absolute top-0 bottom-0 left-0 mt-5 flex w-10 -translate-x-full justify-center md:w-12">
        <div className="size-3 rounded-full bg-primary-500 ring-3 ring-primary-100 ring-offset-2 ring-offset-secondary-100 dark:bg-primary-300 dark:ring-primary-900 dark:ring-offset-secondary-900" />
      </div>

      <div className="overflow-hidden rounded-xl bg-base-100 hover:ring-3 hover:ring-secondary-200 hover:ring-offset-2 hover:ring-offset-secondary-100 dark:bg-secondary-800 dark:ring-offset-secondary-900 dark:hover:ring-secondary-700">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full flex-col gap-2 p-4 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="grow font-semibold">
              {bucket.total} {bucket.total === 1 ? 'call' : 'calls'}
            </h4>
            {bucket.answered > 0 && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                {bucket.answered} answered
              </span>
            )}
            {bucket.abandoned > 0 && (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                {bucket.abandoned} abandoned
              </span>
            )}
            {live > 0 && (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
                {live} in progress
              </span>
            )}
            <Icon name="chevronDown" className={`size-4 text-secondary-400 transition ${open ? 'rotate-180' : ''}`} />
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary-100 dark:bg-secondary-700">
            <div className="h-full rounded-full bg-primary-500 dark:bg-primary-400" style={{ width: `${(bucket.total / peak) * 100}%` }} />
          </div>
        </button>

        {open && (
          <ul className="border-t border-secondary-100 dark:border-secondary-700">
            {bucket.calls.map((call) => (
              <li
                key={call.contactId}
                className="flex items-center gap-3 border-b border-secondary-100 px-4 py-2 text-sm last:border-0 dark:border-secondary-700"
              >
                <span className="w-16 flex-none text-secondary-500 tabular-nums dark:text-secondary-400">
                  {timeFormat.format(call.initiatedAt)}
                </span>
                <span className="min-w-0 grow">
                  <Caller call={call} />
                </span>
                {showNames && call.agentName && (
                  <span className="hidden text-xs text-secondary-500 sm:inline dark:text-secondary-400">{call.agentName}</span>
                )}
                <StageBadge stage={flowStage(call)} />
                <ConnectLink contactId={call.contactId} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Extra info: time range, plus the day on its first entry */}
      <div className="px-4 py-2 lg:absolute lg:top-0 lg:bottom-0 lg:left-0 lg:mt-4 lg:-ml-12 lg:flex lg:w-40 lg:-translate-x-full lg:flex-col lg:p-0 lg:text-right">
        {width < 86_400_000 && (
          <p className="text-sm font-medium text-secondary-500 tabular-nums dark:text-secondary-400">
            {timeFormat.format(bucket.start)} – {timeFormat.format(bucket.start + width)}
          </p>
        )}
        {day && <p className="text-xs font-semibold tracking-wider text-primary-600 uppercase dark:text-primary-400">{day}</p>}
      </div>
    </li>
  );
}

export default function Timeline() {
  const timeline = useStore($timeline);
  const minutes = Number(useStore($timelineInterval)) || 15;
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setError(null);
    loadTimeline().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(refresh, []);

  const buckets = useMemo(
    () => groupBuckets(timeline?.buckets ?? [], minutes, timeline?.bucketMinutes ?? 15),
    [timeline, minutes],
  );
  const width = Math.max(minutes, timeline?.bucketMinutes ?? 15) * 60_000;
  const peak = Math.max(1, ...buckets.map((b) => b.total));
  const total = buckets.reduce((n, b) => n + b.total, 0);

  // Start at the first page whenever the grouping or data changes.
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [minutes, timeline]);
  const sectionRef = useRef<HTMLDivElement>(null);
  const totalPages = Math.max(1, Math.ceil(buckets.length / TIMELINE_PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const pageBuckets = buckets.slice((current - 1) * TIMELINE_PAGE_SIZE, current * TIMELINE_PAGE_SIZE);

  const goToPage = (p: number) => {
    sectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setPage(p);
  };

  return (
    <div ref={sectionRef} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="grow">
          <h1 className="text-lg font-semibold">Timeline</h1>
          {timeline && (
            <p className="text-sm text-secondary-500 dark:text-secondary-400">
              {total} {total === 1 ? 'call' : 'calls'} in the last {windowPhrase(timeline.hours)} · {intervalPhrase(width / 60_000)}
              intervals · updated {timeFormat.format(timeline.generatedAt)}
            </p>
          )}
        </div>
        <div role="group" aria-label="Group by" className="inline-flex overflow-hidden rounded-lg border border-secondary-200 dark:border-secondary-700">
          {TIMELINE_INTERVALS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={m === minutes}
              onClick={() => $timelineInterval.set(String(m))}
              className={`border-l border-secondary-200 px-2.5 py-1.5 text-xs leading-5 font-semibold transition first:border-l-0 dark:border-secondary-700 ${
                m === minutes
                  ? 'bg-primary-600 text-white dark:bg-primary-500'
                  : 'bg-base-100 text-secondary-700 hover:bg-secondary-100 dark:bg-secondary-800 dark:text-secondary-300 dark:hover:bg-secondary-700'
              }`}
            >
              {intervalLabel(m)}
            </button>
          ))}
        </div>
        <Button size="sm" icon="refresh" onClick={refresh}>
          Refresh
        </Button>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}
      {timeline === null && !error && <p className="text-sm text-secondary-500">Loading…</p>}
      {timeline !== null && !buckets.length && (
        <p className="flex items-center gap-2 text-sm text-secondary-500">
          <Icon name="timeline" className="size-4" />
          No calls in the last {windowPhrase(timeline.hours)}.
        </p>
      )}

      {buckets.length > 0 && (
        <div className="relative py-5">
          {/* Vertical Guide */}
          <div className="absolute top-0 bottom-0 left-0 flex w-10 flex-col justify-center md:w-12 lg:ml-40" aria-hidden="true">
            <div className="mx-auto h-2.5 w-1 grow-0 rounded-t bg-linear-to-b from-transparent to-primary-100 dark:to-primary-900" />
            <div className="mx-auto w-1 grow bg-primary-100 dark:bg-primary-900" />
            <div className="mx-auto h-2.5 w-1 grow-0 rounded-b bg-linear-to-t from-transparent to-primary-100 dark:to-primary-900" />
          </div>

          <ul className="relative space-y-4 pl-10 md:pl-12 lg:ml-40">
            {pageBuckets.map((b, i) => {
              const day = dayLabel(b.start);
              const newDay = i === 0 || dayLabel(pageBuckets[i - 1].start) !== day;
              return <Entry key={b.start} bucket={b} width={width} peak={peak} day={newDay ? day : undefined} />;
            })}
          </ul>
        </div>
      )}
      <Pagination page={current} totalPages={totalPages} onChange={goToPage} />
    </div>
  );
}
