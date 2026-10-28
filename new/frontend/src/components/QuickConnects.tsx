import { useStore } from '@nanostores/react';
import { useMemo, useState } from 'react';

import { dialQuickConnect, loadQuickConnects, transferTo } from '../lib/softphone';
import { $contactSnapshot, $quickConnects } from '../lib/stores';
import { Button, Card, Icon, type IconName } from './ui';

const ET = connect.EndpointType;

const FILTERS: { label: string; type: string | null }[] = [
  { label: 'All', type: null },
  { label: 'Agents', type: ET.AGENT },
  { label: 'Queues', type: ET.QUEUE },
  { label: 'Phone', type: ET.PHONE_NUMBER },
];

const TYPE_ICON: Record<string, IconName> = {
  [ET.AGENT]: 'user',
  [ET.QUEUE]: 'queue',
  [ET.PHONE_NUMBER]: 'phone',
};

export default function QuickConnects() {
  const quickConnects = useStore($quickConnects);
  const contact = useStore($contactSnapshot);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const onCall = contact?.status === connect.ContactStateType.CONNECTED;
  const idle = contact === null;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (quickConnects ?? []).filter((qc) => (!filter || qc.type === filter) && (!q || qc.name.toLowerCase().includes(q)));
  }, [quickConnects, query, filter]);

  const refresh = async () => {
    setRefreshing(true);
    await loadQuickConnects();
    setRefreshing(false);
  };

  return (
    <Card
      title="Transfers"
      className="max-h-[42rem]"
      actions={
        <button
          type="button"
          aria-label="Refresh quick connects"
          title="Refresh"
          onClick={() => void refresh()}
          className="rounded-lg p-1 text-secondary-400 hover:bg-secondary-100 hover:text-secondary-700 dark:hover:bg-secondary-800 dark:hover:text-secondary-200"
        >
          <Icon name="refresh" className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      }
    >
      <div className="flex flex-col gap-3 border-b border-secondary-100 p-4 dark:border-secondary-800">
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-center text-secondary-400">
            <Icon name="search" />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="block w-full rounded-lg border border-secondary-200 py-2 pr-3 pl-10 text-sm leading-6 placeholder:text-secondary-400 focus:border-primary-500 focus:ring-3 focus:ring-primary-500/50 focus:outline-none dark:border-secondary-600 dark:bg-secondary-800 dark:focus:border-primary-500"
          />
        </div>
        <div className="flex gap-1 rounded-lg bg-secondary-100 p-1 dark:bg-secondary-800">
          {FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setFilter(f.type)}
              className={`grow rounded-md px-2 py-1 text-xs font-semibold transition ${
                filter === f.type
                  ? 'bg-white text-secondary-900 shadow-xs dark:bg-secondary-700 dark:text-white'
                  : 'text-secondary-500 hover:text-secondary-800 dark:text-secondary-400 dark:hover:text-secondary-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <ul className="grow divide-y divide-secondary-100 overflow-y-auto dark:divide-secondary-800">
        {quickConnects === null && <li className="px-4 py-6 text-center text-sm text-secondary-400">Loading…</li>}
        {quickConnects !== null && visible.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-secondary-400">No quick connects found</li>
        )}
        {visible.map((qc) => {
          const canCall = idle && qc.type === ET.PHONE_NUMBER;
          return (
            <li key={qc.endpointARN} className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex size-8 flex-none items-center justify-center rounded-full bg-secondary-100 text-secondary-500 dark:bg-secondary-800 dark:text-secondary-400">
                <Icon name={TYPE_ICON[qc.type] ?? 'phone'} className="size-4" />
              </span>
              <span className="min-w-0 grow truncate text-sm font-medium">{qc.name}</span>
              {onCall && (
                <Button size="sm" variant="primary" onClick={() => void transferTo(qc.endpointARN)}>
                  Transfer
                </Button>
              )}
              {canCall && (
                <Button size="sm" icon="phone" onClick={() => void dialQuickConnect(qc.endpointARN)}>
                  Call
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
