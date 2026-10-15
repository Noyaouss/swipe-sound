/**
 * recommender — local taste model and feed builder. All tunables live in TUNING.
 *
 * TASTE PROFILE
 *   Weighted scores per genre, sub-genre, artist and decade (data.tasteWeights).
 *   It is always recomputed from scratch from:
 *     - Profile choices (liked genres: strong +, disliked genres: strong −, favorite artists/albums/songs: +)
 *     - Swipes (like +, dislike −), multiplied by a time decay so recent swipes matter more
 *     - Blind Spot swipes (like = normal +, dislike = very weak −, "Not for now" = nothing)
 *     - Blind Spot discoveries the user confirmed (+)
 *     - Replays from the playlists page (small +)
 *   Recomputing (instead of incrementing) makes Undo and edits trivially correct.
 *
 * SCORING
 *   score = Σ weight[dimension] × importance[dimension] + popularity + source bonus + jitter
 *
 * FEED
 *   Candidates come from liked genres' charts, liked artists, their related
 *   artists, similar-track radios, liked sub-genres, and an exploration share
 *   (~20%, more in "I listen to everything" mode) picked with getProximityLevel().
 *   Seen songs and disliked genres are filtered out.
 */

import * as ds from './dataService.js';
import { deezerLibraryRows } from './deezerImport.js';
import { distancesFrom, pathTo, nodeForTrack, NODES, familyByName, familyByDeezerId, allStyles, stylesOf } from './genreGraph.js';

export const TUNING = {
  halfLifeDays: 30, // a swipe's weight halves every 30 days
  // Liked / disliked sub-genres from the profile mirror the genre weights: a liked style is
  // recommended about as strongly as a liked genre (and counts as home for Blind Spot);
  // a disliked one sinks far down the feed and is left out of exploration and Blind Spot.
  profile: {
    likedGenre: 4,
    dislikedGenre: -8,
    likedSubGenre: 4,
    dislikedSubGenre: -8,
    artist: 4,
    albumArtist: 2,
    albumGenre: 1,
    songArtist: 2,
    songGenre: 0.7,
  },
  like: { genre: 1, subGenre: 1.3, artist: 1.6, decade: 0.5 },
  dislike: { genre: -0.6, subGenre: -0.8, artist: -1.8, decade: -0.25 },
  blindSpotDislikeFactor: 0.15, // Blind Spot dislikes count only a little
  discovery: 3, // confirmed Blind Spot discovery
  replay: 0.4, // × log2(1 + plays)
  /*
   * DISCOVERY (the app is for finding new music)
   * - importance.artist is low (0.5): liking an artist nudges similar music up,
   *   it must not fill the deck with that same artist.
   * - familiarity: the more songs you already have from an artist (Spotify library +
   *   likes, + 3 for artists you picked in your profile), the lower their songs score:
   *   score -= familiarity × ln(1 + songs). With 1.1:
   *       1 song → -0.8 · 3 → -1.5 · 10 → -2.6 · 30 → -3.8 · 100 → -5.1
   *   A liked genre is worth +4, so a familiar artist in a liked genre still shows up
   *   now and then (helped by the random jitter), but much less than new names.
   * - newArtistBonus: +0.8 for artists you have no songs from at all.
   * - Sources (gatherCandidates) lean on related artists and on other artists of your
   *   liked genres / sub-genres rather than on your favourite artists' own top tracks.
   * Raise familiarity to push even harder towards new artists; set it to 0 to turn it off.
   */
  importance: { genre: 1, subGenre: 1.2, artist: 0.5, decade: 0.4 },
  familiarity: 1.1,
  newArtistBonus: 0.8,
  profileArtistSongs: 3, // an artist you picked as a favourite counts as 3 songs you know
  popularity: 0.6, // bonus for popular tracks (accessible first)
  noPreviewPenalty: -1.5,
  jitter: 0.8, // randomness so the feed doesn't feel deterministic
  artistFatigue: 1.2, // penalty per recent card by the same artist (variety)
  artistCooldown: 4, // never the same artist within this many cards
  exploreRate: 0.2,
  exploreRateListenAll: 0.4,
  fewSwipes: 5, // below this many swipes, lean on profile data
  comfortThreshold: 3.5, // a comfort weight above this puts a genre in your comfort zone
};

