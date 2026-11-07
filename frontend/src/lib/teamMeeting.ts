// "Follow team into meetings": when most teammates are In a meeting and this
// agent isn't, switch them too — right away when available, or as the next
// status once the current call wraps up.
import { STATUS_IN_MEETING, STATUS_OFFLINE, TEAM_MEETING_THRESHOLD } from './const';
import { notify } from './notifier';
import { setAgentState } from './softphone';
import { $agent, $agentSnapshot, $contactSnapshot, $metrics, type ActiveUser } from './stores';
import { $followTeamMeeting } from './theme';

const isMeeting = (name: string | null | undefined) => name?.toLowerCase() === STATUS_IN_MEETING;

export function teamInMeeting(users: ActiveUser[], username: string): boolean {
  const me = username.toLowerCase();
  const others = users.filter(
    (u) => u.user.username.toLowerCase() !== me && u.status.name.toLowerCase() !== STATUS_OFFLINE,
  );
  if (others.length === 0) return false;
  return others.filter((u) => isMeeting(u.status.name)).length / others.length >= TEAM_MEETING_THRESHOLD;
}

// On a live call or in after-call work; not a missed/failed call card.
function onContact(): boolean {
  const status = $contactSnapshot.get()?.status;
  return !!status && status !== connect.ContactStateType.ERROR && status !== connect.ContactStateType.MISSED;
}

function followTeam(): void {
  const snap = $agentSnapshot.get();
  if (!snap || isMeeting(snap.stateName) || isMeeting(snap.nextStateName)) return;

  const busy = onContact();
  if (!busy && snap.stateType !== connect.AgentStateType.ROUTABLE) return;

  const meeting = snap.states.find((s) => isMeeting(s.name));
  if (!meeting) return;

  void setAgentState(meeting);
  notify(
    busy
      ? 'Most of your team is in a meeting. Your status will switch to In a meeting after this call.'
      : 'Most of your team is in a meeting. Your status is now In a meeting.',
    'Team Meeting',
    'teamMeeting',
  );
}

// Acts only when the team crosses the threshold, so switching back out is respected
// until the team leaves the meeting and starts another.
let wasInMeeting = false;

$metrics.listen((metrics, _old, changedKey) => {
  if (changedKey !== 'user_list') return;
  const agent = $agent.get();
  if (!agent || !metrics.user_list) return;

  const now = teamInMeeting(metrics.user_list, agent.getConfiguration().username);
  const crossed = now && !wasInMeeting;
  wasInMeeting = now;
  if (crossed && $followTeamMeeting.get()) followTeam();
});
