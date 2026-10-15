/**
 * audio — preview player with "smart start".
 *
 * Previews are the provider's official 30 s clips, streamed through the local
 * backend (same origin, so the Web Audio API can analyse them). Audio is kept
 * in memory only (small LRU), never stored.
 *
 * Smart start (preview length = 15 s):
 *   1. decode the clip with the Web Audio API
 *   2. compute RMS loudness in 1-second steps
 *   3. slide a 15 s window, keep the one with the highest average energy
 *   4. cache only that start offset (a number) per trackId
 * Playback is cut in the player with a short fade-in/out; nothing is re-encoded.
 */

import { storage } from './storage.js';
import { ensurePreview, limiter, audioSrcFor } from './dataService.js';
import { rmsProfile, bestWindowStart } from './analysis.js';

export { rmsProfile, bestWindowStart };

const FADE_IN = 0.35;
const FADE_OUT = 0.6;
const CROSSFADE = 1.5;
const SMART_WINDOW = 15;
const BUFFER_CACHE_SIZE = 8;

/* ------------------------------------------------------------------ */
/* Analysis                                                             */
/* ------------------------------------------------------------------ */

export function smartOffset(buffer, windowSec = SMART_WINDOW) {
  if (!buffer || buffer.duration <= windowSec + 0.5) return 0;
  const channels = [];
  for (let c = 0; c < Math.min(buffer.numberOfChannels, 2); c++) channels.push(buffer.getChannelData(c));
  const rms = rmsProfile(channels, buffer.sampleRate, 1);
  const start = bestWindowStart(rms, windowSec);
  return Math.min(start, Math.max(0, Math.floor(buffer.duration - windowSec)));
}

/* ------------------------------------------------------------------ */
/* Loading & decoding                                                   */
/* ------------------------------------------------------------------ */

let ctx = null;
let decodeCtx = null;

function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** Browsers only allow audio after a user gesture: unlock on the first one. */
function unlock() {
  const c = getCtx();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}
['pointerdown', 'keydown', 'touchend'].forEach((ev) => addEventListener(ev, unlock, { capture: true, passive: true }));

function decoder() {
  if (ctx) return ctx;
  if (!decodeCtx) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    decodeCtx = OAC ? new OAC(2, 44100, 44100) : null;
  }
  return decodeCtx;
}

const buffers = new Map(); // trackId -> Promise<AudioBuffer>
const decoded = new Map(); // trackId -> AudioBuffer, once fully downloaded and decoded

/** Reject if `p` takes longer than `ms` (never leave the player stuck "loading"). */
function withTimeout(p, ms, message) {
  return Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}

const preloadLane = limiter(1); // background clip downloads, one at a time

async function fetchAudio(track) {
  return preloadLane(() => fetchAudioNow(track));
}

async function fetchAudioNow(track) {
  let res = await fetch(await audioSrcFor(track));
  if (!res.ok && [403, 404, 410].includes(res.status)) {
    // Expired preview link: get a fresh one from the API and retry once.
    res = await fetch(await audioSrcFor(track, { fresh: true }));
  }
  if (!res.ok) throw new Error(res.status === 404 ? 'No preview available' : `Preview failed (${res.status})`);
  return await res.arrayBuffer(); // inside the lane: the slot stays busy until the clip is fully downloaded
}

/** Decoded AudioBuffer for a track (cached in memory, LRU). */
export function loadBuffer(track) {
  if (!track || !track.hasPreview || !track.audioSrc) return Promise.reject(new Error('No preview available'));
  if (buffers.has(track.trackId)) {
    const p = buffers.get(track.trackId);
    buffers.delete(track.trackId);
    buffers.set(track.trackId, p); // refresh LRU position
    return p;
  }
  const p = (async () => {
    const data = await fetchAudio(track);
    const dc = decoder();
    if (!dc) throw new Error('Web Audio not supported');
    return await new Promise((resolve, reject) => {
      // Callback form for older Safari; promise form elsewhere.
      const r = dc.decodeAudioData(data, resolve, reject);
      if (r && r.then) r.then(resolve, reject);
    });
  })();
  buffers.set(track.trackId, p);
  p.then((buf) => buffers.has(track.trackId) && decoded.set(track.trackId, buf)).catch(() => buffers.delete(track.trackId));
  while (buffers.size > BUFFER_CACHE_SIZE) {
    const oldest = buffers.keys().next().value;
    buffers.delete(oldest);
    decoded.delete(oldest);
  }
  return p;
}

/* ------------------------------------------------------------------ */
/* Offsets & preview window                                             */
/* ------------------------------------------------------------------ */

export const previewLength = () => (storage.data.profile.previewLength === 15 ? 15 : 30);

