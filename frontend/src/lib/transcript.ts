import { atom } from 'nanostores';

import { onEvent, request } from './realtime';
import { $can, $contactSnapshot, $wsStatus } from './stores';
import { $autoTranscribe } from './theme';

// Live transcription of the caller's side of the call. The backend reads the
// call's Kinesis Video Stream, runs the caller's audio through Amazon
// Transcribe and pushes text to this connection only.
// The transcript lives in memory for the current call and is never saved.

export type TranscriptSegment = {
  id: string;
  text: string;
  partial: boolean;
  start: number; // seconds since transcription started
};

type SegmentEvent = TranscriptSegment & { contactId: string };

type EndedEvent = {
  contactId: string;
  reason: 'stopped' | 'ended' | 'contactChanged' | 'error';
  error?: string;
};

export type TranscriptState = {
  contactId: string | null;
  status: 'idle' | 'starting' | 'live' | 'ended' | 'error';
  error?: string;
  segments: TranscriptSegment[];
};

const IDLE: TranscriptState = { contactId: null, status: 'idle', segments: [] };

export const $transcript = atom<TranscriptState>(IDLE);

/** Start transcribing the given contact, replacing any current transcript. */
export async function startTranscript(contactId: string): Promise<void> {
  const current = $transcript.get();
  const keep = current.contactId === contactId ? current.segments : [];
  $transcript.set({ contactId, status: 'starting', segments: keep });
  try {
    await request('transcribe.start', { contactId });
    if ($transcript.get().contactId === contactId && $transcript.get().status === 'starting') {
      $transcript.set({ ...$transcript.get(), status: 'live' });
    }
  } catch (err) {
    if ($transcript.get().contactId !== contactId) return;
    $transcript.set({
      ...$transcript.get(),
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function stopTranscript(): Promise<void> {
  const { status } = $transcript.get();
  if (status !== 'live' && status !== 'starting') return;
  try {
    await request('transcribe.stop');
  } catch {
    // The socket dropped; the server already stopped it.
  }
}

onEvent<SegmentEvent>('transcript.segment', ({ contactId, ...seg }) => {
  const state = $transcript.get();
  if (state.contactId !== contactId) return;
  // Partial results are replaced by later ones with the same id.
  const i = state.segments.findIndex((s) => s.id === seg.id);
  const segments = i === -1 ? [...state.segments, seg] : state.segments.map((s, j) => (j === i ? seg : s));
  $transcript.set({ ...state, status: state.status === 'starting' ? 'live' : state.status, segments });
});

onEvent<EndedEvent>('transcript.ended', ({ contactId, reason, error }) => {
  const state = $transcript.get();
  if (state.contactId !== contactId) return;
  // Drop dangling partials; finals for them won't come.
  const segments = state.segments.filter((s) => !s.partial);
  if (reason === 'error') {
    $transcript.set({ ...state, segments, status: 'error', error: error ?? 'Transcription failed' });
  } else {
    $transcript.set({ ...state, segments, status: 'ended' });
  }
});

// A new call, or no call, clears the transcript. Hanging up (after call
// work) stops it but keeps the text until the contact is cleared.
$contactSnapshot.subscribe((contact) => {
  const state = $transcript.get();
  if (!state.contactId) return;
  const running = state.status === 'live' || state.status === 'starting';
  if (state.contactId !== contact?.contactId) {
    if (running) void stopTranscript();
    $transcript.set(IDLE);
  } else if (running && contact.status !== connect.ContactStateType.CONNECTED) {
    void stopTranscript();
  }
});

// The server stops transcription when the socket closes.
$wsStatus.subscribe((status) => {
  const state = $transcript.get();
  if (status !== 'open' && (state.status === 'live' || state.status === 'starting')) {
    $transcript.set({ ...state, status: 'ended', segments: state.segments.filter((s) => !s.partial) });
  }
});

// With the Auto start transcription setting on, transcribe each call once it
// connects. Only once per contact: after Stop it stays stopped.
let autoStartedFor: string | null = null;

function maybeAutoStart(): void {
  const contact = $contactSnapshot.get();
  if (!contact || contact.status !== connect.ContactStateType.CONNECTED) return;
  if (autoStartedFor === contact.contactId) return;
  if (!$autoTranscribe.get() || !$can('transcription').get() || $wsStatus.get() !== 'open') return;
  const state = $transcript.get();
  if (state.contactId === contact.contactId && (state.status === 'live' || state.status === 'starting')) return;
  autoStartedFor = contact.contactId;
  void startTranscript(contact.contactId);
}

$contactSnapshot.subscribe(maybeAutoStart);
$wsStatus.subscribe(maybeAutoStart);
$can('transcription').subscribe(maybeAutoStart);
