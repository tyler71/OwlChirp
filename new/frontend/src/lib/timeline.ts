import { request } from './realtime';
import { $timeline, type FlowCallBucket, type FlowTimeline } from './stores';

// The server rebuilds the timeline at most every 30 minutes, so this is a
// snapshot; live flowcall.updated events are not merged in.
export async function loadTimeline(): Promise<void> {
  $timeline.set(await request<FlowTimeline>('flowcalls.timeline'));
}

// Grouping intervals in minutes; the server sends 15-minute buckets and
// coarser ones are merged client-side.
export const TIMELINE_INTERVALS = [15, 30, 60, 240, 480, 720, 1440] as const;

export function intervalLabel(minutes: number): string {
  return minutes < 60 ? `${minutes}m` : `${minutes / 60}h`;
}

export function intervalPhrase(minutes: number): string {
  return minutes < 60 ? `${minutes}-minute` : `${minutes / 60}-hour`;
}

// Merges buckets into groups of `minutes`, aligned to local midnight so e.g.
// 4h groups start at 00:00, 04:00, … and 24h groups are calendar days.
export function groupBuckets(buckets: FlowCallBucket[], minutes: number, bucketMinutes: number): FlowCallBucket[] {
  if (minutes <= bucketMinutes) return buckets;
  const width = minutes * 60_000;
  const groups = new Map<number, FlowCallBucket>();
  for (const b of buckets) {
    const midnight = new Date(b.start).setHours(0, 0, 0, 0);
    const start = midnight + Math.floor((b.start - midnight) / width) * width;
    const g = groups.get(start);
    if (g) {
      g.total += b.total;
      g.answered += b.answered;
      g.abandoned += b.abandoned;
      g.calls.push(...b.calls);
    } else {
      groups.set(start, { ...b, start, calls: [...b.calls] });
    }
  }
  const sorted = [...groups.values()].sort((a, b) => a.start - b.start);
  // Keep the server's ordering direction.
  return buckets.length > 1 && buckets[0].start > buckets[buckets.length - 1].start ? sorted.reverse() : sorted;
}
