/**
 * storage — the user's data, shared between PC and phone.
 *
 * Primary copy: data/userdata.json on the PC (via /api/data).
 * Mirror + fallback: IndexedDB in this browser. If the server can't be reached,
 * changes are kept in IndexedDB and pushed to the server once it's back.
 * Standalone (no server, e.g. installed from GitHub Pages): IndexedDB only (mode 'device').
 *
 * Usage:
 *   await storage.load();
 *   storage.data                  // read
 *   storage.update(d => { ... })  // mutate + autosave
 *   storage.subscribe(fn)         // re-render on change
 */

import { isStandalone } from './mode.js';
import { RENAMED_STYLES, REMOVED_STYLES, isRemovedStyleName, currentStyleName, placeTrack, NODES } from './genreGraph.js';

export const SCHEMA_VERSION = 3;

export function defaultData() {
  return {
    version: SCHEMA_VERSION,
    onboarded: false,
    profile: {
      likedGenres: [], // [{ genreId, name }]
      dislikedGenres: [], // [{ genreId, name }]
      likedSubGenres: [], // [{ id, name }] sub-genres (styles) you like, independent of their genre
      dislikedSubGenres: [], // [{ id, name }]
      artists: [], // [{ artistId, name, picture }]
      albums: [], // [{ albumId, title, artistId, artistName, coverSmall, genreId }]
      songs: [], // [{ trackId, title, artistId, artistName, coverSmall, genre }]
      listenAll: false,
      preferredPlatform: 'deezer',
      previewLength: 30,
      hideKnownSongs: true, // skip songs already in your connected streaming library
      knownIncludePlaylists: true, // ...including songs from your own playlists
    },
    swipes: [], // { trackId, artistId, artistName, title, genre, subGenre, year, liked, timestamp }
    tasteWeights: { genres: {}, subGenres: {}, artists: {}, decades: {} },
    previewOffsets: {}, // { [trackId]: seconds }
    blindSpotSwipes: [], // { trackId, artistId, genre, subGenre, level, liked, skipped, timestamp, bridgeReason }
    blindSpotState: {
      currentLevel: 1,
      likeStreak: 0,
      dislikeStreak: 0,
      exploredGenres: {}, // { [nodeName]: { likes, dislikes, skips, lastAt, asked } }
      discoveries: [], // node names confirmed as liked genres
      allowDislikedGenres: false,
    },
    likedSongs: [],
    playlistSettings: {
      groupBySubGenre: false,
      sortBy: 'count',
      customNames: {},
      hiddenGenres: [],
      minSongsPerPlaylist: 3,
      overrides: {}, // { [trackId]: playlist key } when a song is moved by hand
      order: {}, // { [deck key]: [trackId, ...] } when a deck was reordered by hand
    },
    playCounts: {}, // { [trackId]: number } plays from the playlists page
    artistGenres: {}, // { [normalized artist name]: { f: familyId|null, s: styleId|null, at } } (Music Map)
    deezerImports: [], // playlists/profiles imported from a Deezer link (see deezerImport.js)
    gameBests: {}, // { [gameId or gameId:mode]: personal best } (Games)
  };
}

/** Fill in any keys missing from older or partial data. */
export function migrate(data) {
  const base = defaultData();
  if (!data || typeof data !== 'object') return base;
  const out = { ...base, ...data };
  for (const key of ['profile', 'tasteWeights', 'blindSpotState', 'playlistSettings']) {
    out[key] = { ...base[key], ...(data[key] || {}) };
  }
  for (const key of ['swipes', 'blindSpotSwipes', 'likedSongs', 'deezerImports']) if (!Array.isArray(out[key])) out[key] = [];
  for (const key of ['previewOffsets', 'playCounts', 'artistGenres', 'gameBests']) if (!out[key] || typeof out[key] !== 'object') out[key] = {};
  if ((data.version || 1) < 2) migrateStylesV2(out);
  if ((data.version || 1) < 3) migratePlacementV3(out);
  out.version = SCHEMA_VERSION;
  return out;
}

