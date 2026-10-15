/**
 * library — liked songs and swipe recording, shared by Swipe, Blind Spot and Playlists.
 */

import { storage } from './storage.js';
import { recomputeWeights } from './recommender.js';
import { knownOffset } from './audio.js';
import { nodeByName, placeTrack, NODES } from './genreGraph.js';
import { listenLinks, enrichSubGenre } from './dataService.js';
import { confirmDialog } from './ui.js';

export const UNSORTED = 'Unsorted';

/**
 * A song's primary genre: among its genres (the album may list several), the one
 * with the best taste weight; ties keep the album's order. Unknown -> "Unsorted".
 */
export function primaryGenre(song, data = storage.data) {
  const placed = placeTrack(song);
  if (placed.style) return NODES.get(placed.family).name; // the sun its sub-genre orbits (as on the Music Map)
  const options = [...new Set([song.genre, ...(song.genres || [])].filter(Boolean))];
  if (!options.length) return UNSORTED;
  const w = data.tasteWeights.genres;
  let best = options[0];
  for (const g of options) if ((w[g] || 0) > (w[best] || 0)) best = g;
  return best;
}

/** The snapshot of a track stored in likedSongs. */
export function toLikedSong(track, source) {
  const offset = knownOffset(track);
  return {
    trackId: track.trackId,
    title: track.title,
    artistId: track.artistId,
    artistName: track.artistName,
    albumId: track.albumId || null,
    albumTitle: track.albumTitle || '',
    genre: track.genre || null,
    genres: track.genres || (track.genre ? [track.genre] : []),
    subGenre: track.subGenre || null,
    moon: track.moon || null, // variation of the sub-genre, if known (Music Map moon)
    year: track.year || null,
    coverUrl: track.coverUrl || '',
    coverSmall: track.coverSmall || track.coverUrl || '',
    previewUrl: track.previewUrl || '',
    previewSource: track.previewSource || (track.hasPreview ? 'deezer' : null),
    hasPreview: !!track.hasPreview,
    previewStartOffset: offset == null ? null : offset,
    listenLinks: track.listenLinks || listenLinks(track),
    link: track.link || '',
    source,
    likedAt: Date.now(),
  };
}

/** Rebuild a playable track object from a liked song. */
export function songAsTrack(song) {
  const audioSrc =
    song.previewSource === 'itunes' && song.previewUrl
      ? `api/audio/url?u=${encodeURIComponent(song.previewUrl)}`
      : song.hasPreview || song.previewUrl
        ? `api/audio/deezer/${song.trackId}`
        : '';
  return { ...song, audioSrc, hasPreview: !!audioSrc };
}

function swipeRecord(track, liked) {
  return {
    trackId: track.trackId,
    artistId: track.artistId,
    artistName: track.artistName,
    title: track.title,
    genre: track.genre || null,
    subGenre: track.subGenre || null,
    year: track.year || null,
    liked,
    timestamp: Date.now(),
  };
}

/** Like or dislike from the Swipe page. Returns the playlist genre for a like. */
export async function recordSwipe(track, liked) {
  const already = storage.data.likedSongs.some((s) => s.trackId === track.trackId);
  let removeLike = false;
  if (!liked && already) {
    removeLike = await confirmDialog('Remove from your deck?', `You had liked “${track.title}”.`, 'Remove');
  }
  let genre = null;
  storage.update((d) => {
    d.swipes.push(swipeRecord(track, liked));
    if (liked && !already) {
      d.likedSongs.push(toLikedSong(track, 'swipe'));
    } else if (removeLike) {
      d.likedSongs = d.likedSongs.filter((s) => s.trackId !== track.trackId);
    }
    recomputeWeights(d);
    if (liked) genre = playlistNameFor(d.likedSongs.find((s) => s.trackId === track.trackId) || track, d);
  }, 'swipe');
  return genre;
}

/** Undo the most recent Swipe-page swipe of this track. */
export function undoSwipe(trackId) {
  storage.update((d) => {
    for (let i = d.swipes.length - 1; i >= 0; i--) {
      if (d.swipes[i].trackId === trackId) {
        const [s] = d.swipes.splice(i, 1);
        if (s.liked) {
          const idx = d.likedSongs.findIndex((x) => x.trackId === trackId && x.source === 'swipe' && x.likedAt >= s.timestamp - 5000);
          if (idx >= 0) d.likedSongs.splice(idx, 1);
        }
        break;
      }
    }
    recomputeWeights(d);
  }, 'undo');
}

/** Blind Spot swipe: like / dislike / skip ("Not for now"). */
export function recordBlindSpotSwipe(track, { liked = false, skipped = false, level, bridgeReason }) {
  let genre = null;
  storage.update((d) => {
    d.blindSpotSwipes.push({
      ...swipeRecord(track, liked),
      level,
      skipped,
      bridgeReason: bridgeReason || null,
    });
    if (liked && !d.likedSongs.some((s) => s.trackId === track.trackId)) {
      d.likedSongs.push(toLikedSong(track, 'blindspot'));
    }
    recomputeWeights(d);
    if (liked) genre = playlistNameFor(d.likedSongs.find((s) => s.trackId === track.trackId), d);
  }, 'blindspot');
  return genre;
}

export function undoBlindSpotSwipe(trackId) {
  let removed = null;
  storage.update((d) => {
    for (let i = d.blindSpotSwipes.length - 1; i >= 0; i--) {
      if (d.blindSpotSwipes[i].trackId === trackId) {
        [removed] = d.blindSpotSwipes.splice(i, 1);
        if (removed.liked) d.likedSongs = d.likedSongs.filter((x) => !(x.trackId === trackId && x.source === 'blindspot'));
        break;
      }
    }
    recomputeWeights(d);
  }, 'undo');
  return removed;
}

export function removeLike(trackId) {
  storage.update((d) => {
    d.likedSongs = d.likedSongs.filter((s) => s.trackId !== trackId);
    delete d.playlistSettings.overrides[trackId];
    recomputeWeights(d);
  }, 'unlike');
}

/** Display name of the deck (playlist) a liked song lands in (respects manual moves and renames). */
export function playlistNameFor(song, data = storage.data) {
  const key = data.playlistSettings.overrides[song.trackId] || primaryGenre(song, data);
  return data.playlistSettings.customNames[key] || key;
}

export const subGenreLabel = (song) => (song.subGenre && nodeByName(song.subGenre) ? song.subGenre : null);

/**
 * Re-sort liked songs whose sub-genre was removed in the V2 clean-up (flag needsRetag):
 * look at the artist's tags again and pick a real sub-genre, or leave just the genre.
 * Runs quietly in the background; MusicBrainz answers are cached, so it's quick.
 */
export async function retagSongs() {
  const todo = storage.data.likedSongs.filter((s) => s.needsRetag);
  for (const song of todo) {
    const probe = { artistName: song.artistName, genre: song.genre, subGenre: null };
    await enrichSubGenre(probe).catch(() => {});
    storage.update((d) => {
      const s = d.likedSongs.find((x) => x.trackId === song.trackId);
      if (!s) return;
      s.subGenre = probe.subGenre || null;
      delete s.needsRetag;
    }, 'retag');
  }
  return todo.length;
}
