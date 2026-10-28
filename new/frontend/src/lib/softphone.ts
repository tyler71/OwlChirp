// Softphone controls built on the Streams API. The CCP iframe stays hidden and
// only carries audio/signalling; everything the agent clicks goes through here.
// https://github.com/amazon-connect/amazon-connect-streams/blob/master/Documentation.md
import 'amazon-connect-streams';

import { formatPhoneNumber } from './helpers';
import {
  $agent,
  $agentSnapshot,
  $alert,
  $contactSnapshot,
  $quickConnects,
  type ConnectionSnapshot,
  type QuickConnect,
} from './stores';

let muted = false;

// ---- Snapshots ----

function snapshotAgent(agent: connect.Agent): void {
  const state = agent.getState();
  const next = agent.getNextState();
  $agentSnapshot.set({
    name: agent.getName(),
    stateName: state.name,
    stateType: state.type,
    stateStartedAt: Date.now() - agent.getStateDuration(),
    nextStateName: next ? next.name : null,
    states: agent.getAgentStates(),
    muted,
  });
}

function connectionLabel(conn: connect.BaseConnection): string {
  const ep = conn.getEndpoint();
  if (ep.type === connect.EndpointType.PHONE_NUMBER && ep.phoneNumber) {
    return formatPhoneNumber(ep.phoneNumber);
  }
  return ep.name || ep.phoneNumber || 'Unknown';
}

function snapshotContact(contact: connect.Contact): void {
  const initial = contact.getInitialConnection();
  const connections: ConnectionSnapshot[] = contact
    .getConnections()
    .filter((c) => c.getType() !== connect.ConnectionType.AGENT)
    .map((c) => ({
      id: c.getConnectionId(),
      isInitial: c.getConnectionId() === initial?.getConnectionId(),
      label: connectionLabel(c),
      status: c.getStatus().type,
      statusStartedAt: Date.now() - c.getStatusDuration(),
    }));

  $contactSnapshot.set({
    contactId: contact.getContactId(),
    status: contact.getStatus().type,
    statusStartedAt: Date.now() - contact.getStatusDuration(),
    isInbound: contact.isInbound(),
    phoneNumber: initial?.getEndpoint().phoneNumber ?? '',
    connections,
  });
}

export function trackAgent(agent: connect.Agent): void {
  snapshotAgent(agent);
  agent.onRefresh(snapshotAgent);
  agent.onStateChange(() => snapshotAgent(agent));
  agent.onMuteToggle(({ muted: m }) => {
    muted = m;
    snapshotAgent(agent);
  });
  void loadQuickConnects();
}

export function trackContact(contact: connect.Contact): void {
  if (contact.getType() !== connect.ContactType.VOICE && contact.getType() !== connect.ContactType.QUEUE_CALLBACK) {
    return;
  }
  const update = () => snapshotContact(contact);
  update();
  contact.onRefresh(update);
  contact.onIncoming(update);
  contact.onConnecting(update);
  contact.onAccepted(update);
  contact.onConnected(update);
  contact.onMissed(update);
  contact.onEnded(update);
  contact.onACW(update);
  contact.onDestroy(() => {
    if ($contactSnapshot.get()?.contactId === contact.getContactId()) $contactSnapshot.set(null);
  });
}

// ---- Lookups ----

function requireAgent(): connect.Agent {
  const agent = $agent.get();
  if (!agent) throw new Error('Agent not ready');
  return agent;
}

function currentContact(): connect.Contact {
  const id = $contactSnapshot.get()?.contactId;
  const contact = requireAgent()
    .getContacts()
    .find((c) => c.getContactId() === id);
  if (!contact) throw new Error('No active call');
  return contact;
}

