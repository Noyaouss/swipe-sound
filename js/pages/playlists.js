/**
 * Decks (formerly "Playlists") — auto-generated from every liked song, one per genre.
 * Each deck is a stack of song cards: bigger decks are thicker stacks. Opening one
 * spreads its cards out; each card can be played, removed, moved or reordered.
 *
 * Internally the code and stored settings keep the old "playlist" names
 * (playlistsCore.js, data.playlistSettings), so nothing needs migrating.
 * Not to be confused with js/deck.js, the swipe card stack.
 */

import { h, icon, clear, cover, toast, dialog, chooser, confirmDialog, downloadFile, copyText, emptyState, debounce } from '../ui.js';
import { storage } from '../storage.js';
import { player, prepare } from '../audio.js';
import { PLATFORMS } from '../dataService.js';
import { songAsTrack, removeLike } from '../library.js';
import {
  derivePlaylists,
  sortPlaylists,
  findPlaylist,
  moveTargets,
  asText,
  asCsv,
  asJson,
  ALL_KEY,
  BLINDSPOT_KEY,
  OTHER,
  SPLIT_AT,
} from '../playlistsCore.js';

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mount(view, params) {
  if (params[0] === 'all') return mountDetail(view, ALL_KEY);
  if (params[0] === 'blindspot') return mountDetail(view, BLINDSPOT_KEY);
  if (params[0] === 'g' && params[1]) return mountDetail(view, params[1]);
  return mountList(view);
}

export const deckHref = (p) =>
  p.key === ALL_KEY ? '#/decks/all' : p.key === BLINDSPOT_KEY ? '#/decks/blindspot' : `#/decks/g/${encodeURIComponent(p.key)}`;

const cardsLabel = (n) => `${n} card${n === 1 ? '' : 's'}`;

/** Deezer covers come in several sizes (the size is in the URL): 500 px is plenty for a card. */
const coverAt = (url, size) => (url && /dzcdn\.net/.test(url) ? url.replace(/\/\d+x\d+-/, `/${size}x${size}-`) : url);

/** Thickness of a deck: always a card fanned behind the top one, plus one more per 8 songs (max 6). */
export const stackLayers = (count) => (count ? Math.min(6, 2 + Math.floor(count / 8)) : 1);

/** Cover art of a deck's first songs: 1 or 4 images. */
function deckArt(p) {
  const covers = p.covers;
  return h(
    'div',
    { class: 'deck-art' + (covers.length >= 4 ? ' quad' : '') },
    covers.length >= 4 ? covers.slice(0, 4).map((c) => h('img', { src: c, alt: '', loading: 'lazy' })) : cover(covers[0], '', 'cover')
  );
}

/**
 * A deck shown as a stack of cards: the top card carries the art, the name and the
 * card count; the cards behind are fanned out (more of them for bigger decks).
 */
export function deckStack(p, { tag = 'a', big = false } = {}) {
  const layers = stackLayers(p.count);
  return h(
    tag,
    {
      class: 'deck-stack' + (big ? ' big' : ''),
      href: tag === 'a' ? deckHref(p) : null,
      'aria-label': `${p.name} deck, ${cardsLabel(p.count)}`,
      style: { '--layers': layers },
    },
    Array.from({ length: layers - 1 }, (_, i) => h('span', { class: 'deck-layer', 'aria-hidden': 'true', style: { '--i': layers - 1 - i } })),
    h(
      'div',
      { class: 'deck-top' },
      deckArt(p),
      h('div', { class: 'deck-shade', 'aria-hidden': 'true' }),
      p.compass && h('span', { class: 'deck-badge', title: 'Blind Spot' }, icon('compass', { size: 16 })),
      h('div', { class: 'deck-info' }, h('div', { class: 'deck-name' }, p.name), h('div', { class: 'deck-count' }, cardsLabel(p.count)))
    )
  );
}

/* ------------------------------------------------------------------ */
/* Overview                                                             */
/* ------------------------------------------------------------------ */