export function knownOffset(track) {
  if (!track) return null;
  const stored = storage.data.previewOffsets[track.trackId];
  if (typeof stored === 'number') return stored;
  if (typeof track.previewStartOffset === 'number') return track.previewStartOffset;
  return null;
}

function rememberOffset(track, offset) {
  track.previewStartOffset = offset;
  if (storage.data.previewOffsets[track.trackId] === offset) return;
  storage.update((d) => {
    d.previewOffsets[track.trackId] = offset;
    const liked = d.likedSongs.find((s) => s.trackId === track.trackId);
    if (liked) liked.previewStartOffset = offset;
  }, 'offset');
}

/**
 * Preload a track in the background: find a preview if missing, decode it,
 * and compute the smart-start offset. Never throws.
 */
export async function prepare(track) {
  try {
    if (!track.hasPreview) await ensurePreview(track);
    if (!track.hasPreview) return track;
    const buf = await loadBuffer(track);
    if (knownOffset(track) == null) rememberOffset(track, smartOffset(buf));
  } catch {
    /* analysis failed: playback falls back to the start of the clip */
  }
  return track;
}

/** { start, end, smart } for a track given the current setting. */
function windowFor(track, duration) {
  if (previewLength() === 30) return { start: 0, end: duration, smart: false };
  const off = knownOffset(track);
  if (off == null) return { start: 0, end: Math.min(SMART_WINDOW, duration), smart: false };
  const start = Math.min(off, Math.max(0, duration - SMART_WINDOW));
  return { start, end: Math.min(duration, start + SMART_WINDOW), smart: start > 0 };
}

/* ------------------------------------------------------------------ */
/* Player                                                               */
/* ------------------------------------------------------------------ */

/**
 * A "voice" is one playing clip. Web Audio when possible; an <audio> element
 * as a fallback if decoding fails (no smart start then).
 */
class Voice {
  constructor(track, onEnded) {
    this.track = track;
    this.onEnded = onEnded;
    this.stopped = false;
  }

  /**
   * Start playing. If the clip is already downloaded and decoded (preloaded), use
   * Web Audio: instant, sample-accurate smart start. Otherwise stream it right away
   * with an <audio> element (sound in a fraction of a second, even on a slow CDN)
   * while the full clip is decoded in the background for next time.
   */
  async start({ fadeIn = FADE_IN } = {}) {
    const c = getCtx();
    const buf = decoded.get(this.track.trackId);
    if (buf && c) {
      if (c.state === 'suspended') await withTimeout(c.resume(), 1500, 'suspended').catch(() => {});
      if (c.state === 'running') {
        if (knownOffset(this.track) == null) rememberOffset(this.track, smartOffset(buf));
        this.mode = 'webaudio';
        this.buf = buf;
        this.win = windowFor(this.track, buf.duration);
        this.pos = this.win.start;
        this.playFrom(this.pos, fadeIn);
        return;
      }
    }
    loadBuffer(this.track)
      .then((b) => knownOffset(this.track) == null && rememberOffset(this.track, smartOffset(b)))
      .catch(() => {});
    await this.startElement(fadeIn);
  }

  async startElement(fadeIn) {
    this.mode = 'element';
    const el = (this.el = new Audio());
    el.preload = 'auto';
    el.volume = fadeIn ? 0 : 1;
    this.fadeIn = fadeIn;
    this.win = windowFor(this.track, 30); // refined once the real duration is known
    // Resolves when the file's header is in (duration known), so we can seek to the best part.
    const load = (src) => {
      const ready = new Promise((resolve, reject) => {
        el.onloadedmetadata = () => {
          if (Number.isFinite(el.duration) && el.duration > 0) this.win = windowFor(this.track, el.duration);
          if (this.win.start > 0) el.currentTime = this.win.start; // previews support byte ranges
          resolve();
        };
        el.onerror = () => reject(new Error('Could not play this preview'));
      });
      el.src = src;
      return withTimeout(ready, 15000, 'This preview is taking too long to load');
    };
    el.addEventListener('timeupdate', () => el.currentTime >= this.win.end - 0.05 && this.finish());
    // Slow connection: show the spinner while the stream catches up.
    el.addEventListener('waiting', () => !this.paused && this.onBuffering && this.onBuffering(true));
    el.addEventListener('playing', () => this.onBuffering && this.onBuffering(false));
    el.addEventListener('ended', () => this.finish());
    try {
      await load(await withTimeout(audioSrcFor(this.track), 15000, 'This preview is taking too long to load'));
    } catch (err) {
      if (this.stopped || /No preview/.test(err.message)) throw err;
      // Most likely an expired Deezer link: one retry with a freshly looked-up one.
      await load(await audioSrcFor(this.track, { fresh: true }));
    }
    el.onerror = null;
    if (this.stopped) return this.stop();
    await withTimeout(el.play(), 15000, 'This preview is taking too long to start');
    // Fades for the <audio> element (the Web Audio path uses a gain node instead).
    this.fader = setInterval(() => this.applyElementVolume(), 40);
  }

