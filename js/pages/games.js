/**
 * Games — small games built on your own music (#/games, #/games/<id>[?mode=…]).
 * The page lists one card per game with its personal best; more games can be added to GAMES.
 * Each game module exports { id, name, emoji, blurb, unit, modes?, check(ctx), play(stage, ctx) }.
 */

import { h, icon, clear, spinner, toast, copyText } from '../ui.js';
import { storage } from '../storage.js';
import { knownReady } from '../recommender.js';
import { candidates, stopClip } from '../games/pool.js';
import { getPlayStats } from '../playStats.js';
import mostStreamed from '../games/mostStreamed.js';
import guessYear from '../games/guessYear.js';
import whichGenre from '../games/whichGenre.js';
import guessSong from '../games/guessSong.js';

const GAMES = [mostStreamed, guessYear, whichGenre, guessSong];

const bestKey = (game, mode) => (mode ? `${game.id}:${mode}` : game.id);
const bestOf = (game, mode) => storage.data.gameBests[bestKey(game, mode)] || 0;

export function mount(view, params) {
  const game = GAMES.find((g) => g.id === params[0]);
  let alive = true;
  if (game) runGame(view, game, () => alive);
  else list(view);
  return () => {
    alive = false;
    stopClip();
  };
}

function list(view) {
  view.append(
    h('div', { class: 'page-head' }, h('h1', {}, 'Games')),
    h('p', { class: 'muted small' }, 'Small games with your own music.'),
    h(
      'div',
      { class: 'game-list' },
      GAMES.map((g) => {
        const best = g.modes ? Math.max(...g.modes.map((m) => bestOf(g, m.id))) : bestOf(g);
        return h(
          'a',
          { class: 'game-card', href: `#/games/${g.id}` },
          h('span', { class: 'game-emoji', 'aria-hidden': 'true' }, g.emoji),
          h('span', { class: 'game-card-text' }, h('strong', {}, g.name), h('span', { class: 'muted small' }, g.blurb), h('span', { class: 'small game-best' }, best ? `Best: ${best.toLocaleString()} ${g.unit}` : 'Not played yet')),
          icon('chevron', { size: 20 })
        );
      })
    )
  );
}

async function runGame(view, game, alive) {
  const mode = new URLSearchParams(location.hash.split('?')[1] || '').get('mode') || (game.modes ? game.modes[0].id : null);
  const stage = h('div', { class: 'game-stage' }, spinner('Getting your songs ready…'));
  view.append(
    h('div', { class: 'page-head' }, h('a', { class: 'icon-btn', href: '#/games', 'aria-label': 'Back to games' }, icon('back')), h('h1', { style: { flex: '1' } }, game.name)),
    game.modes
      ? h(
          'div',
          { class: 'segmented game-modes', role: 'group', 'aria-label': 'Mode' },
          game.modes.map((m) => h('a', { href: `#/games/${game.id}?mode=${m.id}`, class: 'btn small', 'aria-pressed': String(m.id === mode) }, m.label))
        )
      : null,
    stage
  );

  await knownReady();
  const ctx = { data: storage.data, mode, alive, list: await candidates(storage.data), stats: await getPlayStats(storage.data) };
  const problem = await game.check(ctx);
  if (!alive()) return;
  if (problem) {
    clear(stage).append(
      h(
        'div',
        { class: 'profile-section' },
        h('h2', {}, problem.title),
        h('p', { class: 'small' }, problem.text),
        h('a', { class: 'btn primary block', href: '#/profile/import' }, icon('upload', { size: 18 }), 'Import your music')
      )
    );
    return;
  }

  for (;;) {
    clear(stage).append(spinner('Picking songs…'));
    const result = await game.play(stage, ctx).catch((err) => {
      console.error(err);
      return null;
    });
    stopClip();
    if (!alive()) return;
    if (!result) {
      clear(stage).append(h('p', { class: 'muted' }, 'Couldn’t find playable songs right now. Check your connection and try again.'));
      return;
    }
    const key = bestKey(game, mode);
    const before = storage.data.gameBests[key] || 0;
    const record = result.score > before;
    if (record) storage.update((d) => (d.gameBests[key] = result.score), 'games');
    const best = Math.max(before, result.score);
    const modeLabel = game.modes ? ` (${game.modes.find((m) => m.id === mode).label})` : '';
    const share = `🎵 Swipe Sound · ${game.name}${modeLabel}: ${result.scoreText}${record ? ' (new personal best!)' : ` · my best: ${best.toLocaleString()} ${game.unit}`}`;
    const again = h('button', { type: 'button', class: 'btn primary block' }, icon('refresh', { size: 18 }), 'Play again');
    clear(stage).append(
      h(
        'div',
        { class: 'game-end' },
        h('p', { class: 'muted' }, 'Your score'),
        h('p', { class: 'game-score' }, result.scoreText),
        h('p', { class: record ? 'game-verdict right' : 'muted' }, record ? 'New personal best!' : `Personal best: ${best.toLocaleString()} ${game.unit}`),
        result.fact ? h('p', { class: 'game-fact' }, result.fact) : null,
        h(
          'button',
          { type: 'button', class: 'btn block', onClick: async () => ((await copyText(share)) ? toast('Result copied: paste it anywhere', { icon: 'copy' }) : toast(share, { duration: 6000 })) },
          icon('copy', { size: 18 }),
          'Share'
        ),
        again,
        h('a', { class: 'btn ghost block', href: '#/games' }, 'All games')
      )
    );
    await new Promise((r) => again.addEventListener('click', r, { once: true }));
  }
}