function mountList(view) {
  let query = '';
  const results = h('div', {});

  const render = () => {
    const d = storage.data;
    if (!d.likedSongs.length) {
      clear(view).append(
        h('div', { class: 'page-head' }, h('h1', {}, 'Decks')),
        emptyState({
          title: 'No decks yet',
          text: 'Like a few songs and your decks will appear here.',
          action: h('a', { class: 'btn primary', href: '#/swipe' }, icon('cards', { size: 18 }), 'Start swiping'),
        })
      );
      return;
    }
    const { special, genres, hidden } = derivePlaylists(d);
    const sortBy = d.playlistSettings.sortBy || 'count';
    const sortSel = h(
      'select',
      {
        class: 'select',
        'aria-label': 'Sort decks',
        onChange: (e) => storage.update((dd) => (dd.playlistSettings.sortBy = e.target.value), 'settings'),
      },
      [
        ['count', 'Most cards'],
        ['recent', 'Most recent'],
        ['az', 'A to Z'],
      ].map(([v, l]) => h('option', { value: v, selected: sortBy === v }, l))
    );
    const search = h('input', {
      class: 'input',
      type: 'search',
      placeholder: 'Search all decks',
      'aria-label': 'Search all decks',
      value: query,
      onInput: debounce((e) => {
        query = e.target.value.trim();
        renderResults();
      }, 200),
    });
    const groupToggle = h(
      'div',
      { class: 'switch-row', style: { padding: '0 0 14px', border: '0' } },
      h('label', { for: 'pl-group' }, 'Group by sub-genre', h('span', { class: 'hint' }, `Splits decks with ${SPLIT_AT}+ cards`)),
      h('input', {
        type: 'checkbox',
        role: 'switch',
        class: 'switch',
        id: 'pl-group',
        checked: d.playlistSettings.groupBySubGenre,
        onChange: (e) => storage.update((dd) => (dd.playlistSettings.groupBySubGenre = e.target.checked), 'settings'),
      })
    );

    clear(view).append(
      h('div', { class: 'page-head' }, h('h1', {}, 'Decks'), sortSel),
      h('div', { class: 'search', style: { marginBottom: '12px' } }, icon('search', { size: 20 }), search),
      groupToggle,
      results
    );

    function renderResults() {
      clear(results);
      if (query) {
        const q = query.toLowerCase();
        const hits = d.likedSongs.filter((s) => [s.title, s.artistName, s.genre, s.subGenre, s.albumTitle].some((v) => v && v.toLowerCase().includes(q)));
        results.append(h('p', { class: 'muted small' }, `${hits.length} card${hits.length === 1 ? '' : 's'} found`), cardGrid(hits, { deckKey: null, showGenre: true }));
        return;
      }
      // (append() would print null as text: build with h() so empty parts are skipped)
      results.append(
        h(
          'div',
          {},
        h('div', { class: 'deck-grid special' }, special.filter((p) => p.count || p.key === ALL_KEY).map((p) => deckStack(p))),
        h('h2', { class: 'section-title' }, `By genre · ${genres.length}`),
        h('div', { class: 'deck-grid' }, sortPlaylists(genres, sortBy).map((p) => deckStack(p))),
        hidden.length
          ? h(
            'details',
            { class: 'disclose section' },
            h('summary', {}, `Hidden decks (${hidden.length})`),
            h('div', { class: 'deck-grid' }, hidden.map((p) => deckStack(p)))
          )
          : null
        )
      );
    }
    renderResults();
  };

  render();
  const unsub = storage.subscribe((_, reason) => {
    if (['remote', 'replace', 'merge', 'settings', 'unlike', 'move', 'order'].includes(reason)) render();
  });
  const stopBar = playerBar();
  return () => {
    unsub();
    stopBar();
  };
}

/* ------------------------------------------------------------------ */
/* Song cards (same look as the swipe cards, smaller)                   */
/* ------------------------------------------------------------------ */

