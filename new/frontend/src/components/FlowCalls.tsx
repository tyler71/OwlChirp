import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';

import { getCallerIdName } from '../lib/callerId';
import { flowStage, isLive, loadFlowCalls, type FlowStage } from '../lib/flowCalls';
import { formatCallTime, formatPhoneNumber, formatSecondsToTime, normalizePhoneNumber } from '../lib/helpers';
import { $config, $flowCalls, $view, type FlowCall } from '../lib/stores';
import { loadNumberFeed } from '../lib/wrapups';
import { Button, Card, Icon, formatElapsed, useNow } from './ui';

const STAGE: Record<FlowStage, { label: string; className: string }> = {
  flow: { label: 'In flow', className: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300' },
  queued: { label: 'Queued', className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  answered: {
    label: 'Answered',
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  },
  abandonedFlow: {
    label: 'Abandoned in flow',
    className: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  },
  abandonedQueue: {
    label: 'Abandoned in queue',
    className: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  },
};

// Caller ID names rarely change; look each number up once per page load.
const callerNames = new Map<string, Promise<string | null>>();

function useCallerName(phoneNumber: string): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!phoneNumber) return;
    let cancelled = false;
    let lookup = callerNames.get(phoneNumber);
    if (!lookup) {
      lookup = getCallerIdName(phoneNumber).catch(() => null);
      callerNames.set(phoneNumber, lookup);
    }
    lookup.then((n) => !cancelled && setName(n));
    return () => {
      cancelled = true;
    };
  }, [phoneNumber]);
  return name;
}

function seconds(from: number, to: number): number {
  return from && to ? Math.max(0, Math.round((to - from) / 1000)) : 0;
}

export function StageBadge({ stage }: { stage: FlowStage }) {
  const { label, className } = STAGE[stage];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${className}`}>{label}</span>;
}

export function Caller({ call }: { call: FlowCall }) {
  const name = useCallerName(call.phoneNumber);
  if (!call.phoneNumber) return <span className="text-secondary-500">Unknown</span>;

  const jumpToFeed = () => {
    void loadNumberFeed(normalizePhoneNumber(call.phoneNumber));
    $view.set('feed');
  };

  return (
    <button type="button" onClick={jumpToFeed} title="Open feed" className="min-w-0 text-left hover:underline">
      <span className="font-medium tabular-nums">{formatPhoneNumber(call.phoneNumber)}</span>
      {name && <span className="ml-2 truncate text-xs text-secondary-500 dark:text-secondary-400">{name}</span>}
    </button>
  );
}

export function ConnectLink({ contactId }: { contactId: string }) {
  const config = useStore($config);
  if (!config) return null;
  return (
    <a
      href={`${config.connectDomain}/contact-trace-records/details/${contactId}?tx=${encodeURIComponent(config.timeZone)}`}
      target="_blank"
      rel="noreferrer"
      title="Open in Amazon Connect"
      className="flex-none text-secondary-400 hover:text-secondary-600 dark:hover:text-secondary-300"
    >
      <Icon name="externalLink" className="size-4" />
    </a>
  );
}

function LiveRow({ call, now }: { call: FlowCall; now: number }) {
  const stage = flowStage(call);
  return (
    <li className="flex items-center gap-3 border-b border-secondary-100 px-4 py-3 text-sm last:border-0 dark:border-secondary-800">
      <span className="grow">
        <Caller call={call} />
      </span>
      {stage === 'queued' && call.queueName && (
        <span className="hidden text-xs text-secondary-500 sm:inline dark:text-secondary-400">{call.queueName}</span>
      )}
      <StageBadge stage={stage} />
      <span
        className="w-14 flex-none text-right font-medium tabular-nums"
        title={call.enqueuedAt ? `${formatElapsed(now - call.enqueuedAt)} in queue` : undefined}
      >
        {formatElapsed(now - call.initiatedAt)}
      </span>
      <ConnectLink contactId={call.contactId} />
    </li>
  );
}

function HistoryRow({ call }: { call: FlowCall }) {
  const stage = flowStage(call);
  // Time in the flow ends at enqueue, or at hang-up/answer if never queued.
  const flowEnd = call.enqueuedAt || call.connectedAt || call.disconnectedAt;
  const queueEnd = call.connectedAt || call.disconnectedAt;

  return (
    <tr className="border-b border-secondary-100 last:border-0 dark:border-secondary-800">
      <td className="px-4 py-2 whitespace-nowrap text-secondary-500">{formatCallTime(call.initiatedAt)}</td>
      <td className="px-4 py-2">
        <Caller call={call} />
      </td>
      <td className="px-4 py-2">
        <StageBadge stage={stage} />
      </td>
      <td className="px-4 py-2 tabular-nums">{flowEnd ? formatSecondsToTime(seconds(call.initiatedAt, flowEnd)) : '—'}</td>
      <td className="px-4 py-2 tabular-nums" title={call.queueName || undefined}>
        {call.enqueuedAt && queueEnd ? formatSecondsToTime(seconds(call.enqueuedAt, queueEnd)) : '—'}
      </td>
      <td className="px-4 py-2">{call.agentName || '—'}</td>
      <td className="px-4 py-2">
        <ConnectLink contactId={call.contactId} />
      </td>
    </tr>
  );
}

export default function FlowCalls() {
  const calls = useStore($flowCalls);
  const now = useNow();
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setError(null);
    loadFlowCalls().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(refresh, []);

  const live = (calls ?? []).filter(isLive).sort((a, b) => a.initiatedAt - b.initiatedAt);
  const history = (calls ?? []).filter((c) => !isLive(c));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="grow text-lg font-semibold">Flow Calls</h1>
        <Button size="sm" icon="refresh" onClick={refresh}>
          Refresh
        </Button>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <Card title={`In flow / queue (${live.length})`}>
        {calls === null && !error && <p className="px-4 py-3 text-sm text-secondary-500">Loading…</p>}
        {calls !== null && !live.length && (
          <p className="px-4 py-3 text-sm text-secondary-500">No calls waiting right now.</p>
        )}
        {live.length > 0 && (
          <ul>
            {live.map((call) => (
              <LiveRow key={call.contactId} call={call} now={now} />
            ))}
          </ul>
        )}
      </Card>

      <Card title="Last 24 hours">
        {calls !== null && !history.length && <p className="px-4 py-3 text-sm text-secondary-500">No calls yet.</p>}
        {history.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-secondary-500 uppercase dark:text-secondary-400">
                <tr className="border-b border-secondary-100 dark:border-secondary-800">
                  <th className="px-4 py-2 font-semibold">Time</th>
                  <th className="px-4 py-2 font-semibold">Caller</th>
                  <th className="px-4 py-2 font-semibold">Outcome</th>
                  <th className="px-4 py-2 font-semibold">In flow</th>
                  <th className="px-4 py-2 font-semibold">In queue</th>
                  <th className="px-4 py-2 font-semibold">Agent</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {history.map((call) => (
                  <HistoryRow key={call.contactId} call={call} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
