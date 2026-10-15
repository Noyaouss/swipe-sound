/**
 * Game 4 — "Guess the song": 2 s of the preview, extendable to 5, 10, then 30 s (fewer points
 * each time); the cover stays hidden. Type the title (artist optional, for a bonus); typos are
 * forgiven (answerMatch.js). "Easy mode" gives 4 titles to choose from instead.
 */

import { h, icon } from '../ui.js';
import { nextSong, playClip, stopClip, MIN_POOL } from './pool.js';
import { checkAnswer, stripExtras } from './answerMatch.js';
import { ROUNDS, roundHeader, mysteryCover, nextButton, choice, sample } from './common.js';

const STEPS = [
  { seconds: 2, points: 100 },
  { seconds: 5, points: 70 },
  { seconds: 10, points: 50 },
  { seconds: 30, points: 30 },
];
const ARTIST_BONUS = 25;
const EASY_KEY = 'swipe-sound:guess-song-easy';

const isEasy = () => {
  try {
    return localStorage.getItem(EASY_KEY) === '1';
  } catch {
    return false;
  }
};

export default {
  id: 'guess-song',
  name: 'Guess the song',
  emoji: '🎧',
  blurb: 'Two seconds of a song you know. Name it! Listen longer for fewer points.',
  unit: 'pts',

  async check(ctx) {
    return ctx.list.length < MIN_POOL ? { title: 'Not enough songs yet', text: 'Like a few more songs, or import your music, to play.' } : null;
  },

  async play(stage, ctx) {
    const used = new Set();
    const head = roundHeader();
    let score = 0;
    let upcoming = nextSong(ctx.list, used);
    const easySwitch = h('input', {
      type: 'checkbox',
      role: 'switch',
      class: 'switch',
      id: 'guess-easy',
      checked: isEasy(),
      onChange: (e) => {
        try {
          localStorage.setItem(EASY_KEY, e.target.checked ? '1' : '0');
        } catch {
          /* not remembered */
        }
      },
    });
    const easyRow = h('div', { class: 'switch-row game-easy' }, h('label', { for: 'guess-easy' }, 'Easy mode', h('span', { class: 'hint' }, '4 titles to choose from (from the next song)')), easySwitch);

    for (let round = 1; round <= ROUNDS; round++) {
      const song = await upcoming;
      if (!song || !ctx.alive()) break;
      upcoming = nextSong(ctx.list, used);
      const t = song.t;
      head.set(round, score);
      let step = 0;
      const coverEl = mysteryCover();
      const playBtn = h('button', { type: 'button', class: 'btn' }, icon('play', { size: 18 }), `Play ${STEPS[0].seconds} s`);
      const moreBtn = h('button', { type: 'button', class: 'btn' }, `Listen longer: ${STEPS[1].seconds} s`);
      const listen = () => playClip(t, { seconds: STEPS[step].seconds });
      playBtn.addEventListener('click', listen);
      moreBtn.addEventListener('click', () => {
        step = Math.min(step + 1, STEPS.length - 1);
        playBtn.replaceChildren(icon('play', { size: 18 }), `Play ${STEPS[step].seconds} s`);
        if (step === STEPS.length - 1) moreBtn.hidden = true;
        else moreBtn.textContent = `Listen longer: ${STEPS[step + 1].seconds} s`;
        pointsEl.textContent = `Worth ${STEPS[step].points} points`;
        listen();
      });
      const pointsEl = h('p', { class: 'muted small', 'aria-live': 'polite' }, `Worth ${STEPS[0].points} points`);
      const feedback = h('p', { class: 'game-verdict', 'aria-live': 'polite' });
      const skip = h('button', { type: 'button', class: 'btn ghost' }, 'Skip');
      const form = h('form', { class: 'stack guess-form' });
      stage.replaceChildren(head, h('div', { class: 'game-song' }, coverEl, h('div', { class: 'stack' }, playBtn, moreBtn, pointsEl)), form, feedback, h('div', { class: 'game-answer' }));

      listen();
      // Answer: typed (normal) or one of 4 titles (easy).
      const outcome = await new Promise((resolve) => {
        skip.addEventListener('click', () => resolve({ ok: false, skipped: true }));
        if (easySwitch.checked) {
          // Other titles look like the real one: no "- Live…" / "(Remastered)" giveaways.
          const others = sample(ctx.list.filter((c) => c.key !== song.c.key && stripExtras(c.title).toLowerCase() !== t.title.toLowerCase()), 3).map((c) => stripExtras(c.title));
          const titles = sample([t.title, ...others], 4);
          const btns = titles.map((x) => h('button', { type: 'button', class: 'btn block genre-option' }, x));
          form.replaceChildren(...btns, skip, easyRow);
          choice(btns.map((b, i) => [b, titles[i]])).then((x) => resolve({ ok: x === t.title, typed: x }));
          return;
        }
        const titleIn = h('input', { class: 'input', placeholder: 'Song title', 'aria-label': 'Song title', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done' });
        const artistIn = h('input', { class: 'input', placeholder: `Artist (optional, +${ARTIST_BONUS})`, 'aria-label': 'Artist, optional', autocomplete: 'off', spellcheck: 'false' });
        form.replaceChildren(titleIn, artistIn, h('div', { class: 'row', style: { gap: '8px' } }, h('button', { type: 'submit', class: 'btn primary', style: { flex: '1' } }, 'Guess'), skip), easyRow);
        let triedClose = false;
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!titleIn.value.trim()) return titleIn.focus();
          const r = checkAnswer(titleIn.value, t.titleFull || t.title);
          if (!r.ok && r.close && !triedClose) {
            triedClose = true; // one more try, no points lost
            feedback.className = 'game-verdict close';
            feedback.textContent = 'So close! One more try.';
            return titleIn.focus();
          }
          resolve({ ...r, typed: titleIn.value.trim(), artistOk: !!artistIn.value.trim() && checkAnswer(artistIn.value, t.artistName).ok });
        });
        titleIn.focus();
      });
      stopClip();
      const pts = outcome.ok ? STEPS[step].points + (outcome.artistOk ? ARTIST_BONUS : 0) : 0;
      score += pts;
      head.set(round, score);
      coverEl.reveal(t);
      form.replaceChildren();
      feedback.className = 'game-verdict ' + (outcome.ok ? 'right' : 'wrong');
      feedback.textContent = outcome.ok
        ? `${outcome.forgiven ? `Accepted: you typed “${outcome.typed}”. ` : 'Yes! '}${pts} points${outcome.artistOk ? ' (artist bonus included)' : ''}.`
        : outcome.skipped
          ? 'Skipped.'
          : `Not this one${outcome.typed ? ` (you said “${outcome.typed}”)` : ''}.`;
      const next = nextButton(round === ROUNDS ? 'See my score' : 'Next song');
      stage.querySelector('.game-answer').replaceChildren(h('h2', {}, t.title), h('p', { class: 'muted' }, t.artistName), next);
      await choice([[next, true]]);
    }
    return { score, scoreText: `${score} points` };
  },
};
