/**
 * Blind Spot — music you'd likely enjoy but wouldn't pick yourself.
 * A friendly guide, never a test.
 */

import { h, icon, clear, spinner, errorBox, errorMessage, toast, dialog } from '../ui.js';
import { storage } from '../storage.js';
import { BlindSpotFeed, LEVELS } from '../blindspot.js';
import { comfortNodes } from '../recommender.js';
import { recordBlindSpotSwipe, undoBlindSpotSwipe } from '../library.js';
import { NODES } from '../genreGraph.js';
import { Deck } from '../deck.js';
import { flyToDeck } from '../deckFly.js';

const feed = new BlindSpotFeed();
const undoStack = [];
let resetPending = false;
storage.subscribe((_, reason) => {
  if (reason === 'profile' || reason === 'replace') resetPending = true;
});

export function mount(view, params) {
  if (resetPending) {
    feed.reset();
    resetPending = false;
  }
  if (params[0] === 'map') return location.replace('#/map'); // the map moved to its own page
  if (params[0] === 'progress') return mountProgress(view);
  return mountDeck(view);
}

/* ------------------------------------------------------------------ */
/* Deck                                                                 */
/* ------------------------------------------------------------------ */

function levelBadge(level) {
  const L = LEVELS[level] || LEVELS[1];
  return h('span', { class: `level-badge l${level}`, title: L.hint }, L.name);
}

function mountDeck(view) {
  const state = () => storage.data.blindSpotState;
  const levelLabel = h('span', { class: 'muted small' });
  const updateLevelLabel = () => {
    const L = LEVELS[state().currentLevel];
    levelLabel.textContent = `Exploring ${L.plural.toLowerCase()}`;
  };
  updateLevelLabel();

  view.append(
    h(
      'div',
      { class: 'page-head', style: { marginBottom: '4px' } },
      h('div', {}, h('h1', {}, 'Blind Spot'), levelLabel),
      h(
        'div',
        { class: 'bs-head-actions' },
        h('a', { class: 'icon-btn', href: '#/blindspot/progress', 'aria-label': 'Your exploration', title: 'Your exploration' }, icon('compass')),
        h('a', { class: 'icon-btn', href: '#/decks/blindspot', 'aria-label': 'Blind Spot discoveries deck', title: 'Discoveries deck' }, icon('decks'))
      )
    )
  );
  const body = h('div', {});
  view.append(body);

  let deck;
  let loading = false;
  let failed = null;
  let recap = null;

  const extras = (track) => {
    const bs = track.bs || { level: 1 };
    return {
      badges: [levelBadge(bs.level), track.secondChance && h('span', { class: 'tag' }, 'Second chance')],
      why: h('div', { class: 'why' }, h('strong', {}, 'Why this? '), bs.why || 'Something a little different for you'),
    };
  };

  const empty = () => {
    if (recap) return recapView(recap);
    if (failed) return errorBox(errorMessage(failed), fill);
    if (loading) return spinner('Looking beyond your usual…');
    return h('div', {}, h('h2', {}, 'Nothing new right now'), h('p', { class: 'muted' }, 'Come back later, or turn on second chances in the map settings.'));
  };

  const recapView = (r) =>
    h(
      'div',
      { class: 'recap' },
      h('div', { class: 'big', 'aria-hidden': 'true' }, '🧭'),
      h('h2', {}, r.newGenres ? `You explored ${r.newGenres} new genre${r.newGenres > 1 ? 's' : ''} today` : 'Nice exploring!'),
      h('p', { class: 'muted' }, r.likes ? `and liked ${r.likes} song${r.likes > 1 ? 's' : ''}. Want to keep going?` : 'Want to keep going? We can try something different.'),
      h(
        'div',
        { class: 'stack' },
        h(
          'button',
          {
            class: 'btn primary block',
            onClick: () => {
              recap = null;
              deck.render();
              fill();
            },
          },
          'Continue'
        ),
        h('a', { class: 'btn ghost block', href: '#/map' }, 'Stop for now · see my Music Map')
      )
    );

  async function fill() {
    if (loading) return;
    loading = true;
    failed = null;
    deck.render();
    try {
      await feed.ensure(3);
    } catch (err) {
      console.error(err);
      if (!feed.queue.length) failed = err;
    } finally {
      loading = false;
    }
    deck.render();
  }

  async function onDecide(track, action, { rect } = {}) {
    undoStack.push(track);
    if (undoStack.length > 20) undoStack.shift();
    const bs = track.bs || { level: 1 };
    const playlist = recordBlindSpotSwipe(track, {
      liked: action === 'like',
      skipped: action === 'skip',
      level: bs.level,
      bridgeReason: bs.why,
    });
    const r = feed.react(track, action);
    updateLevelLabel();

    if (action === 'like') {
      const caption = r.levelChange > 0 ? `You unlocked ${LEVELS[state().currentLevel].plural}! 🎉` : r.message;
      flyToDeck({ fromRect: rect, cover: track.coverSmall || track.coverUrl, deckName: playlist, caption });
    } else if (action === 'nope' && (r.levelChange < 0 || /closer/.test(r.message))) toast(r.message, { icon: 'compass' });

    if (r.askGenre) await askGenre(r.askGenre);
    if (feed.needsRecap()) recap = feed.recap();
    if (!recap) fill();
  }

  async function askGenre(node) {
    const yes = await dialog({
      title: `Looks like you enjoy ${node.name}`,
      text: 'Add it to your liked genres? It will slowly show up more in your main feed too.',
      buttons: [
        { label: 'Not yet', value: false, kind: 'ghost' },
        { label: 'Yes, add it', value: true, kind: 'primary' },
      ],
    });
    feed.answerGenre(node, !!yes);
    if (yes) toast(`${node.name} added to your taste 🧭`, { icon: 'check' });
  }

  function onUndo() {
    const track = undoStack.pop();
    if (!track) return;
    const removed = undoBlindSpotSwipe(track.trackId);
    if (removed) {
      // Roll back the ladder counters touched by that card (streaks are reset to be safe).
      storage.update((d) => {
        const g = d.blindSpotState.exploredGenres[removed.subGenre || removed.genre];
        if (g) {
          if (removed.liked) g.likes = Math.max(0, g.likes - 1);
          else if (removed.skipped) g.skips = Math.max(0, g.skips - 1);
          else g.dislikes = Math.max(0, g.dislikes - 1);
        }
        d.blindSpotState.likeStreak = 0;
        d.blindSpotState.dislikeStreak = 0;
      }, 'blindspot-state');
    }
    feed.queue.unshift(track);
    recap = null;
    deck.render();
    toast('Undone', { icon: 'undo' });
  }

  deck = new Deck({
    container: body,
    tracks: () => (recap ? [] : feed.queue),
    onDecide,
    onUndo,
    canUndo: () => undoStack.length > 0,
    extras,
    skipButton: true,
    empty,
  });
  deck.render();
  fill();
  return () => deck.destroy();
}

