import { apiKey } from './auth';
import { API } from './const';
import { sleep } from './helpers';
import { $alert, $metrics, $wsStatus, type Metrics } from './stores';

const FAIL_MESSAGE = 'Realtime connection lost; restoring...';
const MIN_RETRY_SECONDS = 2;
const MAX_RETRY_SECONDS = 30;
const REQUEST_TIMEOUT_MS = 15000;

// Server → client messages: replies to request() carry the request's id,
// everything else is an event {"type": "...", "data": ...}.
type ServerMessage = {
  id?: number;
  type: string;
  data?: unknown;
  error?: string;
};

type Pending = {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let socket: WebSocket | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();
const eventHandlers = new Map<string, Set<(data: any) => void>>();

/** Run handler for every server event of the given type. Returns an unsubscribe function. */
export function onEvent<T>(type: string, handler: (data: T) => void): () => void {
  let handlers = eventHandlers.get(type);
  if (!handlers) eventHandlers.set(type, (handlers = new Set()));
  handlers.add(handler);
  return () => handlers.delete(handler);
}

onEvent<Metrics>('metrics', (data) => {
  for (const [key, value] of Object.entries(data)) {
    $metrics.setKey(key as keyof Metrics, value);
  }
});

function waitForOpen(): Promise<WebSocket> {
  if (socket && $wsStatus.get() === 'open') return Promise.resolve(socket);
  return new Promise((resolve) => {
    const unsubscribe = $wsStatus.listen((status) => {
      if (status === 'open' && socket) {
        unsubscribe();
        resolve(socket);
      }
    });
  });
}

/**
 * Call a backend handler over the socket. Waits for the socket to be open,
 * and rejects on a server error, a timeout, or the connection dropping.
 */
export async function request<T>(type: string, data: unknown = {}): Promise<T> {
  const ws = await waitForOpen();
  const id = ++nextId;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${type}: timed out`));
    }, REQUEST_TIMEOUT_MS);

    pending.set(id, { resolve: resolve as (data: unknown) => void, reject, timer });
    ws.send(JSON.stringify({ id, type, data }));
  });
}

function handleMessage(msg: ServerMessage): void {
  if (msg.id !== undefined && (msg.type === 'result' || msg.type === 'error')) {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.type === 'result') p.resolve(msg.data ?? null);
    else p.reject(new Error(msg.error ?? 'request failed'));
    return;
  }

  for (const handler of eventHandlers.get(msg.type) ?? []) {
    try {
      handler(msg.data);
    } catch (e) {
      console.error(`realtime ${msg.type}`, e);
    }
  }
}

function failPending(): void {
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error('connection closed'));
    pending.delete(id);
  }
}

/** Open one socket and resolve when it closes. */
async function connectOnce(onOpen: () => void): Promise<void> {
  // The token rotates hourly, so generate it fresh for every connection.
  const token = await apiKey();

  await new Promise<void>((resolve) => {
    const ws = new WebSocket(socketUrl());
    $wsStatus.set('connecting');

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
      // The server closes the socket on a bad token, so once the auth
      // message is accepted for sending the connection is usable; requests
      // sent before a 4401 close are rejected by failPending.
      socket = ws;
      $wsStatus.set('open');
      onOpen();
    });

    ws.addEventListener('message', (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      handleMessage(msg);
    });

    ws.addEventListener('close', () => {
      socket = null;
      $wsStatus.set('closed');
      failPending();
      resolve();
    });
  });
}

function socketUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${API}/ws`;
}

let started = false;

/** Keep the realtime socket connected, reconnecting forever with backoff. */
export async function startRealtime(): Promise<void> {
  if (started) return;
  started = true;

  let retrySeconds = MIN_RETRY_SECONDS;

  for (;;) {
    try {
      await connectOnce(() => {
        retrySeconds = MIN_RETRY_SECONDS;
        if ($alert.get().message === FAIL_MESSAGE) {
          $alert.set({ kind: 'none' });
        }
      });
    } catch (e) {
      console.error('realtime', e);
    }

    $alert.set({ kind: 'warning', message: FAIL_MESSAGE });
    await sleep(retrySeconds * 1000);
    retrySeconds = Math.min(retrySeconds * 1.2, MAX_RETRY_SECONDS);
  }
}
