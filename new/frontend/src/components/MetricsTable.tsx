import { useStore } from '@nanostores/react';

import {
  CURSOR_HELP_CLASS,
  LOADING_CLASS,
  MAX_QUEUE_COUNT,
  MIN_AGENT_STAFFED,
  SIDELINE_STATUSES,
  TABLE_ALERT_CLASS,
} from '../lib/const';
import { $metrics } from '../lib/stores';
import { Card } from './ui';

const KEY_CLASS = 'px-4 py-2.5 text-secondary-600 select-none dark:text-secondary-400';
const VALUE_CLASS = 'px-4 py-2.5 text-right font-semibold tabular-nums';

function Loading() {
  return <span className={`inline-block h-4 w-8 align-middle ${LOADING_CLASS}`} />;
}

export default function MetricsTable() {
  const metrics = useStore($metrics);
  const { queue_count, available_count, active_agent_count, user_list } = metrics;

  const queueLoaded = queue_count !== undefined;
  const agentsLoaded = available_count !== undefined && active_agent_count !== undefined && user_list !== undefined;

  let agentsText = '';
  let agentsTitle = '';
  if (agentsLoaded) {
    const sideline = user_list.filter((u) => SIDELINE_STATUSES.has(u.status.name.toLowerCase())).length;
    agentsText = `${available_count}/${active_agent_count}${sideline > 0 ? `+${sideline}` : ''}`;
    agentsTitle =
      `${available_count} able to take a call now, ${active_agent_count} taking calls.` +
      (sideline > 0 ? ` ${sideline} ready to help` : '');
  }

  return (
    <Card title="Queue">
      <table id="metrics" className="w-full text-sm">
        <tbody className="divide-y divide-secondary-100 dark:divide-secondary-800">
          <tr id="queueCount" className={queueLoaded && queue_count >= MAX_QUEUE_COUNT ? TABLE_ALERT_CLASS : undefined}>
            <td className={KEY_CLASS}>Calls in Queue</td>
            <td className={VALUE_CLASS}>{queueLoaded ? queue_count : <Loading />}</td>
          </tr>
          <tr
            id="availableAgentCount"
            className={agentsLoaded && active_agent_count <= MIN_AGENT_STAFFED ? TABLE_ALERT_CLASS : undefined}
          >
            <td className={KEY_CLASS}>Available Agents</td>
            <td className={`${VALUE_CLASS} ${CURSOR_HELP_CLASS}`} title={agentsTitle || undefined}>
              {agentsLoaded ? agentsText : <Loading />}
            </td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}
