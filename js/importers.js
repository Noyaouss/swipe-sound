/**
 * importers — read a music library from files, in the browser (no account link needed).
 *
 * Supported (drop the downloaded file as-is, .zip included):
 *   - Exportify (exportify.app) CSV exports, in any language
 *   - Spotify "Download your data": YourLibrary.json, StreamingHistory*.json,
 *     Streaming_History_Audio_*.json (extended history), Playlist*.json
 *
 * Output: [[artists[], title, isrc|null, source, genres?]] with source 'saved' | 'playlist' | 'recent'
 * (the same compact shape as the server's Spotify sync). `genres` (Spotify's artist genres)
 * is only there when Exportify's "Include artists data" option was on; it lets the Music
 * Map sort your library instantly.
 */

/* ------------------------------------------------------------------ */
/* ZIP (stored or deflate), using the browser's DecompressionStream      */
/* ------------------------------------------------------------------ */

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** List the files of a .zip: [{ name, bytes }]. */
export async function unzip(buffer) {
  const data = new Uint8Array(buffer);
  const view = new DataView(buffer);
  // Find the End Of Central Directory record (scan backwards).
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This .zip file looks damaged.');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const files = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(data.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = data.subarray(start, start + compSize);
    if (method === 0) files.push({ name, bytes: raw });
    else if (method === 8) files.push({ name, bytes: await inflateRaw(raw) });
  }
  return files;
}

/* ------------------------------------------------------------------ */
/* CSV                                                                  */
/* ------------------------------------------------------------------ */

/** RFC 4180 CSV parser (quotes, doubled quotes, newlines inside quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') (field += '"'), i++;
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') row.push(field), (field = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows.filter((r) => r.length > 1 || r[0]);
}

const LIKED_NAME = /liked|lik[ée]s|favori|gefällt|me gusta|preferit|curtid/i;

/** "Artist Genres" in every language Exportify is translated into. */
const ARTIST_GENRES_HEADERS = new Set(
  ['Artist Genres', "Genres de l'artiste", 'Künstler-Genres', 'Géneros del artista', "Generi dell'artista", 'Genres van de artiest', 'Gêneros do artista', 'Artistens genrer', 'Sanatçı Türleri', 'アーティストジャンル', 'أنواع الفنان', 'Είδη καλλιτέχνη'].map((x) => x.toLowerCase())
);

/**
 * Exportify CSV. Headers are translated into the browser's language, so columns
 * are found by position from the "spotify:track:" URI column (Track URI, Track Name,
 * Artist URI(s), Artist Name(s), …), and ISRC by its header (same in every language).
 */