const DAY = 86400000;
export const decadeOf = (year) => (year ? `${Math.floor(year / 10) * 10}s` : null);
const decay = (ts, now) => Math.pow(0.5, (now - ts) / (TUNING.halfLifeDays * DAY));
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
export const songKey = (t) => `${norm(t.artistName)}|${norm((t.title || '').replace(/\(.*?\)|\[.*?\]| - .*$/g, ''))}`;

/* ------------------------------------------------------------------ */
/* Taste weights                                                        */
/* ------------------------------------------------------------------ */

function add(map, key, value) {
  if (!key || !value) return;
  map[key] = (map[key] || 0) + value;
}

function applySwipe(w, s, mult, scale) {
  add(w.genres, s.genre, scale.genre * mult);
  add(w.subGenres, s.subGenre, scale.subGenre * mult);
  add(w.artists, s.artistId, scale.artist * mult);
  add(w.decades, decadeOf(s.year), scale.decade * mult);
}

/** Rebuild data.tasteWeights from everything we know. Call after any swipe/profile change. */
export function recomputeWeights(data, now = Date.now()) {
  const P = TUNING.profile;
  const w = { genres: {}, subGenres: {}, artists: {}, decades: {} };
  const p = data.profile;

  p.likedGenres.forEach((g) => add(w.genres, g.name, P.likedGenre));
  p.dislikedGenres.forEach((g) => add(w.genres, g.name, P.dislikedGenre));
  (p.likedSubGenres || []).forEach((x) => add(w.subGenres, x.name, P.likedSubGenre));
  (p.dislikedSubGenres || []).forEach((x) => add(w.subGenres, x.name, P.dislikedSubGenre));
  p.artists.forEach((a) => add(w.artists, a.artistId, P.artist));
  p.albums.forEach((al) => {
    add(w.artists, al.artistId, P.albumArtist);
    const fam = familyByDeezerId(al.genreId);
    if (fam) add(w.genres, fam.name, P.albumGenre);
    add(w.decades, decadeOf(al.year), 0.5);
  });
  p.songs.forEach((s) => {
    add(w.artists, s.artistId, P.songArtist);
    add(w.genres, s.genre, P.songGenre);
    add(w.decades, decadeOf(s.year), 0.5);
  });

  for (const s of data.swipes) applySwipe(w, s, decay(s.timestamp, now), s.liked ? TUNING.like : TUNING.dislike);
  // Comfort zone = profile + main-feed swipes only. Blind Spot likes count for scoring,
  // but only *confirmed* discoveries widen the comfort zone (added below).
  const comfort = { genres: { ...w.genres }, subGenres: { ...w.subGenres } };
  for (const s of data.blindSpotSwipes) {
    if (s.skipped) continue; // "Not for now": no penalty, no signal
    const mult = decay(s.timestamp, now) * (s.liked ? 1 : TUNING.blindSpotDislikeFactor);
    applySwipe(w, s, mult, s.liked ? TUNING.like : TUNING.dislike);
  }
  for (const name of data.blindSpotState.discoveries || []) {
    const node = NODES.get(name) || [...NODES.values()].find((n) => n.name === name);
    if (!node) continue;
    if (node.kind === 'family') add(w.genres, node.name, TUNING.discovery);
    else add(w.subGenres, node.name, TUNING.discovery);
  }
  w.comfort = comfort;
  // Replays: songs played often from playlists nudge their artist and genre up.
  for (const [trackId, plays] of Object.entries(data.playCounts || {})) {
    const song = data.likedSongs.find((s) => s.trackId === trackId);
    if (!song || plays < 2) continue;
    const bonus = TUNING.replay * Math.log2(1 + plays);
    add(w.artists, song.artistId, bonus);
    add(w.genres, song.genre, bonus / 2);
  }

  const round = (map) => Object.keys(map).forEach((k) => (map[k] = Math.round(map[k] * 100) / 100));
  [w.genres, w.subGenres, w.artists, w.decades, comfort.genres, comfort.subGenres].forEach(round);
  data.tasteWeights = w;
  return w;
}

