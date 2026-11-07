// System log: a per-call diagnostic timeline of app events, console warnings
// and errors, and the Amazon Connect Streams log, stored on the server so a
// failed call can be looked at after a reload.
import 'amazon-connect-streams';

import { atom, map } from 'nanostores';

import { request } from './realtime';
import { $view, $wsStatus } from './stores';

export type LogSource = 'app' | 'console' | 'connect';
export type LogLevel = 'info' | 'warn' | 'error';
export type LogEntry = { time: number; source: LogSource; level: LogLevel; message: string; detail?: string };
export type CallOutcome = '' | 'failed' | 'missed';

export type CallLog = {
  contactId: string;
  phoneNumber: string;
  inbound: boolean;
  outcome: CallOutcome;
  startedAt: number;
  endedAt: number;
  entryCount: number;
  errorCount: number;
  entries?: LogEntry[];
};

const SESSION_LOG_SIZE = 500;
const MAX_TEXT_LENGTH = 2000;
const MAX_CALL_LOGS = 100;
// Late CCP entries (e.g. the softphone tearing down) arrive after the contact
// is destroyed; wait for them before reading the Streams log.
const SETTLE_MS = 2000;
const CONNECT_LEAD_MS = 5000;
// The socket accepts 64KB per message; leave room for the envelope.
const MAX_CHUNK_BYTES = 40_000;
const MAX_CHUNK_ENTRIES = 500;

/** Everything logged this session, calls or not (newest last). */
export const $sessionLog = atom<LogEntry[]>([]);
/** Call log summaries, newest first. */
export const $callLogs = atom<CallLog[]>([]);
/** Full logs for calls made this session, which may not be uploaded yet. */
export const $localLogs = map<Record<string, CallLog>>({});
/** Call the System Log view should open and scroll to. */
export const $logFocus = atom<string | null>(null);

type ActiveCall = { log: CallLog; status: string };
const active = new Map<string, ActiveCall>();

// ---- Capture ----

function truncate(s: string): string {
  return s.length > MAX_TEXT_LENGTH ? `${s.slice(0, MAX_TEXT_LENGTH)}…` : s;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  const seen = new WeakSet<object>();
  try {
    return (
      JSON.stringify(value, (_k, v: unknown) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[Circular]';
          seen.add(v);
        }
        return v;
      }) ?? String(value)
    );
  } catch {
    return String(value);
  }
}

function record(entry: LogEntry, toCalls = true): void {
  const session = $sessionLog.get();
  $sessionLog.set([...session.slice(-(SESSION_LOG_SIZE - 1)), entry]);
  if (toCalls) for (const call of active.values()) call.log.entries!.push(entry);
}

/** Add an app-level entry to the session log and any call in progress. */
export function logEvent(level: LogLevel, message: string, detail?: unknown): void {
  record({
    time: Date.now(),
    source: 'app',
    level,
    message: truncate(message),
    detail: detail === undefined ? undefined : truncate(stringify(detail)),
  });
}

// Streams echoes its own WARN+ entries to the console as "[2026-…] [LEVEL] …";
// calls get those from the Streams log itself.
const STREAMS_ECHO = /^\[\d{4}-\d{2}-\d{2}T/;

function captureConsole(level: LogLevel, args: unknown[]): void {
  const [first, ...rest] = args;
  const message = truncate(stringify(first));
  record(
    {
      time: Date.now(),
      source: 'console',
      level,
      message,
      detail: rest.length ? truncate(rest.map(stringify).join('\n')) : undefined,
    },
    !STREAMS_ECHO.test(message),
  );
}

let consoleInstalled = false;

/** Copy console warnings/errors and uncaught errors into the log. */
export function installConsoleCapture(): void {
  if (consoleInstalled) return;
  consoleInstalled = true;

  const { warn, error } = console;
  console.warn = (...args: unknown[]) => {
    warn.apply(console, args);
    captureConsole('warn', args);
  };
  console.error = (...args: unknown[]) => {
    error.apply(console, args);
    captureConsole('error', args);
  };
  window.addEventListener('error', (e) => captureConsole('error', [e.message, e.error ?? `${e.filename}:${e.lineno}`]));
  window.addEventListener('unhandledrejection', (e) => captureConsole('error', ['Unhandled rejection', e.reason]));
}

// ---- Amazon Connect Streams log ----

type StreamsEntry = {
  time: Date | string;
  level: string;
  component?: string;
  text: string;
  objects?: unknown[];
  exception?: unknown;
};

const STREAMS_LEVELS: Record<string, LogLevel> = {
  INFO: 'info',
  LOG: 'info',
  WARN: 'warn',
  ERROR: 'error',
  CRITICAL: 'error',
};

// Reads the same buffers Logger.download() saves. They're private, so treat
// anything unexpected as "no entries" rather than failing the call log.
function streamsEntries(from: number, to: number): LogEntry[] {
  const logger = connect.getLog() as unknown as { _rolledLogs?: unknown; _logs?: unknown };
  const all = [logger._rolledLogs, logger._logs].flatMap((l) => (Array.isArray(l) ? (l as StreamsEntry[]) : []));

  const entries: LogEntry[] = [];
  for (const e of all) {
    const level = STREAMS_LEVELS[e.level];
    const time = new Date(e.time).getTime();
    if (!level || !(time >= from && time <= to)) continue;
    const extra = [...(e.objects ?? []), ...(e.exception ? [e.exception] : [])];
    entries.push({
      time,
      source: 'connect',
      level,
      message: truncate(e.component ? `[${e.component}] ${e.text}` : e.text),
      detail: extra.length ? truncate(stringify(extra.length === 1 ? extra[0] : extra)) : undefined,
    });
  }
  return entries;
}

// ---- Per-call logs ----

function summary(log: CallLog): CallLog {
  const entries = log.entries ?? [];
  return {
    ...log,
    entries: undefined,
    entryCount: entries.length,
    errorCount: entries.filter((e) => e.level === 'error').length,
  };
}

function upsertSummary(log: CallLog): void {
  const others = $callLogs.get().filter((l) => l.contactId !== log.contactId);
  $callLogs.set([summary(log), ...others].sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_CALL_LOGS));
}