  applyElementVolume() {
    const el = this.el;
    if (!el || this.paused) return;
    const pos = el.currentTime;
    let v = Math.min(1, (this.win.end - pos) / FADE_OUT);
    if (this.fadeIn) v = Math.min(v, (pos - this.win.start) / this.fadeIn);
    if (this.fadingOut) {
      const t = (performance.now() - this.fadingOut.at) / (this.fadingOut.secs * 1000);
      if (t >= 1) return this.stop();
      v = Math.min(v, 1 - t);
    }
    el.volume = Math.max(0, Math.min(1, v));
  }

  playFrom(pos, fadeIn) {
    const c = getCtx();
    const src = c.createBufferSource();
    src.buffer = this.buf;
    const gain = c.createGain();
    src.connect(gain).connect(c.destination);
    const now = c.currentTime;
    const remaining = Math.max(0, this.win.end - pos);
    gain.gain.setValueAtTime(fadeIn ? 0.0001 : 1, now);
    if (fadeIn) gain.gain.linearRampToValueAtTime(1, now + fadeIn);
    const fadeOutAt = now + Math.max(0, remaining - FADE_OUT);
    gain.gain.setValueAtTime(1, Math.max(fadeOutAt, now + (fadeIn || 0)));
    gain.gain.linearRampToValueAtTime(0.0001, now + remaining);
    src.start(now, pos, remaining);
    src.onended = () => {
      if (this.src === src && !this.paused) this.finish();
    };
    this.src = src;
    this.gain = gain;
    this.startedAt = now;
    this.startPos = pos;
    this.paused = false;
  }

  position() {
    if (this.mode === 'element') return this.el ? this.el.currentTime : 0;
    if (this.paused || !this.src) return this.pos;
    return this.startPos + (getCtx().currentTime - this.startedAt);
  }

  progress() {
    const { start, end } = this.win || { start: 0, end: 1 };
    return Math.min(1, Math.max(0, (this.position() - start) / Math.max(0.1, end - start)));
  }

  remaining() {
    return this.win ? this.win.end - this.position() : Infinity;
  }

  pause() {
    if (this.paused) return;
    if (this.mode === 'element') {
      this.paused = true;
      return this.el.pause();
    }
    this.pos = this.position(); // before setting `paused`, which makes position() return the saved value
    this.paused = true;
    const c = getCtx();
    // Tiny fade to avoid a click.
    try {
      this.gain.gain.cancelScheduledValues(c.currentTime);
      this.gain.gain.setValueAtTime(this.gain.gain.value, c.currentTime);
      this.gain.gain.linearRampToValueAtTime(0.0001, c.currentTime + 0.08);
      this.src.stop(c.currentTime + 0.1);
    } catch {
      /* already stopped */
    }
  }

  resume() {
    if (!this.paused) return;
    if (this.mode === 'element') {
      this.paused = false;
      return this.el.play();
    }
    if (this.remaining() <= 0.2) return this.finish();
    this.playFrom(this.pos, 0.15);
  }

  /** Fade out over `secs` and stop. */
  fadeOut(secs = CROSSFADE) {
    if (this.mode === 'element') {
      this.fadingOut = { at: performance.now(), secs };
      this.stopped = true;
      return;
    }
    this.stopped = true;
    if (!this.src) return;
    const c = getCtx();
    try {
      this.gain.gain.cancelScheduledValues(c.currentTime);
      this.gain.gain.setValueAtTime(Math.max(0.0001, this.gain.gain.value), c.currentTime);
      this.gain.gain.linearRampToValueAtTime(0.0001, c.currentTime + secs);
      this.src.stop(c.currentTime + secs + 0.05);
    } catch {
      /* already stopped */
    }
  }

  stop() {
    this.stopped = true;
    this.paused = true;
    if (this.mode === 'element' || this.el) {
      clearInterval(this.fader);
      if (this.el) {
        this.el.pause();
        this.el.removeAttribute('src');
        this.el.load(); // abort the download
      }
      if (this.mode === 'element') return;
    }
    try {
      this.src && this.src.stop();
    } catch {
      /* already stopped */
    }
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.stop();
    this.onEnded && this.onEnded(this);
  }
}

