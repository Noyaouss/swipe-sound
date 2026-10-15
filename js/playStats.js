/**
 * playStats — how often you played each song, from your Spotify listening history
 * (imported files) plus plays in Swipe Sound (data.playCounts). Used by the Games.
 *
 * Kept on this device (IndexedDB, also in PC server mode): { songs: { [songKey]: { artist, title,
 * ms, minutes: [play end times, minutes since 1970] } } }. Each play is identified by its minute,
 * so importing the same history again (or both history formats) never counts a play twice.
 */

import { songKey } from './recommender.js';

const DB = 'swipe-sound-plays';
let dbp = null;
function idb(mode, fn) {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp.then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction('kv', mode);
        const r = fn(tx.objectStore('kv'));
        tx.oncomplete = () => resolve(r && r.result);
        tx.onerror = () => reject(tx.error);
      })
  );
}
const load = () => idb('readonly', (s) => s.get('plays')).then((v) => v || { songs: {} });
const save = (v) => idb('readwrite', (s) => s.put(v, 'plays'));

/** Add plays ([[artist, title, minute, ms]]) to songs, skipping ones already there. Returns how many were new. */
export function mergeStreams(songs, streams) {
  const seen = new Map(); // songKey -> Set of minutes (built only for songs we touch)
  let added = 0;
  for (const [artist, title, minute, ms] of streams) {
    const key = songKey({ artistName: artist, title });
    let e = songs[key];
    if (!e) e = songs[key] = { artist, title, ms: 0, minutes: [] };
    let set = seen.get(key);
    if (!set) seen.set(key, (set = new Set(e.minutes)));
    if (set.has(minute)) continue;
    set.add(minute);
    e.minutes.push(minute);
    e.ms += ms || 0;
    added++;
  }
  return added;
}

/** Merge newly imported plays into the stored history. Returns how many plays were new. */
export async function importStreams(streams) {
  if (!streams || !streams.length) return 0;
  const v = await load();
  const added = mergeStreams(v.songs, streams);
  v.updatedAt = Date.now();
  await save(v);
  cached = null;
  return added;
}

/**
 * Per-song stats: { key, artist, title, plays, msPlayed, firstPlayed, lastPlayed, years: { [year]: plays } },
 * with in-app plays added on top. `trackSongs` = songs with a Deezer trackId (liked songs), to map playCounts.
 */
export function songStats(songs, playCounts = {}, trackSongs = []) {
  const out = new Map();
  for (const [key, e] of Object.entries(songs)) {
    const years = {};
    let first = Infinity;
    let last = 0;
    for (const m of e.minutes) {
      const y = new Date(m * 60000).getUTCFullYear();
      years[y] = (years[y] || 0) + 1;
      if (m < first) first = m;
      if (m > last) last = m;
    }
    out.set(key, { key, artist: e.artist, title: e.title, plays: e.minutes.length, msPlayed: e.ms, firstPlayed: first * 60000, lastPlayed: last * 60000, years });
  }
  const byId = new Map(trackSongs.map((s) => [String(s.trackId), s]));
  for (const [id, n] of Object.entries(playCounts || {})) {
    const s = byId.get(String(id));
    if (!s || !n) continue;
    const key = songKey(s);
    const e = out.get(key) || { key, artist: s.artistName, title: s.title, plays: 0, msPlayed: 0, firstPlayed: null, lastPlayed: null, years: {} };
    e.plays += n;
    out.set(key, e);
  }
  return out;
}

let cached = null;
/** Your play stats (Map songKey -> stats). Empty when no listening history was imported. */
export async function getPlayStats(data) {
  if (!cached) cached = load().catch(() => ({ songs: {} }));
  const v = await cached;
  return songStats(v.songs, data.playCounts, data.likedSongs);
}

/** True when a listening history (not only liked songs/playlists) has been imported. */
export const hasHistory = async () => Object.keys((await (cached || (cached = load().catch(() => ({ songs: {} }))))).songs).length > 0;
