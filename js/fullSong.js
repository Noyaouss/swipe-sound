/**
 * fullSong — play the whole song in an official embedded player, no login in Swipe Sound:
 *  - the Spotify embed (iFrame API): the full song when you're logged in to Spotify
 *    (Premium) in this browser, otherwise a 30 s preview, which we detect and offer YouTube;
 *  - the YouTube embed on iPhone/iPad (Safari only gets previews from Spotify's embed),
 *    or when the song has no Spotify link. Visible, at least 200×200, nothing on top of it.
 * Song ids come from MusicBrainz by ISRC (Odesli closed its public API in 2026). Looked up only
 * when you ask for a full song, and cached for good on this device. One player at a time.
 */

import * as ds from './dataService.js';
import { h, icon, spinner } from './ui.js';

const KEY = 'swipe-sound:full-song-ids';
const PREVIEW_MS = 31000; // the Spotify embed plays 30 s clips when you aren't logged in

let cache = {};
try {
  cache = JSON.parse(localStorage.getItem(KEY)) || {};
} catch {
  /* private mode: lookups just aren't remembered */
}
function remember(trackId, ids) {
  cache[trackId] = ids;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage full or blocked: fine */
  }
}

export const isAppleMobile = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const SPOTIFY = /open\.spotify\.com\/track\/([A-Za-z0-9]{22})/;
const YOUTUBE = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/;

/** Spotify and YouTube ids in a list of links (first match of each). */
export function idsFromLinks(links) {
  const pick = (re) => {
    for (const u of links) {
      const m = String(u).match(re);
      if (m) return m[1];
    }
    return null;
  };
  return { spotify: pick(SPOTIFY), youtube: pick(YOUTUBE) };
}

/** { spotify, youtube } ids for a Deezer track (null when MusicBrainz doesn't know). Errors aren't cached. */
export async function findIds(track) {
  const key = String(track.trackId);
  if (cache[key]) return cache[key];
  const isrc = track.isrc || (await ds.getTrack(track.trackId)).isrc;
  const links = isrc ? await ds.linksForIsrc(isrc).catch((err) => (err.status === 404 ? [] : Promise.reject(err))) : [];
  const ids = idsFromLinks(links);
  remember(key, ids);
  return ids;
}

let spotifyApi = null;
function loadSpotifyApi() {
  spotifyApi ||= new Promise((resolve, reject) => {
    window.onSpotifyIframeApiReady = resolve;
    const s = document.createElement('script');
    s.src = 'https://open.spotify.com/embed/iframe-api/v1';
    s.async = true;
    s.onerror = () => {
      spotifyApi = null;
      reject(new Error('Could not load the Spotify player'));
    };
    document.head.append(s);
  });
  return spotifyApi;
}

let current = null; // the open player: { close() }

/** Close the full-song player, if one is open. */
export function closeFullSong() {
  const c = current;
  current = null;
  if (c) c.close();
}

/**
 * Open the full-song player for `track` in `slot` (an element on the card).
 * onClose runs when it closes (swipe, ✕, another full song).
 */
export async function openFullSong(track, slot, { onClose } = {}) {
  closeFullSong();
  let closed = false;
  let controller = null;
  const me = {
    close() {
      closed = true;
      if (controller && controller.destroy) controller.destroy();
      slot.replaceChildren();
      slot.hidden = true;
      if (onClose) onClose();
    },
  };
  current = me;

  const stage = h('div', { class: 'full-stage' }, spinner('Finding the full song…'));
  const note = h('p', { class: 'full-note small', hidden: true });
  const q = encodeURIComponent(`${track.artistName} ${track.title}`);
  const linkTo = (href, label) => h('a', { class: 'listen-link small', href, target: '_blank', rel: 'noopener', dataset: { role: 'link' } }, label, icon('external', { size: 14 }));
  const spotifyLink = linkTo(`https://open.spotify.com/search/${q}`, 'Open in Spotify');
  slot.replaceChildren(
    stage,
    note,
    h(
      'div',
      { class: 'full-links' },
      spotifyLink,
      track.link && linkTo(track.link, 'Open in Deezer'),
      h('button', { class: 'icon-btn', 'aria-label': 'Close the full song', dataset: { role: 'link' }, onClick: () => current === me && closeFullSong() }, icon('x', { size: 18 }))
    )
  );
  slot.hidden = false;
  const say = (text, extra) => {
    note.replaceChildren(text, extra || '');
    note.hidden = false;
  };

  let ids;
  try {
    ids = await findIds(track);
  } catch {
    if (!closed) {
      stage.replaceChildren();
      say('Couldn’t look this song up right now. Try again in a minute, or open it in your app.');
    }
    return;
  }
  if (closed) return;
  if (ids.spotify) spotifyLink.href = `https://open.spotify.com/track/${ids.spotify}`; // opens the Spotify app

  const youtube = () => {
    if (controller && controller.destroy) controller.destroy();
    controller = null;
    note.hidden = true;
    stage.replaceChildren(
      h('iframe', {
        class: 'full-youtube',
        src: `https://www.youtube-nocookie.com/embed/${ids.youtube}?autoplay=1&playsinline=1&rel=0`,
        title: `${track.title} on YouTube`,
        allow: 'autoplay; encrypted-media; picture-in-picture',
        allowfullscreen: '',
      })
    );
  };
  const youtubeBtn = () => ids.youtube && h('button', { class: 'btn small', dataset: { role: 'link' }, onClick: youtube }, 'Play on YouTube');

  if (ids.youtube && (isAppleMobile() || !ids.spotify)) return youtube();
  if (!ids.spotify) {
    stage.replaceChildren();
    return say('This song isn’t linked to Spotify or YouTube yet. Open it in your app instead.');
  }
  try {
    const api = await loadSpotifyApi();
    if (closed) return;
    const box = h('div', {});
    stage.replaceChildren(box);
    api.createController(box, { uri: `spotify:track:${ids.spotify}`, width: '100%', height: 152 }, (c) => {
      if (closed) return c.destroy && c.destroy();
      controller = c;
      c.addListener('ready', () => c.play());
      let warned = false;
      c.addListener('playback_update', (e) => {
        const d = e.data && e.data.duration;
        if (!warned && d > 0 && d <= PREVIEW_MS) {
          warned = true; // a 30 s preview: not logged in to Spotify Premium in this browser
          say('Spotify only plays a preview here. Log in at open.spotify.com in this browser (Premium) for the full song. ', youtubeBtn());
        }
      });
    });
  } catch (err) {
    if (closed) return;
    if (ids.youtube) return youtube();
    stage.replaceChildren();
    say(`${err.message}. Open it in your app instead.`);
  }
}
