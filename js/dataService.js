/**
 * dataService — the ONE place that talks to music APIs.
 *
 * Every call goes through the local backend proxy (/api/...), which handles
 * CORS, caching and rate limits. To swap providers, change this file only:
 * the rest of the app works with the normalized shapes returned here.
 *
 * Normalized Track:
 *   { trackId, title, artistId, artistName, albumId, albumTitle, coverUrl, coverSmall,
 *     hasPreview, audioSrc, previewUrl, year, genre, genreId, subGenre, rank, duration,
 *     link, listenLinks }
 */

import { matchTags, placeTrack, NODES } from './genreGraph.js';
import { isStandalone } from './mode.js';
import * as direct from './direct.js';

export class ApiError extends Error {
  constructor(message, { status = 0, offline = false } = {}) {
    super(message);
    this.status = status;
    this.offline = offline;
  }
}

// Deezer genres we never show (not music, or "all").
const HIDDEN_GENRE_IDS = new Set([0, 457]);

const memo = new Map(); // short-lived in-memory memo on top of the server's disk cache

/**
 * Browsers open at most 6 connections to one server. Background work (feed building,
 * MusicBrainz lookups, audio preloading) must never take them all, or pressing
 * play waits in the browser's queue. So data calls share 3 lanes, preloads 1.
 */
export function limiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}
const dataLane = limiter(3);

/**
 * GET JSON. `path` is the server route ('/api/deezer/…', '/api/itunes/…', '/api/mb/…');
 * in standalone mode the same request goes straight to the provider instead.
 */
async function api(path, { timeout = 20000, memoize = true, fresh = false } = {}) {
  const key = path + (fresh ? '#fresh' : '');
  if (memoize && memo.has(key)) return memo.get(key);
  const p = isStandalone() ? viaDirect(path, { timeout, fresh }) : viaServer(path + (fresh ? (path.includes('?') ? '&' : '?') + 'fresh=1' : ''), timeout);
  if (memoize) {
    memo.set(key, p);
    p.catch(() => memo.delete(key));
    if (memo.size > 800) memo.delete(memo.keys().next().value);
  }
  return p;
}