/** Top entries of a weight map, highest first. */
export function topWeights(map, n = 5, min = 0.01) {
  return Object.entries(map || {})
    .filter(([, v]) => v >= min)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

/* ------------------------------------------------------------------ */
/* Seen songs & disliked genres                                         */
/* ------------------------------------------------------------------ */

/* Songs you already listen to on a connected streaming service (Spotify). */
const known = { keys: new Set(), isrcs: new Set(), ids: new Set(), loadedAt: 0, count: 0, hits: new Set() };

/**
 * Load your streaming library: [[artists[], title, isrc, sources]].
 * Matching is by ISRC when both sides have one, else by normalized "artist|title"
 * (every credited artist is tried, so "A & B" songs match either).
 */
export function setKnownLibrary(tracks, { includePlaylists = true } = {}) {
  known.keys = new Set();
  known.isrcs = new Set();
  known.ids = new Set();
  let n = 0;
  for (const [artists, title, isrc, sources, , deezerId] of tracks || []) {
    if (!includePlaylists && sources === 'playlist') continue;
    n++;
    if (isrc) known.isrcs.add(isrc.toUpperCase());
    if (deezerId) known.ids.add(String(deezerId)); // imported from Deezer: exact match
    for (const a of artists) known.keys.add(songKey({ artistName: a, title }));
  }
  known.count = n;
  known.loadedAt = Date.now();
}

/**
 * Load (or reload) your streaming library. The full list is always kept (the Music Map
 * and the discovery weighting use it); hiding known songs follows the profile settings.
 */
export function loadKnownLibrary(data) {
  known.ready = (async () => {
    try {
      const lib = await ds.getSpotifyLibrary();
      known.spotify = lib.tracks || [];
    } catch {
      /* server unreachable: keep what we had */
    }
    known.all = mergeLibraries(known.spotify || [], deezerLibraryRows(data.deezerImports));
    setKnownLibrary(data.profile.hideKnownSongs ? known.all || [] : [], { includePlaylists: data.profile.knownIncludePlaylists !== false });
    return known.count;
  })();
  return known.ready;
}

/**
 * Spotify rows plus Deezer rows, each song once: by ISRC when both have one, else by
 * artist|title. A song liked anywhere stays "saved"; Deezer's track id is kept for exact matches.
 */
export function mergeLibraries(spotify, deezer) {
  const byKey = new Map();
  const isrcKey = new Map();
  const out = [];
  for (const r of [...spotify, ...deezer]) {
    const k = songKey({ artistName: r[0][0], title: r[1] });
    const prev = r[5] && ((r[2] && isrcKey.get(r[2].toUpperCase())) || byKey.get(k)); // only Deezer rows are merged: the Spotify import is already de-duplicated
    if (prev) {
      if (r[3] === 'saved') prev[3] = 'saved';
      if (r[5] && !prev[5]) prev[5] = r[5];
      continue;
    }
    const row = [...r];
    out.push(row);
    byKey.set(k, row);
    if (r[2]) isrcKey.set(r[2].toUpperCase(), row);
  }
  return out;
}

/** Every song of the imported/synced library: [[artists[], title, isrc, sources, genres, deezerId]]. */
export const libraryTracks = () => known.all || [];

/** Wait (briefly) for the library so the very first cards are filtered too. */
export const knownReady = () =>
  Promise.race([known.ready || Promise.resolve(), new Promise((r) => setTimeout(r, 5000))]);

export function isKnownSong(t) {
  if (!known.count) return false;
  const hit =
    (t.trackId && known.ids.has(String(t.trackId))) || (t.isrc && known.isrcs.has(String(t.isrc).toUpperCase())) || (t.title && t.artistName && known.keys.has(songKey(t)));
  if (hit && t.trackId) known.hits.add(t.trackId);
  return !!hit;
}

/** { songs in the library, suggestions skipped this session } */
export const knownStats = () => ({ count: known.count, skipped: known.hits.size });

/** Everything the user has already seen anywhere, by id and by artist|title. */
export function seenSets(data) {
  const ids = new Set();
  const keys = new Set();
  const addT = (t) => {
    if (t.trackId) ids.add(String(t.trackId));
    if (t.title && t.artistName) keys.add(songKey(t));
  };
  data.swipes.forEach(addT);
  data.blindSpotSwipes.forEach(addT);
  data.likedSongs.forEach(addT);
  data.profile.songs.forEach(addT);
  return { ids, keys, has: (t) => ids.has(String(t.trackId)) || keys.has(songKey(t)) || isKnownSong(t) };
}

export function dislikedFamilies(data) {
  return new Set(data.profile.dislikedGenres.map((g) => familyByName(g.name)?.id).filter(Boolean));
}

/** Sub-genres (style node ids) the user said they dislike. */
export const dislikedStyles = (data) => new Set((data.profile.dislikedSubGenres || []).map((x) => x.id));

/** True if the track's sub-genre is one the user said they dislike. */
export function isDislikedStyle(track, data) {
  const node = nodeForTrack(track);
  return !!(node && node.kind === 'style' && dislikedStyles(data).has(node.id));
}

/** True if the track belongs to a genre the user said they dislike. */
export function isDislikedGenre(track, data) {
  const fams = dislikedFamilies(data);
  const node = nodeForTrack(track);
  if (node && fams.has(node.family)) return true;
  const fam = familyByName(track.genre);
  return !!(fam && fams.has(fam.id));
}

/* ------------------------------------------------------------------ */
/* Proximity (shared by Blind Spot and the exploration share)           */
/* ------------------------------------------------------------------ */

/** Graph nodes that make up the user's comfort zone. */
export function comfortNodes(data) {
  const ids = new Set();
  const w = (data.tasteWeights && data.tasteWeights.comfort) || {};
  data.profile.likedGenres.forEach((g) => {
    const f = familyByName(g.name);
    if (f) ids.add(f.id);
  });
  for (const [name, v] of Object.entries(w.genres || {})) {
    const f = familyByName(name);
    if (f && v >= TUNING.comfortThreshold) ids.add(f.id);
  }
  for (const [name, v] of Object.entries(w.subGenres || {})) {
    const n = allStyles().find((s) => s.name === name);
    if (n && v >= TUNING.comfortThreshold) ids.add(n.id);
  }
  for (const name of data.blindSpotState.discoveries || []) {
    const n = NODES.get(name) || [...NODES.values()].find((x) => x.name === name);
    if (n) ids.add(n.id);
  }
  if (!ids.size) {
    // "I listen to everything" with no signal yet: start from the most popular families.
    ['pop', 'rock', 'hip-hop', 'electro'].forEach((id) => ids.add(id));
  }
  return ids;
}

let distCache = { key: '', map: null };
function comfortDistances(data) {
  const ids = [...comfortNodes(data)].sort();
  const key = ids.join(',');
  if (distCache.key !== key) distCache = { key, map: distancesFrom(ids) };
  return distCache.map;
}

/**
 * How far a track is from the user's comfort zone.
 *   level 0 = home (already in the comfort zone)
 *   level 1 = Neighbor (another style of a liked genre, or a directly adjacent genre)
 *   level 2 = Cousin (two steps away, through a bridge)
 *   level 3 = Explorer (far)
 * A shared-artist bridge (e.g. a related artist of one you like) brings it one level closer.
 * Returns { level, distance, node, from, path, bridge: { type, why } }.
 */
export function getProximityLevel(track, tasteProfile) {
  const node = nodeForTrack(track);
  if (!node) return { level: track.bridgeArtist ? 1 : 2, distance: null, node: null, from: null, path: [], bridge: null };
  const dist = comfortDistances(tasteProfile);
  const info = dist.get(node.id);
  const distance = info ? info.dist : Infinity;
  let level = distance === 0 ? 0 : distance === 1 ? 1 : distance === 2 ? 2 : 3;
  if (track.bridgeArtist && level > 1) level -= 1;
  const path = info ? pathTo(dist, node.id) : [];
  return {
    level,
    distance,
    node,
    from: info ? NODES.get(info.from) : null,
    path,
    bridge: info && info.via ? { type: info.via.type, why: info.via.why } : null,
  };
}

/* ------------------------------------------------------------------ */
/* Scoring                                                              */
/* ------------------------------------------------------------------ */

/**
 * How many songs you already have from each artist (normalized name), from your Spotify
 * library and your likes; favourite artists from your profile add a few. Cached.
 */
let familiarCache = { key: '', map: new Map() };
const normName = (s) => norm(s);
export function artistFamiliarity(data) {
  const key = `${known.loadedAt}|${(known.all || []).length}|${data.likedSongs.length}|${data.profile.artists.length}`;
  if (familiarCache.key === key) return familiarCache.map;
  const m = new Map();
  const bump = (name, n = 1) => {
    const k = normName(name);
    if (k) m.set(k, (m.get(k) || 0) + n);
  };
  for (const [artists] of known.all || []) bump(artists[0]);
  for (const s of data.likedSongs) bump(s.artistName);
  for (const a of data.profile.artists) bump(a.name, TUNING.profileArtistSongs);
  familiarCache = { key, map: m };
  return m;
}

/** Discovery adjustment for a track's artist (negative for artists you know well). */
export function familiarityScore(track, data) {
  const n = artistFamiliarity(data).get(normName(track.artistName)) || 0;
  return n ? -TUNING.familiarity * Math.log(1 + n) : TUNING.newArtistBonus;
}

export function scoreTrack(track, data) {
  const w = data.tasteWeights;
  const I = TUNING.importance;
  let score =
    I.genre * (w.genres[track.genre] || 0) +
    I.subGenre * (w.subGenres[track.subGenre] || 0) +
    I.artist * (w.artists[track.artistId] || 0) +
    I.decade * (w.decades[decadeOf(track.year)] || 0);
  if (track.rank) score += TUNING.popularity * Math.min(1, Math.max(0, (Math.log10(track.rank) - 4) / 2));
  if (!track.hasPreview) score += TUNING.noPreviewPenalty;
  score += track.sourceBonus || 0;
  if (track.artistName) score += familiarityScore(track, data);
  return score;
}

/** Predicted match 0..1 (for "near-sure wins"). */
export const predictedMatch = (track, data) => 1 / (1 + Math.exp(-(scoreTrack(track, data) - 2) / 1.5));

/* ------------------------------------------------------------------ */
/* Candidate sources                                                    */
/* ------------------------------------------------------------------ */

const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const pickSome = (arr, n) => shuffle(arr).slice(0, n);
const tag = (tracks, extra) => tracks.map((t) => Object.assign(t, extra));
const withTimeout = (p, ms = 15000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

const artistIdCache = new Map();
/** Deezer artist for a curated entry-point name (cached). */
export function entryArtist(name) {
  if (!artistIdCache.has(name)) {
    const p = ds.findArtistByName(name);
    artistIdCache.set(name, p);
    p.catch(() => artistIdCache.delete(name));
  }
  return artistIdCache.get(name);
}

/** Accessible entry-point tracks for a graph node: top tracks of its curated artists. */
/**
 * Entry-point artist names for a sub-genre (planet) or variation (moon). Curated ones have
 * hand-picked artists; generated ones (from MusicBrainz/Wikidata) get the most-followed Deezer
 * artists among those MusicBrainz tags with that genre (accessible first). Cached per node.
 */
const entryCache = new Map();
export function entryArtistsFor(node) {
  if (node.artists && node.artists.length) return Promise.resolve(node.artists);
  if (!entryCache.has(node.id)) {
    const p = (async () => {
      const names = await ds.searchArtistsByTag(node.tags[0], 12);
      const settled = await Promise.allSettled(names.slice(0, 8).map((n) => entryArtist(n)));
      const found = settled
        .map((r) => (r.status === 'fulfilled' ? r.value : null))
        .filter(Boolean)
        .sort((a, b) => b.fans - a.fans);
      // Prefer well-known artists, but a niche genre may only have small ones.
      const known = found.filter((a) => a.fans >= 1000);
      return (known.length >= 3 ? known : found).slice(0, 5).map((a) => a.name);
    })();
    entryCache.set(node.id, p);
    p.catch(() => entryCache.delete(node.id));
  }
  return entryCache.get(node.id);
}

export async function nodeTracks(node, { artists = 2, perArtist = 5 } = {}) {
  const planet = node.kind === 'moon' ? NODES.get(node.planet) : node;
  const fam = NODES.get(node.family);
  const names = node.kind === 'style' || node.kind === 'moon' ? pickSome(await entryArtistsFor(node), artists) : [];
  const lists = await Promise.allSettled(
    names.map(async (name) => {
      const a = await entryArtist(name);
      if (!a) return [];
      // Only songs where the entry artist is the main artist (not a feature on someone else's hit).
      const top = (await ds.getArtistTopTracks(a.artistId, perArtist + 3)).filter((t) => t.artistId === a.artistId).slice(0, perArtist);
      return tag(top, {
        subGenre: planet.name,
        moon: node.kind === 'moon' ? node.name : undefined,
        genre: fam ? fam.name : null,
        genreId: fam ? fam.deezerId : null,
        nodeId: node.id,
      });
    })
  );
  let out = lists.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (node.kind === 'family' && fam && fam.deezerId) out = pickSome(await ds.getGenreTopTracks(fam.deezerId, 50), 10);
  return out;
}

function likedArtistIds(data) {
  const fromWeights = topWeights(data.tasteWeights.artists, 30, 1).map(([id]) => id);
  return [...new Set([...data.profile.artists.map((a) => a.artistId), ...fromWeights])];
}

function likedGenreIds(data) {
  const ids = new Set(data.profile.likedGenres.map((g) => g.genreId));
  for (const [name, v] of topWeights(data.tasteWeights.genres, 6, TUNING.comfortThreshold)) {
    const f = familyByName(name);
    if (f && v > 0) ids.add(f.deezerId);
  }
  return [...ids];
}

/**
 * Focused swiping (from the Music Map): only songs of one genre or sub-genre.
 * A style: its entry-point artists plus artists related to them. A genre: its chart
 * plus entry artists of a few of its styles.
 */
async function gatherFocused(node) {
  const fam = NODES.get(node.family);
  const jobs = [];
  if (node.kind === 'style' || node.kind === 'moon') {
    const planet = node.kind === 'moon' ? NODES.get(node.planet) : node;
    jobs.push(nodeTracks(node, { artists: 3, perArtist: 8 }));
    for (const name of pickSome(await entryArtistsFor(node), 2)) {
      jobs.push(
        entryArtist(name).then(async (a) => {
          if (!a) return [];
          const rel = await ds.getRelatedArtists(a.artistId, 10);
          const lists = await Promise.allSettled(pickSome(rel, 3).map((r) => ds.getArtistTopTracks(r.artistId, 4)));
          return tag(
            lists.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])),
            { genre: fam.name, genreId: fam.deezerId, subGenre: planet.name, moon: node.kind === 'moon' ? node.name : undefined, nodeId: node.id }
          );
        })
      );
    }
  } else {
    if (node.deezerId) jobs.push(ds.getGenreTopTracks(node.deezerId, 100).then((t) => pickSome(t, 30)));
    for (const style of pickSome(stylesOf(node.id), 3)) jobs.push(nodeTracks(style, { artists: 2, perArtist: 5 }));
  }
  const results = await Promise.allSettled(jobs.map((j) => withTimeout(j)));
  const tracks = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (!tracks.length) {
    const err = results.find((r) => r.status === 'rejected');
    if (err) throw err.reason;
  }
  return tag(tracks, { source: 'focus', focus: node.id });
}

