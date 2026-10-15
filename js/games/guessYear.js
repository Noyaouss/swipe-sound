/**
 * Game 2 — "Guess the year": the preview plays with the cover hidden; pick the release year.
 * Uses the ORIGINAL year: the earliest MusicBrainz release of that recording, else the Deezer
 * album year, and songs whose only year comes from a compilation/remaster album are skipped.
 */

import { h, icon } from '../ui.js';
import * as ds from '../dataService.js';
import { nextSong, stopClip, MIN_POOL } from './pool.js';
import { stripExtras } from './answerMatch.js';
import { ROUNDS, previewButton, roundHeader, mysteryCover, nextButton, choice } from './common.js';

const THIS_YEAR = new Date().getFullYear();
const COMPILATION = /\b(greatest hits|best of|the very best|hits|remaster(ed)?|anniversary|collection|essentials?|anthology|compilation|gold|number ones|deluxe)\b/i;

/** exact = 100, ±1 = 80, ±2 = 60, ±3 = 40, ±4 = 30, ±5 = 20, more = 0 */
export const yearPoints = (diff) => [100, 80, 60, 40, 30, 20][Math.abs(diff)] ?? 0;

/** The year a song first came out, or null when only a compilation/remaster year is known. */
export async function originalYear(t) {
  const mb = await ds.firstReleaseYear(t.artistName, stripExtras(t.titleFull || t.title)).catch(() => null);
  const deezer = t.year && !COMPILATION.test(t.albumTitle || '') ? t.year : null;
  const years = [mb, deezer].filter((y) => y && y <= THIS_YEAR);
  return years.length ? Math.min(...years) : null;
}

export default {
  id: 'guess-year',
  name: 'Guess the year',
  emoji: '📅',
  blurb: 'A song from your music plays, cover hidden. When did it first come out?',
  unit: 'pts',

  async check(ctx) {
    return ctx.list.length < MIN_POOL ? { title: 'Not enough songs yet', text: 'Like a few more songs, or import your music, to play.' } : null;
  },

  async play(stage, ctx) {
    const used = new Set();
    const accept = async (t) => (t.origYear = await originalYear(t)) != null;
    const head = roundHeader();
    let score = 0;
    let upcoming = nextSong(ctx.list, used, accept); // the next song is found while you listen
    for (let round = 1; round <= ROUNDS; round++) {
      const song = await upcoming;
      if (!song || !ctx.alive()) break;
      upcoming = nextSong(ctx.list, used, accept);
      const t = song.t;
      head.set(round, score);
      const low = Math.min(1950, t.origYear - 5);
      let year = 1995;
      const yearEl = h('output', { class: 'year-value', 'aria-live': 'polite' }, String(year));
      const slider = h('input', { type: 'range', min: low, max: THIS_YEAR, step: 1, value: year, class: 'year-slider', 'aria-label': 'Release year' });
      const set = (y) => {
        year = Math.max(low, Math.min(THIS_YEAR, y));
        slider.value = year;
        yearEl.textContent = year;
      };
      slider.addEventListener('input', () => set(+slider.value));
      const step = (d, label) => h('button', { type: 'button', class: 'btn small', 'aria-label': label, onClick: () => set(year + d) }, d > 0 ? `+${d}` : `${d}`);
      const confirm = h('button', { type: 'button', class: 'btn primary block' }, icon('check', { size: 18 }), 'This year');
      const coverEl = mysteryCover();
      const play = previewButton(t);
      const answer = h('div', { class: 'game-answer' });
      stage.replaceChildren(
        head,
        h('div', { class: 'game-song' }, coverEl, play),
        answer,
        h('div', { class: 'year-pick' }, yearEl, slider, h('div', { class: 'row year-steps' }, step(-10, '10 years earlier'), step(-1, 'A year earlier'), step(1, 'A year later'), step(10, '10 years later')), confirm)
      );
      play.play();
      await choice([[confirm, true]]);
      const pts = yearPoints(year - t.origYear);
      score += pts;
      head.set(round, score);
      coverEl.reveal(t);
      stage.querySelector('.year-pick').replaceChildren();
      const next = nextButton(round === ROUNDS ? 'See my score' : 'Next song');
      answer.replaceChildren(
        h('h2', {}, t.title),
        h('p', { class: 'muted' }, t.artistName),
        h('p', { class: 'game-verdict ' + (pts ? 'right' : 'wrong') }, `First released in ${t.origYear}. You said ${year}: ${pts} points.`),
        next
      );
      await choice([[next, true]]);
      stopClip();
    }
    return { score, scoreText: `${score} points` };
  },
};
