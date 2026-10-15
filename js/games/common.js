/** Small pieces shared by the games: preview button, count-up, round header, waiting. */

import { h, icon } from '../ui.js';
import { playClip, stopClip } from './pool.js';

export const ROUNDS = 10;
export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const wait = (ms) => new Promise((r) => setTimeout(r, reduceMotion() ? Math.min(ms, 400) : ms));

/** Play/pause button for a track's preview (optionally only the first `seconds`). */
export function previewButton(track, { seconds = 0, label = 'preview' } = {}) {
  const btn = h('button', { type: 'button', class: 'play-btn game-play', 'aria-label': `Play ${label}` }, icon('play', { size: 24 }));
  let on = false;
  const set = (v) => {
    on = v;
    btn.replaceChildren(icon(v ? 'pause' : 'play', { size: 24 }));
    btn.setAttribute('aria-label', `${v ? 'Pause' : 'Play'} ${label}`);
  };
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (on) return stopClip();
    set(true);
    if (!(await playClip(track, { seconds, onEnd: () => set(false) }))) set(false);
  });
  btn.play = () => !on && btn.click();
  return btn;
}

/** Animate a number from 0 to `to` (instant with reduced motion). */
export function countUp(el, to, ms = 700) {
  if (reduceMotion() || !to) {
    el.textContent = to.toLocaleString();
    return Promise.resolve();
  }
  // A timer, not animation frames: those pause when the page isn't shown, and the game would wait forever.
  return new Promise((resolve) => {
    const t0 = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / ms);
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))).toLocaleString();
      if (p < 1) setTimeout(step, 30);
      else resolve();
    };
    step();
  });
}

/** "Round 3/10 · 240 pts" */
export function roundHeader() {
  const el = h('div', { class: 'game-head', 'aria-live': 'polite' });
  el.set = (round, score, unit = 'pts') => (el.textContent = `Round ${round}/${ROUNDS} · ${score.toLocaleString()} ${unit}`);
  return el;
}

/** A hidden cover (it often gives the era away) that can be revealed. */
export function mysteryCover() {
  const el = h('div', { class: 'game-cover mystery', 'aria-label': 'Hidden cover' }, h('span', { 'aria-hidden': 'true' }, '?'));
  el.reveal = (track) => {
    el.classList.remove('mystery');
    el.setAttribute('aria-label', `Cover of ${track.albumTitle || track.title}`);
    el.replaceChildren(h('img', { src: track.coverSmall || track.coverUrl, alt: '' }));
  };
  return el;
}

/** Resolves with the value of the first button clicked. */
export const choice = (buttons) =>
  new Promise((resolve) => {
    for (const [btn, value] of buttons) btn.addEventListener('click', () => resolve(value), { once: true });
  });

/** Pick n random items. */
export function sample(list, n) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

export const nextButton = (label = 'Next') => h('button', { type: 'button', class: 'btn primary block game-next' }, label, icon('chevron', { size: 18 }));
