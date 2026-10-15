/**
 * deezerImport — import Deezer playlists and profiles from a pasted link, no login.
 *
 * Deezer's public API reads any public playlist, a profile's public playlists and its
 * public favourite tracks. Imported songs keep their Deezer track id and ISRC, so they
 * match exactly (no fuzzy title matching). Stored in data.deezerImports:
 *   { key, kind: 'playlist'|'profile', id, name, picture, link, importedAt, playlists, tracks }
 * with tracks as [deezerTrackId, title, artistName, isrc|null, 'saved'|'playlist'].
 */

import * as ds from './dataService.js';
import { isStandalone } from './mode.js';

const PAGE = 100;
const MAX_PAGES = 100; // 10,000 songs per list is plenty

export const SHORT_LINK_HELP =
  'Short Deezer links can’t be opened from here. In Deezer, tap Share → Copy link, open that link in your browser, then copy the full address (deezer.com/…/playlist/… or …/profile/…) and paste it here.';

/**
 * Find Deezer links in pasted text. Returns [{ kind: 'playlist'|'profile', id } | { kind: 'short', url }],
 * plus `bad` for words that look like links but aren't Deezer playlists or profiles.
 */
export function parseDeezerLinks(text) {
  const found = [];
  const bad = [];
  const seen = new Set();
  for (const raw of String(text || '').split(/[\s,;]+/).filter(Boolean)) {
    const word = raw.replace(/^<|>$/g, '');
    let m = word.match(/deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(playlist|profile)\/(\d+)/i);
    let item = m ? { kind: m[1].toLowerCase(), id: m[2] } : null;
    if (!item && /^(https?:\/\/)?(link\.deezer\.com|deezer\.page\.link|dzr\.page\.link)\//i.test(word)) item = { kind: 'short', url: word.startsWith('http') ? word : 'https://' + word };
    if (!item) {
      if (/deezer|https?:\/\//i.test(word)) bad.push(word);
      continue;
    }
    const k = item.kind + ':' + (item.id || item.url);
    if (seen.has(k)) continue;
    seen.add(k);
    found.push(item);
  }
  return { found, bad };
}

/** A short share link (link.deezer.com/…) → its full deezer.com link (PC server only). */
async function resolveShort(url) {
  if (isStandalone()) throw new Error(SHORT_LINK_HELP);
  const res = await fetch('api/deezer-link?u=' + encodeURIComponent(url)).catch(() => null);
  const body = res && (await res.json().catch(() => null));
  const item = body && body.url && parseDeezerLinks(body.url).found.find((x) => x.kind !== 'short');
  if (!item) throw new Error(SHORT_LINK_HELP);
  return item;
}

/** Every page of a Deezer list (index/limit pagination). */
async function all(path) {
  const out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await ds.deezerGet(`${path}${path.includes('?') ? '&' : '?'}index=${page * PAGE}&limit=${PAGE}`);
    const rows = (body && body.data) || [];
    out.push(...rows);
    if (rows.length < PAGE || !body.next) break;
  }
  return out;
}

const row = (t, source) => [t.id, t.title, t.artist ? t.artist.name : '', t.isrc || null, source];

/** Explain Deezer's "no data" for something that exists but isn't public. */
function privateError(err, what) {
  if (err && err.status === 404) return new Error(`This ${what} is private or doesn’t exist. Make it public in Deezer and try again.`);
  return err;
}

async function fetchPlaylist(id) {
  const pl = await ds.deezerGet(`/playlist/${id}`).catch((err) => {
    throw privateError(err, 'playlist');
  });
  const tracks = (await all(`/playlist/${id}/tracks`)).map((t) => row(t, 'playlist'));
  return { key: `playlist:${id}`, kind: 'playlist', id, name: pl.title, picture: pl.picture_medium || null, link: pl.link, playlists: 1, tracks };
}

async function fetchProfile(id) {
  const user = await ds.deezerGet(`/user/${id}`).catch((err) => {
    throw privateError(err, 'profile');
  });
  const lists = await all(`/user/${id}/playlists`);
  const tracks = [];
  let note = null;
  try {
    tracks.push(...(await all(`/user/${id}/tracks`)).map((t) => row(t, 'saved')));
  } catch {
    note = 'Favourite tracks are private: make your profile public in Deezer to include them.';
  }
  for (const pl of lists) {
    if (pl.is_loved_track) continue; // "Loved tracks" = the favourites above
    try {
      tracks.push(...(await all(`/playlist/${pl.id}/tracks`)).map((t) => row(t, 'playlist')));
    } catch {
      /* one unreadable playlist doesn't stop the rest */
    }
  }
  const byId = new Map();
  for (const t of tracks) if (!byId.has(t[0]) || t[4] === 'saved') byId.set(t[0], t); // favourite wins
  return { key: `profile:${id}`, kind: 'profile', id, name: user.name, picture: user.picture_medium || null, link: user.link, playlists: lists.filter((p) => !p.is_loved_track).length, tracks: [...byId.values()], note };
}

/** Fetch one parsed link (playlist, profile, or short link) as an import entry. */
export async function fetchImport(item) {
  if (item.kind === 'short') item = await resolveShort(item.url);
  const entry = item.kind === 'playlist' ? await fetchPlaylist(item.id) : await fetchProfile(item.id);
  return { ...entry, importedAt: Date.now() };
}

/** Totals for "3 playlists · 412 songs · 180 artists". */
export function deezerTotals(imports) {
  const songs = new Set();
  const artists = new Set();
  let playlists = 0;
  for (const e of imports || []) {
    playlists += e.playlists || 0;
    for (const t of e.tracks) {
      songs.add(t[0]);
      artists.add(String(t[2]).toLowerCase());
    }
  }
  return { playlists, songs: songs.size, artists: artists.size };
}

/** Library rows like the Spotify ones: [[artist], title, isrc, source, genres, deezerTrackId]. */
export function deezerLibraryRows(imports) {
  const rows = [];
  for (const e of imports || []) for (const [id, title, artist, isrc, source] of e.tracks) rows.push([[artist], title, isrc, source, null, id]);
  return rows;
}