/* ------------------------------------------------------------------ */
/* Comfort zone map                                                     */
/* ------------------------------------------------------------------ */

/** Exploration progress: comfort ladder, unlocked territory, settings. (The map is its own page now.) */
function mountProgress(view) {
  const render = () => {
    const d = storage.data;
    const st = d.blindSpotState;
    const explored = Object.entries(st.exploredGenres || {});
    const liked = explored.filter(([, g]) => g.likes > 0).sort((a, b) => b[1].likes - a[1].likes);
    const discoveries = (st.discoveries || []).map((id) => NODES.get(id)?.name || id);

    clear(view).append(
      h(
        'div',
        { class: 'page-head' },
        h('a', { class: 'icon-btn', href: '#/blindspot', 'aria-label': 'Back to Blind Spot' }, icon('back')),
        h('h1', { style: { flex: '1' } }, 'Your exploration')
      ),
      h('a', { class: 'btn block', href: '#/map', style: { marginBottom: '14px' } }, icon('map', { size: 18 }), 'Open your Music Map'),
      h(
        'section',
        { class: 'profile-section' },
        h('h2', {}, 'Home'),
        h('p', { class: 'muted small' }, 'Genres you already love. Blind Spot looks around them.'),
        h('div', { class: 'chips' }, [...comfortNodes(d)].map((id) => h('span', { class: 'chip static' }, NODES.get(id).name)))
      ),
      h(
        'section',
        { class: 'profile-section' },
        h('h2', {}, 'Comfort ladder'),
        h(
          'div',
          { class: 'row wrap' },
          [1, 2, 3].map((l) =>
            h(
              'span',
              { class: `level-badge l${l}`, style: { opacity: l <= st.currentLevel ? '1' : '0.35' }, 'aria-label': `${LEVELS[l].name}${l <= st.currentLevel ? ' (unlocked)' : ' (locked)'}` },
              (l <= st.currentLevel ? '' : '🔒 ') + LEVELS[l].name
            )
          )
        ),
        h('p', { class: 'muted small', style: { marginTop: '10px' } }, LEVELS[st.currentLevel].hint + '. Three likes in a row unlock the next step.')
      ),
      h(
        'section',
        { class: 'profile-section' },
        h('h2', {}, 'Territory unlocked'),
        liked.length
          ? h('div', { class: 'chips' }, liked.map(([name, g]) => h('span', { class: 'chip static', 'data-state': 'liked' }, `${name} · ${g.likes}♥`)))
          : h('p', { class: 'muted small' }, 'Like a song in Blind Spot and its genre lights up here.'),
        discoveries.length ? h('p', { class: 'small', style: { marginTop: '10px' } }, `Added to your taste: ${discoveries.join(', ')}`) : null
      ),
      h(
        'section',
        { class: 'profile-section' },
        h(
          'div',
          { class: 'switch-row' },
          h('label', { for: 'bs-second' }, 'Give my disliked genres a second chance', h('span', { class: 'hint' }, 'Only their most accessible songs')),
          h('input', {
            type: 'checkbox',
            role: 'switch',
            class: 'switch',
            id: 'bs-second',
            checked: st.allowDislikedGenres,
            onChange: (e) => {
              storage.update((dd) => (dd.blindSpotState.allowDislikedGenres = e.target.checked), 'settings');
              feed.reset();
            },
          })
        ),
        h('a', { class: 'btn block', href: '#/decks/blindspot', style: { marginTop: '8px' } }, icon('compass', { size: 18 }), 'Blind Spot discoveries deck')
      ),
      h('a', { class: 'btn primary block', href: '#/blindspot' }, 'Keep exploring')
    );
  };
  render();
  return storage.subscribe((_, reason) => reason === 'remote' && render());
}