/**
 * Grid of song cards. Options: deckKey (for reordering), reorder (show ◀ ▶),
 * onPlay(index), showGenre.
 */
function cardGrid(songs, { deckKey, reorder = false, onPlay, showGenre = false } = {}) {
  const platform = storage.data.profile.preferredPlatform || 'deezer';
  const grid = h('ul', { class: 'song-cards' + (reorder ? ' reordering' : ''), role: 'list' });
  songs.forEach((s, i) => {
    const playable = s.hasPreview || s.previewUrl;
    const play = () => (onPlay ? onPlay(i) : playSong(s));
    const li = h(
      'li',
      { class: 'song-card' + (player.track && player.track.trackId === s.trackId && player.status !== 'idle' ? ' playing' : ''), dataset: { trackId: s.trackId } },
      h(
        'button',
        { class: 'song-card-face', 'aria-label': playable ? `Play ${s.title} by ${s.artistName}` : `${s.title} by ${s.artistName}: no preview available`, onClick: play },
        cover(coverAt(s.coverUrl, 500) || s.coverSmall, ''),
        h('span', { class: 'song-card-shade', 'aria-hidden': 'true' }),
        h('span', { class: 'song-card-play', 'aria-hidden': 'true' }, icon(playable ? 'play' : 'music', { size: 18 })),
        h(
          'span',
          { class: 'song-card-info' },
          h('span', { class: 't' }, s.title),
          h('span', { class: 's' }, [s.artistName, s.year].filter(Boolean).join(' · ')),
          h(
            'span',
            { class: 'pills' },
            showGenre && s.genre && h('span', { class: 'label-pill' }, s.genre),
            s.subGenre && h('span', { class: 'label-pill' }, s.subGenre),
            s.source === 'blindspot' && h('span', { class: 'label-pill', title: 'Found in Blind Spot' }, '🧭'),
            !playable && h('span', { class: 'label-pill' }, 'No preview available')
          )
        )
      ),
      reorder
        ? h(
            'span',
            { class: 'song-card-move' },
            h('button', { class: 'icon-btn', 'aria-label': `Move ${s.title} earlier`, disabled: i === 0, onClick: () => moveCard(deckKey, songs, i, -1) }, icon('back', { size: 18 })),
            h('button', { class: 'icon-btn', 'aria-label': `Move ${s.title} later`, disabled: i === songs.length - 1, onClick: () => moveCard(deckKey, songs, i, 1) }, icon('chevron', { size: 18 }))
          )
        : h(
            'span',
            { class: 'song-card-actions' },
            h('button', { class: 'icon-btn', 'aria-label': `Remove ${s.title}`, title: 'Remove', onClick: () => removeSong(s) }, icon('x', { size: 16 })),
            h('button', { class: 'icon-btn', 'aria-label': `More options for ${s.title}`, title: 'More', onClick: () => songMenu(s, platform) }, icon('more', { size: 16 }))
          )
    );
    grid.append(li);
  });
  return grid;
}

/** Reorder: swap a card with its neighbour and remember the deck's order. */
function moveCard(deckKey, songs, i, dir) {
  const ids = songs.map((s) => s.trackId);
  const j = i + dir;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  storage.update((d) => (d.playlistSettings.order[deckKey] = ids), 'order');
}

