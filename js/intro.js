/**
 * intro — the opening animation: your Music Map assembling itself.
 *
 *   1. Genres (suns) branch out from the centre, biggest first, each one flying out
 *      from a related sun that's already placed while their constellation line draws.
 *   2. Sub-genres (planets) branch out from their sun as their orbits open,
 *      most songs first.
 * Events start slow and accelerate. ~3 s in total; a tap skips it. Not played for a
 * new user with no data, or when the device asks for reduced motion.
 */

import { h } from './ui.js';
import { storage } from './storage.js';
import { tasteCounts, computeLayout, SUN_MAX } from './musicMap.js';
import { knownReady } from './recommender.js';
import { buildGalaxy, nightSky } from './pages/map.js';

const SUNS_MS = 1400; // phase 1
const PLANETS_MS = 1500; // phase 2
const POP_MS = 420; // each element's own grow/fly animation
const HOLD_MS = 350; // pause on the finished map
const FADE_MS = 450;

const ease = (p) => 1 - Math.pow(1 - p, 3);
const clamp = (p) => Math.max(0, Math.min(1, p));
/** Start time of the i-th of n events: sqrt spacing = long gaps first, then faster and faster. */
const when = (i, n, total) => (n <= 1 ? 0 : total * Math.sqrt(i / (n - 1)));

export function shouldPlayIntro() {
  if (!storage.data.onboarded) return false;
  // Nothing to draw yet (brand-new user): go straight to Swipe.
  if (!storage.data.likedSongs.length && !Object.keys(storage.data.artistGenres || {}).length) return false;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const route = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return route === '' || route === 'swipe';
}

