// Office screenshare. At any desk in Office Space you can share your screen
// or watch whoever is sharing; one person shares at a time. Everything goes
// through the backend /video relay (backend video.go): the sharer encodes
// the screen as VP8 with WebCodecs and sends each frame as
// [u8 flags (1 = key)][u16 width][u16 height][VP8 chunk]; watchers decode
// and draw it. The connection is open only while it's needed: while the
// desk modal is open (ensureVideo/releaseVideo) or while you're sharing.
// Walking away from the desk (or leaving the office/map) ends your share.
import { atom } from 'nanostores';

import { apiKey } from './auth';
import { API } from './const';

export type ScreenStatus = 'off' | 'connecting' | 'live' | 'elsewhere' | 'unsupported' | 'error';

export const $screenStatus = atom<ScreenStatus>('off');
/** Who is sharing right now, or null. Only known while connected. */
export const $screenSharer = atom<string | null>(null);
/** The local display stream while I'm sharing. */
export const $myShare = atom<MediaStream | null>(null);
/** Whether I'm standing next to a desk in Office Space (set by the map canvas). */
export const $atDesk = atom(false);
/** Why the last share attempt failed, e.g. someone else is sharing. */
export const $shareError = atom('');

const FPS = 10;
const MAX_W = 1280;
const BITRATE = 1_500_000;
const KEY_EVERY_MS = 3000;
const MAX_BUFFERED = 2 * 1024 * 1024;
const HEADER = 5;
const FLAG_KEY = 1;
const MIN_RETRY_S = 2;
const MAX_RETRY_S = 30;
// Close codes from backend video.go / websocket.go.
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_FORBIDDEN = 4403;
const CLOSE_REPLACED = 4409;
/** How long you can be off the desk before your share stops (edge jitter). */
const AWAY_GRACE_MS = 1000;

export function screenshareSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoDecoder !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function'
  );
}

type FrameSink = (frame: VideoFrame) => void;

let me = '';
let users = 0;
let ws: WebSocket | null = null;
let stopped = true;
let watching = false;
let sink: FrameSink | null = null;
let decoder: VideoDecoder | null = null;
let decSize = '';
let decTs = 0;
let share: Sharer | null = null;
let awayTimer: ReturnType<typeof setTimeout> | null = null;

$atDesk.listen((atDesk) => {
  if (awayTimer) clearTimeout(awayTimer);
  awayTimer = null;
  if (atDesk || !share) return;
  awayTimer = setTimeout(() => {
    awayTimer = null;
    if (!$atDesk.get()) stopShare();
  }, AWAY_GRACE_MS);
});

/** Open the relay for me (a ref count; pair with releaseVideo). */
export function ensureVideo(username: string): void {
  if (!screenshareSupported()) {
    $screenStatus.set('unsupported');
    return;
  }
  users++;
  if (!stopped && me === username) return;
  if (!stopped) closeVideo();
  me = username;
  stopped = false;
  void connectLoop();
}

/** Done with the relay; it closes once nobody (nor a share) needs it. */
export function releaseVideo(): void {
  users = Math.max(0, users - 1);
  if (users === 0 && !share) closeVideo();
}

function closeVideo(): void {
  stopped = true;
  watching = false;
  ws?.close(1000, 'done');
  ws = null;
  resetDecoder();
  $screenSharer.set(null);
  $screenStatus.set('off');
}

function send(msg: unknown): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** Get (or stop getting) the shared picture; frames go to onFrame, which must close them. */
export function watchScreen(onFrame: FrameSink | null): void {
  sink = onFrame;
  watching = onFrame !== null;
  if (!watching) resetDecoder();
  send({ type: 'watch', on: watching });
}

