/**
 * deck — the swipeable card stack shared by Swipe and Blind Spot.
 *
 * The page owns the list of tracks; the deck renders the top few, handles
 * drag gestures, buttons and keyboard, previews, and asks the page what to
 * do when a decision is made (like | nope | skip).
 */

import { h, icon, clear, cover, toast } from './ui.js';
import { player, prepare, knownOffset, previewLength } from './audio.js';
import { storage } from './storage.js';
import { PLATFORMS, enrichSubGenre } from './dataService.js';
import { placeTrack, NODES } from './genreGraph.js';
import { openFullSong, closeFullSong } from './fullSong.js';

const VISIBLE = 3; // cards in the DOM
const PRELOAD = 5; // cards whose audio is prepared ahead
const THRESHOLD = 0.28; // fraction of card width to count as a swipe

/** Card for one track. extras(track) may return { badges: [nodes], why: node }. */
function buildCard(track, { extras } = {}) {
  const platform = storage.data.profile.preferredPlatform || 'deezer';
  const link = (track.listenLinks && track.listenLinks[platform]) || track.link;
  const ex = extras ? extras(track) || {} : {};

  const progress = h('div', {});
  const playBtn = h(
    'button',
    {
      class: 'play-btn',
      'aria-label': track.hasPreview ? `Play preview of ${track.title}` : 'No preview available',
      disabled: !track.hasPreview && track.noPreviewChecked,
      dataset: { role: 'play' },
    },
    icon('play', { size: 26 })
  );
  const tags = h('div', { class: 'tags' });
  const badges = h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } }, ex.badges || []);
  const bestPart = h('span', { class: 'tag gold', hidden: true }, '✨ Best part');
  const fullSlot = h('div', { class: 'full-slot', hidden: true }); // the full-song player (fullSong.js)

  const el = h(
    'article',
    { class: 'card', 'aria-label': `${track.title} by ${track.artistName}`, dataset: { trackId: track.trackId } },
    cover(track.coverUrl, `Cover of ${track.albumTitle || track.title}`, 'art'),
    h('div', { class: 'shade' }),
    h('div', { class: 'progress', 'aria-hidden': 'true' }, progress),
    h('div', { class: 'top-badges' }, badges, bestPart),
    h('div', { class: 'stamp like', 'aria-hidden': 'true' }, 'LIKE'),
    h('div', { class: 'stamp nope', 'aria-hidden': 'true' }, 'NOPE'),
    h('div', { class: 'stamp skip', 'aria-hidden': 'true' }, 'NOT NOW'),
    fullSlot,
    h(
      'div',
      { class: 'info' },
      ex.why || null,
      h('h2', { class: 'title' }, track.title),
      h('div', { class: 'artist' }, track.artistName),
      tags,
      h(
        'div',
        { class: 'actions-row' },
        playBtn,
        link &&
          h(
            'a',
            { class: 'listen-link', href: link, target: '_blank', rel: 'noopener', dataset: { role: 'link' } },
            `Listen on ${PLATFORMS[platform] || 'Deezer'}`,
            icon('external', { size: 16 })
          ),
        h(
          'button',
          {
            class: 'listen-link full-song',
            dataset: { role: 'link' },
            'aria-label': `Play the full song ${track.title}`,
            onClick: () => {
              player.stop(); // one player at a time
              el.classList.add('full-open');
              openFullSong(track, fullSlot, { onClose: () => el.classList.remove('full-open') });
            },
          },
          icon('music', { size: 16 }),
          'Full song'
        ),
        !track.hasPreview && track.noPreviewChecked && h('span', { class: 'tag' }, 'No preview')
      )
    )
  );

  const renderTags = () => {
    clear(tags);
    if (track.year) tags.append(h('span', { class: 'tag' }, String(track.year)));
    // Where it sits on the Music Map: sun › planet › moon (genreGraph.placeTrack).
    const p = placeTrack(track);
    const path = [p.family ? NODES.get(p.family).name : track.genre, p.style && NODES.get(p.style).name, p.moon && NODES.get(p.moon).name].filter(Boolean);
    if (path.length) tags.append(h('span', { class: 'tag genre-path' }, path.join(' › ')));
    const smart = previewLength() === 15 && (knownOffset(track) || 0) > 0;
    bestPart.hidden = !smart;
  };
  renderTags();

  return {
    el,
    track,
    progress,
    playBtn,
    refresh: renderTags,
    setPlaying(state) {
      playBtn.replaceChildren(icon(state === 'playing' || state === 'loading' ? 'pause' : 'play', { size: 26 }));
      playBtn.setAttribute('aria-label', `${state === 'playing' ? 'Pause' : 'Play'} preview of ${track.title}`);
      playBtn.classList.toggle('is-loading', state === 'loading');
      playBtn.setAttribute('aria-busy', String(state === 'loading'));
    },
  };
}