/** Gather a batch of candidate tracks for the main Swipe feed. */
async function gatherCandidates(data, focus) {
  if (focus && NODES.get(focus)) return gatherFocused(NODES.get(focus));
  const few = data.swipes.length < TUNING.fewSwipes;
  const listenAll = data.profile.listenAll;
  const artists = likedArtistIds(data);
  const genres = likedGenreIds(data);
  const jobs = [];

  // Liked genres' charts (genre known).
  for (const gid of pickSome(genres, listenAll ? 2 : 3)) {
    jobs.push(ds.getGenreTopTracks(gid, 100).then((t) => tag(pickSome(t, 15), { source: 'genre', sourceBonus: 0.3 })));
  }
  // Liked artists' top tracks.
  // Your favourite artists' own songs: only a few (you probably know them already).
  for (const id of pickSome(artists, few ? 2 : 1)) {
    jobs.push(ds.getArtistTopTracks(id, 10).then((t) => tag(t, { source: 'artist', sourceBonus: 0 })));
  }
  // Related artists of liked artists.
  // Artists related to the ones you like: the main discovery source.
  for (const id of pickSome(artists, 3)) {
    jobs.push(
      ds.getRelatedArtists(id, 12).then(async (rel) => {
        const lists = await Promise.allSettled(pickSome(rel, 4).map((r) => ds.getArtistTopTracks(r.artistId, 5)));
        const src = data.profile.artists.find((a) => a.artistId === id);
        return tag(
          lists.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])),
          { source: 'related', sourceBonus: 0.9, bridgeArtist: src ? src.name : null }
        );
      })
    );
  }
  // Similar tracks: radio of artists from recent likes.
  const recentLikes = data.likedSongs.slice(-20);
  for (const s of pickSome(recentLikes, 2)) {
    if (s.artistId) jobs.push(ds.getArtistRadio(s.artistId, 25).then((t) => tag(t, { source: 'similar', sourceBonus: 0.3 })));
  }
  // Liked sub-genres → curated entry artists.
  const subs = topWeights(data.tasteWeights.subGenres, 6, 1).map(([name]) => allStyles().find((n) => n.name === name)).filter(Boolean);
  // Other artists of your liked sub-genres (curated entry-point artists).
  for (const node of pickSome(subs, 3)) jobs.push(nodeTracks(node).then((t) => tag(t, { source: 'subgenre', sourceBonus: 0.6 })));
  // Cold start with nothing liked: popular across genres.
  if (!genres.length && !artists.length) {
    for (const gid of pickSome([132, 152, 116, 106, 165, 85, 113, 129, 169, 466, 197, 144], 4)) {
      jobs.push(ds.getGenreTopTracks(gid, 60).then((t) => tag(pickSome(t, 12), { source: 'popular' })));
    }
  }
  // Exploration share: nearby genres outside the comfort zone.
  const rate = listenAll ? TUNING.exploreRateListenAll : TUNING.exploreRate;
  const maxLevel = few ? 1 : listenAll ? 3 : 2;
  for (const node of pickExploreNodes(data, rate >= 0.3 ? 3 : 2, maxLevel)) {
    jobs.push(nodeTracks(node, { artists: 2, perArtist: 4 }).then((t) => tag(t, { source: 'explore', explore: true })));
  }

  const results = await Promise.allSettled(jobs.map((j) => withTimeout(j)));
  const tracks = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (!tracks.length && results.length) {
    const firstErr = results.find((r) => r.status === 'rejected');
    if (firstErr) throw firstErr.reason;
  }
  return tracks;
}