async function connectLoop(): Promise<void> {
  let retry = MIN_RETRY_S;
  while (!stopped) {
    $screenStatus.set('connecting');
    const code = await connectOnce(() => (retry = MIN_RETRY_S));
    if (stopped) return;
    $screenSharer.set(null);
    resetDecoder();
    if (code === CLOSE_REPLACED) {
      endShare();
      $screenStatus.set('elsewhere');
      stopped = true;
      return;
    }
    if (code === CLOSE_FORBIDDEN) {
      endShare();
      $screenStatus.set('error');
      stopped = true;
      return;
    }
    await new Promise((r) => setTimeout(r, retry * 1000));
    retry = Math.min(retry * 1.5, MAX_RETRY_S);
  }
}

function videoUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${API}/video`;
}

async function connectOnce(onHello: () => void): Promise<number> {
  let token: string;
  try {
    token = await apiKey();
  } catch {
    return CLOSE_UNAUTHORIZED;
  }
  if (stopped) return 1000;
  return new Promise<number>((resolve) => {
    const sock = new WebSocket(videoUrl());
    sock.binaryType = 'arraybuffer';
    ws = sock;
    sock.addEventListener('open', () => sock.send(JSON.stringify({ type: 'auth', token })));
    sock.addEventListener('message', (ev) => {
      if (ws !== sock) return;
      if (ev.data instanceof ArrayBuffer) {
        onFrame(ev.data);
        return;
      }
      let msg: { type: string; data: any };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'hello':
          onHello();
          $screenStatus.set('live');
          $screenSharer.set(msg.data?.sharer ?? null);
          if (watching) send({ type: 'watch', on: true });
          // Reconnected mid-share: claim the slot again.
          if (share) send({ type: 'start' });
          break;
        case 'state': {
          const sharer: string | null = msg.data?.sharer ?? null;
          $screenSharer.set(sharer);
          if (sharer === null || sharer === me) resetDecoder();
          break;
        }
        case 'busy':
          if (share) {
            $shareError.set(`${msg.data?.sharer ?? 'Someone'} is already sharing`);
            endShare();
          }
          break;
        case 'keyframe':
          if (share) share.forceKey = true;
          break;
      }
    });
    sock.addEventListener('close', (ev) => {
      if (ws === sock) ws = null;
      resolve(ev.code);
    });
  });
}

// ---- Watching ----

function resetDecoder(): void {
  if (decoder && decoder.state !== 'closed') decoder.close();
  decoder = null;
  decSize = '';
}

function onFrame(buf: ArrayBuffer): void {
  if (!watching || buf.byteLength <= HEADER) return;
  const view = new DataView(buf);
  const key = (view.getUint8(0) & FLAG_KEY) !== 0;
  const w = view.getUint16(1);
  const h = view.getUint16(3);
  const size = `${w}x${h}`;
  if (!decoder || decoder.state === 'closed' || (key && size !== decSize)) {
    if (!key) return; // wait for a keyframe
    resetDecoder();
    decoder = new VideoDecoder({
      output: (frame) => {
        if (sink) sink(frame);
        else frame.close();
      },
      error: (e) => {
        console.warn('screenshare decode', e);
        resetDecoder();
        // Ask again so the picture comes back.
        send({ type: 'watch', on: watching });
      },
    });
    decoder.configure({ codec: 'vp8', codedWidth: w, codedHeight: h, optimizeForLatency: true });
    decSize = size;
  }
  // Fall behind? Drop deltas until things settle; the next key resyncs.
  if (decoder.decodeQueueSize > 4 && !key) return;
  decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: decTs, data: new Uint8Array(buf, HEADER) }));
  decTs += 1_000_000 / FPS;
}

// ---- Sharing ----

type Sharer = {
  stream: MediaStream;
  encoder: VideoEncoder;
  timer: ReturnType<typeof setInterval>;
  video: HTMLVideoElement;
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  forceKey: boolean;
  lastKey: number;
  ts: number;
  w: number;
  h: number;
};

/** Pick my screen and share it to every desk. Needs ensureVideo first. */
export async function startShare(): Promise<void> {
  if (share || !screenshareSupported()) return;
  $shareError.set('');
  if ($screenSharer.get() && $screenSharer.get() !== me) {
    $shareError.set(`${$screenSharer.get()} is already sharing`);
    return;
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: FPS }, audio: false });
  } catch (e) {
    if (!(e instanceof DOMException && e.name === 'NotAllowedError')) $shareError.set("Couldn't capture the screen");
    return;
  }
  if (share) {
    stream.getTracks().forEach((t) => t.stop());
    return;
  }
  const track = stream.getVideoTracks()[0];
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    /* plays once frames arrive */
  }

  const encoder = new VideoEncoder({
    output: (chunk) => sendChunk(chunk),
    error: (e) => {
      console.error('screenshare encode', e);
      $shareError.set('Screen encoding failed');
      stopShare();
    },
  });
  const canvas = new OffscreenCanvas(2, 2);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    stream.getTracks().forEach((t) => t.stop());
    encoder.close();
    $shareError.set("Couldn't capture the screen");
    return;
  }
  const s: Sharer = { stream, encoder, timer: 0 as never, video, canvas, ctx, forceKey: true, lastKey: 0, ts: 0, w: 0, h: 0 };
  share = s;
  users++; // a share keeps the relay open
  $myShare.set(stream);
  track.addEventListener('ended', stopShare);
  send({ type: 'start' });
  s.timer = setInterval(() => captureFrame(s), 1000 / FPS);
}

function captureFrame(s: Sharer): void {
  if (share !== s || s.video.videoWidth === 0) return;
  // The other side may have resized the window: keep even sizes, at most MAX_W wide.
  const scale = Math.min(1, MAX_W / s.video.videoWidth);
  const w = Math.max(2, Math.round((s.video.videoWidth * scale) / 2) * 2);
  const h = Math.max(2, Math.round((s.video.videoHeight * scale) / 2) * 2);
  if (w !== s.w || h !== s.h) {
    if (s.encoder.state === 'configured') s.encoder.reset();
    s.encoder.configure({ codec: 'vp8', width: w, height: h, bitrate: BITRATE, framerate: FPS, latencyMode: 'realtime' });
    s.w = w;
    s.h = h;
    s.forceKey = true;
  }
  if ($screenSharer.get() !== me) return; // not ours (yet)
  if (!ws || ws.bufferedAmount > MAX_BUFFERED || s.encoder.encodeQueueSize > 2) return;
  const now = performance.now();
  const key = s.forceKey || now - s.lastKey > KEY_EVERY_MS;
  // Draw at the encoded size so big screens are scaled down.
  if (s.canvas.width !== w || s.canvas.height !== h) {
    s.canvas.width = w;
    s.canvas.height = h;
  }
  s.ctx.drawImage(s.video, 0, 0, w, h);
  const frame = new VideoFrame(s.canvas, { timestamp: s.ts });
  s.ts += 1_000_000 / FPS;
  try {
    s.encoder.encode(frame, { keyFrame: key });
  } finally {
    frame.close();
  }
  if (key) {
    s.forceKey = false;
    s.lastKey = now;
  }
}

function sendChunk(chunk: EncodedVideoChunk): void {
  const s = share;
  if (!s || ws?.readyState !== WebSocket.OPEN) return;
  const out = new Uint8Array(HEADER + chunk.byteLength);
  const view = new DataView(out.buffer);
  view.setUint8(0, chunk.type === 'key' ? FLAG_KEY : 0);
  view.setUint16(1, s.w);
  view.setUint16(3, s.h);
  chunk.copyTo(out.subarray(HEADER));
  ws.send(out);
}

/** Stop sharing my screen. */
export function stopShare(): void {
  if (!share) return;
  send({ type: 'stop' });
  endShare();
}

function endShare(): void {
  const s = share;
  if (!s) return;
  share = null;
  clearInterval(s.timer);
  s.stream.getTracks().forEach((t) => t.stop());
  s.video.srcObject = null;
  if (s.encoder.state !== 'closed') s.encoder.close();
  $myShare.set(null);
  releaseVideo();
}
