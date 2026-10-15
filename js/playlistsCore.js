/**
 * playlistsCore — "Decks" (formerly playlists) are DERIVED from likedSongs +
 * playlistSettings, never stored on their own. The code keeps the old "playlist"
 * names internally (and js/deck.js is the swipe card stack, unrelated).
 *
 *   - one playlist per primary genre (see library.primaryGenre); unknown -> "Unsorted"
 *   - songs moved by hand keep their chosen playlist (playlistSettings.overrides)
 *   - "Group by sub-genre" splits playlists with 10+ songs by sub-genre
 *   - playlists with fewer than minSongsPerPlaylist songs go to "Other / Just starting"
 *   - two special playlists: "All my likes" and "Blind Spot discoveries"
 */

import { primaryGenre } from './library.js';

export const OTHER = 'Other / Just starting';
export const SPLIT_AT = 10;
const SEP = ' · ';

export const ALL_KEY = '__all';
export const BLINDSPOT_KEY = '__blindspot';

const newestFirst = (a, b) => (b.likedAt || 0) - (a.likedAt || 0);

/**
 * Newest first, unless you reordered the deck by hand (playlistSettings.order[key]);
 * songs added since then come first, then your order.
 */
function orderSongs(key, songs, settings) {
  const sorted = songs.slice().sort(newestFirst);
  const custom = settings.order && settings.order[key];
  if (!custom || !custom.length) return sorted;
  const pos = new Map(custom.map((id, i) => [id, i]));
  const fresh = sorted.filter((s) => !pos.has(s.trackId));
  const ordered = sorted.filter((s) => pos.has(s.trackId)).sort((a, b) => pos.get(a.trackId) - pos.get(b.trackId));
  return [...fresh, ...ordered];
}

function makePlaylist(key, songs, settings, extra = {}) {
  const sorted = orderSongs(key, songs, settings);
  const covers = [];
  for (const s of sorted) {
    const c = s.coverSmall || s.coverUrl;
    if (c && !covers.includes(c)) covers.push(c);
    if (covers.length === 4) break;
  }
  return {
    key,
    name: settings.customNames[key] || extra.name || key,
    songs: sorted,
    count: sorted.length,
    covers,
    lastAdded: sorted[0] ? sorted[0].likedAt : 0,
    hidden: settings.hiddenGenres.includes(key),
    ...extra,
  };
}

/** Key of the genre playlist a song belongs to (before small-playlist grouping). */
export function baseKey(song, data) {
  return data.playlistSettings.overrides[song.trackId] || primaryGenre(song, data);
}

/**
 * All playlists, derived.
 * @returns {{ special: object[], genres: object[], hidden: object[] }}
 */
export function derivePlaylists(data) {
  const settings = data.playlistSettings;
  const songs = data.likedSongs;
  const min = settings.minSongsPerPlaylist || 3;

  // 1. Group by genre (or manual override).
  const groups = new Map();
  for (const s of songs) {
    const k = baseKey(s, data);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }

  // 2. Optionally split big genres by sub-genre (manually moved songs stay put).
  //    Only sub-genres big enough to be a playlist are split out; the rest stay in the genre.
  const splitParents = new Set(); // genres that were split: their leftovers stay, however few
  if (settings.groupBySubGenre) {
    for (const [k, list] of [...groups]) {
      if (list.length < SPLIT_AT || k.includes(SEP)) continue;
      const bySub = new Map();
      for (const s of list) {
        if (!s.subGenre || settings.overrides[s.trackId]) continue;
        if (!bySub.has(s.subGenre)) bySub.set(s.subGenre, []);
        bySub.get(s.subGenre).push(s);
      }
      const rest = new Set(list);
      for (const [sub, subList] of bySub) {
        if (subList.length < min) continue;
        groups.set(k + SEP + sub, subList);
        subList.forEach((s) => rest.delete(s));
      }
      if (rest.size) groups.set(k, [...rest]);
      else groups.delete(k);
      if (rest.size < list.length) splitParents.add(k);
    }
  }

  // 3. Small playlists go to "Other / Just starting" (unless they were hand-picked).
  const other = [];
  const genres = [];
  for (const [k, list] of groups) {
    const handPicked = list.some((s) => settings.overrides[s.trackId] === k);
    if (list.length < min && k !== OTHER && !handPicked && !splitParents.has(k)) other.push(...list);
    else genres.push(makePlaylist(k, list, settings));
  }
  if (other.length) {
    const existing = genres.find((p) => p.key === OTHER);
    if (existing) Object.assign(existing, makePlaylist(OTHER, existing.songs.concat(other), settings));
    else genres.push(makePlaylist(OTHER, other, settings, { isOther: true }));
  }

  const special = [
    makePlaylist(ALL_KEY, songs, settings, { name: 'All my likes', special: true }),
    makePlaylist(
      BLINDSPOT_KEY,
      songs.filter((s) => s.source === 'blindspot'),
      settings,
      { name: 'Blind Spot discoveries', special: true, compass: true }
    ),
  ];
  return {
    special,
    genres: genres.filter((p) => !p.hidden),
    hidden: genres.filter((p) => p.hidden),
  };
}

export function sortPlaylists(list, sortBy) {
  const l = list.slice();
  const otherLast = (a, b) => (a.key === OTHER) - (b.key === OTHER);
  if (sortBy === 'recent') l.sort((a, b) => otherLast(a, b) || b.lastAdded - a.lastAdded);
  else if (sortBy === 'az') l.sort((a, b) => otherLast(a, b) || a.name.localeCompare(b.name));
  else l.sort((a, b) => otherLast(a, b) || b.count - a.count || a.name.localeCompare(b.name));
  return l;
}

export function findPlaylist(data, key) {
  const all = derivePlaylists(data);
  return [...all.special, ...all.genres, ...all.hidden].find((p) => p.key === key) || null;
}

/** Genre playlist keys a song can be moved to (existing ones + its own genres). */
export function moveTargets(data, song) {
  const keys = new Set(data.likedSongs.map((s) => baseKey(s, data)));
  for (const g of [song.genre, ...(song.genres || [])]) if (g) keys.add(g);
  keys.delete(baseKey(song, data));
  return [...keys].sort((a, b) => a.localeCompare(b));
}

/* ------------------------------------------------------------------ */
/* Export                                                               */
/* ------------------------------------------------------------------ */

export const asText = (songs) => songs.map((s) => `${s.title} - ${s.artistName}`).join('\n');

export function asCsv(songs) {
  const cols = ['title', 'artist', 'album', 'year', 'genre', 'subGenre', 'source', 'likedAt', 'deezer', 'spotify', 'apple', 'youtube'];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = songs.map((s) => [
    s.title,
    s.artistName,
    s.albumTitle,
    s.year,
    s.genre,
    s.subGenre,
    s.source,
    s.likedAt ? new Date(s.likedAt).toISOString() : '',
    s.listenLinks?.deezer,
    s.listenLinks?.spotify,
    s.listenLinks?.apple,
    s.listenLinks?.youtube,
  ]);
  return [cols, ...rows].map((r) => r.map(esc).join(',')).join('\n');
}

export function asJson(name, songs) {
  return JSON.stringify(
    {
      playlist: name,
      exportedAt: new Date().toISOString(),
      songs: songs.map((s) => ({
        title: s.title,
        artist: s.artistName,
        album: s.albumTitle,
        year: s.year,
        genre: s.genre,
        subGenre: s.subGenre,
        links: s.listenLinks,
      })),
    },
    null,
    2
  );
}