export class Deck {
  /**
   * @param {object} o
   * @param {HTMLElement} o.container
   * @param {() => object[]} o.tracks          current ordered tracks (top first)
   * @param {(track, action) => Promise} o.onDecide  action: 'like' | 'nope' | 'skip'
   * @param {() => void} [o.onUndo]
   * @param {() => boolean} [o.canUndo]
   * @param {(track) => object} [o.extras]
   * @param {boolean} [o.skipButton]          show "Not for now"
   * @param {() => Node} [o.empty]            what to show when there are no cards
   */
  constructor(o) {
    this.o = o;
    this.cards = new Map(); // trackId -> card
    this.busy = false;
    this.autoplay = false;
    this.root = h('div', { class: 'deck-wrap' });
    this.deckEl = h('div', { class: 'deck', role: 'region', 'aria-label': 'Song cards', 'aria-roledescription': 'card stack' });
    this.live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
    this.controls = this.buildControls();
    this.root.append(this.deckEl, this.controls, this.live);
    o.container.append(this.root);

    this.unsubPlayer = player.subscribe((s) => this.onPlayer(s));
    this.onKey = (e) => this.handleKey(e);
    addEventListener('keydown', this.onKey);
  }

  destroy() {
    closeFullSong();
    this.unsubPlayer();
    removeEventListener('keydown', this.onKey);
    this.root.remove();
  }

  buildControls() {
    const btn = (cls, label, ic, action) =>
      h('button', { class: 'ctrl ' + cls, 'aria-label': label, title: label, onClick: () => this.decide(action) }, icon(ic, { size: cls.includes('small') ? 22 : 30 }));
    this.undoBtn = h('button', { class: 'ctrl small', 'aria-label': 'Undo last swipe', title: 'Undo', onClick: () => this.o.onUndo && this.o.onUndo() }, icon('undo', { size: 22 }));
    return h(
      'div',
      { class: 'controls' },
      this.undoBtn,
      btn('nope', 'Dislike', 'x', 'nope'),
      this.o.skipButton &&
        h('button', { class: 'ctrl skip', 'aria-label': 'Not for now (no penalty)', onClick: () => this.decide('skip') }, icon('skip', { size: 20 }), 'Not now'),
      btn('like', 'Like', 'heart', 'like')
    );
  }

  top() {
    const t = this.o.tracks()[0];
    return t ? this.cards.get(t.trackId) : null;
  }

  /** Sync DOM cards with the page's track list. */
  render() {
    const tracks = this.o.tracks();
    const visible = tracks.slice(0, VISIBLE);
    const ids = new Set(visible.map((t) => t.trackId));
    for (const [id, card] of this.cards) {
      if (!ids.has(id)) {
        card.el.remove();
        this.cards.delete(id);
      }
    }
    // Insert in reverse so the top card is last in the DOM (on top).
    [...visible].reverse().forEach((t, i) => {
      let card = this.cards.get(t.trackId);
      if (!card) {
        card = buildCard(t, { extras: this.o.extras });
        this.cards.set(t.trackId, card);
        this.attachGestures(card);
      }
      card.el.dataset.depth = String(visible.length - 1 - i);
      card.el.style.transform = '';
      card.el.style.opacity = '';
      this.deckEl.append(card.el);
    });
    const topCard = this.top();
    for (const [, card] of this.cards) {
      const isTop = card === topCard;
      card.el.setAttribute('aria-hidden', String(!isTop));
      card.el.inert = !isTop;
      if (isTop) card.setPlaying(player.isPlaying(card.track.trackId) ? player.status : 'idle');
    }
    const msg = this.deckEl.querySelector('.deck-message');
    if (msg) msg.remove();
    if (!tracks.length && this.o.empty) this.deckEl.append(h('div', { class: 'deck-message' }, this.o.empty()));
    this.controls.querySelectorAll('.ctrl:not(.small)').forEach((b) => (b.disabled = !tracks.length));
    this.undoBtn.disabled = !(this.o.canUndo && this.o.canUndo());
    this.preload(tracks);
  }

  /** Prepare audio + smart offset for the next cards, and sub-genres for the visible ones. */
  async preload(tracks) {
    const batch = tracks.slice(0, PRELOAD);
    const token = (this.preloadToken = {});
    for (const t of batch.slice(0, VISIBLE)) {
      if (!t.subGenre) enrichSubGenre(t).then(() => this.cards.get(t.trackId)?.refresh());
    }
    for (const t of batch) {
      if (this.preloadToken !== token) return;
      if (t.prepared) continue;
      await prepare(t);
      t.prepared = true;
      t.noPreviewChecked = true;
      const card = this.cards.get(t.trackId);
      if (card) {
        card.refresh();
        if (!t.hasPreview) {
          card.playBtn.disabled = true;
          card.playBtn.setAttribute('aria-label', 'No preview available');
        }
      }
    }
  }