/**
 * V3: one genre placement (genreGraph.placeTrack). A saved song with a sub-genre gets the
 * genre of the sun that sub-genre orbits (a "Pop" album tagged Trap is Rap/Hip Hop), so
 * Decks, taste weights and Blind Spot agree with the Music Map.
 */
function migratePlacementV3(d) {
  for (const s of [...d.likedSongs, ...d.swipes, ...d.blindSpotSwipes]) {
    const p = placeTrack(s);
    if (!p.style) continue;
    const fam = NODES.get(p.family);
    s.subGenre = NODES.get(p.style).name; // a moon's planet
    if (s.genre === fam.name) continue;
    s.genre = fam.name;
    if ('genreId' in s) s.genreId = fam.deezerId;
    if (Array.isArray(s.genres) && !s.genres.includes(fam.name)) s.genres.unshift(fam.name);
  }
}

/**
 * V2: sub-genre clean-up (see genreGraph REMOVED_STYLES / RENAMED_STYLES).
 * Renamed styles get their new name; songs tagged with a removed one lose the tag and
 * are flagged so library.retagSongs() re-sorts them from their artist's tags.
 */
function migrateStylesV2(d) {
  const fixSong = (s, retag) => {
    if (!s || !s.subGenre) return;
    if (isRemovedStyleName(s.subGenre)) {
      s.subGenre = null;
      if (retag) s.needsRetag = true;
    } else s.subGenre = currentStyleName(s.subGenre);
  };
  d.likedSongs.forEach((s) => fixSong(s, true));
  d.profile.songs.forEach((s) => fixSong(s, false));
  d.swipes.forEach((s) => fixSong(s, false));
  d.blindSpotSwipes.forEach((s) => fixSong(s, false));
  const explored = {};
  for (const [name, v] of Object.entries(d.blindSpotState.exploredGenres || {})) {
    if (!isRemovedStyleName(name)) explored[currentStyleName(name)] = v;
  }
  d.blindSpotState.exploredGenres = explored;
  d.blindSpotState.discoveries = (d.blindSpotState.discoveries || []).filter((id) => !REMOVED_STYLES[id]);
  // Library artists filed under a removed style get sorted again by the Music Map classifier.
  for (const [k, v] of Object.entries(d.artistGenres || {})) if (v && REMOVED_STYLES[v.s]) delete d.artistGenres[k];
  // Deck (playlist) keys like "Rock · Classic rock" follow the renames.
  const renameKey = (k) => k.split(' · ').map((part) => RENAMED_STYLES[part] || part).join(' · ');
  const ps = d.playlistSettings;
  ps.customNames = Object.fromEntries(Object.entries(ps.customNames || {}).map(([k, v]) => [renameKey(k), v]));
  ps.hiddenGenres = (ps.hiddenGenres || []).map(renameKey);
  ps.overrides = Object.fromEntries(Object.entries(ps.overrides || {}).map(([k, v]) => [k, renameKey(v)]));
}

/* ------------------------------------------------------------------ */
/* IndexedDB (tiny key-value wrapper)                                   */
/* ------------------------------------------------------------------ */

const IDB_NAME = 'swipe-sound';
const IDB_STORE = 'kv';
let dbPromise = null;

