import { useStore } from '@nanostores/react';
import { useEffect, useRef, useState } from 'react';

import { downloadCcpLog } from '../lib/ccp';
import { formatCallTime } from '../lib/helpers';
import { $view } from '../lib/stores';
import {
  $callLogs,
  $localLogs,
  $logFocus,
  $sessionLog,
  loadCallLog,
  loadCallLogs,
  type CallLog,
  type LogEntry,
} from '../lib/systemLog';
import { Button, Card, Icon, PhoneLabel } from './ui';

type Filters = { errorsOnly: boolean; hideConnectInfo: boolean };

const LEVEL_CLASS = {
  info: 'text-secondary-500 dark:text-secondary-400',
  warn: 'text-amber-600 dark:text-amber-400',
  error: 'text-rose-600 dark:text-rose-400',
};

const SOURCE_LABEL = { app: 'APP', console: 'CONSOLE', connect: 'CONNECT' };

function clock(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function visible(entries: LogEntry[], { errorsOnly, hideConnectInfo }: Filters): LogEntry[] {
  return entries.filter(
    (e) => (!errorsOnly || e.level === 'error') && !(hideConnectInfo && e.source === 'connect' && e.level === 'info'),
  );
}

function Timeline({ entries, filters }: { entries: LogEntry[]; filters: Filters }) {
  const shown = visible(entries, filters);
  if (!shown.length) return <p className="px-4 py-3 text-sm text-secondary-500">No entries.</p>;
  return (
    <ol className="max-h-[32rem] overflow-y-auto px-4 py-2 font-mono text-xs leading-5">
      {shown.map((e, i) => (
        <li key={i} className="border-b border-secondary-100 py-1 last:border-0 dark:border-secondary-800">
          <div className="flex gap-2">
            <span className="flex-none text-secondary-400 tabular-nums">{clock(e.time)}</span>
            <span className={`w-8 flex-none font-semibold uppercase ${LEVEL_CLASS[e.level]}`}>{e.level}</span>
            <span className="w-16 flex-none text-secondary-400">{SOURCE_LABEL[e.source]}</span>
            {e.detail ? (
              <details className="min-w-0 grow">
                <summary className="cursor-pointer break-words">{e.message}</summary>
                <pre className="mt-1 whitespace-pre-wrap break-all text-secondary-500">{e.detail}</pre>
              </details>
            ) : (
              <span className="min-w-0 grow break-words">{e.message}</span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

type Loaded = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; log: CallLog };

function CallLogRow({ call, focused, filters }: { call: CallLog; focused: boolean; filters: Filters }) {
  const [open, setOpen] = useState(focused);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  // This session's copy updates when the Connect entries are merged in.
  const local = useStore($localLogs)[call.contactId];
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focused]);

  useEffect(() => {
    if (!open || local) return;
    let cancelled = false;
    setLoaded({ status: 'loading' });
    loadCallLog(call.contactId)
      .then((log): Loaded => ({ status: 'ready', log }))
      .catch((e: unknown): Loaded => ({ status: 'error', message: e instanceof Error ? e.message : String(e) }))
      .then((l) => !cancelled && setLoaded(l));
    return () => {
      cancelled = true;
    };
  }, [open, local, call.contactId]);

  const current: Loaded = local ? { status: 'ready', log: local } : loaded;
  const badge =
    call.outcome === 'failed'
      ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300'
      : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300';

  return (
    <div
      ref={ref}
      className={`scroll-mt-4 border-b border-secondary-100 last:border-0 dark:border-secondary-800 ${focused ? 'bg-primary-50/50 dark:bg-primary-500/5' : ''}`}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-secondary-50 dark:hover:bg-secondary-800/50"
      >
        <Icon name="chevronDown" className={`size-4 text-secondary-400 transition ${open ? '' : '-rotate-90'}`} />
        <span className="w-40 flex-none text-secondary-500">{formatCallTime(call.startedAt)}</span>
        <span className="grow truncate font-medium">
          {call.phoneNumber ? <PhoneLabel phoneNumber={call.phoneNumber} /> : 'Unknown'}
          <span className="ml-2 text-xs font-normal text-secondary-500">{call.inbound ? 'Inbound' : 'Outbound'}</span>
        </span>
        {call.outcome && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${badge}`}>{call.outcome}</span>
        )}
        {call.errorCount > 0 && (
          <span className="text-xs text-rose-600 dark:text-rose-400">
            {call.errorCount} error{call.errorCount === 1 ? '' : 's'}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-secondary-100 dark:border-secondary-800">
          {current.status === 'loading' && <p className="px-4 py-3 text-sm text-secondary-500">Loading…</p>}
          {current.status === 'error' && <p className="px-4 py-3 text-sm text-rose-600">{current.message}</p>}
          {current.status === 'ready' && <Timeline entries={current.log.entries ?? []} filters={filters} />}
        </div>
      )}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs">
      <input type="checkbox" className="checkbox checkbox-xs" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export default function SystemLog() {
  const calls = useStore($callLogs);
  const session = useStore($sessionLog);
  // Read once: the focused call stays highlighted while this view is open.
  const [focus] = useState(() => $logFocus.get());
  const [filters, setFilters] = useState<Filters>({ errorsOnly: false, hideConnectInfo: false });
  const [showSession, setShowSession] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setError(null);
    loadCallLogs().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(() => {
    $logFocus.set(null);
    refresh();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => $view.set('settings')}>
          ← Settings
        </Button>
        <h1 className="grow text-lg font-semibold">System log</h1>
        <Toggle label="Errors only" checked={filters.errorsOnly} onChange={(v) => setFilters({ ...filters, errorsOnly: v })} />
        <Toggle
          label="Hide Connect info"
          checked={filters.hideConnectInfo}
          onChange={(v) => setFilters({ ...filters, hideConnectInfo: v })}
        />
        <Button size="sm" icon="refresh" onClick={refresh}>
          Refresh
        </Button>
        <Button size="sm" onClick={downloadCcpLog}>
          Download CCP log
        </Button>
      </div>

      <Card
        title="This session"
        actions={
          <Button size="sm" onClick={() => setShowSession(!showSession)}>
            {showSession ? 'Hide' : `Show (${session.length})`}
          </Button>
        }
      >
        {showSession && <Timeline entries={[...session].reverse()} filters={filters} />}
      </Card>

      <Card title="Calls">
        {error && <p className="px-4 py-3 text-sm text-rose-600">{error}</p>}
        {!error && !calls.length && <p className="px-4 py-3 text-sm text-secondary-500">No calls logged yet.</p>}
        {calls.map((call) => (
          <CallLogRow key={call.contactId} call={call} focused={call.contactId === focus} filters={filters} />
        ))}
      </Card>
    </div>
  );
}
