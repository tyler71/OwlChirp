// Map proximity voice. Once the Map has been opened, the mic streams (Opus,
// only while talking) to the backend relay, which forwards it to people
// nearby; it keeps running while other sections are shown.
// Each listener sets every speaker's volume from the live distance: 100
// side by side, fading on a log curve to silence at VOICE_RANGE. While on a
// phone call nothing is sent and everyone else is silenced.
// Mute self stops sending; Mute all silences everyone else. With the
// Proximity chat setting off, both start on each time voice starts.
// The mic either opens on its own above a level threshold (set in Settings,
// applied live), or only while
// Space (or the toolbar's hold button) is held: push to talk. Each session
// starts in the mode chosen in Settings; the toolbar can switch it.
import { persistentAtom } from '@nanostores/persistent';
import { atom, computed } from 'nanostores';

import { apiKey } from './auth';
import { API } from './const';
import { $mapPlayers } from './map';
import { $contactSnapshot } from './stores';
import { $proximityChat, $voiceModeDefault, $voiceThreshold, type VoiceMode } from './theme';

/** How far a voice carries, in world px (5 tiles). Mirrors voiceRange in backend voice.go. */
export const VOICE_RANGE = 5 * 16;

/** Volume (0-100) of a speaker distancePx away: log falloff to 0 at VOICE_RANGE. */
export function volumeAt(distancePx: number): number {
  if (!(distancePx >= 0) || distancePx >= VOICE_RANGE) return 0;
  return 100 * Math.max(0, 1 - Math.log10(1 + (9 * distancePx) / VOICE_RANGE));
}

export type VoiceStatus = 'off' | 'connecting' | 'live' | 'listenOnly' | 'elsewhere' | 'unsupported' | 'error';

export const $voiceStatus = atom<VoiceStatus>('off');
export const $voiceMuted = persistentAtom<boolean>('owlchirp:voice:muted', false, {
  encode: (v) => (v ? '1' : ''),
  decode: (v) => v === '1',
});
/** Mute all: hear nobody on the map. */
export const $voiceDeafened = persistentAtom<boolean>('owlchirp:voice:deafened', false, {
  encode: (v) => (v ? '1' : ''),
  decode: (v) => v === '1',
});
/** How the mic opens this session: level threshold or push to talk. */
export const $voiceMode = atom<VoiceMode>('threshold');
/** True while push to talk is held (Space or the toolbar button). */
export const $voicePttHeld = atom(false);

/** Hold or release push to talk. */
export function setPttHeld(on: boolean): void {
  if ($voicePttHeld.get() !== on) $voicePttHeld.set(on);
}

/** Whether a key press is going into a text field rather than the page. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/** Recent mic level in dBFS while voice is capturing, or null (for the Settings meter). */
export const $voiceLevel = atom<number | null>(null);

/** True while this user's mic is open (by level or push to talk) and being sent. */
export const $voiceTalking = atom(false);

// Contact states that count as being on a call (hold keeps the contact connected).
const ON_CALL_STATES = new Set(['init', 'incoming', 'pending', 'connecting', 'connected']);
export const $voiceOnCall = computed($contactSnapshot, (c) => !!c && ON_CALL_STATES.has(c.status));

const SAMPLE_RATE = 48000;
const FRAME = 960; // 20ms
const FRAME_US = 20_000;
const LEVEL_EVERY_MS = 100;
const HANGOVER_MS = 300;
const PREROLL_FRAMES = 2;
const JITTER_S = 0.06;
const MAX_LAG_S = 0.3;
const SPEAKING_MS = 300;
const GAIN_EVERY_MS = 100;
const MAX_BUFFERED = 16 * 1024;
const MIN_RETRY_S = 2;
const MAX_RETRY_S = 30;

// Close codes from backend voice.go / websocket.go.
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_FORBIDDEN = 4403;
const CLOSE_REPLACED = 4409;

const WORKLET = `
class OwlchirpVoiceCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${FRAME}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === ${FRAME}) {
        this.port.postMessage(this.buf, [this.buf.buffer]);
        this.buf = new Float32Array(${FRAME});
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('owlchirp-voice-capture', OwlchirpVoiceCapture);
`;

type Speaker = {
  username: string;
  decoder: AudioDecoder | null;
  gain: GainNode;
  nextTime: number;
  ts: number;
};

