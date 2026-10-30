import { useStore } from '@nanostores/react';

import { formatPhoneNumber } from '../lib/helpers';
import {
  acceptContact,
  clearContact,
  conference,
  dropConnection,
  hangUp,
  holdConnection,
  rejectContact,
  resumeConnection,
  swapConnections,
  toggleMute,
} from '../lib/softphone';
import {
  $agentSnapshot,
  $callerId,
  $contactSnapshot,
  type CallerId,
  type ConnectionSnapshot,
  type ContactSnapshot,
} from '../lib/stores';
import { openCallLog } from '../lib/systemLog';
import { $wrapupStatus, saveDraft } from '../lib/wrapups';
import { Button, Card, Icon, formatElapsed, useNow } from './ui';
import WrapupFeed from './WrapupFeed';
import WrapupForm from './WrapupForm';

const CS = connect.ContactStateType;
const HOLD = connect.ConnectionStateType.HOLD;

export function Timer({ since }: { since: number }) {
  const now = useNow();
  return <span className="font-mono tabular-nums">{formatElapsed(now - since)}</span>;
}

// Caller ID name when it matches this call, else the formatted number.
export function contactName(contact: ContactSnapshot, callerId: CallerId | null): string {
  if (callerId && callerId.phoneNumber === contact.phoneNumber && callerId.name) return callerId.name;
  if (contact.phoneNumber) return formatPhoneNumber(contact.phoneNumber);
  return contact.connections[0]?.label ?? 'Unknown';
}

function ConnectionRow({ conn, canDrop }: { conn: ConnectionSnapshot; canDrop: boolean }) {
  const onHold = conn.status === HOLD;
  const connecting = conn.status === connect.ConnectionStateType.CONNECTING;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span
        className={`flex size-9 flex-none items-center justify-center rounded-full ${
          onHold
            ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
        }`}
      >
        <Icon name={conn.isInitial ? 'phone' : 'user'} className="size-4" />
      </span>
      <div className="min-w-0 grow">
        <p className="truncate text-sm font-semibold">{conn.label}</p>
        <p className="text-xs text-secondary-500 dark:text-secondary-400">
          {conn.isInitial ? 'User' : 'Third party'} · {connecting ? 'Dialing' : onHold ? 'On hold' : 'Connected'}{' '}
          · <Timer since={conn.statusStartedAt} />
        </p>
      </div>
      {!connecting && (
        <Button
          size="sm"
          icon={onHold ? 'play' : 'pause'}
          variant={onHold ? 'active' : 'default'}
          onClick={() => void (onHold ? resumeConnection(conn.id) : holdConnection(conn.id))}
        >
          {onHold ? 'Resume' : 'Hold'}
        </Button>
      )}
      {canDrop && (
        <Button size="sm" icon="xMark" title="Disconnect" aria-label="Disconnect" onClick={() => void dropConnection(conn.id)} />
      )}
    </li>
  );
}

function AfterCallWork({ contact, name }: { contact: ContactSnapshot; name: string }) {
  const { saving } = useStore($wrapupStatus);

  // Save any unsaved notes first; if that fails, stay in after-call work so
  // the form (which shows the error) isn't lost.
  const finish = async () => {
    if (await saveDraft()) await clearContact();
  };

  return (
    <Card>
      <div className="flex items-center gap-3 px-4 py-4">
        <span className="flex size-10 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <Icon name="check" />
        </span>
        <div className="min-w-0 grow">
          <p className="font-semibold">After call work</p>
          <p className="truncate text-sm text-secondary-500 dark:text-secondary-400">
            {name} · <Timer since={contact.statusStartedAt} />
          </p>
        </div>
        <Button variant="primary" disabled={saving} onClick={() => void finish()}>
          {saving ? 'Saving notes…' : 'Finish call'}
        </Button>
      </div>
      {contact.phoneNumber && <WrapupForm contactId={contact.contactId} phoneNumber={contact.phoneNumber} />}
      <WrapupFeed phoneNumber={contact.phoneNumber} collapsible />
    </Card>
  );
}

