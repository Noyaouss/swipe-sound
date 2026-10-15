/**
 * Game 3 — "Which genre?": the preview plays; pick its genre (Music Map sun) among 4.
 * Answers come from the same placement as the Music Map (genreGraph.placeTrack); only songs
 * placed with confidence (a known sub-genre) are used. Early rounds offer distant genres,
 * later ones neighbouring genres (constellation links). Bonus question: the sub-genre.
 */

import { h } from '../ui.js';
import { NODES, FAMILIES, stylesOf, familyLinks, placeTrack } from '../genreGraph.js';
import { tasteCounts, computeLayout, normArtist } from '../musicMap.js';
import { songKey } from '../recommender.js';
import { planetLook } from '../planetArt.js';
import { nextSong, stopClip, MIN_POOL } from './pool.js';
import { ROUNDS, previewButton, roundHeader, mysteryCover, nextButton, choice, sample, wait } from './common.js';

const SUN_POINTS = 100;
const PLANET_POINTS = 50;

/** Confident placements { [songKey]: { family, style, moon } }: liked songs, else the artist's sub-genre. */
function placements(ctx) {
  const out = new Map();
  for (const s of ctx.data.likedSongs) {
    const p = placeTrack(s);
    if (p.style) out.set(songKey(s), p);
  }
  for (const c of ctx.list) {
    if (out.has(c.key)) continue;
    const a = ctx.data.artistGenres[normArtist(c.artist)];
    if (a && a.s && NODES.get(a.s)) out.set(c.key, { family: NODES.get(a.s).family, style: a.s, moon: a.m || null });
  }
  return out;
}

/** Steps between two genres along the constellation links. */
function familyDistances(from) {
  const links = familyLinks();
  const dist = new Map([[from, 0]]);
  let frontier = [from];
  while (frontier.length) {
    const next = [];
    for (const f of frontier)
      for (const l of links) {
        const o = l.a === f ? l.b : l.b === f ? l.a : null;
        if (!o || dist.has(o)) continue;
        dist.set(o, dist.get(f) + 1);
        next.push(o);
      }
    frontier = next;
  }
  return dist;
}

/** 3 wrong genres: far apart in the first rounds, neighbours in the last ones. */
function distractors(family, round) {
  const dist = familyDistances(family);
  const others = FAMILIES.map((f) => f.id).filter((id) => id !== family);
  const d = (id) => dist.get(id) ?? 9;
  const pool = round <= 4 ? others.filter((id) => d(id) >= 2) : round >= 7 ? others.filter((id) => d(id) === 1) : others;
  const picked = sample(pool, 3);
  return picked.concat(sample(others.filter((id) => !picked.includes(id)), 3 - picked.length));
}

export default {
  id: 'which-genre',
  name: 'Which genre?',
  emoji: '🪐',
  blurb: 'A song plays: which sun of your Music Map does it orbit? Bonus points for the planet.',
  unit: 'pts',

  async check(ctx) {
    const n = [...placements(ctx).keys()].filter((k) => ctx.list.some((c) => c.key === k)).length;
    return n < MIN_POOL ? { title: 'Not enough sorted songs yet', text: 'Open the Music Map once so it can sort your music into genres, or like a few more songs.' } : null;
  },

  async play(stage, ctx) {
    const placed = placements(ctx);
    const list = ctx.list.filter((c) => placed.has(c.key));
    const layout = computeLayout(tasteCounts(), new Set());
    const sunColour = new Map(layout.systems.map((s) => [s.id, s.star.core]));
    const used = new Set();
    const head = roundHeader();
    let score = 0;
    let upcoming = nextSong(list, used);

    const crumb = (p) =>
      h(
        'div',
        { class: 'genre-crumb', 'aria-label': 'Where it sits on your Music Map' },
        [
          [p.family, sunColour.get(p.family) || '#ffd75e'],
          [p.style, p.style && planetLook(p.style).colors[0]],
          [p.moon, '#c9c6d2'],
        ]
          .filter(([id]) => id && NODES.get(id))
          .flatMap(([id, colour], i) => [i ? h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '›') : null, h('span', { class: 'crumb' }, h('i', { style: { background: colour } }), NODES.get(id).name)])
          .filter(Boolean)
      );
    const ask = async (question, options, right) => {
      const btns = options.map((id) => h('button', { type: 'button', class: 'btn block genre-option' }, NODES.get(id).name));
      const box = h('div', { class: 'genre-options' }, h('p', { class: 'hl-ask' }, question), ...btns);
      stage.querySelector('.game-question').replaceChildren(box);
      const picked = await choice(btns.map((b, i) => [b, i]));
      btns.forEach((b, i) => {
        b.disabled = true;
        if (options[i] === right) b.classList.add('right');
        else if (i === picked) b.classList.add('wrong');
      });
      await wait(900);
      return options[picked] === right;
    };

    for (let round = 1; round <= ROUNDS; round++) {
      const song = await upcoming;
      if (!song || !ctx.alive()) break;
      upcoming = nextSong(list, used);
      const p = placed.get(song.c.key);
      const t = song.t;
      head.set(round, score);
      const coverEl = mysteryCover();
      const play = previewButton(t);
      stage.replaceChildren(head, h('div', { class: 'game-song' }, coverEl, play), h('div', { class: 'game-question' }), h('div', { class: 'game-answer' }));
      play.play();

      let pts = 0;
      if (await ask('Which genre?', sample([p.family, ...distractors(p.family, round)], 4), p.family)) {
        pts += SUN_POINTS;
        const planets = stylesOf(p.family).map((n) => n.id).filter((id) => id !== p.style);
        if (planets.length >= 3 && (await ask(`Bonus: which ${NODES.get(p.family).name} planet?`, sample([p.style, ...sample(planets, 3)], 4), p.style))) pts += PLANET_POINTS;
      }
      score += pts;
      head.set(round, score);
      coverEl.reveal(t);
      const next = nextButton(round === ROUNDS ? 'See my score' : 'Next song');
      stage.querySelector('.game-question').replaceChildren();
      stage.querySelector('.game-answer').replaceChildren(
        h('h2', {}, t.title),
        h('p', { class: 'muted' }, t.artistName),
        crumb(p),
        h('p', { class: 'game-verdict ' + (pts ? 'right' : 'wrong') }, `${pts} points`),
        next
      );
      await choice([[next, true]]);
      stopClip();
    }
    return { score, scoreText: `${score} points` };
  },
};
