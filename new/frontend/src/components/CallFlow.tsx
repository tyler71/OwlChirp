import { useStore } from '@nanostores/react';
import { useEffect, useRef, useState } from 'react';

import { CURSOR_HELP_CLASS, STATUS_AFTERCALL, STATUS_AVAILABLE, STATUS_ON_CALL } from '../lib/const';
import { flowStage, type FlowStage } from '../lib/flowCalls';
import { $flowCalls, $can, $metrics, agentCountLabel, type ActiveUser } from '../lib/stores';
import { Card } from './ui';
import { STATUS_EMOJI, statusClass } from './VisualAgentList';

// Statuses counted as "taking calls", in display order.
const TAKING_CALLS = [STATUS_ON_CALL, STATUS_AFTERCALL, STATUS_AVAILABLE];
const HIGHLIGHT_MS = 1500;

type Track = 0 | 1; // 0: flow → queue, 1: queue → agents
type Dot = { id: number; track: Track; kind: 'move' | 'drop' };

function Bubble({ label, count, tone }: { label: string; count: number; tone: 'sky' | 'amber' }) {
  const color =
    tone === 'sky'
      ? 'bg-sky-100 text-sky-800 ring-sky-300 dark:bg-sky-500/20 dark:text-sky-200 dark:ring-sky-500/40'
      : 'bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-500/20 dark:text-amber-200 dark:ring-amber-500/40';
  const halo = tone === 'sky' ? 'bg-sky-400/40' : 'bg-amber-400/40';
  return (
    <div className="flex w-16 flex-none flex-col items-center gap-1.5">
      <div className="relative">
        {count > 0 && (
          <span className={`absolute inset-0 animate-ping rounded-full motion-reduce:hidden ${halo}`} aria-hidden />
        )}
        <div
          className={`relative flex size-12 items-center justify-center rounded-full text-lg font-bold tabular-nums ring-2 ${color}`}
        >
          <span key={count} className="inline-block animate-flow-pop motion-reduce:animate-none">
            {count}
          </span>
        </div>
      </div>
      <span className="text-center text-xs font-medium text-secondary-500 dark:text-secondary-400">{label}</span>
    </div>
  );
}

function Connector({ active, dots, onDone }: { active: boolean; dots: Dot[]; onDone: (id: number) => void }) {
  return (
    <div className="relative mt-6 h-1 min-w-6 flex-1 -translate-y-1/2 rounded-full bg-secondary-200 dark:bg-secondary-700">
      {active && <div className="flow-track-active absolute inset-0 rounded-full motion-reduce:hidden" />}
      {dots.map((d) => (
        <span
          key={d.id}
          onAnimationEnd={() => onDone(d.id)}
          className={`absolute top-1/2 left-0 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow motion-reduce:hidden ${
            d.kind === 'move' ? 'animate-flow-travel bg-primary-500' : 'animate-flow-drop bg-rose-500'
          }`}
        />
      ))}
    </div>
  );
}

function AgentRow({ user, highlight }: { user: ActiveUser; highlight: boolean }) {
  const status = user.status.name.toLowerCase();
  return (
    <li
      className={`flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm transition-shadow duration-300 ${
        highlight ? 'bg-primary-50 ring-2 ring-primary-400 dark:bg-primary-500/10' : ''
      }`}
    >
      <span className="truncate">
        {user.user.first_name} {user.user.last_name}
      </span>
      <span
        className={`flex-none rounded px-1.5 py-0.5 text-xs font-semibold ${statusClass(status)}`}
        title={user.status.name}
      >
        {STATUS_EMOJI[status] || '✓'}
      </span>
    </li>
  );
}

