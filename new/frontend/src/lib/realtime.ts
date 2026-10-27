import { apiKey } from './auth';
import { API } from './const';
import { sleep } from './helpers';
import { $alert, $metrics, $wsStatus, type Metrics } from './stores';

const FAIL_MESSAGE = 'Realtime metrics paused; restoring...';
const MIN_RETRY_SECONDS = 2;
const MAX_RETRY_SECONDS = 30;

function socketUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${API}/ws`;
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
    });

    ws.addEventListener('message', (ev) => {
      if ($wsStatus.get() !== 'open') {
        $wsStatus.set('open');
        onOpen();
      }

      let data: Metrics;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      for (const [key, value] of Object.entries(data)) {
        $metrics.setKey(key as keyof Metrics, value);
      }
    });

    ws.addEventListener('close', () => {
      $wsStatus.set('closed');
      resolve();
    });
  });
}

let started = false;

/** Subscribe to realtime metrics, reconnecting forever with backoff. */
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