type Session = {
  me: string;
  ctx: AudioContext;
  master: GainNode;
  ws: WebSocket | null;
  mic: MediaStream | null;
  /** The mic couldn't be used: hear others but don't send. */
  listenOnly: boolean;
  encoder: AudioEncoder | null;
  speakers: Map<number, Speaker>;
  timers: ReturnType<typeof setInterval>[];
  cleanups: (() => void)[];
  stopped: boolean;
};

let session: Session | null = null;
const heardAt = new Map<string, number>();

/** Whether username was heard talking in the last moment (for the canvas). */
export function isSpeaking(username: string): boolean {
  return Date.now() - (heardAt.get(username) ?? 0) < SPEAKING_MS;
}

export function voiceSupported(): boolean {
  return typeof AudioEncoder !== 'undefined' && typeof AudioDecoder !== 'undefined' && typeof AudioWorkletNode !== 'undefined';
}

/** Join map voice as me. Safe to call again; stopVoice() leaves. */
export function startVoice(me: string): void {
  if (session && !session.stopped && session.me === me) return;
  stopVoice();
  if (!$proximityChat.get()) {
    $voiceMuted.set(true);
    $voiceDeafened.set(true);
  }
  $voiceMode.set($voiceModeDefault.get());
  setPttHeld(false);
  if (!voiceSupported()) {
    $voiceStatus.set('unsupported');
    return;
  }

  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const s: Session = { me, ctx, master, ws: null, mic: null, listenOnly: false, encoder: null, speakers: new Map(), timers: [], cleanups: [], stopped: false };
  session = s;
  $voiceStatus.set('connecting');

  // Browsers keep audio suspended until the page is interacted with.
  const resume = () => {
    if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
  };
  resume();
  for (const ev of ['pointerdown', 'keydown'] as const) {
    window.addEventListener(ev, resume, { capture: true });
    s.cleanups.push(() => window.removeEventListener(ev, resume, { capture: true }));
  }

  const applyGain = () => {
    master.gain.setTargetAtTime($voiceOnCall.get() || $voiceDeafened.get() ? 0 : 1, ctx.currentTime, 0.05);
  };
  applyGain();
  const applyOnCall = (onCall: boolean) => {
    applyGain();
    sendJSON(s, { type: 'onCall', on: onCall });
    if (onCall) $voiceTalking.set(false);
  };
  s.cleanups.push($voiceOnCall.listen(applyOnCall));
  s.cleanups.push($voiceDeafened.listen(applyGain));
  s.cleanups.push(
    $voiceMuted.listen((muted) => {
      if (muted) $voiceTalking.set(false);
    }),
  );
  s.timers.push(setInterval(() => updateGains(s), GAIN_EVERY_MS));

  // Push to talk: hold Space anywhere in the app, except while typing.
  const onPttKey = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || $voiceMode.get() !== 'ptt' || isTyping(e.target)) return;
    e.preventDefault();
    setPttHeld(e.type === 'keydown');
  };
  const releasePtt = () => setPttHeld(false);
  for (const ev of ['keydown', 'keyup'] as const) {
    window.addEventListener(ev, onPttKey, { capture: true });
    s.cleanups.push(() => window.removeEventListener(ev, onPttKey, { capture: true }));
  }
  window.addEventListener('blur', releasePtt);
  s.cleanups.push(() => window.removeEventListener('blur', releasePtt));
  s.cleanups.push($voiceMode.listen(releasePtt));
  s.cleanups.push(releasePtt);

  void startMic(s);
  void connectLoop(s);
}

/** Leave map voice: close the relay, release the mic and stop playback. */
export function stopVoice(): void {
  const s = session;
  session = null;
  if (!s || s.stopped) return;
  s.stopped = true;
  for (const t of s.timers) clearInterval(t);
  for (const c of s.cleanups) c();
  s.ws?.close(1000, 'left map');
  s.mic?.getTracks().forEach((t) => t.stop());
  if (s.encoder?.state !== 'closed') s.encoder?.close();
  for (const sp of s.speakers.values()) dropSpeaker(sp);
  s.speakers.clear();
  s.ctx.close().catch(() => undefined);
  heardAt.clear();
  $voiceLevel.set(null);
  $voiceTalking.set(false);
  $voiceStatus.set('off');
}

