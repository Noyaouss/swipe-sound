/**
 * Game 1 — "Guess the most streamed song": two songs from your music, tap the one more people
 * stream (Deezer's popularity score, `rank`, which follows its streams). Endless streak: the
 * winner stays, a new challenger comes in, until the first mistake. Pairs start far apart and
 * get closer (within ~20%) as the streak grows. No listening history needed.
 */

import { h, cover } from '../ui.js';
import { resolve, pickWeighted, MIN_POOL } from './pool.js';
import { previewButton, countUp, wait, choice } from './common.js';

const READY = 24; // songs looked up ahead, to pick well-matched challengers from

/** A challenger whose gap with the champion fits the streak: big early, close (≤ ~20%) later. */
function challenger(ready, champ, streak) {
  const target = Math.max(0.1, 0.7 - 0.06 * streak); // relative gap |a-b| / max(a,b)
  let best = null;
  let bestErr = Infinity;
  for (const s of ready) {
    if (s.t.rank === champ.t.rank) continue; // never two equal scores
    const err = Math.abs(Math.abs(s.t.rank - champ.t.rank) / Math.max(s.t.rank, champ.t.rank) - target);
    if (err < bestErr) [best, bestErr] = [s, err];
  }
  return best;
}

export default {
  id: 'most-streamed',
  name: 'Guess the most streamed song',
  emoji: '🔥',
  blurb: 'Two songs from your music: tap the one more people stream. One mistake ends the streak.',
  unit: 'in a row',

  async check(ctx) {
    return ctx.list.length < MIN_POOL ? { title: 'Not enough songs yet', text: 'Like a few more songs, or import your music, to play.' } : null;
  },

  async play(stage, ctx) {
    const used = new Set();
    const ready = []; // [{ c, t }] looked up, with a popularity score, not shown yet
    let filling = null;
    const fill = () =>
      (filling ||= (async () => {
        for (let misses = 0; ready.length < READY && misses < 40; ) {
          const c = pickWeighted(ctx.list, used);
          if (!c) break;
          used.add(c.key);
          const t = await resolve(c);
          if (t && t.rank > 0) ready.push({ c, t });
          else misses++;
        }
        filling = null;
      })());
    await fill();
    if (ready.length < 2) return null;

    const take = (s) => ready.splice(ready.indexOf(s), 1)[0];
    const card = (s) => {
      const countEl = h('strong', { class: 'hl-count' }, '?');
      const el = h(
        'button',
        { type: 'button', class: 'hl-card', 'aria-label': `${s.t.title} by ${s.t.artistName}` },
        cover(s.t.coverSmall, '', 'hl-cover'),
        h('span', { class: 'hl-text' }, h('span', { class: 'hl-name' }, s.t.title), h('span', { class: 'muted small' }, s.t.artistName), countEl)
      );
      return { ...s, el, countEl };
    };
    const streakEl = h('div', { class: 'game-head', 'aria-live': 'polite' }, 'Streak: 0');
    const seen = [];
    let streak = 0;
    let champ = card(take(ready[Math.floor(Math.random() * ready.length)]));
    seen.push(champ);

    for (;;) {
      if (!ctx.alive()) return null;
      if (ready.length < READY / 2) fill(); // top up in the background
      if (!ready.length) await fill();
      const pick = challenger(ready, champ, streak);
      if (!pick) break; // played them all!
      const chall = card(take(pick));
      seen.push(chall);
      champ.countEl.textContent = '?';
      champ.el.className = 'hl-card';
      champ.el.disabled = false;
      const row = (c) => h('div', { class: 'hl-row' }, c.el, previewButton(c.t, { label: `preview of ${c.t.title}` }));
      stage.replaceChildren(streakEl, h('p', { class: 'hl-ask' }, 'Which one do more people stream?'), row(champ), h('div', { class: 'hl-vs', 'aria-hidden': 'true' }, 'vs'), row(chall));
      const picked = await choice([
        [champ.el, champ],
        [chall.el, chall],
      ]);
      const other = picked === champ ? chall : champ;
      champ.el.disabled = chall.el.disabled = true;
      await Promise.all([countUp(champ.countEl, champ.t.rank), countUp(chall.countEl, chall.t.rank)]);
      const right = picked.t.rank > other.t.rank;
      picked.el.classList.add(right ? 'right' : 'wrong');
      other.el.classList.add(right ? 'dim' : 'right');
      await wait(right ? 1100 : 1800);
      if (!right) break;
      streak++;
      streakEl.textContent = `Streak: ${streak}`;
      champ = picked; // the more streamed song stays
    }

    const top = seen.reduce((a, b) => (b.t.rank > a.t.rank ? b : a));
    return {
      score: streak,
      scoreText: `${streak} in a row`,
      fact: `The most streamed song you met: ${top.t.title} by ${top.t.artistName} (popularity ${top.t.rank.toLocaleString()} on Deezer).`,
    };
  },
};