/** Random style nodes at proximity level 1..maxLevel, avoiding disliked families. */
export function pickExploreNodes(data, n, maxLevel = 2, minLevel = 1) {
  const fams = dislikedFamilies(data);
  const styles = dislikedStyles(data);
  const dist = comfortDistances(data);
  const pool = [];
  for (const node of NODES.values()) {
    if (node.kind !== 'style' || fams.has(node.family) || styles.has(node.id) || NODES.get(node.family)?.noExplore) continue;
    const d = dist.get(node.id);
    const level = !d ? 3 : Math.min(3, d.dist);
    if (level >= minLevel && level <= maxLevel) pool.push(node);
  }
  return pickSome(pool, n);
}

/* ------------------------------------------------------------------ */
/* Feed                                                                 */
/* ------------------------------------------------------------------ */

/**
 * The Swipe feed: a queue of scored, filtered tracks, refilled in the background.
 * One instance lives for the whole session so switching tabs doesn't refetch.
 */
export class Feed {
  constructor(getData) {
    this.getData = getData;
    this.queue = [];
    this.pool = [];
    this.loading = null;
    this.recentArtists = [];
    this.excluded = new Set(); // shown in this session but not swiped yet / dropped
    this.focus = null; // a genre/sub-genre id when swiping from the Music Map
  }