export function beginCall(contactId: string, phoneNumber: string, inbound: boolean): void {
  if (active.has(contactId)) return;
  const log: CallLog = {
    contactId,
    phoneNumber,
    inbound,
    outcome: '',
    startedAt: Date.now(),
    endedAt: 0,
    entryCount: 0,
    errorCount: 0,
    entries: [],
  };
  active.set(contactId, { log, status: '' });
  logEvent('info', `${inbound ? 'Inbound' : 'Outbound'} call started`, { contactId, phoneNumber });
}

/** Log a contact status change (once per distinct status). */
export function callStatus(contactId: string, status: string): void {
  const call = active.get(contactId);
  if (!call || call.status === status) return;
  call.status = status;
  logEvent(status === connect.ContactStateType.ERROR ? 'error' : 'info', `Contact ${status}`, { contactId });
}

function outcomeOf(status: string): CallOutcome {
  if (status === connect.ContactStateType.ERROR) return 'failed';
  if (status === connect.ContactStateType.MISSED || status === connect.ContactStateType.REJECTED) return 'missed';
  return '';
}

/** Finish a call's log: merge in the Streams log and upload it. */
export function endCall(contactId: string): void {
  const call = active.get(contactId);
  if (!call) return;
  logEvent('info', 'Contact destroyed', { contactId });
  active.delete(contactId);

  const log = call.log;
  log.outcome = outcomeOf(call.status);
  log.endedAt = Date.now();
  // Show it straight away; the Connect entries follow once they settle.
  $localLogs.setKey(contactId, { ...log, entries: [...log.entries!] });
  upsertSummary(log);

  setTimeout(() => {
    const merged = [...log.entries!, ...streamsEntries(log.startedAt - CONNECT_LEAD_MS, Date.now())].sort(
      (a, b) => a.time - b.time,
    );
    const done = { ...log, entries: merged };
    $localLogs.setKey(contactId, done);
    upsertSummary(done);
    unsent.set(contactId, done);
    void flush();
  }, SETTLE_MS);
}

// ---- Upload ----

const unsent = new Map<string, CallLog>();
let flushing = false;

function chunks(entries: LogEntry[]): LogEntry[][] {
  const out: LogEntry[][] = [];
  let chunk: LogEntry[] = [];
  let bytes = 0;
  for (const e of entries) {
    const size = JSON.stringify(e).length;
    if (chunk.length && (chunk.length >= MAX_CHUNK_ENTRIES || bytes + size > MAX_CHUNK_BYTES)) {
      out.push(chunk);
      chunk = [];
      bytes = 0;
    }
    chunk.push(e);
    bytes += size;
  }
  out.push(chunk);
  return out;
}

// Uploads finished call logs. A log that fails stays queued (resuming after
// the chunks already sent) and is retried when the socket next opens.
async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (const [contactId, log] of unsent) {
      const { entries = [], ...meta } = log;
      for (const chunk of chunks(entries)) {
        await request('syslog.append', { ...meta, entries: chunk });
        const sent = new Set(chunk);
        unsent.set(contactId, { ...log, entries: (unsent.get(contactId)?.entries ?? []).filter((e) => !sent.has(e)) });
      }
      unsent.delete(contactId);
    }
  } catch (e) {
    // Plain console.warn: this is captured too, but no call is active by now.
    console.warn('system log upload', e);
  } finally {
    flushing = false;
  }
}

$wsStatus.listen((status) => {
  if (status === 'open' && unsent.size) void flush();
});

// ---- Reading ----

export async function loadCallLogs(): Promise<void> {
  const server = (await request<CallLog[]>('syslog.list', { maxRecords: MAX_CALL_LOGS })) ?? [];
  // Keep this session's calls whose upload hasn't landed yet.
  const local = Object.values($localLogs.get())
    .filter((l) => !server.some((s) => s.contactId === l.contactId))
    .map(summary);
  $callLogs.set([...local, ...server].sort((a, b) => b.startedAt - a.startedAt));
}

/** Full log for a call: this session's copy if there is one, else the server's. */
export async function loadCallLog(contactId: string): Promise<CallLog> {
  return $localLogs.get()[contactId] ?? request<CallLog>('syslog.get', { contactId });
}

export function openCallLog(contactId: string): void {
  $logFocus.set(contactId);
  $view.set('log');
}