export function parseExportifyCsv(text, fileName = '') {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (rows.length < 2) return [];
  const header = rows[0];
  const sample = rows.slice(1, 30);
  let uriCol = header.findIndex((_, i) => sample.some((r) => /^spotify:(track|local):/.test(r[i] || '')));
  if (uriCol < 0) uriCol = 0;
  const isrcCol = header.findIndex((h) => h.trim().toUpperCase() === 'ISRC');
  const genresCol = header.findIndex((h) => ARTIST_GENRES_HEADERS.has(h.trim().toLowerCase()));
  const source = LIKED_NAME.test(fileName) ? 'saved' : 'playlist';
  const out = [];
  for (const r of rows.slice(1)) {
    const title = (r[uriCol + 1] || '').trim();
    const artists = (r[uriCol + 3] || '')
      .split(/(?<!\\), /)
      .map((a) => a.replace(/\\,/g, ',').trim())
      .filter(Boolean);
    if (!title || !artists.length) continue;
    const isrc = isrcCol >= 0 && r[isrcCol] ? r[isrcCol].trim() : null;
    const genres = genresCol >= 0 && r[genresCol] ? [...new Set(r[genresCol].split(',').map((g) => g.trim().toLowerCase()).filter(Boolean))] : null;
    out.push(genres && genres.length ? [artists, title, isrc, source, genres] : [artists, title, isrc, source]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Spotify "Download your data" JSON                                    */
/* ------------------------------------------------------------------ */

const MIN_PLAY_MS = 30000; // a stream shorter than 30 s doesn't mean you know the song

export function parseSpotifyJson(json, fileName = '') {
  const out = [];
  const base = fileName.split('/').pop();
  if (json && Array.isArray(json.tracks)) {
    // YourLibrary.json
    for (const t of json.tracks) if (t.track && t.artist) out.push([[t.artist], t.track, null, 'saved']);
  }
  if (json && Array.isArray(json.playlists)) {
    // Playlist1.json
    for (const pl of json.playlists) {
      for (const it of pl.items || []) {
        const t = it.track;
        if (t && t.trackName && t.artistName) out.push([[t.artistName], t.trackName, null, 'playlist']);
      }
    }
  }
  if (Array.isArray(json)) {
    for (const s of json) {
      // StreamingHistory_music_*.json
      if (s.trackName && s.artistName && (s.msPlayed || 0) >= MIN_PLAY_MS) out.push([[s.artistName], s.trackName, null, 'recent']);
      // Streaming_History_Audio_*.json (extended history)
      else if (s.master_metadata_track_name && s.master_metadata_album_artist_name && (s.ms_played || 0) >= MIN_PLAY_MS) {
        out.push([[s.master_metadata_album_artist_name], s.master_metadata_track_name, null, 'recent']);
      }
    }
  }
  if (!out.length && /StreamingHistory|Streaming_History/i.test(base)) return [];
  return out;
}

/**
 * Every play in a Spotify listening-history file, for play counts (Games):
 * [[artist, title, minute (end time, minutes since 1970), msPlayed]]. Plays under 30 s don't count.
 * StreamingHistory_music_*.json has "endTime": "2023-05-01 13:45" (UTC); the extended
 * Streaming_History_Audio_*.json has "ts": "2023-05-01T13:45:12Z". Both are cut to the minute
 * so the same play found in both files is counted once.
 */
export function parseStreams(json) {
  const out = [];
  if (!Array.isArray(json)) return out;
  const minute = (iso) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? Math.floor(t / 60000) : null;
  };
  for (const s of json) {
    if (s.trackName && s.artistName && (s.msPlayed || 0) >= MIN_PLAY_MS) {
      const m = minute(String(s.endTime || '').replace(' ', 'T') + 'Z');
      if (m) out.push([s.artistName, s.trackName, m, s.msPlayed]);
    } else if (s.master_metadata_track_name && s.master_metadata_album_artist_name && (s.ms_played || 0) >= MIN_PLAY_MS) {
      const m = minute(s.ts);
      if (m) out.push([s.master_metadata_album_artist_name, s.master_metadata_track_name, m, s.ms_played]);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                          */
/* ------------------------------------------------------------------ */

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/**
 * Read files picked by the user. Returns { tracks, files: [{ name, count }], skipped: [names],
 * stats: { liked, playlists, artists, plays } (what was found, shown after the import),
 * streams: every play in the listening history (see parseStreams) }.
 */
export async function importFiles(fileList) {
  const decoder = new TextDecoder();
  const entries = [];
  for (const f of fileList) {
    const buf = await f.arrayBuffer();
    if (/\.zip$/i.test(f.name)) entries.push(...(await unzip(buf)).map((e) => ({ name: e.name, text: () => decoder.decode(e.bytes) })));
    else entries.push({ name: f.name, text: () => decoder.decode(new Uint8Array(buf)) });
  }
  const byKey = new Map();
  const files = [];
  const skipped = [];
  let playlists = 0;
  let plays = 0;
  const streams = [];
  for (const e of entries) {
    let tracks = [];
    try {
      if (/\.csv$/i.test(e.name)) {
        tracks = parseExportifyCsv(e.text(), e.name);
        if (tracks.length && tracks[0][3] === 'playlist') playlists++; // one Exportify CSV per playlist
      } else if (/\.json$/i.test(e.name)) {
        const json = JSON.parse(e.text());
        tracks = parseSpotifyJson(json, e.name);
        if (json && Array.isArray(json.playlists)) playlists += json.playlists.length;
        for (const s of parseStreams(json)) streams.push(s);
      }
    } catch {
      tracks = [];
    }
    if (!tracks.length) {
      if (/\.(csv|json)$/i.test(e.name)) skipped.push(e.name);
      continue;
    }
    files.push({ name: e.name.split('/').pop(), count: tracks.length });
    for (const t of tracks) {
      if (t[3] === 'recent') plays++; // one row per stream of 30 s or more
      const k = t[2] || `${norm(t[0][0])}|${norm(t[1])}`;
      const prev = byKey.get(k);
      if (!prev) byKey.set(k, t);
      else {
        if (t[3] === 'saved') prev[3] = 'saved'; // "liked" wins over "in a playlist"
        if (!prev[4] && t[4]) prev[4] = t[4];
      }
    }
  }
  const all = [...byKey.values()];
  const stats = {
    liked: all.filter((t) => t[3] === 'saved').length,
    playlists,
    artists: new Set(all.map((t) => norm(t[0][0]))).size,
    plays,
  };
  return { tracks: all, files, skipped, stats, streams };
}