  /** Swipe only one genre or sub-genre (null = back to the normal mix). */
  setFocus(id) {
    if ((id || null) === this.focus) return false;
    this.focus = id || null;
    this.reset();
    return true;
  }

  reset() {
    this.queue = [];
    this.pool = [];
    this.recentArtists = [];
    this.excluded.clear();
  }

  filterPool(data) {
    const seen = seenSets(data);
    const inQueue = new Set(this.queue.map((t) => t.trackId));
    const queueKeys = new Set(this.queue.map(songKey));
    const keys = new Set();
    this.pool = this.pool.filter((t) => {
      const k = songKey(t);
      if (seen.has(t) || inQueue.has(t.trackId) || queueKeys.has(k) || keys.has(k) || this.excluded.has(t.trackId)) return false;
      if (t.genre && !this.focus && isDislikedGenre(t, data)) return false; // you chose the genre on the map
      keys.add(k);
      return true;
    });
  }

  async refill() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const data = this.getData();
      const fresh = await gatherCandidates(data, this.focus);
      const ids = new Set(this.pool.map((t) => t.trackId));
      for (const t of fresh) if (!ids.has(t.trackId)) this.pool.push(t), ids.add(t.trackId);
      this.filterPool(data);
    })().finally(() => (this.loading = null));
    return this.loading;
  }

  /** Pick the next track from the pool: ~80% best matches, ~20% exploration, varied artists. */
  pickNext(data) {
    if (!this.pool.length) return null;
    const rate = data.profile.listenAll ? TUNING.exploreRateListenAll : TUNING.exploreRate;
    const wantExplore = Math.random() < rate;
    const recent = new Set(this.recentArtists.slice(-TUNING.artistCooldown));
    const fatigue = {};
    for (const id of this.recentArtists.slice(-20)) fatigue[id] = (fatigue[id] || 0) + 1;
    const scoreOf = (t) => scoreTrack(t, data) - TUNING.artistFatigue * (fatigue[t.artistId] || 0) + Math.random() * TUNING.jitter;
    const scored = this.pool.filter((t) => !recent.has(t.artistId)).map((t) => ({ t, s: scoreOf(t) }));
    const list = scored.length ? scored : this.pool.map((t) => ({ t, s: scoreOf(t) }));
    let candidates = list.filter(({ t }) => !!t.explore === wantExplore);
    if (!candidates.length) candidates = list;
    candidates.sort((a, b) => b.s - a.s);
    const chosen = candidates[0].t;
    this.pool.splice(this.pool.indexOf(chosen), 1);
    this.recentArtists.push(chosen.artistId);
    return chosen;
  }

  /** Make sure at least `n` tracks are queued and enriched (genre, year, preview). */
  async ensure(n = 5) {
    await knownReady();
    const data = this.getData();
    // The library may have been (re)loaded since these were queued: drop known songs (not the visible card).
    this.queue = this.queue.filter((t, i) => i === 0 || !isKnownSong(t));
    let attempts = 0;
    while (this.queue.length < n && attempts < 4) {
      if (this.pool.length < n * 2) {
        try {
          await this.refill();
        } catch (err) {
          if (!this.queue.length && !this.pool.length) throw err;
        }
        attempts++;
      }
      this.filterPool(data);
      if (!this.pool.length) {
        if (attempts >= 4) break;
        continue;
      }
      const t = this.pickNext(data);
      if (!t) break;
      await ds.enrichGenre(t).catch(() => {});
      if ((!this.focus && isDislikedGenre(t, data)) || seenSets(data).has(t)) continue;
      this.queue.push(t);
    }
    return this.queue;
  }

  /** Remove a track from the head of the queue (after a swipe). */
  remove(trackId) {
    this.queue = this.queue.filter((t) => t.trackId !== trackId);
  }

  /** Put a track back at the front (Undo). */
  unshift(track) {
    this.queue.unshift(track);
  }
}