export default function CallFlow() {
  const canFlow = useStore($can('flow'));
  const calls = useStore($flowCalls);
  const metrics = useStore($metrics, { keys: ['user_list', 'available_count', 'active_agent_count'] });
  const userList = metrics.user_list;
  const agentCount = agentCountLabel(metrics);

  const [dots, setDots] = useState<Dot[]>([]);
  const [highlights, setHighlights] = useState<Set<string>>(new Set());
  const prevStages = useRef<Map<string, FlowStage> | null>(null);
  const nextId = useRef(0);

  // Diff call stages against the previous push to animate transitions.
  useEffect(() => {
    if (!calls) return;
    const current = new Map(calls.map((c) => [c.contactId, flowStage(c)]));
    const prev = prevStages.current;
    prevStages.current = current;
    if (!prev) return; // First load: no burst of animations.

    const spawned: Dot[] = [];
    const answeredBy: string[] = [];
    for (const call of calls) {
      const before = prev.get(call.contactId);
      const now = current.get(call.contactId)!;
      if (before === now) continue;
      if (now === 'queued' && (before === 'flow' || before === undefined)) {
        spawned.push({ id: nextId.current++, track: 0, kind: 'move' });
      } else if (now === 'answered' && (before === 'queued' || before === 'flow')) {
        spawned.push({ id: nextId.current++, track: 1, kind: 'move' });
        if (call.agentUsername) answeredBy.push(call.agentUsername.toLowerCase());
      } else if (now === 'abandonedFlow' && before === 'flow') {
        spawned.push({ id: nextId.current++, track: 0, kind: 'drop' });
      } else if (now === 'abandonedQueue' && before === 'queued') {
        spawned.push({ id: nextId.current++, track: 1, kind: 'drop' });
      }
    }
    if (spawned.length) setDots((d) => [...d, ...spawned]);
    if (answeredBy.length) {
      setHighlights((h) => new Set([...h, ...answeredBy]));
      setTimeout(() => {
        setHighlights((h) => new Set([...h].filter((u) => !answeredBy.includes(u))));
      }, HIGHLIGHT_MS);
    }
  }, [calls]);

  if (!canFlow) return null;

  const counts = { flow: 0, queued: 0 };
  for (const c of calls ?? []) {
    const s = flowStage(c);
    if (s === 'flow' || s === 'queued') counts[s]++;
  }

  const agents = (userList ?? [])
    .filter((u) => TAKING_CALLS.includes(u.status.name.toLowerCase() as (typeof TAKING_CALLS)[number]))
    .sort(
      (a, b) =>
        TAKING_CALLS.indexOf(a.status.name.toLowerCase() as (typeof TAKING_CALLS)[number]) -
          TAKING_CALLS.indexOf(b.status.name.toLowerCase() as (typeof TAKING_CALLS)[number]) ||
        a.user.first_name.localeCompare(b.user.first_name),
    );
  const onCall = agents.filter((u) => u.status.name.toLowerCase() === STATUS_ON_CALL).length;

  const removeDot = (id: number) => setDots((d) => d.filter((x) => x.id !== id));

  return (
    <Card title="Call flow">
      <div className="flex items-start gap-2 p-4">
        <Bubble label="In flow" count={counts.flow} tone="sky" />
        <Connector active={counts.flow > 0} dots={dots.filter((d) => d.track === 0)} onDone={removeDot} />
        <Bubble label="In queue" count={counts.queued} tone="amber" />
        <Connector active={counts.queued > 0} dots={dots.filter((d) => d.track === 1)} onDone={removeDot} />
        <div className="w-44 flex-none rounded-lg border border-secondary-200 bg-secondary-50 dark:border-secondary-700 dark:bg-secondary-800/50 xl:w-52">
          <div className="flex items-center justify-between border-b border-secondary-200 px-2 py-1.5 text-xs font-semibold dark:border-secondary-700">
            <span>
              Taking calls{' '}
              {agentCount && (
                <span className={`${CURSOR_HELP_CLASS} tabular-nums`} title={agentCount.title}>
                  {agentCount.text}
                </span>
              )}
            </span>
            {onCall > 0 && <span className="text-primary-600 dark:text-primary-300">{onCall} on call</span>}
          </div>
          {userList === undefined && <p className="px-2 py-2 text-xs text-secondary-500">Loading…</p>}
          {userList !== undefined && !agents.length && (
            <p className="px-2 py-2 text-xs text-secondary-500">Nobody available.</p>
          )}
          {agents.length > 0 && (
            <ul className="max-h-64 space-y-0.5 overflow-y-auto p-1">
              {agents.map((u) => (
                <AgentRow key={u.user_id} user={u} highlight={highlights.has(u.user.username.toLowerCase())} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