function idb() {
  if (!('indexedDB' in self)) return Promise.reject(new Error('No IndexedDB'));
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbGet(key) {
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

async function idbSet(key, value) {
  try {
    const db = await idb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* private mode etc. — nothing we can do */
  }
}

/* ------------------------------------------------------------------ */
/* Merge (when two devices saved at the same time)                      */
/* ------------------------------------------------------------------ */

/**
 * Local wins for settings and profile; append-only logs are unioned; items the
 * other device added since our last sync are kept.
 */
export function mergeData(server, local, lastSyncAt) {
  const out = { ...local };
  const union = (a, b, key) => {
    const seen = new Set(a.map(key));
    return a.concat(b.filter((x) => !seen.has(key(x)))).sort((x, y) => x.timestamp - y.timestamp);
  };
  const swipeKey = (s) => `${s.trackId}|${s.timestamp}`;
  out.swipes = union(local.swipes, server.swipes || [], swipeKey);
  out.blindSpotSwipes = union(local.blindSpotSwipes, server.blindSpotSwipes || [], swipeKey);
  const localIds = new Set(local.likedSongs.map((s) => s.trackId));
  const addedElsewhere = (server.likedSongs || []).filter((s) => !localIds.has(s.trackId) && s.likedAt > lastSyncAt);
  out.likedSongs = local.likedSongs.concat(addedElsewhere);
  out.previewOffsets = { ...(server.previewOffsets || {}), ...local.previewOffsets };
  out.artistGenres = { ...(server.artistGenres || {}), ...(local.artistGenres || {}) };
  out.gameBests = { ...(server.gameBests || {}) };
  for (const [k, v] of Object.entries(local.gameBests || {})) out.gameBests[k] = Math.max(v, out.gameBests[k] || 0); // the best of both devices
  out.playCounts = { ...(server.playCounts || {}) };
  for (const [k, v] of Object.entries(local.playCounts)) out.playCounts[k] = Math.max(v, out.playCounts[k] || 0);
  return out;
}

/* ------------------------------------------------------------------ */
/* Store                                                                */
/* ------------------------------------------------------------------ */

const SAVE_DELAY = 400;
const RETRY_DELAY = 15000;

class Storage {
  constructor() {
    this.data = defaultData();
    this.rev = 0;
    this.syncedAt = 0; // server updatedAt of the revision we're based on
    this.mode = 'server'; // 'server' | 'local' (server unreachable) | 'device' (standalone)
    this.dirty = false;
    this.changes = 0; // bumped on every update, to detect edits made during a save
    this.saving = false;
    this.listeners = new Set();
    this.saveTimer = null;
    this.retryTimer = null;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(reason) {
    for (const fn of this.listeners) {
      try {
        fn(this.data, reason);
      } catch (err) {
        console.error(err);
      }
    }
  }

  async fetchServer() {
    const res = await fetch('api/data', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json(); // { rev, updatedAt, data }
  }

  async load() {
    const local = await idbGet('userdata'); // { rev, syncedAt, data, dirty }
    if (isStandalone()) {
      this.mode = 'device';
      this.data = migrate(local && local.data);
      this.dirty = false;
      this.emit('load');
      return this.data;
    }
    try {
      const server = await this.fetchServer();
      this.mode = 'server';
      if (local && local.dirty && local.data) {
        // Changes made while the server was unreachable: merge them in and push.
        this.data = migrate(server.data ? mergeData(server.data, migrate(local.data), local.syncedAt || 0) : local.data);
        this.rev = server.rev;
        this.syncedAt = server.updatedAt;
        this.dirty = true;
        this.scheduleSave(0);
      } else if (server.data) {
        this.data = migrate(server.data);
        this.rev = server.rev;
        this.syncedAt = server.updatedAt;
        this.mirror();
      } else if (local && local.data) {
        // Server is empty (fresh install) but this browser has data: push it.
        this.data = migrate(local.data);
        this.rev = server.rev;
        this.dirty = true;
        this.scheduleSave(0);
      } else {
        this.data = defaultData();
        this.rev = server.rev;
      }
    } catch {
      this.mode = 'local';
      this.data = migrate(local && local.data);
      this.rev = (local && local.rev) || 0;
      this.syncedAt = (local && local.syncedAt) || 0;
      this.dirty = !!(local && local.dirty);
      this.scheduleRetry();
    }
    this.installSyncHooks();
    this.emit('load');
    return this.data;
  }

  /** Mutate data through a function, then notify and autosave. */
  update(mutator, reason = 'update') {
    const result = mutator(this.data);
    this.changes++;
    this.dirty = true;
    this.mirror();
    this.emit(reason);
    this.scheduleSave();
    return result;
  }

  /** Replace all data (restore / reset). Overwrites the server copy. */
  async replaceAll(newData) {
    this.data = migrate(newData);
    this.changes++;
    this.dirty = true;
    this.mirror();
    this.emit('replace');
    await this.save({ force: true });
  }

  mirror() {
    idbSet('userdata', { rev: this.rev, syncedAt: this.syncedAt, data: this.data, dirty: this.dirty });
  }

  scheduleSave(delay = SAVE_DELAY) {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), delay);
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.reconnect(), RETRY_DELAY);
  }

  async save({ force = false } = {}) {
    if (this.saving) {
      this.scheduleSave();
      return;
    }
    if (!this.dirty && !force) return;
    if (this.mode === 'device') {
      this.dirty = false; // saved on this device only
      this.mirror();
      return;
    }
    this.saving = true;
    const startChanges = this.changes;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch('api/data', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseRev: this.rev, data: this.data, force }),
          signal: AbortSignal.timeout(10000),
        });
        if (res.status === 409) {
          // The other device saved in between: merge and retry.
          const server = await res.json();
          this.data = migrate(mergeData(server.data || {}, this.data, this.syncedAt));
          this.rev = server.rev;
          this.syncedAt = server.updatedAt;
          this.emit('merge');
          continue;
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const { rev, updatedAt } = await res.json();
        this.rev = rev;
        this.syncedAt = updatedAt;
        this.dirty = this.changes !== startChanges; // changed again while we were saving?
        if (this.dirty) this.scheduleSave();
        if (this.mode !== 'server') {
          this.mode = 'server';
          this.emit('mode');
        }
        break;
      }
    } catch {
      if (this.mode !== 'local') {
        this.mode = 'local';
        this.emit('mode');
      }
      this.scheduleRetry();
    } finally {
      this.saving = false;
      this.mirror();
    }
  }

  /** Save immediately (e.g. before downloading a backup). */
  async flush() {
    clearTimeout(this.saveTimer);
    await this.save();
  }

  async reconnect() {
    if (this.mode === 'device') return;
    try {
      const server = await this.fetchServer();
      if (this.dirty) {
        if (server.rev !== this.rev && server.data) {
          this.data = migrate(mergeData(server.data, this.data, this.syncedAt));
          this.rev = server.rev;
          this.syncedAt = server.updatedAt;
        }
        await this.save();
      } else if (server.rev !== this.rev && server.data) {
        this.adopt(server);
      }
      if (this.mode !== 'server') {
        this.mode = 'server';
        this.emit('mode');
      }
    } catch {
      this.scheduleRetry();
    }
  }

  adopt(server) {
    this.data = migrate(server.data);
    this.rev = server.rev;
    this.syncedAt = server.updatedAt;
    this.dirty = false;
    this.mirror();
    this.emit('remote');
  }

  /** When the app comes back to the foreground, pick up changes from the other device. */
  async refreshFromServer() {
    if (this.mode === 'device') return;
    if (this.dirty || this.saving) return this.reconnect();
    try {
      const server = await this.fetchServer();
      if (server.rev !== this.rev && server.data) this.adopt(server);
      if (this.mode !== 'server') {
        this.mode = 'server';
        this.emit('mode');
      }
    } catch {
      if (this.mode !== 'local') {
        this.mode = 'local';
        this.emit('mode');
      }
    }
  }

  installSyncHooks() {
    if (this.hooked) return;
    this.hooked = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.refreshFromServer();
      else if (this.dirty) this.save();
    });
    addEventListener('online', () => this.reconnect());
    // On close, pending changes are already mirrored to IndexedDB; load() pushes them next time.
    addEventListener('pagehide', () => this.dirty && this.save());
  }
}

export const storage = new Storage();
