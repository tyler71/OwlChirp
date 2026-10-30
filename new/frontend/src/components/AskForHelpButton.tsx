import { useStore } from '@nanostores/react';

import { HELP_REQUEST_COOLDOWN_MS, MAX_QUEUE_COUNT } from '../lib/const';
import { requestHelp } from '../lib/help';
import { $agentSnapshot, $helpRequestedAt, $metrics } from '../lib/stores';
import { Button, useNow } from './ui';

// Shown to agents taking calls while callers are stacking up; asks everyone
// on break/lunch/etc. to become available.
export default function AskForHelpButton() {
  const { queue_count } = useStore($metrics);
  const agent = useStore($agentSnapshot);
  const requestedAt = useStore($helpRequestedAt);
  const now = useNow();

  if (queue_count === undefined || queue_count <= MAX_QUEUE_COUNT) return null;
  if (agent?.stateType !== connect.AgentStateType.ROUTABLE) return null;

  const cooling = now - requestedAt < HELP_REQUEST_COOLDOWN_MS;
  return (
    <Button variant="danger" icon="userGroup" disabled={cooling} onClick={() => void requestHelp()}>
      {cooling ? 'Help requested' : `Ask for Help (${queue_count} waiting)`}
    </Button>
  );
}