function sendJSON(s: Session, msg: unknown): void {
  if (s.ws?.readyState === WebSocket.OPEN) s.ws.send(JSON.stringify(msg));
}

// ---- Capture ----

async function startMic(s: Session): Promise<void> {
  let mic: MediaStream;
  try {
    mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (e) {
    console.warn('voice: no microphone', e);
    if (!s.stopped) markListenOnly(s);
    return;
  }
  if (s.stopped) {
    mic.getTracks().forEach((t) => t.stop());
    return;
  }
  s.mic = mic;

  const config: AudioEncoderConfig = { codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: 1, bitrate: 24000 };
  try {
    const { supported } = await AudioEncoder.isConfigSupported(config);
    if (!supported) throw new Error('Opus encoding not supported');
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    try {
      await s.ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    console.warn('voice: capture unavailable', e);
    markListenOnly(s);
    return;
  }
  if (s.stopped) return;

  // Encoded frames go out while the gate is open; the last few are kept so
  // the start of a word isn't clipped.
  let sendUntil = 0;
  const preroll: Uint8Array<ArrayBuffer>[] = [];
  const encoder = new AudioEncoder({
    output: (chunk) => {
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      if (performance.now() >= sendUntil) {
        preroll.push(bytes);
        if (preroll.length > PREROLL_FRAMES) preroll.shift();
        return;
      }
      const ws = s.ws;
      if (ws?.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_BUFFERED) return;
      for (const b of preroll.splice(0)) ws.send(b);
      ws.send(bytes);
    },
    error: (e) => console.error('voice encoder', e),
  });
  encoder.configure(config);
  s.encoder = encoder;

  const source = s.ctx.createMediaStreamSource(mic);
  const node = new AudioWorkletNode(s.ctx, 'owlchirp-voice-capture', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 });
  source.connect(node);
  s.cleanups.push(() => {
    node.port.onmessage = null;
    source.disconnect();
    node.disconnect();
  });

  let ts = 0;
  let levelAt = 0;
  let peakDb = -Infinity;
  node.port.onmessage = (ev: MessageEvent<Float32Array<ArrayBuffer>>) => {
    const pcm = ev.data;
    if (s.stopped || encoder.state !== 'configured') return;
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
    const db = 10 * Math.log10(sum / pcm.length + 1e-12);
    const now = performance.now();
    // Report the loudest frame of each interval so short words register.
    peakDb = Math.max(peakDb, db);
    if (now - levelAt >= LEVEL_EVERY_MS) {
      $voiceLevel.set(peakDb);
      peakDb = -Infinity;
      levelAt = now;
    }
    if ($voiceMuted.get() || $voiceOnCall.get()) {
      sendUntil = 0;
      preroll.length = 0;
      return;
    }
    const open = $voiceMode.get() === 'ptt' ? $voicePttHeld.get() : db > $voiceThreshold.get();
    if (open) sendUntil = now + HANGOVER_MS;
    const talking = now < sendUntil;
    if ($voiceTalking.get() !== talking) $voiceTalking.set(talking);
    if (talking) heardAt.set(s.me, Date.now());

    const data = new AudioData({ format: 'f32', sampleRate: SAMPLE_RATE, numberOfFrames: pcm.length, numberOfChannels: 1, timestamp: ts, data: pcm });
    ts += FRAME_US;
    encoder.encode(data);
    data.close();
  };
}

function markListenOnly(s: Session): void {
  s.mic?.getTracks().forEach((t) => t.stop());
  s.mic = null;
  s.listenOnly = true;
  if ($voiceStatus.get() === 'live' || $voiceStatus.get() === 'connecting') $voiceStatus.set('listenOnly');
}

// ---- Relay connection ----

async function connectLoop(s: Session): Promise<void> {
  let retry = MIN_RETRY_S;
  while (!s.stopped) {
    const code = await connectOnce(s, () => (retry = MIN_RETRY_S));
    if (s.stopped) return;
    for (const sp of s.speakers.values()) dropSpeaker(sp);
    s.speakers.clear();
    if (code === CLOSE_REPLACED) {
      $voiceStatus.set('elsewhere');
      return;
    }
    if (code === CLOSE_FORBIDDEN) {
      $voiceStatus.set('error');
      return;
    }
    $voiceStatus.set('connecting');
    await new Promise((r) => setTimeout(r, retry * 1000));
    retry = Math.min(retry * 1.5, MAX_RETRY_S);
  }
}

function voiceUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${API}/voice`;
}

/** Open one relay connection; resolves with its close code. */
async function connectOnce(s: Session, onHello: () => void): Promise<number> {
  let token: string;
  try {
    token = await apiKey();
  } catch {
    return CLOSE_UNAUTHORIZED;
  }
  if (s.stopped) return 1000;

  return new Promise<number>((resolve) => {
    const ws = new WebSocket(voiceUrl());
    ws.binaryType = 'arraybuffer';
    s.ws = ws;
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
    ws.addEventListener('message', (ev) => {
      if (s.stopped) return;
      if (ev.data instanceof ArrayBuffer) {
        onAudio(s, ev.data);
        return;
      }
      let msg: { type: string; data: any };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'hello') {
        onHello();
        for (const p of msg.data.peers ?? []) addSpeaker(s, p.id, p.username);
        $voiceStatus.set(s.listenOnly ? 'listenOnly' : 'live');
        if ($voiceOnCall.get()) sendJSON(s, { type: 'onCall', on: true });
      } else if (msg.type === 'peer') {
        addSpeaker(s, msg.data.id, msg.data.username);
      } else if (msg.type === 'peerLeft') {
        const sp = s.speakers.get(msg.data.id);
        if (sp) dropSpeaker(sp);
        s.speakers.delete(msg.data.id);
      }
    });
    ws.addEventListener('close', (ev) => {
      if (s.ws === ws) s.ws = null;
      resolve(ev.code);
    });
  });
}

// ---- Playback ----

function addSpeaker(s: Session, id: number, username: string): void {
  const old = s.speakers.get(id);
  if (old) dropSpeaker(old);
  const gain = s.ctx.createGain();
  gain.gain.value = 0;
  gain.connect(s.master);
  const sp: Speaker = { username, decoder: null, gain, nextTime: 0, ts: 0 };
  sp.decoder = new AudioDecoder({
    output: (data) => play(s, sp, data),
    error: (e) => console.error('voice decoder', e),
  });
  sp.decoder.configure({ codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: 1 });
  s.speakers.set(id, sp);
  updateGains(s);
}

function dropSpeaker(sp: Speaker): void {
  if (sp.decoder && sp.decoder.state !== 'closed') sp.decoder.close();
  sp.decoder = null;
  sp.gain.disconnect();
}

function onAudio(s: Session, buf: ArrayBuffer): void {
  if (buf.byteLength < 3 || $voiceOnCall.get() || $voiceDeafened.get()) return;
  const id = new DataView(buf).getUint16(0);
  const sp = s.speakers.get(id);
  if (!sp?.decoder || sp.decoder.state !== 'configured') return;
  heardAt.set(sp.username, Date.now());
  sp.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: sp.ts, data: new Uint8Array(buf, 2) }));
  sp.ts += FRAME_US;
}

function play(s: Session, sp: Speaker, data: AudioData): void {
  try {
    if (s.stopped || !sp.decoder) return;
    const frames = data.numberOfFrames;
    const buffer = s.ctx.createBuffer(1, frames, data.sampleRate);
    const pcm = new Float32Array(frames);
    data.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
    buffer.copyToChannel(pcm, 0);

    const now = s.ctx.currentTime;
    // Start a little behind to absorb network jitter; skip ahead when the
    // queue has drifted too far behind real time.
    if (sp.nextTime < now + 0.01 || sp.nextTime > now + MAX_LAG_S) sp.nextTime = now + JITTER_S;
    const src = s.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(sp.gain);
    src.start(sp.nextTime);
    sp.nextTime += buffer.duration;
  } finally {
    data.close();
  }
}

/** Set every speaker's volume from how far they are from me right now. */
function updateGains(s: Session): void {
  const players = $mapPlayers.get() ?? {};
  const me = players[s.me];
  for (const sp of s.speakers.values()) {
    const p = players[sp.username];
    // Only people in the same scene (town or office) can hear each other.
    const sameScene = me && p && (p.scene || 'town') === (me.scene || 'town');
    const v = sameScene ? volumeAt(Math.hypot(p.x - me.x, p.y - me.y)) : 0;
    sp.gain.gain.setTargetAtTime(v / 100, s.ctx.currentTime, 0.05);
  }
}
