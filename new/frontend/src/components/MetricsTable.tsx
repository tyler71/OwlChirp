import { useStore } from '@nanostores/react';

import {
  CURSOR_HELP_CLASS,
  LOADING_CLASS,
  MAX_QUEUE_COUNT,
  MIN_AGENT_STAFFED,
  TABLE_ALERT_CLASS,
} from '../lib/const';
import { $metrics, agentCountLabel } from '../lib/stores';
import { Card } from './ui';

const KEY_CLASS = 'px-4 py-2.5 text-secondary-600 select-none dark:text-secondary-400';
const VALUE_CLASS = 'px-4 py-2.5 text-right font-semibold tabular-nums';

function Loading() {
  return <span className={`inline-block h-4 w-8 align-middle ${LOADING_CLASS}`} />;
}

export default function MetricsTable() {
  const metrics = useStore($metrics);
  const { queue_count, active_agent_count } = metrics;

  const queueLoaded = queue_count !== undefined;
  const agents = agentCountLabel(metrics);

  return (
    <Card className={"lg:hidden"} title="Queue">
      <table id="metrics" className="w-full text-sm">
        <tbody className="divide-y divide-secondary-100 dark:divide-secondary-800">
          <tr id="queueCount" className={queueLoaded && queue_count >= MAX_QUEUE_COUNT ? TABLE_ALERT_CLASS : undefined}>
            <td className={KEY_CLASS}>Calls in Queue</td>
            <td className={VALUE_CLASS}>{queueLoaded ? queue_count : <Loading />}</td>
          </tr>
          <tr
            id="availableAgentCount"
            className={agents && active_agent_count! <= MIN_AGENT_STAFFED ? TABLE_ALERT_CLASS : undefined}
          >
            <td className={KEY_CLASS}>Available Agents</td>
            <td className={`${VALUE_CLASS} ${CURSOR_HELP_CLASS}`} title={agents?.title}>
              {agents ? agents.text : <Loading />}
            </td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}
