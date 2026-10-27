import { $notifyTimes } from './stores';

type NotificationEvent = {
  name: keyof NotificationEventMap;
  handler: (e: Event) => void;
};

let nextId = 1;

function compatible(): boolean {
  if (typeof Notification === 'undefined') {
    console.log('Notifications are not available for your browser.');
    return false;
  }
  return true;
}

export function authorize(): void {
  if (compatible()) {
    Notification.requestPermission().then((permission) => {
      console.log(`Permission to display: ${permission}`);
    });
  }
}

/** Seconds since tag was last shown (Infinity if never). */
function secondsSince(tag: string): number {
  const last = Number($notifyTimes.get()[tag]);
  return Number.isFinite(last) ? (Date.now() - last) / 1000 : Infinity;
}

/** Suppress a tag until `until` (ms epoch) by recording it as shown then. */
export function snooze(tag: string, until: number): void {
  $notifyTimes.setKey(tag, String(until));
}

/**
 * Show a desktop notification. When interval > 0, a notification with the
 * same tag is shown at most once per interval seconds (persisted across reloads).
 */
export function notify(
  message: string,
  title = 'Notification',
  tag: string = String(nextId),
  interval = 0,
  events: NotificationEvent[] = [],
): Notification | undefined {
  nextId++;
  if (!compatible()) return;

  if (interval > 0) {
    if (secondsSince(tag) <= interval) return;
    $notifyTimes.setKey(tag, String(Date.now()));
  }

  const n = new Notification(title, { body: message, tag, lang: 'en-US', dir: 'auto' });
  for (const event of events) {
    n.addEventListener(event.name, event.handler);
  }
  return n;
}