export default function CallPanel() {
  const contact = useStore($contactSnapshot);
  const agent = useStore($agentSnapshot);
  const callerId = useStore($callerId);

  if (!contact) {
    const routable = agent?.stateType === connect.AgentStateType.ROUTABLE;
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 px-4 py-2 lg:py-10 text-center">
          <span
            className={`flex size-8 lg:size-12 items-center justify-center rounded-full ${
              routable
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                : 'bg-secondary-100 text-secondary-500 dark:bg-secondary-800 dark:text-secondary-400'
            }`}
          >
            <Icon name="phone" className="size-4 lg:size-6" />
          </span>
          <div>
            <p className="font-semibold">{routable ? 'Available' : 'Ignoring Calls'}</p>
            <p className="text-sm text-secondary-500 dark:text-secondary-400">
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const name = contactName(contact, callerId);
  const ringing = contact.isInbound && (contact.status === CS.INCOMING || contact.status === CS.CONNECTING);

  if (ringing) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-4 px-4 py-8 text-center">
          <span className="relative flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
            <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/30" />
            <Icon name="phone" className="relative size-7" />
          </span>
          <div>
            <p className="text-xs font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-400">Incoming call</p>
            <p className="text-xl font-bold">{name}</p>
            {name !== formatPhoneNumber(contact.phoneNumber) && contact.phoneNumber && (
              <p className="text-sm text-secondary-500 dark:text-secondary-400">{formatPhoneNumber(contact.phoneNumber)}</p>
            )}
          </div>
          <div className="flex gap-3">
            <Button size="lg" variant="success" icon="phone" onClick={() => void acceptContact()}>
              Accept
            </Button>
            <Button size="lg" icon="xMark" onClick={() => void rejectContact()}>
              Decline
            </Button>
          </div>
        </div>
        <WrapupFeed phoneNumber={contact.phoneNumber} />
      </Card>
    );
  }

  if (contact.status === CS.MISSED || contact.status === CS.REJECTED || contact.status === CS.ERROR) {
    return (
      <Card>
        <div className="flex items-center gap-3 px-4 py-4">
          <Icon name="exclamation" className="size-6 text-rose-500" />
          <div className="grow">
            <p className="font-semibold">{contact.status === CS.ERROR ? 'Call failed' : 'Missed call'}</p>
            <p className="text-sm text-secondary-500 dark:text-secondary-400">{name}</p>
          </div>
          {contact.status === CS.ERROR && (
            <Button onClick={() => openCallLog(contact.contactId)}>View log</Button>
          )}
          <Button onClick={() => void clearContact()}>Clear</Button>
        </div>
      </Card>
    );
  }

  if (contact.status === CS.ENDED) {
    return <AfterCallWork contact={contact} name={name} />;
  }

  // Connecting (outbound) or connected.
  const dialing = contact.status === CS.CONNECTING || contact.status === CS.PENDING || contact.status === CS.INIT;
  const live = contact.connections;
  const multiParty = live.length > 1;
  const allHeld = live.length > 0 && live.every((c) => c.status === HOLD);
  const muted = agent?.muted ?? false;

  return (
    <Card>
      <div className="flex items-center gap-3 border-b border-secondary-100 px-4 py-4 dark:border-secondary-800">
        <span className="flex size-10 items-center justify-center rounded-full bg-primary-100 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300">
          <Icon name="phone" />
        </span>
        <div className="min-w-0 grow">
          <p className="truncate text-lg font-bold">{name}</p>
          <p className="text-sm text-secondary-500 dark:text-secondary-400">
            {dialing ? 'Calling…' : allHeld ? 'On hold' : 'Connected'} · <Timer since={contact.statusStartedAt} />
          </p>
        </div>
        <Button variant="danger" icon="phone" onClick={() => void hangUp()} className="[&>svg]:rotate-[135deg]">
          {multiParty ? 'Leave' : 'End'}
        </Button>
      </div>

      {!dialing && (
        <div className="flex flex-wrap gap-2 border-b border-secondary-100 px-4 py-3 dark:border-secondary-800">
          <Button icon={muted ? 'microphoneSlash' : 'microphone'} variant={muted ? 'active' : 'default'} onClick={toggleMute}>
            {muted ? 'Unmute' : 'Mute'}
          </Button>
          {!multiParty && live[0] && (
            <Button
              icon={allHeld ? 'play' : 'pause'}
              variant={allHeld ? 'active' : 'default'}
              onClick={() => void (allHeld ? resumeConnection(live[0].id) : holdConnection(live[0].id))}
            >
              {allHeld ? 'Resume' : 'Hold'}
            </Button>
          )}
          {multiParty && (
            <>
              <Button icon="swap" onClick={() => void swapConnections()}>
                Swap
              </Button>
              <Button icon="userGroup" onClick={() => void conference()}>
                Join
              </Button>
            </>
          )}
        </div>
      )}

      {live.length > 0 && (
        <ul className="divide-y divide-secondary-100 dark:divide-secondary-800">
          {live.map((c) => (
            <ConnectionRow key={c.id} conn={c} canDrop={multiParty} />
          ))}
        </ul>
      )}

      {/* Without a number (e.g. an internal transfer) there's nothing to attach notes to. */}
      {contact.phoneNumber && <WrapupForm contactId={contact.contactId} phoneNumber={contact.phoneNumber} />}

      <WrapupFeed phoneNumber={contact.phoneNumber} collapsible />

      {multiParty && (
        <p className="border-t border-secondary-100 px-4 py-2 text-xs text-secondary-500 dark:border-secondary-800 dark:text-secondary-400">
          Leaving keeps the other parties connected and completes the transfer.
        </p>
      )}
    </Card>
  );
}
