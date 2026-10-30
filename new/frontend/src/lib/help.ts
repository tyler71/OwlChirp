// "Ask for Help": an agent taking calls asks everyone in a non-routable
// status (break, lunch, ...) to become available. The server broadcasts the
// request to every client and each one decides from its own agent state
// whether to show it.
import 'amazon-connect-streams';

import { notify } from './notifier';
import { onEvent, request } from './realtime';
import { $agent, $agentSnapshot, $alert, $helpRequest, $helpRequestedAt, $metrics, type HelpRequest } from './stores';

export async function requestHelp(): Promise<void> {
  try {
    await request<HelpRequest>('help.request', {
      name: $agentSnapshot.get()?.name ?? '',
      queueCount: $metrics.get().queue_count ?? 0,
    });
    $helpRequestedAt.set(Date.now());
  } catch (e) {
    $alert.set({ kind: 'warning', message: `Ask for help failed: ${e instanceof Error ? e.message : String(e)}` });
  }
}

function notRoutable(): boolean {
  return $agentSnapshot.get()?.stateType === connect.AgentStateType.NOT_ROUTABLE;
}

onEvent<HelpRequest>('help.requested', (req) => {
  if (req.agent === $agent.get()?.getConfiguration().username || !notRoutable()) return;

  $helpRequest.set(req);
  // Reaches agents who have OwlChirp in a background tab.
  notify(`${req.name} needs help: ${req.queueCount} callers waiting`, 'Help Requested', 'helpRequest', 0, [
    { name: 'click', handler: () => window.focus() },
  ]);
});

// Going available (from the popup or elsewhere) answers the request.
$agentSnapshot.listen(() => {
  if ($helpRequest.get() && !notRoutable()) $helpRequest.set(null);
});
