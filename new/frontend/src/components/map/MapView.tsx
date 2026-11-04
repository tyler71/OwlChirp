// Map section: the town canvas, who's around, and (with Map buildings) the
// buildings editor.
import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';

import { $queuedCount, loadFlowCalls } from '../../lib/flowCalls';
import { agentName } from '../../lib/helpers';
import { $mapPlayers, loadMapState } from '../../lib/map';
import { $agent, $can, $flowCalls, $metrics, $wsStatus } from '../../lib/stores';
import { STATUS_EMOJI, statusClass } from '../VisualAgentList';
import { Card } from '../ui';
import BuildingsEditor from './BuildingsEditor';
import MapCanvas from './MapCanvas';

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function WhoIsHere({ me }: { me: string }) {
  const players = useStore($mapPlayers) ?? {};
  const { user_list: users = [] } = useStore($metrics, { keys: ['user_list'] });
  const canSeeNames = useStore($can('agentNames'));
  const statusOf = new Map(users.map((u) => [u.user.username.toLowerCase(), u.status.name]));

  const names = Object.keys(players).sort((a, b) => (a === me ? -1 : b === me ? 1 : a.localeCompare(b)));
  return (
    <Card title={`On the map (${names.length})`}>
      <ul className="flex flex-col divide-y divide-secondary-100 text-sm dark:divide-secondary-800">
        {names.map((name, i) => {
          const status = statusOf.get(name.toLowerCase()) ?? 'Offline';
          const label = name === me ? 'You' : canSeeNames ? agentName(name) : `Agent ${i + 1}`;
          return (
            <li key={name} className="flex items-center justify-between gap-2 px-4 py-2">
              <span className="truncate font-medium">{label}</span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(status)}`}>
                {STATUS_EMOJI[status.toLowerCase()]} {status}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Legend() {
  const queued = useStore($queuedCount);
  return (
    <Card title="Legend">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 px-4 py-3 text-sm">
        <dt>📞</dt>
        <dd>On a call</dd>
        <dt>🎫</dt>
        <dd>Ticket break: typing at a desk</dd>
        <dt>🍔</dt>
        <dd>Lunch</dd>
        <dt>💤</dt>
        <dd>Offline: asleep</dd>
        <dt>✨</dt>
        <dd>A new call travels from its building to Techline HQ</dd>
      </dl>
      <p className="border-t border-secondary-100 px-4 py-2 text-xs text-secondary-500 dark:border-secondary-800 dark:text-secondary-400">
        {queued ? `${queued} waiting in queue: HQ is lit up` : 'Nobody waiting in queue'}
      </p>
    </Card>
  );
}

export default function MapView() {
  const agent = useStore($agent);
  const wsStatus = useStore($wsStatus);
  const players = useStore($mapPlayers);
  const canEdit = useStore($can('mapEdit'));
  const [error, setError] = useState('');
  const me = agent?.getConfiguration().username ?? '';

  useEffect(() => {
    if (wsStatus !== 'open') return;
    loadMapState()
      .then(() => setError(''))
      .catch((e) => setError(errorMessage(e)));
    // Queue glow and pulses need flow calls even without the Flow feature.
    if ($flowCalls.get() === null) loadFlowCalls().catch((e) => console.error('loadFlowCalls', e));
  }, [wsStatus]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Map</h1>
        <p className="text-sm text-secondary-500 dark:text-secondary-400">
          Click the map, then walk with the arrow keys or WASD, or click where you want to go.
        </p>
      </div>
      {error && <p className="text-sm text-rose-600 dark:text-rose-400">Couldn't load the map: {error}</p>}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-4">
        <div className="xl:col-span-3">
          {players === null || !me ? (
            <div className="flex aspect-[3/2] items-center justify-center rounded-lg bg-secondary-200 text-sm text-secondary-500 dark:bg-secondary-800">
              Loading map...
            </div>
          ) : (
            <MapCanvas me={me} />
          )}
        </div>
        <div className="flex flex-col gap-6">
          <WhoIsHere me={me} />
          <Legend />
        </div>
      </div>
      {canEdit && <BuildingsEditor />}
    </div>
  );
}