/** Play the intro over the app. Resolves when it's gone (or immediately if there's nothing to show). */
export async function playIntro() {
  // Show the night sky right away; the galaxy appears once the data is in.
  const stage = h('div', { class: 'intro-stage' });
  const overlay = h(
    'div',
    { class: 'intro', role: 'img', 'aria-label': 'Your music map is drawing itself. Tap to skip.' },
    stage,
    h('p', { class: 'intro-skip' }, 'Tap to skip')
  );
  document.body.append(overlay);
  stage.append(nightSky(stage));
  let skipped = false;
  const skipEarly = () => (skipped = true);
  overlay.addEventListener('pointerdown', skipEarly);
  addEventListener('hashchange', skipEarly, { once: true }); // left Swipe (e.g. a deep link or back button)
  const leave = () =>
    new Promise((resolve) => {
      overlay.classList.add('out');
      setTimeout(() => {
        overlay.remove();
        resolve();
      }, FADE_MS);
    });

  // Give the Spotify library a moment to load, but never hold the app up for long.
  await Promise.race([knownReady(), new Promise((r) => setTimeout(r, 1500))]);
  const counts = tasteCounts();
  if (skipped || !counts.total || ![...counts.families.values()].some((f) => f.count)) return leave(); // brand-new user
  overlay.removeEventListener('pointerdown', skipEarly);

  const layout = computeLayout(counts, new Set());
  const galaxy = buildGalaxy(layout, { interactive: false });
  stage.append(galaxy.svg);

  // Frame only your genres (empty ones stay out of the intro), so the systems look big.
  const r = stage.getBoundingClientRect();
  const mine = layout.systems.filter((x) => x.count);
  const minX = Math.min(...mine.map((x) => x.x - x.R));
  const maxX = Math.max(...mine.map((x) => x.x + x.R));
  const minY = Math.min(...mine.map((x) => x.y - x.R));
  const maxY = Math.max(...mine.map((x) => x.y + x.R));
  const b = { minX, minY, w: maxX - minX, h: maxY - minY };
  const k = Math.min(r.width / b.w, r.height / b.h) * 0.92;
  galaxy.svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
  galaxy.world.setAttribute('transform', `translate(${r.width / 2 - (b.minX + b.w / 2) * k} ${r.height / 2 - (b.minY + b.h / 2) * k}) scale(${k})`);
  galaxy.svg.style.setProperty('--k', k);
  galaxy.svg.style.setProperty('--sun-boost', Math.max(1, 34 / (2 * SUN_MAX * k))); // same as the map
  galaxy.svg.classList.add('intro-mode');

  // ---- Build the timeline ----
  const suns = layout.order.filter((s) => s.count); // biggest first
  const sunById = new Map(suns.map((s) => [s.id, s]));
  const placed = [];
  const events = []; // { at, kind, ... }
  const centre = suns[0];
  suns.forEach((sys, i) => {
    // Fly out from the biggest already-placed sun it's linked to, else from the centre.
    const linked = layout.links
      .filter((l) => (l.a === sys.id && placed.includes(l.b)) || (l.b === sys.id && placed.includes(l.a)))
      .map((l) => sunById.get(l.a === sys.id ? l.b : l.a))
      .sort((a, b) => b.count - a.count);
    const from = linked[0] || centre;
    const line = galaxy.lines.find((l) => (l.a === sys.id && l.b === from.id) || (l.b === sys.id && l.a === from.id));
    events.push({ at: when(i, suns.length, SUNS_MS), kind: 'sun', sys, from: i ? from : null, line: i ? line : null });
    placed.push(sys.id);
  });
  const planets = suns
    .flatMap((sys) => sys.planets.map((p) => ({ sys, p })))
    .sort((a, b) => b.p.count - a.p.count || b.sys.count - a.sys.count);
  planets.forEach((x, i) => events.push({ at: SUNS_MS + 150 + when(i, planets.length, PLANETS_MS), kind: 'planet', ...x }));

  // ---- Elements to animate ----
  const svg = galaxy.svg;
  const sunEl = (id) => svg.querySelector(`[data-sun="${id}"]`);
  const planetEl = (id) => svg.querySelector(`[data-planet="${id}"]`);
  for (const sys of layout.systems) {
    const g = galaxy.systems.get(sys.id);
    if (!sys.count) g.style.opacity = '0'; // empty genres stay out of the intro
    g.querySelectorAll('.orbit').forEach((o) => o.setAttribute('data-r', o.getAttribute('r')));
  }
  // Everything starts hidden.
  for (const e of events) {
    if (e.kind === 'sun') sunEl(e.sys.id).style.opacity = '0';
    else planetEl(e.p.id).style.opacity = '0';
  }
  svg.querySelectorAll('.orbit').forEach((o) => o.setAttribute('r', 0));
  for (const l of galaxy.lines) {
    const len = Math.hypot(l.el.x2.baseVal.value - l.el.x1.baseVal.value, l.el.y2.baseVal.value - l.el.y1.baseVal.value);
    l.len = len;
    l.el.style.strokeDasharray = `${len} ${len}`;
    l.el.style.strokeDashoffset = `${len}`;
  }
  const linesUsed = new Set(events.filter((e) => e.line).map((e) => e.line));
  for (const l of galaxy.lines) if (!linesUsed.has(l)) l.el.style.opacity = '0'; // the rest appear at the end

  const total = SUNS_MS + 150 + PLANETS_MS + POP_MS;
  let done = false;
  let finishResolve;
  const finished = new Promise((r) => (finishResolve = r));

  const frame = (t0) => (now) => {
    if (done) return;
    const t = now - t0;
    for (const e of events) {
      const p = ease(clamp((t - e.at) / POP_MS));
      if (e.kind === 'sun') {
        const el = sunEl(e.sys.id);
        const fx = e.from ? (e.from.x - e.sys.x) * (1 - p) : 0;
        const fy = e.from ? (e.from.y - e.sys.y) * (1 - p) : 0;
        const sc = 0.2 + 0.8 * p;
        el.style.opacity = String(clamp(p * 1.6));
        el.setAttribute('transform', `translate(${fx} ${fy}) translate(${e.sys.x} ${e.sys.y}) scale(${sc}) translate(${-e.sys.x} ${-e.sys.y})`);
        el.querySelector('.sun-label').style.opacity = String(p > 0.85 ? (p - 0.85) / 0.15 : 0);
        if (e.line) e.line.el.style.strokeDashoffset = String(e.line.len * (1 - p));
      } else {
        const el = planetEl(e.p.id);
        const fx = (e.sys.x - e.p.x) * (1 - p);
        const fy = (e.sys.y - e.p.y) * (1 - p);
        el.style.opacity = String(clamp(p * 1.4));
        el.setAttribute('transform', `translate(${fx} ${fy}) translate(${e.p.x} ${e.p.y}) scale(${p}) translate(${-e.p.x} ${-e.p.y})`);
        const orbit = galaxy.systems.get(e.sys.id).querySelectorAll('.orbit')[e.sys.planets.indexOf(e.p)];
        if (orbit) orbit.setAttribute('r', String(+orbit.dataset.r * p));
      }
    }
    if (t >= total) {
      for (const l of galaxy.lines) {
        l.el.style.transition = 'opacity 0.3s';
        l.el.style.opacity = '';
      }
      setTimeout(() => finish(), HOLD_MS);
      return;
    }
    requestAnimationFrame(frame(t0));
  };

  function finish() {
    if (done) return;
    done = true;
    overlay.classList.add('out');
    setTimeout(() => {
      overlay.remove();
      finishResolve();
    }, FADE_MS);
  }

  overlay.addEventListener('pointerdown', finish);
  addEventListener('keydown', finish, { once: true });
  addEventListener('hashchange', finish, { once: true }); // navigating away ends the intro
  requestAnimationFrame((now) => frame(now)(now));
  return finished;
}
