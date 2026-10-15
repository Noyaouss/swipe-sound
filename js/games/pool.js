/**
 * Games song pool: your imported library (Spotify, Deezer) and liked songs, songs you know
 * best first (play counts, else liked/saved). Each song is matched to a Deezer track with a
 * playable preview when a game needs it (looked up once, then cached); songs without one are
 * skipped. Plus a tiny preview player for the games (one clip at a time).
 */

import * as ds from '../dataService.js';
import { libraryTracks, songKey } from '../recommender.js';
import { getPlayStats } from '../playStats.js';
import { player } from '../audio.js';
import { normArtist } from '../musicMap.js';

export const MIN_POOL = 20;

/**
 * Candidate songs, songs you know best weighing most:
 * [{ key, artist, title, trackId, isrc, plays, liked, weight }]
 */
export async function candidates(data) {
  const stats = await getPlayStats(data);
  const m = new Map();
  const get = (artist, title) => {
    const key = songKey({ artistName: artist, title });
    if (!m.has(key)) m.set(key, { key, artist, title, trackId: null, isrc: null, plays: 0, liked: false });
    return m.get(key);
  };
  for (const [artists, title, isrc, source, , deezerId] of libraryTracks()) {
    const c = get(artists[0], title);
    c.isrc ||= isrc || null;
    c.trackId ||= deezerId ? String(deezerId) : null;
    if (source === 'saved') c.liked = true;
  }
  for (const s of data.likedSongs) {
    const c = get(s.artistName, s.title);
    c.trackId = String(s.trackId); // exact Deezer track
    c.liked = true;
  }
  for (const s of stats.values()) {
    const c = get(s.artist, s.title);
    c.plays = s.plays;
  }
  for (const c of m.values()) c.weight = 1 + c.plays + (c.liked ? 5 : 0);
  return [...m.values()];
}

/** Weighted random pick among songs not used yet in this run. */
export function pickWeighted(list, used) {
  let total = 0;
  for (const c of list) if (!used.has(c.key)) total += c.weight;
  let r = Math.random() * total;
  for (const c of list) {
    if (used.has(c.key)) continue;
    r -= c.weight;
    if (r <= 0) return c;
  }
  return null;
}

const KEY = 'swipe-sound:game-tracks-v2'; // songKey -> Deezer track id, or 0 when Deezer doesn't have it
let found = {};
try {
  found = JSON.parse(localStorage.getItem(KEY)) || {};
} catch {
  /* private mode: lookups aren't remembered */
}
function remember(key, trackId) {
  found[key] = trackId;
  try {
    localStorage.setItem(KEY, JSON.stringify(found));
  } catch {
    /* full or blocked: fine */
  }
}

/** The Deezer track (full details, with a preview) for a candidate, or null. */
export async function resolve(c) {
  let id = c.trackId || found[c.key];
  if (id === 0) return null; // looked up before: not on Deezer
  if (!id) {
    // A plain "artist title" search (Deezer's artist:"…" track:"…" syntax returns nothing in 2026).
    const results = await ds.searchTracks(`${c.artist} ${c.title}`, 10).catch(() => null);
    if (!results) return null; // offline or busy: try again another time, don't remember a miss
    // The same song only (songKey ignores "(feat. …)" / " - Remastered" differences), never another one by the artist.
    const pick = results.find((t) => t.hasPreview && normArtist(t.artistName) === normArtist(c.artist) && songKey(t) === c.key);
    id = pick ? pick.trackId : 0;
    remember(c.key, id);
    if (!id) return null;
  }
  const t = await ds.getTrack(id).catch(() => null);
  return t && t.hasPreview ? t : null;
}

/**
 * Next playable song of a run: { c, t } (candidate + Deezer track), or null when nothing
 * playable is left. accept(t, c) may reject a song (e.g. no reliable year).
 */
export async function nextSong(list, used, accept) {
  for (let tries = 0; tries < 30; tries++) {
    const c = pickWeighted(list, used);
    if (!c) return null;
    used.add(c.key);
    const t = await resolve(c);
    if (t && (!accept || (await accept(t, c)))) return { c, t };
  }
  return null;
}

/* ---------- preview player (one clip at a time) ---------- */

let audio = null;

/** Play a track's preview from the start; `seconds` stops it early. onEnd runs when it stops. */
export async function playClip(track, { seconds = 0, onEnd } = {}) {
  stopClip();
  player.stop(); // the swipe player and a game never play at once
  const a = new Audio();
  audio = a;
  try {
    a.src = await ds.audioSrcFor(track);
  } catch {
    return false;
  }
  if (audio !== a) return false;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    a.pause();
    if (onEnd) onEnd();
  };
  a.end = end; // stopClip() ends it the same way (its button goes back to "play")
  if (seconds) a.addEventListener('timeupdate', () => a.currentTime >= seconds && end());
  a.addEventListener('ended', end);
  return a.play().then(
    () => true,
    () => false
  );
}

export function stopClip() {
  const a = audio;
  if (!a) return;
  audio = null;
  if (a.end) a.end();
  a.pause();
  a.removeAttribute('src');
}

export const clipPlaying = () => !!audio && !audio.paused;
