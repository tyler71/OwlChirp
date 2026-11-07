import { useStore } from '@nanostores/react';
import { useEffect, useRef } from 'react';

import { usePhoneLabel } from '../lib/callerId';
import { $can, $contactSnapshot, $wsStatus } from '../lib/stores';
import { $transcript, startTranscript, stopTranscript, type TranscriptSegment } from '../lib/transcript';
import { Button, Card, Icon } from './ui';

const CS = connect.ContactStateType;

// Pixels from the bottom within which the list keeps following new text.
const FOLLOW_SLACK = 48;

function formatOffset(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Live transcript of what the caller says on the current call, read from its
 * Kinesis Video Stream by the backend. The agent's voice isn't transcribed. Held in memory only; it clears when the call changes.
 */
export default function VoiceTranscript() {
  const canTranscribe = useStore($can('transcription'));
  const contact = useStore($contactSnapshot);
  const transcript = useStore($transcript);
  const wsStatus = useStore($wsStatus);
  const caller = usePhoneLabel(contact?.phoneNumber ?? '');

  const listRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  useEffect(() => {
    const el = listRef.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [transcript.segments]);

  if (!canTranscribe || !contact) return null;

  const mine = transcript.contactId === contact.contactId;
  const status = mine ? transcript.status : 'idle';
  const segments = mine ? transcript.segments : [];
  const running = status === 'live' || status === 'starting';
  const connected = contact.status === CS.CONNECTED;

  // Its own card now, so stay out of the way while a call rings, is missed or
  // fails: only show for a connected call, after-call work, or existing text.
  if (!connected && contact.status !== CS.ENDED && segments.length === 0) return null;
  const canStart = connected && wsStatus === 'open' && !running;

  const actions = running ? (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-400 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-rose-500" />
        </span>
        {status === 'starting' ? 'Connecting…' : 'Live'}
      </span>
      <Button size="sm" onClick={() => void stopTranscript()}>
        Stop
      </Button>
    </div>
  ) : (
    <Button
      size="sm"
      variant="primary"
      icon="microphone"
      disabled={!canStart}
      title={connected ? undefined : 'Available once the call is connected'}
      onClick={() => {
        follow.current = true;
        void startTranscript(contact.contactId);
      }}
    >
      {status === 'ended' || status === 'error' ? 'Restart' : 'Start'}
    </Button>
  );

  const body = (
    <>
      {status === 'error' && (
        <p className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
          {transcript.error}
        </p>
      )}

      {segments.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center text-sm text-secondary-500 dark:text-secondary-400">
          <Icon name="microphone" className="size-6 opacity-60" />
          {running
            ? 'Listening…'
            : connected
              ? 'Start to transcribe the caller as they speak. Nothing is saved.'
              : 'Transcription is available once the call is connected.'}
        </div>
      ) : (
        <div
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK;
          }}
          className="flex max-h-96 flex-col gap-2 overflow-y-auto px-4 py-3"
          aria-live="polite"
        >
          <p className="text-[11px] text-secondary-400 dark:text-secondary-500">{caller || 'Caller'}</p>
          {segments.map((seg) => (
            <Line key={seg.id} seg={seg} />
          ))}
          {status === 'ended' && (
            <p className="pt-1 text-center text-xs text-secondary-400 dark:text-secondary-500">Transcription stopped</p>
          )}
        </div>
      )}
    </>
  );

  return (
    <Card title="Voice transcription" actions={actions}>
      {body}
    </Card>
  );
}

function Line({ seg }: { seg: TranscriptSegment }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-9 shrink-0 text-right text-[11px] text-secondary-400 tabular-nums dark:text-secondary-500">
        {formatOffset(seg.start)}
      </span>
      <p
        className={`rounded-lg bg-secondary-100 px-3 py-1.5 text-sm text-secondary-900 dark:bg-secondary-800 dark:text-secondary-100 ${
          seg.partial ? 'italic opacity-70' : ''
        }`}
      >
        {seg.text}
      </p>
    </div>
  );
}
