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
    <div id="metrics">
      <table className="table table-sm">
        <tbody>
          <tr id="queueCount" className={queueLoaded && queue_count >= MAX_QUEUE_COUNT ? TABLE_ALERT_CLASS : undefined}>
            <td className="key noselect">Calls in Queue</td>
            <td className={`value ${queueLoaded ? '' : LOADING_CLASS}`}>{queue_count}</td>
          </tr>
          <tr
            id="availableAgentCount"
            className={agentsLoaded && active_agent_count <= MIN_AGENT_STAFFED ? TABLE_ALERT_CLASS : undefined}
          >
            <td className="key noselect">Available Agents</td>
            <td
              className={`value ${CURSOR_HELP_CLASS} ${agentsLoaded ? '' : LOADING_CLASS}`}
              data-toggle="tooltip"
              data-placement="top"
              title={agentsTitle || undefined}
            >
              {agentsText}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