function findConnection(connectionId: string): connect.BaseConnection {
  const conn = currentContact()
    .getConnections()
    .find((c) => c.getConnectionId() === connectionId);
  if (!conn) throw new Error('Connection not found');
  return conn;
}
// Wraps a Streams callback-style call in a Promise; failures (including
// synchronous throws such as "No active call") surface as an alert.
function run(label: string, fn: (callbacks: connect.SuccessFailOptions) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    fn({ success: () => resolve(), failure: (err) => reject(new Error(err || 'unknown error')) });
  }).catch((e: unknown) => {
    console.error(label, e);
    $alert.set({ kind: 'warning', message: `${label} failed: ${e instanceof Error ? e.message : String(e)}` });
  });
}

// ---- Agent status ----

export const setAgentState = (state: connect.AgentStateDefinition) =>
  run('Status change', (cb) => requireAgent().setState(state, cb, { enqueueNextState: true }));

export function toggleMute(): void {
  const agent = $agent.get();
  if (!agent) return;
  if (muted) agent.unmute();
  else agent.mute();
}

// ---- Call control ----

export const acceptContact = () => run('Answer', (cb) => currentContact().accept(cb));

export const rejectContact = () => run('Decline', (cb) => currentContact().reject(cb));

// Leaving with other parties still connected completes a warm transfer.
export const hangUp = () => run('End call', (cb) => currentContact().getAgentConnection().destroy(cb));

export const clearContact = () => run('Clear', (cb) => currentContact().clear(cb));

export const holdConnection = (id: string) => run('Hold', (cb) => findConnection(id).hold(cb));

export const resumeConnection = (id: string) => run('Resume', (cb) => findConnection(id).resume(cb));

export const dropConnection = (id: string) => run('Disconnect', (cb) => findConnection(id).destroy(cb));

export const swapConnections = () => run('Swap', (cb) => currentContact().toggleActiveConnections(cb));

export const conference = () => run('Join', (cb) => currentContact().conferenceConnections(cb));

export const sendDigits = (digits: string) =>
  run('Keypad', (cb) => {
    const contact = currentContact();
    // Prefer an active third party (e.g. an IVR being transferred to).
    const conn =
      contact.getThirdPartyConnections().find((c) => c.isActive() && !c.isOnHold()) ?? contact.getInitialConnection();
    conn.sendDigits(digits, cb);
  });

// ---- Dialing ----

// Accepts what agents type: 10 digits assumes +1, otherwise must be E.164.
export function toE164(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  return null;
}

function connectTo(endpoint: () => connect.Endpoint): Promise<void> {
  return run('Call', (cb) => {
    const agent = requireAgent();
    const queueARN = agent.getRoutingProfile().defaultOutboundQueue?.queueARN;
    agent.connect(endpoint(), { ...cb, queueARN });
  });
}

export function dialNumber(input: string): Promise<void> {
  const number = toE164(input);
  if (!number) {
    $alert.set({ kind: 'warning', message: `"${input}" is not a valid phone number` });
    return Promise.resolve();
  }
  return connectTo(() => connect.Endpoint.byPhoneNumber(number));
}

// ---- Quick connects ----

const endpointCache = new Map<string, connect.Endpoint>();

function endpoint(arn: string): connect.Endpoint {
  const ep = endpointCache.get(arn);
  if (!ep) throw new Error('Quick connect not found');
  return ep;
}

export const loadQuickConnects = () =>
  run('Quick connects', (cb) => {
    const agent = requireAgent();
    agent.getEndpoints(agent.getAllQueueARNs(), {
      success: (data) => {
        endpointCache.clear();
        const list: QuickConnect[] = data.endpoints.map((ep) => {
          endpointCache.set(ep.endpointARN, ep);
          return { endpointARN: ep.endpointARN, name: ep.name, type: ep.type };
        });
        list.sort((a, b) => a.name.localeCompare(b.name));
        $quickConnects.set(list);
        cb.success?.();
      },
      failure: cb.failure,
    });
  });

// Warm transfer: the customer is held while the new party is dialled.
export const transferTo = (arn: string) => run('Transfer', (cb) => currentContact().addConnection(endpoint(arn), cb));

export const dialQuickConnect = (arn: string) => connectTo(() => endpoint(arn));