class Player {
  constructor() {
    this.voice = null;
    this.status = 'idle'; // idle | loading | playing | paused | error
    this.track = null;
    this.queue = null; // { tracks, index }
    this.listeners = new Set();
    this.raf = null;
    this.error = null;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  state() {
    return {
      track: this.track,
      trackId: this.track && this.track.trackId,
      status: this.status,
      smart: !!(this.voice && this.voice.win && this.voice.win.smart),
      progress: this.voice ? this.voice.progress() : 0,
      queue: this.queue,
      error: this.error,
    };
  }

  emit() {
    const s = this.state();
    for (const fn of this.listeners) fn(s);
  }

  tick = () => {
    this.raf = null;
    if (this.status !== 'playing') return;
    this.emit();
    // Crossfade into the next queued track.
    if (this.queue && this.voice && this.voice.remaining() <= CROSSFADE && this.queue.index < this.queue.tracks.length - 1) {
      this.next({ crossfade: true });
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  loop() {
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  isPlaying(trackId) {
    return this.track && this.track.trackId === trackId && (this.status === 'playing' || this.status === 'loading');
  }

  /** Play one track (stops whatever was playing). */
  async play(track, { keepQueue = false, crossfade = false } = {}) {
    if (!keepQueue) this.queue = null;
    const old = this.voice;
    if (old) crossfade ? old.fadeOut(CROSSFADE) : old.stop();
    this.track = track;
    this.status = 'loading';
    this.error = null;
    this.emit();
    if (!track.hasPreview) await ensurePreview(track).catch(() => {});
    const voice = new Voice(track, (v) => this.ended(v));
    voice.onBuffering = (waiting) => {
      if (this.voice !== voice || voice.paused || this.status === 'error') return;
      const next = waiting ? 'loading' : 'playing';
      if (this.status !== next && (this.status === 'playing' || this.status === 'loading')) {
        this.status = next;
        this.emit();
        if (next === 'playing') this.loop();
      }
    };
    this.voice = voice;
    try {
      await voice.start({ fadeIn: crossfade ? CROSSFADE : FADE_IN });
      if (this.voice !== voice) return;
      if (voice.stopped) return;
      this.status = 'playing';
      this.emit();
      this.loop();
    } catch (err) {
      if (this.voice !== voice) return;
      this.status = 'error';
      this.error = err.message || 'Could not play this preview';
      this.emit();
      if (this.queue) setTimeout(() => this.voice === voice && this.next(), 800);
    }
  }

  ended(voice) {
    if (voice !== this.voice) return;
    if (this.queue && this.queue.index < this.queue.tracks.length - 1) return this.next();
    this.status = 'idle';
    this.emit();
  }

  /** Tap to play/pause. */
  toggle(track) {
    if (this.track && track && this.track.trackId !== track.trackId) return this.play(track);
    if (this.status === 'playing') return this.pause();
    if (this.status === 'paused') return this.resume();
    if (this.status === 'loading') return this.voice && this.voice.mode ? this.pause() : this.stop(); // buffering mid-song: pause
    return this.play(track || this.track, { keepQueue: !!this.queue });
  }

  pause() {
    if (!this.voice || (this.status !== 'playing' && this.status !== 'loading')) return;
    this.voice.pause();
    this.status = 'paused';
    this.emit();
  }

  resume() {
    if (!this.voice || this.status !== 'paused') return;
    this.voice.resume();
    this.status = 'playing';
    this.emit();
    this.loop();
  }

  stop() {
    if (this.voice) this.voice.stop();
    this.voice = null;
    this.track = null;
    this.queue = null;
    if (this.status !== 'idle') {
      this.status = 'idle';
      this.emit();
    }
  }

  /** "Play all": previews in sequence with a short crossfade. */
  playQueue(tracks, index = 0) {
    this.queue = { tracks, index };
    // Warm up the next one so the crossfade is seamless.
    if (tracks[index + 1]) prepare(tracks[index + 1]);
    return this.play(tracks[index], { keepQueue: true });
  }

  next({ crossfade = false } = {}) {
    if (!this.queue) return;
    const { tracks } = this.queue;
    if (this.queue.index >= tracks.length - 1) return this.stop();
    this.queue.index++;
    if (tracks[this.queue.index + 1]) prepare(tracks[this.queue.index + 1]);
    return this.play(tracks[this.queue.index], { keepQueue: true, crossfade });
  }

  previous() {
    if (!this.queue) return;
    // Like most players: restart the current song unless we're at its very beginning.
    if (this.voice && this.voice.progress() > 0.15) return this.play(this.track, { keepQueue: true });
    if (this.queue.index > 0) this.queue.index--;
    return this.play(this.queue.tracks[this.queue.index], { keepQueue: true });
  }
}

export const player = new Player();
