// Wires the Amazon Connect CCP to OwlChirp: agent/contact hooks, periodic
// state checks, and notifications driven by realtime metrics.
// https://github.com/amazon-connect/amazon-connect-streams/blob/master/Documentation.md
import 'amazon-connect-streams';

import { addCall, refreshCalls } from './callHistory';
import { loadCallerId } from './callerId';
import { loadWrapups } from './wrapups';
import {
  API,
  BREAK_STATUSES,
  HIGH_QUEUE_COUNT_NOTIFICATION_INTERVAL,
  LONG_BREAK_NOTIFICATION_INTERVAL,
  LONG_BREAK_SNOOZE_MINUTES,
  MAX_QUEUE_COUNT,
  MIN_AGENT_STAFFED,
  SIDELINE_NOTIFICATION_INTERVAL,
  STATE_CHECK_INTERVAL_MS,
  STATUS_ON_CONTACT,
} from './const';
import { agentSideline, formatPhoneNumber, telemetry } from './helpers';
import './help';
import { authorize, notify, snooze } from './notifier';
import { startRealtime } from './realtime';
import { installConsoleCapture } from './systemLog';
import { trackAgent, trackContact } from './softphone';
import { $agent, $alert, $config, $metrics, $storageAccess, type AppConfig } from './stores';

export async function loadConfig(): Promise<AppConfig> {
  const existing = $config.get();
  if (existing) return existing;

  const res = await fetch(`${API}/config`);
  if (!res.ok) throw new Error(`Failed to load config: ${res.status}`);
  const config: AppConfig = await res.json();
  $config.set(config);
  return config;
}

let initialised = false;

export async function initCcp(container: HTMLElement): Promise<void> {
  if (initialised) return;
  initialised = true;
  installConsoleCapture();

  const config = await loadConfig();

  authorize();

  connect.core.initCCP(container, {
    ccpUrl: `${config.connectDomain}/connect/ccp-v2`,
    // A popup opened from this page keeps window.opener, which lets Firefox
    // grant the CCP frame storage access once the agent signs in.
    loginPopup: true,
    loginPopupAutoClose: true,
    loginUrl: `${config.connectDomain}/login`,
    loginOptions: { autoClose: true },
    softphone: {
      allowFramedSoftphone: true,
      disableRingtone: false,
    },
    pageOptions: {
      enableAudioDeviceSettings: false,
      enablePhoneTypeSettings: true,
    },
    // Firefox ETP / third-party cookie blocking partitions the CCP iframe's
    // session; prompt the agent to grant storage access via Connect's banner.
    storageAccess: {
      canRequest: true,
      mode: 'default',
    },
  });

  connect.storageAccess.onRequest({
    onInit: ({ data }) => $storageAccess.set(data.hasAccess ? 'granted' : 'needed'),
    onGrant: () => $storageAccess.set('granted'),
    onDeny: () => {
      $storageAccess.set('denied');
      $alert.set({ kind: 'warning', message: 'Allow cookie access for Amazon Connect, then reload.' });
    },
  });

  connect.agent((agent) => {
    onAgent(agent).catch((e) => console.error('agent init', e));
  });

  connect.contact((contact) => {
    trackContact(contact);
    contact.onConnecting((c) => {
      onIncomingCall(c).catch((e) => console.error('incoming call', e));
    });
  });
}

async function onAgent(agent: connect.Agent): Promise<void> {
  $agent.set(agent);
  $alert.set({ kind: 'none' });
  trackAgent(agent);

  // Call history, caller ID and wrap-ups all go over the realtime socket.
  void startRealtime();
  await refreshCalls();

  setInterval(() => checkStateDuration(agent), STATE_CHECK_INTERVAL_MS);

  $metrics.listen((metrics, _old, changedKey) => {
    if (changedKey === 'queue_count') notifyQueueCount(metrics.queue_count ?? 0);
    if (changedKey === 'active_agent_count') notifyAgentCount(metrics.active_agent_count ?? 0);
  });
}

// Runs for outbound dials too: caller ID, notes and history apply either way,
// but the notification and call-count telemetry are inbound-only.
async function onIncomingCall(contact: connect.Contact): Promise<void> {
  const phoneNumber = contact.getActiveInitialConnection()?.getEndpoint().phoneNumber ?? '';
  const contactId = contact.getContactId();
  const inbound = contact.isInbound();

  if (inbound) notify(`Incoming Call from ${formatPhoneNumber(phoneNumber)}`, 'Incoming Call', 'incomingCall');

  await Promise.all([
    loadCallerId(phoneNumber).catch((e) => console.error('loadCallerId', e)),
    loadWrapups(phoneNumber),
    addCall(contactId, phoneNumber),
  ]);

  const agent = $agent.get();
  if (agent && inbound) void telemetry(agent);
}

// Full Streams log, including the CCP iframe's softphone/WebRTC detail.
export function downloadCcpLog(): void {
  connect.getLog().download();
}

// Remind agents who have been in a break-like status too long.
function checkStateDuration(agent: connect.Agent): void {
  const stateName = agent.getState().name.toLowerCase();
  const maxMinutes = BREAK_STATUSES[stateName];
  if (maxMinutes === undefined) return;

  const minutes = Math.floor(agent.getStateDuration() / 1000 / 60);
  if (minutes <= maxMinutes) return;

  const tag = 'Long Break';
  notify(
    `Hi ${agent.getName()}! Letting you know you've been on ${stateName} for ${minutes} minutes`,
    stateName,
    tag,
    LONG_BREAK_NOTIFICATION_INTERVAL,
    [
      {
        name: 'click',
        handler: () => snooze(tag, Date.now() + LONG_BREAK_SNOOZE_MINUTES * 60 * 1000),
      },
    ],
  );
}

function notifyQueueCount(value: number): void {
  if (value <= MAX_QUEUE_COUNT) return;

  if (agentSideline()) {
    notify(`Queue Count is ${value}!\nCan you help?`, 'Callers Waiting', 'queueCount', HIGH_QUEUE_COUNT_NOTIFICATION_INTERVAL);
  } else if ($agent.get()?.getState().name.toLowerCase() === STATUS_ON_CONTACT) {
    notify(
      `Queue Count is ${value}\nWe're asking for help!`,
      'Support Requested',
      'supportRequest',
      HIGH_QUEUE_COUNT_NOTIFICATION_INTERVAL,
    );
  }
}

function notifyAgentCount(activeAgentCount: number): void {
  if (activeAgentCount < MIN_AGENT_STAFFED && agentSideline()) {
    notify(
      `There are currently ${activeAgentCount} available agents`,
      'Available Agents',
      'availableAgents',
      SIDELINE_NOTIFICATION_INTERVAL,
    );
  }
}