  onPlayer(s) {
    const card = this.top();
    if (!card) return;
    const mine = s.trackId === card.track.trackId;
    card.setPlaying(mine ? s.status : 'idle');
    if (mine && s.status === 'error' && this.lastError !== s.track) {
      this.lastError = s.track; // one message per failed song
      toast(`${s.error}. Try again, or use “Listen on”.`, { duration: 4000 });
    }
    card.progress.style.width = mine ? `${s.progress * 100}%` : '0';
    if (mine && s.status !== 'idle') card.refresh();
  }

  togglePlay() {
    const card = this.top();
    if (!card) return;
    closeFullSong(); // back to the preview
    player.toggle(card.track);
  }

  /* ---------- gestures ---------- */

  attachGestures(card) {
    const el = card.el;
    let start = null;
    let dx = 0;
    let dy = 0;
    let moved = false;

    const stamps = {
      like: el.querySelector('.stamp.like'),
      nope: el.querySelector('.stamp.nope'),
      skip: el.querySelector('.stamp.skip'),
    };
    const setStamps = (x, y) => {
      const w = el.offsetWidth || 300;
      stamps.like.style.opacity = String(Math.max(0, Math.min(1, x / (w * THRESHOLD))));
      stamps.nope.style.opacity = String(Math.max(0, Math.min(1, -x / (w * THRESHOLD))));
      if (this.o.skipButton) stamps.skip.style.opacity = String(Math.max(0, Math.min(1, -y / (w * THRESHOLD))) * (Math.abs(x) < 40 ? 1 : 0));
    };

    el.addEventListener('pointerdown', (e) => {
      if (this.busy || el.dataset.depth !== '0' || e.button > 0) return;
      if (e.target.closest('[data-role="link"], .full-slot')) return;
      start = { x: e.clientX, y: e.clientY, t: Date.now() };
      dx = dy = 0;
      moved = false;
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (!start) return;
      dx = e.clientX - start.x;
      dy = e.clientY - start.y;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
      if (!moved) return;
      el.style.transform = `translate(${dx}px, ${Math.min(dy, 40) * (this.o.skipButton ? 1 : 0.3)}px) rotate(${dx / 18}deg)`;
      setStamps(dx, dy);
    });
    const end = (e) => {
      if (!start) return;
      el.classList.remove('dragging');
      const w = el.offsetWidth || 300;
      const velocity = Math.abs(dx) / Math.max(1, Date.now() - start.t);
      const fling = velocity > 0.6 && Math.abs(dx) > 40;
      start = null;
      if (!moved) {
        // A tap: play/pause (unless on a link).
        if (e && e.type === 'pointerup' && !e.target.closest('[data-role="link"], .full-slot')) this.togglePlay();
        return;
      }
      if (dx > w * THRESHOLD || (fling && dx > 0)) return this.decide('like');
      if (dx < -w * THRESHOLD || (fling && dx < 0)) return this.decide('nope');
      if (this.o.skipButton && dy < -w * THRESHOLD && Math.abs(dx) < 60) return this.decide('skip');
      el.style.transform = '';
      setStamps(0, 0);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => {
      moved = true;
      end();
    });
  }

  handleKey(e) {
    if (e.target.closest && e.target.closest('input, textarea, select, .overlay')) return;
    if (!this.root.isConnected) return;
    if (e.key === 'ArrowRight') this.decide('like');
    else if (e.key === 'ArrowLeft') this.decide('nope');
    else if (e.key === 'ArrowUp' && this.o.skipButton) this.decide('skip');
    else if ((e.key === ' ' || e.key === 'k') && !e.target.closest('button, a')) {
      e.preventDefault();
      this.togglePlay();
    } else if ((e.key === 'z' && (e.ctrlKey || e.metaKey)) || e.key === 'Backspace') this.o.onUndo && this.o.onUndo();
    else return;
  }

  /* ---------- decisions ---------- */

  async decide(action) {
    const card = this.top();
    if (!card || this.busy) return;
    this.busy = true;
    const wasPlaying = player.isPlaying(card.track.trackId);
    if (player.track && player.track.trackId === card.track.trackId) player.stop();
    closeFullSong(); // swiping the card away stops its full song

    const el = card.el;
    const rect = el.getBoundingClientRect(); // where the card was (a liked card flies into its deck from here)
    const out = action === 'like' ? 1 : action === 'nope' ? -1 : 0;
    el.querySelector(`.stamp.${action}`).style.opacity = '1';
    el.style.transform =
      action === 'skip' ? 'translate(0, -120%) scale(0.9)' : `translate(${out * 150}%, 30px) rotate(${out * 25}deg)`;
    el.style.opacity = '0';
    this.live.textContent = `${action === 'like' ? 'Liked' : action === 'nope' ? 'Disliked' : 'Skipped'} ${card.track.title}`;
    await new Promise((r) => setTimeout(r, 260));

    try {
      await this.o.onDecide(card.track, action, { rect });
    } finally {
      this.busy = false;
    }
    this.render();
    // Keep the music going if the user was listening.
    const next = this.top();
    if (wasPlaying && next && next.track.hasPreview) player.play(next.track);
  }
}