async function viaServer(path, timeout) {
  let res;
  try {
    // Relative URL: works when the app lives in a sub-folder. The timeout starts once
    // the request leaves our lane, not while it waits for one.
    res = await dataLane(() => fetch(path.replace(/^\//, ''), { signal: AbortSignal.timeout(timeout) }));
  } catch (err) {
    throw new ApiError('Could not reach the Swipe Sound server', { offline: true });
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    throw new ApiError((body && body.error) || `Request failed (${res.status})`, {
      status: res.status,
      offline: !!(body && body.offline),
    });
  }
  return body;
}

async function viaDirect(path, { timeout, fresh }) {
  const m = path.match(/^\/api\/(deezer|itunes|mb)(\/.*)$/);
  if (!m) throw new ApiError('Not available without the PC server', { status: 404 });
  try {
    return await dataLane(() => direct.getJson(m[1], m[2], { timeout, fresh }));
  } catch (err) {
    throw new ApiError(err.message, { status: err.status || 0, offline: !!err.offline });
  }
}

const dz = (path, opts) => api('/api/deezer' + path, opts);
/** Raw Deezer API call, always fresh (imports and their refresh must see new songs). */
export const deezerGet = (path) => dz(path, { memoize: false, fresh: true, timeout: 30000 });
const list = (body) => (body && Array.isArray(body.data) ? body.data : []);
const enc = encodeURIComponent;

/* ------------------------------------------------------------------ */
/* Normalizers                                                          */
/* ------------------------------------------------------------------ */

export function listenLinks({ title, artistName, link }) {
  const q = enc(`${artistName || ''} ${title || ''}`.trim());
  return {
    deezer: link || `https://www.deezer.com/search/${q}`,
    spotify: `https://open.spotify.com/search/${q}`,
    apple: `https://music.apple.com/search?term=${q}`,
    youtube: `https://music.youtube.com/search?q=${q}`,
  };
}

export const PLATFORMS = {
  deezer: 'Deezer',
  spotify: 'Spotify',
  apple: 'Apple Music',
  youtube: 'YouTube Music',
};

function yearOf(date) {
  const y = date && parseInt(String(date).slice(0, 4), 10);
  return y && y > 1800 ? y : null;
}

export function normalizeTrack(t, extra = {}) {
  if (!t || !t.id) return null;
  const album = t.album || {};
  const artist = t.artist || {};
  const track = {
    trackId: String(t.id),
    title: t.title_short || t.title || 'Unknown title',
    titleFull: t.title || '',
    artistId: artist.id ? String(artist.id) : null,
    artistName: artist.name || 'Unknown artist',
    albumId: album.id ? String(album.id) : null,
    albumTitle: album.title || '',
    coverUrl: album.cover_xl || album.cover_big || album.cover_medium || artist.picture_xl || '',
    coverSmall: album.cover_medium || album.cover_small || artist.picture_medium || '',
    previewUrl: t.preview || '',
    hasPreview: !!t.preview,
    audioSrc: t.preview ? `api/audio/deezer/${t.id}` : '',
    year: yearOf(t.release_date || album.release_date),
    genre: null,
    genreId: null,
    subGenre: null,
    rank: t.rank || 0,
    isrc: t.isrc || null,
    duration: t.duration || 0,
    link: t.link || `https://www.deezer.com/track/${t.id}`,
    ...extra,
  };
  track.listenLinks = listenLinks(track);
  return track;
}

export function normalizeArtist(a) {
  if (!a || !a.id) return null;
  return {
    artistId: String(a.id),
    name: a.name,
    picture: a.picture_big || a.picture_medium || a.picture || '',
    pictureSmall: a.picture_medium || a.picture_small || '',
    fans: a.nb_fan || 0,
  };
}

export function normalizeAlbum(a, artistFallback) {
  if (!a || !a.id) return null;
  const artist = a.artist || artistFallback || {};
  return {
    albumId: String(a.id),
    title: a.title,
    artistId: artist.id ? String(artist.id) : artist.artistId || null,
    artistName: artist.name || '',
    coverUrl: a.cover_xl || a.cover_big || a.cover_medium || '',
    coverSmall: a.cover_medium || a.cover_small || '',
    year: yearOf(a.release_date),
    genreId: a.genre_id && a.genre_id > 0 ? a.genre_id : null,
    fans: a.fans || 0,
  };
}

const compact = (arr) => arr.filter(Boolean);

/* ------------------------------------------------------------------ */
/* Genres                                                               */
/* ------------------------------------------------------------------ */

let genresPromise = null;
export function getGenres() {
  genresPromise ||= dz('/genre').then((b) =>
    list(b)
      .filter((g) => !HIDDEN_GENRE_IDS.has(g.id))
      .map((g) => ({ genreId: g.id, name: g.name, picture: g.picture_medium || g.picture_big || '' }))
  );
  genresPromise.catch(() => (genresPromise = null));
  return genresPromise;
}

export async function genreName(genreId) {
  const g = (await getGenres()).find((x) => x.genreId === Number(genreId));
  return g ? g.name : null;
}

/** Popular tracks for a Deezer genre (genreId 0 = everything). Genre is known by construction. */
export async function getGenreTopTracks(genreId, limit = 50) {
  const body = await dz(`/chart/${genreId}/tracks?limit=${limit}`);
  const name = genreId ? await genreName(genreId) : null;
  return compact(list(body).map((t) => normalizeTrack(t, name ? { genre: name, genreId: Number(genreId) } : {})));
}

/**
 * Popular artists for a genre. Deezer's /genre/{id}/artists is unreliable, so
 * we derive artists from the genre chart, keeping chart order.
 */
export async function getGenreArtists(genreId, limit = 30) {
  const body = await dz(`/chart/${genreId}/tracks?limit=100`);
  const seen = new Set();
  const out = [];
  for (const t of list(body)) {
    const a = t.artist;
    if (!a || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(normalizeArtist(a));
    if (out.length >= limit) break;
  }
  return out;
}

/** Popular albums for a Deezer genre. */
export async function getGenreTopAlbums(genreId, limit = 20) {
  return compact(list(await dz(`/chart/${genreId}/albums?limit=${limit}`)).map((a) => normalizeAlbum(a)));
}

/* ------------------------------------------------------------------ */
/* Search                                                               */
/* ------------------------------------------------------------------ */

export async function searchArtists(q, limit = 20) {
  if (!q.trim()) return [];
  return compact(list(await dz(`/search/artist?q=${enc(q)}&limit=${limit}`)).map(normalizeArtist));
}

export async function searchAlbums(q, limit = 20) {
  if (!q.trim()) return [];
  return compact(list(await dz(`/search/album?q=${enc(q)}&limit=${limit}`)).map((a) => normalizeAlbum(a)));
}

export async function searchTracks(q, limit = 20) {
  if (!q.trim()) return [];
  return compact(list(await dz(`/search?q=${enc(q)}&limit=${limit}`)).map((t) => normalizeTrack(t)));
}

/**
 * Artists MusicBrainz tags with a genre, best match first (names only).
 * Used to find entry-point artists for generated sub-genres that have no hand-picked ones.
 */
export async function searchArtistsByTag(tag, limit = 15) {
  const q = enc(`tag:"${String(tag).replace(/"/g, '')}"`);
  const body = await api(`/api/mb/artist?query=${q}&limit=${limit}`, { timeout: 60000 });
  return ((body && body.artists) || []).map((a) => a.name);
}

/**
 * The Deezer artist with exactly this name (ignoring case/accents/punctuation), or null.
 * Never "the closest result": for an artist Deezer doesn't have, that was someone else
 * entirely (e.g. "Jakaboski" -> "Jake Bosci"), which put unrelated songs in a sub-genre.
 */
export async function findArtistByName(name) {
  const results = await searchArtists(name, 10);
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  // Same name ignoring case/accents/punctuation; the most followed one is the real artist.
  const same = results.filter((a) => norm(a.name) === norm(name)).sort((a, b) => b.fans - a.fans);
  return same[0] || null;
}

/* ------------------------------------------------------------------ */
/* Artists, albums, tracks                                              */
/* ------------------------------------------------------------------ */

export async function getArtist(artistId) {
  return normalizeArtist(await dz(`/artist/${artistId}`));
}

export async function getArtistTopTracks(artistId, limit = 10) {
  return compact(list(await dz(`/artist/${artistId}/top?limit=${limit}`)).map((t) => normalizeTrack(t)));
}

export async function getRelatedArtists(artistId, limit = 20) {
  return compact(list(await dz(`/artist/${artistId}/related?limit=${limit}`)).map(normalizeArtist));
}

/** "Similar tracks": Deezer's artist radio (a mix of the artist and similar artists). */
export async function getArtistRadio(artistId, limit = 25) {
  return compact(list(await dz(`/artist/${artistId}/radio?limit=${limit}`)).map((t) => normalizeTrack(t)));
}

/** An artist's albums, most popular first (singles and compilations dropped when possible). */
export async function getArtistAlbums(artistId, limit = 25) {
  const albums = list(await dz(`/artist/${artistId}/albums?limit=${limit}`));
  const real = albums.filter((a) => a.record_type === 'album');
  return compact((real.length ? real : albums).map((a) => normalizeAlbum(a, { id: artistId }))).sort(
    (a, b) => b.fans - a.fans
  );
}

export async function getAlbum(albumId) {
  const a = await dz(`/album/${albumId}`);
  const album = normalizeAlbum(a);
  if (album) {
    album.genres = (a.genres && a.genres.data ? a.genres.data : []).map((g) => ({ genreId: g.id, name: g.name }));
    album.tracks = compact(
      (a.tracks && a.tracks.data ? a.tracks.data : []).map((t) =>
        normalizeTrack({ ...t, album: { ...a, tracks: undefined } })
      )
    );
  }
  return album;
}

/**
 * The year a song first came out: the earliest first-release-date among MusicBrainz recordings
 * with this title by this artist (remasters, live versions and compilations come later). null if unknown.
 */
export async function firstReleaseYear(artistName, title) {
  const clean = (s) => String(s || '').replace(/"/g, '');
  const q = enc(`recording:"${clean(title)}" AND artist:"${clean(artistName)}"`);
  const body = await api(`/api/mb/recording?query=${q}&limit=25`, { timeout: 60000 });
  const same = (a, b) => tagNorm(a) === tagNorm(b);
  const years = ((body && body.recordings) || [])
    .filter((r) => r.score >= 90 && same(r.title, title) && (r['artist-credit'] || []).some((c) => same(c.name, artistName)))
    .map((r) => parseInt(r['first-release-date'], 10))
    .filter((y) => y > 1800);
  return years.length ? Math.min(...years) : null;
}

/** Spotify and YouTube links MusicBrainz knows for a recording, by its ISRC (no key needed). */
export async function linksForIsrc(isrc) {
  const body = await api(`/api/mb/isrc/${String(isrc).toUpperCase()}?inc=url-rels`, { timeout: 60000 });
  return ((body && body.recordings) || []).flatMap((r) => (r.relations || []).map((rel) => rel.url && rel.url.resource)).filter(Boolean);
}

export async function getTrack(trackId, { fresh = false } = {}) {
  const body = await api(`/api/deezer/track/${trackId}`, { memoize: !fresh, fresh });
  return normalizeTrack(body);
}

/* ------------------------------------------------------------------ */
/* Fallbacks: iTunes (previews, year) and MusicBrainz (tags)            */
/* ------------------------------------------------------------------ */

/** Find an iTunes preview for a track that has none on Deezer. Returns { previewUrl, year } or null. */
export async function findItunesPreview(title, artistName) {
  try {
    const body = await api(`/api/itunes/search?term=${enc(`${artistName} ${title}`)}&entity=song&limit=5`, {
      timeout: 30000,
    });
    const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const results = (body && body.results) || [];
    const hit =
      results.find((r) => norm(r.artistName) === norm(artistName) && norm(r.trackName).startsWith(norm(title))) ||
      results.find((r) => norm(r.artistName) === norm(artistName));
    if (!hit || !hit.previewUrl) return null;
    return { previewUrl: hit.previewUrl, year: yearOf(hit.releaseDate) };
  } catch {
    return null;
  }
}

/** MusicBrainz tags for an artist name, most-voted first. Never throws. */
const tagMemo = new Map();
// Ignores accents and punctuation (Popović = Popovic) but keeps non-Latin names.
const tagNorm = (s) => (s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const tagsOf = (a) => (a && a.tags ? a.tags.sort((x, y) => y.count - x.count).map((t) => t.name.toLowerCase()) : []);

/**
 * Look up the tags of many artists in ONE MusicBrainz search (it allows 1 request/s, so one
 * request per artist made big libraries take an hour). Fills the getArtistTags cache.
 */
export async function prefetchArtistTags(names) {
  const todo = names.filter((n) => n && !tagMemo.has(n.toLowerCase()));
  if (!todo.length) return;
  const q = enc(todo.map((n) => `artist:"${n.replace(/["\\]/g, '')}"`).join(' OR '));
  let artists;
  try {
    artists = ((await api(`/api/mb/artist?query=${q}&limit=100`, { timeout: 60000 })) || {}).artists || [];
  } catch {
    return;
  }
  // Not cut off (or a lone name, best matches first): a name missing here isn't on MusicBrainz.
  const complete = artists.length < 100 || todo.length === 1;
  for (const n of todo) {
    const a = artists.find((x) => tagNorm(x.name) === tagNorm(n)); // results are best-score first
    if (a || complete) tagMemo.set(n.toLowerCase(), Promise.resolve(tagsOf(a)));
  }
  // Cut off (names with common words match lots of artists): retry the missing ones in halves.
  const missing = todo.filter((n) => !tagMemo.has(n.toLowerCase()));
  if (missing.length > 1) {
    const half = Math.ceil(missing.length / 2);
    await prefetchArtistTags(missing.slice(0, half));
    await prefetchArtistTags(missing.slice(half));
  }
}

export function getArtistTags(artistName) {
  const key = (artistName || '').toLowerCase();
  if (!key) return Promise.resolve([]);
  if (!tagMemo.has(key)) {
    const q = enc(`artist:"${artistName.replace(/"/g, '')}"`);
    const p = api(`/api/mb/artist?query=${q}&limit=3`, { timeout: 60000 })
      .then((body) => {
        const artists = (body && body.artists) || [];
        return tagsOf(artists.find((x) => tagNorm(x.name) === tagNorm(artistName) && x.score >= 90));
      })
      .catch(() => []);
    tagMemo.set(key, p);
  }
  return tagMemo.get(key);
}

/* ------------------------------------------------------------------ */
/* Enrichment                                                           */
/* ------------------------------------------------------------------ */

const albumGenreMemo = new Map();

/** Fill in genre(s) (from the album) and year if missing. Cheap: one cached album call. */
export async function enrichGenre(track) {
  if (!track || (track.genre && track.year && track.genres) || !track.albumId) return track;
  let info = albumGenreMemo.get(track.albumId);
  if (!info) {
    info = getAlbum(track.albumId)
      .then((a) => ({ genres: a && a.genres ? a.genres : [], year: a ? a.year : null }))
      .catch(() => ({ genres: [] }));
    albumGenreMemo.set(track.albumId, info);
  }
  const { genres, year } = await info;
  if (!track.genres) track.genres = genres.map((g) => g.name);
  if (!track.genre && genres[0]) Object.assign(track, { genre: genres[0].name, genreId: genres[0].genreId });
  if (track.genre && !track.genres.includes(track.genre)) track.genres.unshift(track.genre);
  if (!track.year && year) track.year = year;
  return track;
}

/** Fill in the sub-genre from MusicBrainz artist tags (slow: 1 req/s, so only for cards about to show). */
export async function enrichSubGenre(track) {
  if (!track || track.subGenre) return track;
  const tags = await getArtistTags(track.artistName);
  const { style, moon } = matchTags(tags, track.genre);
  if (style && !track.subGenre) track.subGenre = style.name;
  if (moon && !track.moon) track.moon = moon.name; // a variation of the sub-genre (Music Map moon)
  // The genre is the sun this sub-genre orbits (genreGraph.placeTrack), not just the album's.
  const fam = NODES.get(placeTrack(track).family);
  if (fam && track.genre !== fam.name) {
    track.genre = fam.name;
    if (fam.deezerId) track.genreId = fam.deezerId;
    if (track.genres && !track.genres.includes(fam.name)) track.genres.unshift(fam.name);
  }
  if (tags.length && !track.tags) track.tags = tags.slice(0, 6);
  return track;
}

/** If Deezer has no preview, try iTunes. Mutates and returns the track. */
export async function ensurePreview(track) {
  if (!track || track.hasPreview) return track;
  const it = await findItunesPreview(track.title, track.artistName);
  if (it) {
    track.previewUrl = it.previewUrl;
    track.audioSrc = `api/audio/url?u=${enc(it.previewUrl)}`;
    track.hasPreview = true;
    track.previewSource = 'itunes';
    if (!track.year && it.year) track.year = it.year;
  }
  return track;
}

/**
 * The address the player should load for a track's preview.
 *  - PC server: our own audio route (it resolves fresh Deezer links and allows analysis).
 *  - standalone: the provider's preview file itself. Deezer links expire after ~15 min,
 *    so they're looked up again when needed (cached only until they expire).
 */
export async function audioSrcFor(track, { fresh = false } = {}) {
  if (!track || !track.hasPreview) return '';
  if (!isStandalone()) return track.audioSrc;
  const fromItunes = track.previewSource === 'itunes' || /mzstatic|itunes\.apple/.test(track.previewUrl || '');
  if (fromItunes) return track.previewUrl;
  const t = await getTrack(track.trackId, { fresh });
  if (!t || !t.previewUrl) throw new ApiError('No preview available', { status: 404 });
  track.previewUrl = t.previewUrl;
  return t.previewUrl;
}

/** Re-fetch a track (bypassing caches) to get a fresh preview link. */
export async function refreshTrack(track) {
  const fresh = await getTrack(track.trackId, { fresh: true });
  if (fresh && fresh.hasPreview) {
    track.previewUrl = fresh.previewUrl;
    track.audioSrc = fresh.audioSrc;
    track.hasPreview = true;
  }
  return track;
}

/** Quick connectivity check against the backend. */
export async function checkServer() {
  if (isStandalone()) return navigator.onLine;
  try {
    const res = await fetch('api/health', { signal: AbortSignal.timeout(4000), cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Spotify (optional): only used to know which songs you already listen to */
/* ------------------------------------------------------------------ */

async function post(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(10 * 60000), // a first sync of a big library takes a while
    });
  } catch {
    throw new ApiError('Could not reach the Swipe Sound server', { offline: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, { status: res.status });
  return data;
}

/* In standalone mode the imported library is kept in this device's IndexedDB. */
let spotifyDb = null;
function localStore(op, value) {
  spotifyDb ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('swipe-sound-spotify', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return spotifyDb.then(
    (d) =>
      new Promise((resolve, reject) => {
        const tx = d.transaction('kv', op === 'get' ? 'readonly' : 'readwrite');
        const store = tx.objectStore('kv');
        const r = op === 'get' ? store.get('import') : op === 'put' ? store.put(value, 'import') : store.delete('import');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      })
  );
}

export async function getSpotifyStatus() {
  if (!isStandalone()) return api('/api/spotify/status', { memoize: false, timeout: 8000 });
  const imp = await localStore('get').catch(() => null);
  return {
    standalone: true,
    configured: false,
    connected: false,
    imported: imp ? { importedAt: imp.importedAt, count: imp.tracks.length, files: imp.files || [], stats: imp.stats || null } : null,
  };
}
export async function importSpotifyLibrary(tracks, files, stats) {
  if (!isStandalone()) return post('api/spotify/import', { tracks, files, stats });
  await localStore('put', { importedAt: Date.now(), files, tracks, stats });
  return { ok: true, count: tracks.length };
}
export async function removeSpotifyImport() {
  if (isStandalone()) return localStore('delete').catch(() => {});
  await fetch('api/spotify/import', { method: 'DELETE' });
}
/** [[artists[], title, isrc|null, sources]] of every song in your Spotify library. */
export async function getSpotifyLibrary() {
  if (!isStandalone()) return api('/api/spotify/library', { memoize: false, timeout: 30000 });
  const imp = await localStore('get').catch(() => null);
  return { syncedAt: imp ? imp.importedAt : null, tracks: imp ? imp.tracks : [] };
}