/** Cards fly out of the deck's stack into their place in the grid. */
function spreadOut(grid, from) {
  if (reduceMotion() || !from) return;
  const origin = from.getBoundingClientRect();
  const cards = [...grid.children];
  cards.forEach((card, i) => {
    const r = card.getBoundingClientRect();
    const dx = origin.left + origin.width / 2 - (r.left + r.width / 2);
    const dy = origin.top + origin.height / 2 - (r.top + r.height / 2);
    const rot = ((i % 5) - 2) * 4;
    card.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(0.6)`, opacity: 0 },
        { transform: `translate(${dx * 0.9}px, ${dy * 0.9}px) rotate(${rot}deg) scale(0.65)`, opacity: 1, offset: 0.15 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 520, delay: Math.min(i, 16) * 35, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'backwards' }
    );
  });
}

function countPlay(song) {
  storage.update((d) => (d.playCounts[song.trackId] = (d.playCounts[song.trackId] || 0) + 1), 'play');
}

function playSong(song) {
  if (player.track && player.track.trackId === song.trackId) return player.toggle();
  countPlay(song);
  player.play(songAsTrack(song));
}

async function removeSong(song) {
  const ok = await confirmDialog('Remove this card?', `“${song.title}” will be removed from your likes and decks.`, 'Remove', 'danger');
  if (!ok) return;
  if (player.track && player.track.trackId === song.trackId) player.stop();
  removeLike(song.trackId);
  toast('Card removed', { icon: 'trash' });
}

async function songMenu(song, platform) {
  const link = (song.listenLinks && song.listenLinks[platform]) || song.link;
  const choice = await chooser(song.title, [
    { label: 'Move to another deck…', value: 'move' },
    { label: `Listen on ${PLATFORMS[platform]}`, value: 'listen' },
    { label: 'Remove from my likes', value: 'remove' },
  ]);
  if (choice === 'remove') return removeSong(song);
  if (choice === 'listen' && link) return window.open(link, '_blank', 'noopener');
  if (choice === 'move') {
    const d = storage.data;
    const targets = moveTargets(d, song);
    const target = await chooser('Move to…', [
      ...targets.map((k) => ({ label: d.playlistSettings.customNames[k] || k, value: k })),
      { label: '＋ New deck…', value: '__new' },
    ]);
    if (!target) return;
    let key = target;
    if (target === '__new') {
      key = await promptText('New deck', 'Name', '');
      if (!key) return;
    }
    storage.update((dd) => (dd.playlistSettings.overrides[song.trackId] = key), 'move');
    toast(`Moved to ${d.playlistSettings.customNames[key] || key}`, { icon: 'move' });
  }
}

function promptText(title, label, value) {
  const input = h('input', { class: 'input', style: { paddingLeft: '16px' }, value, 'aria-label': label, maxlength: '60' });
  setTimeout(() => input.focus(), 50);
  return dialog({
    title,
    body: (close) => {
      input.addEventListener('keydown', (e) => e.key === 'Enter' && close(input.value.trim()));
      return input;
    },
    buttons: [
      { label: 'Cancel', value: null, kind: 'ghost' },
      { label: 'Save', value: '__ok', kind: 'primary' },
    ],
  }).then((v) => (v === '__ok' ? input.value.trim() : v));
}

/* ------------------------------------------------------------------ */
/* Detail: one deck, spread out                                         */
/* ------------------------------------------------------------------ */

function mountDetail(view, key) {
  let reorder = false;
  let first = true;

  const render = () => {
    const d = storage.data;
    const p = findPlaylist(d, key);
    if (!p || (!p.count && !p.special)) {
      clear(view).append(
        h('div', { class: 'page-head' }, h('a', { class: 'icon-btn', href: '#/decks', 'aria-label': 'Back to decks' }, icon('back')), h('h1', { style: { flex: 1 } }, 'Deck')),
        emptyState({ title: 'This deck is empty', text: 'Its cards were moved or removed.', action: h('a', { class: 'btn', href: '#/decks' }, 'All decks') })
      );
      return;
    }
    const playable = p.songs.filter((s) => s.hasPreview || s.previewUrl);
    const isGenre = !p.special;

    const playAll = (startIndex = 0) => {
      const tracks = playable.map(songAsTrack);
      if (!tracks.length) return toast('No previews in this deck');
      countPlay(playable[startIndex] || playable[0]);
      player.playQueue(tracks, Math.max(0, startIndex));
    };

    const stack = deckStack(p, { tag: 'div', big: true });
    const grid = p.count
      ? cardGrid(p.songs, {
          deckKey: p.key,
          reorder,
          showGenre: !isGenre || p.key === OTHER,
          onPlay: (i) => {
            const s = p.songs[i];
            if (!(s.hasPreview || s.previewUrl)) return toast('No preview available for this song');
            if (player.track && player.track.trackId === s.trackId) return player.toggle();
            playAll(playable.indexOf(s));
          },
        })
      : null;

    clear(view).append(
      h(
        'div',
        { class: 'page-head', style: { marginBottom: '8px' } },
        h('a', { class: 'icon-btn', href: '#/decks', 'aria-label': 'Back to decks' }, icon('back')),
        h('span', { class: 'spacer' }),
        isGenre && h('button', { class: 'icon-btn', 'aria-label': 'Rename deck', title: 'Rename', onClick: () => rename(p) }, icon('edit', { size: 20 })),
        isGenre &&
          h(
            'button',
            { class: 'icon-btn', 'aria-label': p.hidden ? 'Show deck' : 'Hide deck', title: p.hidden ? 'Show' : 'Hide', onClick: () => toggleHidden(p) },
            icon(p.hidden ? 'eye' : 'eyeOff', { size: 20 })
          ),
        h('button', { class: 'icon-btn', 'aria-label': 'Export deck', title: 'Export', onClick: () => exportMenu(p) }, icon('download', { size: 20 }))
      ),
      h(
        'div',
        { class: 'deck-detail-head' },
        stack,
        h(
          'div',
          { class: 'deck-detail-meta' },
          h('h1', {}, p.name, p.compass ? ' 🧭' : ''),
          h('p', { class: 'muted small' }, `${cardsLabel(p.count)}${p.isOther ? ' · genres with only a few songs so far' : ''}`),
          h(
            'div',
            { class: 'row wrap' },
            h('button', { class: 'btn primary small', onClick: () => playAll(0), disabled: !playable.length }, icon('play', { size: 16 }), 'Play all'),
            p.count > 1 &&
              h(
                'button',
                {
                  class: 'btn small' + (reorder ? ' active' : ''),
                  'aria-pressed': String(reorder),
                  onClick: () => {
                    reorder = !reorder;
                    render();
                  },
                },
                icon('move', { size: 16 }),
                reorder ? 'Done' : 'Reorder'
              )
          )
        )
      ),
      grid ||
        emptyState({
          title: key === BLINDSPOT_KEY ? 'No discoveries yet' : 'No cards yet',
          text: key === BLINDSPOT_KEY ? 'Songs you like in Blind Spot land here.' : 'Like a few songs and they will appear here.',
          action: h('a', { class: 'btn', href: key === BLINDSPOT_KEY ? '#/blindspot' : '#/swipe' }, 'Go find some'),
        })
    );
    // The first time, the stack spreads out into the cards.
    if (first && grid) requestAnimationFrame(() => spreadOut(grid, stack.querySelector('.deck-top')));
    first = false;
    // Warm up the first previews so "Play all" starts quickly.
    playable.slice(0, 2).forEach((s) => prepare(songAsTrack(s)));
  };

  render();
  const unsub = storage.subscribe((_, reason) => {
    if (['remote', 'replace', 'merge', 'settings', 'unlike', 'move', 'order'].includes(reason)) render();
  });
  const unsubPlayer = player.subscribe((s) => {
    view.querySelectorAll('.song-card').forEach((li) => li.classList.toggle('playing', li.dataset.trackId === s.trackId && s.status !== 'idle'));
  });
  const stopBar = playerBar();
  return () => {
    unsub();
    unsubPlayer();
    stopBar();
  };
}

async function rename(p) {
  const name = await promptText('Rename deck', 'Deck name', p.name);
  if (name == null) return;
  storage.update((d) => {
    if (!name || name === p.key) delete d.playlistSettings.customNames[p.key];
    else d.playlistSettings.customNames[p.key] = name;
  }, 'settings');
}

function toggleHidden(p) {
  storage.update((d) => {
    const list = d.playlistSettings.hiddenGenres;
    const i = list.indexOf(p.key);
    if (i >= 0) list.splice(i, 1);
    else list.push(p.key);
  }, 'settings');
  toast(p.hidden ? 'Deck visible again' : 'Deck hidden. Find it at the bottom of Decks.', { icon: p.hidden ? 'eye' : 'eyeOff' });
}

async function exportMenu(p) {
  const safe = p.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'deck';
  const platform = storage.data.profile.preferredPlatform || 'deezer';
  const choice = await chooser(`Export “${p.name}”`, [
    { label: 'Copy as text (Title - Artist)', value: 'text' },
    { label: 'Download CSV', value: 'csv' },
    { label: 'Download JSON', value: 'json' },
    { label: `Open songs on ${PLATFORMS[platform]}…`, value: 'links' },
  ]);
  if (choice === 'text') {
    (await copyText(asText(p.songs))) ? toast(`Copied ${p.count} songs`, { icon: 'copy' }) : toast("Couldn't copy");
  } else if (choice === 'csv') {
    downloadFile(`${safe}.csv`, asCsv(p.songs), 'text/csv');
  } else if (choice === 'json') {
    downloadFile(`${safe}.json`, asJson(p.name, p.songs));
  } else if (choice === 'links') {
    dialog({
      title: `Open on ${PLATFORMS[platform]}`,
      text: 'Tap a song to open it. Creating a playlist directly on streaming services needs an account login, so it may come in a future version.',
      body: h(
        'div',
        { class: 'chooser' },
        p.songs.map((s) =>
          h(
            'a',
            { class: 'chooser-item row', href: (s.listenLinks && s.listenLinks[platform]) || s.link, target: '_blank', rel: 'noopener', style: { textDecoration: 'none', color: 'inherit' } },
            h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `${s.title} - ${s.artistName}`),
            icon('external', { size: 16 })
          )
        )
      ),
      buttons: [{ label: 'Done', value: true, kind: 'primary' }],
    });
  }
}

/* ------------------------------------------------------------------ */
/* Mini player bar (Play all: play/pause, next, previous)               */
/* ------------------------------------------------------------------ */

function playerBar() {
  const bar = h('div', { class: 'player-bar', role: 'region', 'aria-label': 'Preview player', hidden: true });
  document.body.append(bar);
  const render = (s) => {
    if (!s.track || s.status === 'idle') {
      bar.hidden = true;
      document.body.classList.remove('has-player');
      return;
    }
    bar.hidden = false;
    document.body.classList.add('has-player');
    const q = s.queue;
    if (bar.dataset.trackId !== s.trackId || bar.dataset.status !== s.status || bar.dataset.q !== String(!!q)) {
      bar.dataset.trackId = s.trackId;
      bar.dataset.status = s.status;
      bar.dataset.q = String(!!q);
      clear(bar).append(
        cover(s.track.coverSmall || s.track.coverUrl, ''),
        h(
          'div',
          { class: 'meta' },
          h('div', { class: 't' }, s.track.title),
          h('div', { class: 's' }, s.status === 'error' ? s.error : `${s.track.artistName}${s.smart ? ' · ✨ Best part' : ''}`)
        ),
        q && h('button', { class: 'icon-btn', 'aria-label': 'Previous', onClick: () => player.previous() }, icon('prev', { size: 20 })),
        h(
          'button',
          { class: 'icon-btn', 'aria-label': s.status === 'playing' ? 'Pause' : 'Play', onClick: () => player.toggle() },
          icon(s.status === 'playing' || s.status === 'loading' ? 'pause' : 'play', { size: 22 })
        ),
        q && h('button', { class: 'icon-btn', 'aria-label': 'Next', onClick: () => player.next() }, icon('next', { size: 20 })),
        h('div', { class: 'pb-progress' }, h('div', {}))
      );
    }
    const fill = bar.querySelector('.pb-progress > div');
    if (fill) fill.style.width = `${s.progress * 100}%`;
  };
  const unsub = player.subscribe(render);
  render(player.state());
  return () => {
    unsub();
    bar.remove();
    document.body.classList.remove('has-player');
  };
}
