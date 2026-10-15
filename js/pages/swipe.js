/**
 * Swipe — the main screen. Right = like, left = dislike, Undo, tap to preview.
 */

import { h, icon, clear, spinner, errorBox, errorMessage, toast } from '../ui.js';
import { storage } from '../storage.js';
import { Feed, getProximityLevel } from '../recommender.js';
import { recordSwipe, undoSwipe } from '../library.js';
import { Deck } from '../deck.js';
import { NODES } from '../genreGraph.js';
import { navigate } from '../router.js';
import { flyToDeck } from '../deckFly.js';

const QUEUE_TARGET = 5; // preload the next 3–5 cards

// One feed per session: switching tabs doesn't throw away preloaded cards.
const feed = new Feed(() => storage.data);
const undoStack = []; // tracks swiped in this session, most recent last
let resetPending = false;

storage.subscribe((_, reason) => {
  if (reason === 'profile' || reason === 'replace') resetPending = true;
});

export function mount(view) {
  if (resetPending) {
    feed.reset();
    undoStack.length = 0;
    resetPending = false;
  }

  // #/swipe?focus=<genre or sub-genre id>: swipe only that part of the map.
  const focusId = new URLSearchParams(location.hash.split('?')[1] || '').get('focus');
  const focusNode = focusId && NODES.get(focusId);
  if (feed.setFocus(focusNode ? focusId : null)) undoStack.length = 0;

  const head = h(
    'div',
    { class: 'page-head', style: { marginBottom: '4px' } },
    h('h1', {}, 'Discover'),
    focusNode
      ? h(
          'button',
          { class: 'focus-pill', 'aria-label': `Exploring ${focusNode.name}. Tap to go back to your normal mix`, onClick: () => navigate('swipe') },
          `🔭 ${focusNode.name}`,
          icon('x', { size: 14 })
        )
      : h('span', { class: 'muted small' }, 'Tap a card to listen')
  );
  const body = h('div', {});
  view.append(head, body);

  let deck = null;
  let loadingMore = false;
  let failed = null;

  const exploreBadge = (track) => {
    if (!track.explore) return null;
    const p = getProximityLevel(track, storage.data);
    const w = storage.data.tasteWeights;
    // Only "new" while you haven't really liked this style yet.
    if (p.level < 1 || (w.subGenres[track.subGenre] || 0) >= 1 || (w.artists[track.artistId] || 0) >= 1) return null;
    return { badges: [h('span', { class: 'tag' }, '🧭 Something new')] };
  };

  const deckEmpty = () => {
    if (failed) return errorBox(errorMessage(failed), () => fill());
    if (loadingMore || feed.loading) return spinner('Finding songs for you…');
    return h(
      'div',
      {},
      h('h2', {}, "You've seen everything for now"),
      h('p', { class: 'muted' }, 'Try Blind Spot, or add more artists and genres in your profile.'),
      h('a', { class: 'btn', href: '#/blindspot' }, icon('compass', { size: 18 }), 'Open Blind Spot')
    );
  };

  async function fill() {
    if (loadingMore) return;
    loadingMore = true;
    failed = null;
    deck && deck.render();
    try {
      await feed.ensure(QUEUE_TARGET);
    } catch (err) {
      console.error(err);
      if (!feed.queue.length) failed = err;
    } finally {
      loadingMore = false;
    }
    if (deck) deck.render();
  }

  async function onDecide(track, action, { rect } = {}) {
    feed.remove(track.trackId);
    undoStack.push(track);
    if (undoStack.length > 30) undoStack.shift();
    const liked = action === 'like';
    const playlist = await recordSwipe(track, liked);
    if (liked) flyToDeck({ fromRect: rect, cover: track.coverSmall || track.coverUrl, deckName: playlist });
    if (feed.queue.length < QUEUE_TARGET) fill();
  }

  function onUndo() {
    const track = undoStack.pop();
    if (!track) return;
    undoSwipe(track.trackId);
    feed.unshift(track);
    deck.render();
    toast('Undone', { icon: 'undo' });
  }

  deck = new Deck({
    container: body,
    tracks: () => feed.queue,
    onDecide,
    onUndo,
    canUndo: () => undoStack.length > 0,
    extras: exploreBadge,
    empty: deckEmpty,
  });
  deck.render();
  fill();

  return () => deck.destroy();
}
