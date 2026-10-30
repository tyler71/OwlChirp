// Compact call controls pinned to the bottom of every view except Phone, so an
// agent can answer, mute or hang up without leaving the page they're on.
import { useStore } from '@nanostores/react';

import { acceptContact, clearContact, hangUp, rejectContact, toggleMute } from '../lib/softphone';
import { $agentSnapshot, $callerId, $contactSnapshot, $view } from '../lib/stores';
import { Timer, contactName } from './CallPanel';
import { Button, Icon } from './ui';

const CS = connect.ContactStateType;
const HOLD = connect.ConnectionStateType.HOLD;

// Labels collapse to icons on narrow screens.
const LABEL = 'hidden sm:inline';

export default function MiniCallBar() {
  const contact = useStore($contactSnapshot);
  const agent = useStore($agentSnapshot);
  const callerId = useStore($callerId);
  const view = useStore($view);

  if (!contact || view === 'phone') return null;

  const name = contactName(contact, callerId);
  const ringing = contact.isInbound && (contact.status === CS.INCOMING || contact.status === CS.CONNECTING);
  const failed = contact.status === CS.MISSED || contact.status === CS.REJECTED || contact.status === CS.ERROR;
  const wrapup = contact.status === CS.ENDED;
  const dialing = contact.status === CS.CONNECTING || contact.status === CS.PENDING || contact.status === CS.INIT;
  const live = contact.connections;
  const multiParty = live.length > 1;
  const allHeld = live.length > 0 && live.every((c) => c.status === HOLD);
  const muted = agent?.muted ?? false;

  const status = ringing
    ? 'Incoming call'
    : failed
      ? contact.status === CS.ERROR
        ? 'Call failed'
        : 'Missed call'
      : wrapup
        ? 'After call work'
        : dialing
          ? 'Calling…'
          : allHeld
            ? 'On hold'
            : 'Connected';

  const iconClass = failed
    ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
    : wrapup
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';

  return (
    <div className="sticky bottom-3 z-20 mt-auto pt-3">
      <div className="flex items-center gap-3 rounded-lg border border-secondary-200 bg-base-100 px-3 py-2 shadow-lg shadow-secondary-500/10 dark:border-secondary-700 dark:bg-secondary-800 dark:shadow-secondary-950/50">
        <button
          type="button"
          onClick={() => $view.set('phone')}
          className="flex min-w-0 grow items-center gap-3 text-left"
          title="Open phone"
        >
          <span className={`relative flex size-9 flex-none items-center justify-center rounded-full ${iconClass}`}>
            {ringing && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/30" />}
            <Icon name={failed ? 'exclamation' : wrapup ? 'check' : 'phone'} className="relative size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{name}</span>
            <span className="block truncate text-xs text-secondary-500 dark:text-secondary-400">
              {status}
              {!ringing && !failed && (
                <>
                  {' '}
                  · <Timer since={contact.statusStartedAt} />
                </>
              )}
            </span>
          </span>
        </button>

        <div className="flex flex-none items-center gap-2">
          {ringing && (
            <>
              <Button size="sm" variant="success" icon="phone" aria-label="Answer" onClick={() => void acceptContact()}>
                <span className={LABEL}>Answer</span>
              </Button>
              <Button size="sm" icon="xMark" aria-label="Decline" onClick={() => void rejectContact()}>
                <span className={LABEL}>Decline</span>
              </Button>
            </>
          )}
          {!ringing && !failed && !wrapup && (
            <>
              {!dialing && (
                <Button
                  size="sm"
                  icon={muted ? 'microphoneSlash' : 'microphone'}
                  variant={muted ? 'active' : 'default'}
                  aria-label={muted ? 'Unmute' : 'Mute'}
                  onClick={toggleMute}
                >
                  <span className={LABEL}>{muted ? 'Unmute' : 'Mute'}</span>
                </Button>
              )}
              <Button
                size="sm"
                variant="danger"
                icon="phone"
                aria-label={multiParty ? 'Leave' : 'End'}
                onClick={() => void hangUp()}
                className="[&>svg]:rotate-[135deg]"
              >
                <span className={LABEL}>{multiParty ? 'Leave' : 'End'}</span>
              </Button>
            </>
          )}
          {failed && (
            <Button size="sm" aria-label="Clear" onClick={() => void clearContact()}>
              Clear
            </Button>
          )}
          <Button size="sm" icon="externalLink" aria-label="Open phone" onClick={() => $view.set('phone')}>
            <span className={LABEL}>Phone</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
