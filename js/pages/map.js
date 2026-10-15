/**
 * Music Map — your taste as a galaxy. Genres are suns (sized by your songs),
 * sub-genres are planets on their orbits, related genres are joined by faint
 * constellation lines. Pan by dragging, zoom with pinch / wheel / buttons.
 */

import { h, icon, clear, spinner } from '../ui.js';
import { storage } from '../storage.js';
import { tasteCounts, computeLayout, runClassifier, onClassifierProgress, classifierState, SUN_MAX } from '../musicMap.js';
import { loadKnownLibrary, knownReady } from '../recommender.js';
import { navigate } from '../router.js';
import { sunArt, planetArt, planetLook, moonArt } from '../planetArt.js';
import { importReminder } from './spotify.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v);
  for (const c of children) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

function moonIcon(id) {
  const svg = s('svg', { viewBox: '-8 -8 16 16', width: 22, height: 22, 'aria-hidden': 'true' });
  svg.append(moonArt(id, 6));
  return svg;
}

/** A small standalone SVG of a planet, for the info panel. */
function planetIcon(id) {
  const svg = s('svg', { viewBox: '-16 -16 32 32', width: 30, height: 30, 'aria-hidden': 'true' });
  svg.append(planetArt(id, 11));
  return svg;
}

/**
 * A starry night behind the map: a canvas with hundreds of stars of varied size
 * and colour, a faint Milky Way band, and a few stars that twinkle (CSS, so it
 * stops when the phone asks for reduced motion). Drawn once for the stage size.
 */
export function nightSky(stage) {
  const wrap = h('div', { class: 'night-sky', 'aria-hidden': 'true' });
  const r = stage.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = h('canvas', { width: Math.round(r.width * dpr), height: Math.round(r.height * dpr) });
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  // Milky Way: a soft diagonal band of light.
  ctx.save();
  ctx.translate(r.width / 2, r.height / 2);
  ctx.rotate(-0.55);
  for (let i = 0; i < 70; i++) {
    const x = (rand() - 0.5) * r.width * 1.8;
    const y = (rand() - 0.5) * r.height * 0.22;
    const rad = 30 + rand() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const hue = rand() < 0.5 ? '170, 160, 255' : '120, 170, 255';
    g.addColorStop(0, `rgba(${hue}, 0.05)`);
    g.addColorStop(1, `rgba(${hue}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  ctx.restore();
  // Stars: mostly tiny, a few bright ones with a glow; some warm, some cool.
  const n = Math.round((r.width * r.height) / 650);
  const colors = ['255,255,255', '210,225,255', '255,240,215', '190,205,255'];
  for (let i = 0; i < n; i++) {
    const x = rand() * r.width;
    const y = rand() * r.height;
    const big = rand() < 0.04;
    const size = big ? 1.2 + rand() * 1.1 : 0.3 + rand() * 0.8;
    const c = colors[Math.floor(rand() * colors.length)];
    if (big) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, size * 5);
      g.addColorStop(0, `rgba(${c}, 0.35)`);
      g.addColorStop(1, `rgba(${c}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - size * 5, y - size * 5, size * 10, size * 10);
    }
    ctx.fillStyle = `rgba(${c}, ${big ? 0.95 : 0.25 + rand() * 0.55})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  wrap.append(canvas);
  // Twinkling stars.
  for (let i = 0; i < 18; i++) {
    wrap.append(
      h('span', {
        class: 'twinkle',
        style: { left: `${rand() * 100}%`, top: `${rand() * 100}%`, animationDelay: `${(rand() * 4).toFixed(2)}s`, animationDuration: `${(2.5 + rand() * 3).toFixed(2)}s` },
      })
    );
  }
  return wrap;
}

// Semantic zoom (screen pixels per world unit): what appears as you zoom in.
const ZOOM_PLANET_NAMES = 0.42; // planet names
const MOON_HINT_SPOTS = [
  [2.4, 0.55], // in front of the planet, lower left
  [-0.55, 1.65], // upper right
  [-2.75, 1.8], // left
]; // [angle, distance in planet radii]
const RINGS_TEST = new URLSearchParams(location.search).has('rings'); // test design: tilted rings
const likedStyles = (d) => new Set((d.profile.likedSubGenres || []).map((x) => x.id));

/** Build the galaxy SVG. Returns { svg, world, systems: Map(id -> g), lines, layout }. */
export function buildGalaxy(layout, { interactive = true } = {}) {
  const tilt = layout.tilt || 1;
  const moonTilt = layout.moonTilt || 1;
  const tilted = tilt < 1;
  const svg = s('svg', { class: 'galaxy' + (tilted ? ' tilted' : ''), role: 'img', 'aria-label': 'Your music map' });
  // Tilted rings: half of a ring, behind (top) or in front of (bottom) the sun.
  const arc = (x, y, r, front) =>
    s('path', { class: front ? 'orbit front' : 'orbit', d: front ? `M${x + r},${y} A${r},${r * tilt} 0 0 1 ${x - r},${y}` : `M${x - r},${y} A${r},${r * tilt} 0 0 1 ${x + r},${y}` });
  const world = s('g', { class: 'world' });
  svg.append(world);

  // Layers, back to front: constellation lines, systems (orbits, planets, sun, labels).
  // (The starry night sky is a separate canvas behind the SVG.)
  const linesLayer = s('g', { class: 'links' });
  const systemsLayer = s('g', { class: 'systems' });
  world.append(linesLayer, systemsLayer);

  const lines = [];
  for (const l of layout.links) {
    const line = s('line', { x1: l.A.x, y1: l.A.y, x2: l.B.x, y2: l.B.y, class: 'const-line', 'data-a': l.a, 'data-b': l.b });
    linesLayer.append(line);
    lines.push({ el: line, a: l.a, b: l.b });
  }

  const systems = new Map();
  for (const sys of layout.order.slice().reverse()) {
    const g = s('g', { class: 'system' + (sys.count ? '' : ' empty'), 'data-system': sys.id });
    for (const r of sys.rings) g.append(tilted ? arc(sys.x, sys.y, r, false) : s('circle', { class: 'orbit', cx: sys.x, cy: sys.y, r }));
    const front = []; // tilted: drawn after the sun
    for (const p of sys.planets.slice().sort((a, b) => a.y - b.y)) {
      const pg = s('g', {
        class: 'planet' + (p.explored ? ' explored' : ' unexplored') + (p.liked ? ' liked' : '') + (p.depth < 0 ? ' back' : ''),
        'data-planet': p.id,
        'data-system': sys.id,
        tabindex: interactive ? '0' : null,
        role: interactive ? 'button' : null,
        'aria-label': p.explored ? `${p.name}: ${p.count} songs` : `${p.name}: not explored yet`,
      });
      const art = planetArt(p.id, p.r);
      art.setAttribute('transform', `translate(${p.x} ${p.y})`);
      pg.append(art);
      if (tilted && p.moons.length) pg.prepend(s('g', { class: 'moons-back' })); // moons behind the planet
      // A planet with variations shows up to 3 of its moons close by (one crossing in front
      // of it, like Jupiter's); the full moon system opens when you tap the planet.
      if (p.moons.length) {
        const hint = s('g', { class: 'moon-hint' });
        MOON_HINT_SPOTS.slice(0, p.moons.length).forEach(([a, d], i) => {
          const art = moonArt(p.moons[i].id, Math.max(2, p.r * 0.24));
          art.setAttribute('transform', `translate(${p.x + Math.cos(a) * p.r * d} ${p.y + Math.sin(a) * p.r * d})`);
          hint.append(art);
        });
        pg.append(hint);
      }
      if (!p.explored) pg.append(s('circle', { class: 'unexplored-ring', cx: p.x, cy: p.y, r: p.r + 2.5 }));
      if (p.liked && !p.explored) pg.append(s('text', { class: 'liked-mark', x: p.x + p.r + 2, y: p.y - p.r, 'text-anchor': 'middle' }, '♥'));
      // A bigger invisible circle makes small planets easy to tap.
      if (interactive) pg.append(s('circle', { class: 'hit', cx: p.x, cy: p.y, r: Math.max(p.r, 11) }));
      pg.append(
        s(
          'text',
          { class: 'planet-label', x: p.x, y: p.y + p.r, dy: '1.25em', 'text-anchor': 'middle', 'data-priority': p.count, 'data-cx': p.x, 'data-cy': p.y, 'data-r': p.r, 'data-w': planetLook(p.id).type === 'ring' ? 2 : 1.15 },
          p.name.toUpperCase(),
          p.explored ? s('tspan', { class: 'count' }, ` ${p.count}`) : null
        )
      );
      // Moons: variations of this sub-genre, on a small orbit around the planet.
      if (p.moons.length) pg.append(s('ellipse', { class: 'moon-orbit', cx: p.x, cy: p.y, rx: p.moonOrbit, ry: p.moonOrbit * moonTilt }));
      for (const m of p.moons) {
        const mg = s('g', {
          class: 'moon' + (m.explored ? ' explored' : ' unexplored'),
          'data-moon': m.id,
          'data-system': sys.id,
          tabindex: interactive ? '0' : null,
          role: interactive ? 'button' : null,
          'aria-label': `${m.name}, a variation of ${p.name}: ${m.explored ? `${m.count} songs` : 'not explored yet'}`,
        });
        const mart = moonArt(m.id, m.r);
        mart.setAttribute('transform', `translate(${m.x} ${m.y})`);
        mg.append(mart);
        if (interactive) mg.append(s('circle', { class: 'hit', cx: m.x, cy: m.y, r: Math.max(m.r, 4.5) }));
        mg.append(
          s(
            'text',
            { class: 'moon-label', x: m.x, y: m.y + m.r, dy: '1.2em', 'text-anchor': 'middle', 'data-priority': m.count / 1000 - 1, 'data-cx': m.x, 'data-cy': m.y, 'data-r': m.r, 'data-w': 1.15 },
            m.name,
            m.explored ? s('tspan', { class: 'count' }, ` ${m.count}`) : null
          )
        );
        if (tilted && Math.sin(m.angle) < 0) pg.querySelector('.moons-back').append(mg);
        else pg.append(mg);
      }
      if (tilted && p.depth >= 0) front.push(pg);
      else g.append(pg);
    }
    const sun = s('g', {
      class: 'sun',
      'data-sun': sys.id,
      tabindex: interactive ? '0' : null,
      role: interactive ? 'button' : null,
      'aria-label': `${sys.name}: ${sys.count} songs, ${sys.star.name.toLowerCase()}`,
    });
    // Sun parts are drawn around (0, 0) inside a group that is moved to the sun's place, then
    // scaled by --sun-boost: suns stay visible when you zoom far out (see apply()).
    const pos = s('g', { transform: `translate(${sys.x} ${sys.y})` });
    const scaled = s('g', { class: 'sun-scale' });
    scaled.append(sunArt(sys.sunR, sys.star, 'sun:' + sys.id));
    if (sys.count) {
      const size = Math.max(9, Math.min(26, sys.sunR * 0.55));
      scaled.append(s('text', { class: 'sun-count', x: 0, y: 0, dy: '0.35em', 'text-anchor': 'middle', fill: sys.star.text, 'font-size': size }, sys.count));
    }
    scaled.append(s('text', { class: 'sun-label', x: 0, y: sys.sunR, dy: '1.15em', 'text-anchor': 'middle', 'data-priority': 1000 + sys.count }, sys.name));
    pos.append(scaled);
    sun.append(pos);
    g.append(sun);
    if (tilted) for (const r of sys.rings) g.append(arc(sys.x, sys.y, r, true));
    g.append(...front);
    systemsLayer.append(g);
    systems.set(sys.id, g);
  }
  return { svg, world, systems, lines, layout };
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

export function mount(view) {
  const stats = h('p', { class: 'muted small map-stats' });
  const progress = h('p', { class: 'small map-progress', hidden: true, role: 'status' });
  const stage = h('div', { class: 'map-stage' }, spinner('Drawing your galaxy…'));
  const panel = h('div', { class: 'map-panel', hidden: true, role: 'dialog', 'aria-live': 'polite' });
  view.append(h('div', { class: 'page-head', style: { marginBottom: '2px' } }, h('h1', {}, 'Music Map')), stats, progress, importReminder(), stage, panel);
  document.body.classList.add('full-page');

  let galaxy = null;
  let cam = null; // { k, x, y }: world point at the screen centre, zoom k (screen px per world unit)
  let fitK = 1;
  let focus = null;
  let redrawTimer = null;
  let userMoved = false; // keep the user's view when the galaxy redraws; otherwise re-fit

  const updateStats = (counts) => {
    const styles = [...counts.families.values()].reduce((n, f) => n + f.styles.size, 0);
    const genres = [...counts.families.values()].filter((f) => f.count).length;
    stats.textContent = counts.total
      ? `${counts.total.toLocaleString()} songs · ${genres} genres · ${styles} sub-genres explored`
      : 'Like songs or import your Spotify library to light up your galaxy.';
  };

  let lastCounts = null;
  const updateProgress = (p) => {
    const left = p.todo - p.done;
    progress.hidden = !p.running || left <= 0;
    const pct = lastCounts && lastCounts.total ? Math.floor((lastCounts.mapped / lastCounts.total) * 100) : 0;
    progress.textContent = `🔭 Sorting your library into genres: ${pct}% of your songs done (${left.toLocaleString()} artists to go, biggest first). Your galaxy grows as it goes.`;
  };

  function draw() {
    redrawTimer = null;
    const counts = tasteCounts();
    lastCounts = counts;
    updateStats(counts);
    const layout = computeLayout(counts, likedStyles(storage.data), { rings: RINGS_TEST });
    const prevCam = cam;
    galaxy = buildGalaxy(layout);
    clear(stage).append(
      nightSky(stage),
      galaxy.svg,
      h(
        'div',
        { class: 'map-zoom' },
        h('button', { class: 'icon-btn', 'aria-label': 'Zoom in', onClick: () => zoomBy(1.5) }, '+'),
        h('button', { class: 'icon-btn', 'aria-label': 'Zoom out', onClick: () => zoomBy(1 / 1.5) }, '−'),
        h('button', { class: 'icon-btn', 'aria-label': 'Show the whole map', onClick: fit }, icon('compass', { size: 18 }))
      )
    );
    const r = stage.getBoundingClientRect();
    const b = layout.bounds;
    fitK = Math.min(r.width / b.w, r.height / b.h) * 0.95;
    cam = prevCam && userMoved ? prevCam : { k: fitK, x: b.minX + b.w / 2, y: b.minY + b.h / 2 };
    apply();
    attachGestures();
    if (focus) setFocus(focus);
  }

  function fit() {
    const b = galaxy.layout.bounds;
    animateTo({ k: fitK, x: b.minX + b.w / 2, y: b.minY + b.h / 2 });
  }

  function apply() {
    const r = stage.getBoundingClientRect();
    galaxy.svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    galaxy.world.setAttribute('transform', `translate(${r.width / 2 - cam.x * cam.k} ${r.height / 2 - cam.y * cam.k}) scale(${cam.k})`);
    // Semantic zoom: planet names only once you zoom into a system.
    galaxy.svg.classList.toggle('show-planets', cam.k >= ZOOM_PLANET_NAMES);
    galaxy.svg.style.setProperty('--k', cam.k); // labels keep a constant on-screen size
    // Far out, suns are drawn bigger (all by the same factor, so their sizes still compare)
    // until the biggest one is ~34 px across; from closer, they're their true size.
    galaxy.svg.style.setProperty('--sun-boost', Math.max(1, 34 / (2 * SUN_MAX * cam.k)));
    clearTimeout(declutterTimer);
    declutterTimer = setTimeout(declutter, 90);
  }

  /** Hide labels that would overlap a more important one (bigger genres/planets win). */
  let declutterTimer = null;
  function declutter() {
    if (!galaxy) return;
    const showPlanets = galaxy.svg.classList.contains('show-planets');

    const vw = stage.getBoundingClientRect();
    const onScreen = (el) => {
      const r = el.getBoundingClientRect();
      return r.right > vw.left && r.left < vw.right && r.bottom > vw.top && r.top < vw.bottom;
    };
    const labels = [...galaxy.svg.querySelectorAll('.sun-label, .planet-label, .moon-label')].filter((el) =>
      el.classList.contains('sun-label') ? true : el.classList.contains('moon-label') ? !!el.closest('.planet.open') && onScreen(el) : (showPlanets || el.closest('.system.focus')) && onScreen(el)
    );
    labels.sort((a, b) => b.dataset.priority - a.dataset.priority);
    // Suns and planets (rings included) are obstacles too: a name never sits on any of them.
    const bodies = '.sun-body, .planet-art, .planet.open .moon-art';
    const obstacles = [...galaxy.svg.querySelectorAll(bodies)].filter(onScreen).map((el) => {
      const r = el.getBoundingClientRect();
      return { el, l: r.left, r: r.right, t: r.top, b: r.bottom };
    });
    const kept = [];
    const overlap = (a, k) => a.l < k.r && a.r > k.l && a.t < k.b && a.b > k.t;
    let own = []; // the label's own body (and a planet's own moons): the label sits next to them, never counted against them
    // Genre names only avoid other names and suns (they matter most); planet names also avoid every planet.
    const hits = (box, isPlanetLabel) =>
      kept.some((k) => overlap(box, k)) || obstacles.some((o) => !own.includes(o.el) && (isPlanetLabel || o.el.classList.contains('sun-body')) && overlap(box, o));
    const boxOf = (el) => {
      const r = el.getBoundingClientRect();
      return { l: r.left - 2, r: r.right + 2, t: r.top - 1, b: r.bottom + 1 };
    };
    for (const el of labels) {
      el.classList.remove('overlap');
      const moonG = el.closest('.moon');
      const planetG = el.closest('.planet');
      own = moonG
        ? [moonG.querySelector('.moon-art')]
        : planetG
          ? [planetG.querySelector('.planet-art'), ...planetG.querySelectorAll('.moon-art')]
          : [el.closest('.sun')?.querySelector('.sun-body')];
      // Planet labels: below the planet, else above, right or left of it; hidden only if none fits.
      const spots = el.dataset.cx
        ? (() => {
            const x = +el.dataset.cx;
            const y = +el.dataset.cy;
            const r = +el.dataset.r;
            const side = r * +el.dataset.w;
            return [
              { x, y: y + r, dy: '1.25em', anchor: 'middle' },
              { x, y: y - r, dy: '-0.45em', anchor: 'middle' },
              { x: x + side + 3, y, dy: '0.35em', anchor: 'start' },
              { x: x - side - 3, y, dy: '0.35em', anchor: 'end' },
            ];
          })()
        : [null];
      let placed = false;
      for (const spot of spots) {
        if (spot) {
          el.setAttribute('x', spot.x);
          el.setAttribute('y', spot.y);
          el.setAttribute('dy', spot.dy);
          el.setAttribute('text-anchor', spot.anchor);
        }
        const box = boxOf(el);
        if (!hits(box, !!el.dataset.cx)) {
          kept.push(box);
          placed = true;
          break;
        }
      }
      if (!placed) el.classList.add('overlap');
    }
  }

  function clampK(k) {
    return Math.max(fitK * 0.6, Math.min(6, k)); // up to 6 px per unit: close enough to read moon names
  }

  function zoomBy(f, sx, sy) {
    userMoved = true;
    const r = stage.getBoundingClientRect();
    const px = sx == null ? r.width / 2 : sx;
    const py = sy == null ? r.height / 2 : sy;
    // Keep the world point under (px, py) fixed.
    const wx = cam.x + (px - r.width / 2) / cam.k;
    const wy = cam.y + (py - r.height / 2) / cam.k;
    const k = clampK(cam.k * f);
    cam = { k, x: wx - (px - r.width / 2) / k, y: wy - (py - r.height / 2) / k };
    apply();
  }

  let anim = null;
  function animateTo(target, ms = 450) {
    cancelAnimationFrame(anim);
    const from = { ...cam };
    const t0 = performance.now();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const step = (t) => {
      const p = reduce ? 1 : Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      cam = { k: from.k + (target.k - from.k) * e, x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e };
      apply();
      if (p < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  /* ---------- gestures: drag to pan, pinch / wheel to zoom, tap to select ---------- */

  function attachGestures() {
    const svg = galaxy.svg;
    const pointers = new Map();
    let moved = false;
    let down = null; // where the first finger went down (a tap if it barely moves)
    let downTarget = null; // what was under it (pointer capture makes later events target the svg)
    let last = null; // previous pinch state

    svg.addEventListener('pointerdown', (e) => {
      userMoved = true;
      svg.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        down = { x: e.clientX, y: e.clientY };
        downTarget = e.target;
        moved = false;
      }
      last = null;
      cancelAnimationFrame(anim);
    });
    svg.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        moved = moved || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6;
        if (!moved) return;
        cam = { ...cam, x: cam.x - (e.clientX - prev.x) / cam.k, y: cam.y - (e.clientY - prev.y) / cam.k };
        apply();
      } else if (pointers.size === 2) {
        moved = true;
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (last) {
          const r = stage.getBoundingClientRect();
          zoomBy(dist / last.dist, mid.x - r.left, mid.y - r.top);
          cam = { ...cam, x: cam.x - (mid.x - last.mid.x) / cam.k, y: cam.y - (mid.y - last.mid.y) / cam.k };
          apply();
        }
        last = { dist, mid };
      }
    });
    const end = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) last = null;
      if (!moved && e.type === 'pointerup' && pointers.size === 0) onTap({ target: downTarget });
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = stage.getBoundingClientRect();
        zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false }
    );
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onTap(e);
      }
    });
    // Hover (mouse): preview a system's links.
    svg.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse' || focus) return;
      const g = e.target.closest('[data-system]');
      highlight(g ? g.getAttribute('data-system') : null);
    });
    svg.addEventListener('pointerleave', () => !focus && highlight(null));
  }

  function highlight(id) {
    galaxy.svg.classList.toggle('has-focus', !!id);
    for (const [sid, g] of galaxy.systems) g.classList.toggle('focus', sid === id);
    for (const l of galaxy.lines) l.el.classList.toggle('focus', l.a === id || l.b === id);
  }

  function onTap(e) {
    const target = e.target.closest ? e.target : null;
    const moon = target && target.closest('[data-moon]');
    const planet = target && target.closest('[data-planet]');
    const sun = target && target.closest('[data-sun]');
    if (moon) return showMoon(moon.getAttribute('data-system'), planet.getAttribute('data-planet'), moon.getAttribute('data-moon'));
    if (planet) return showPlanet(planet.getAttribute('data-system'), planet.getAttribute('data-planet'));
    if (sun) return setFocus(sun.getAttribute('data-sun'), { zoom: true });
    setFocus(null);
  }

  /** Open a planet: its moons appear around it, everything else steps back. */
  function openPlanet(id) {
    galaxy.svg.querySelector('.planet.open')?.classList.remove('open');
    galaxy.svg.classList.toggle('planet-open', !!id);
    if (id) galaxy.svg.querySelector(`[data-planet="${id}"]`).classList.add('open');
  }

  function setFocus(id, { zoom = false } = {}) {
    openPlanet(null);
    focus = id;
    highlight(id);
    clearTimeout(declutterTimer);
    declutterTimer = setTimeout(declutter, 90);
    if (!id) {
      panel.hidden = true;
      stage.classList.remove('panel-open');
      return;
    }
    const sys = galaxy.layout.systems.find((x) => x.id === id);
    if (zoom) {
      const r = stage.getBoundingClientRect();
      const k = clampK(Math.min(r.width, r.height) / (sys.R * 1.75));
      animateTo({ k, x: sys.x, y: sys.y + 55 / k }); // a bit higher: the info panel covers the bottom
    }
    const explored = sys.planets.filter((p) => p.explored).length;
    clear(panel).append(
      h(
        'div',
        { class: 'map-panel-head' },
        h('span', { class: 'map-dot', style: { background: sys.star.core, boxShadow: `0 0 0 3px ${sys.star.rim}` } }),
        h(
          'div',
          {},
          h('h2', {}, sys.name),
          h('p', { class: 'muted small' }, `${sys.star.dormant ? 'Not explored yet' : sys.star.name} · ${sys.count} song${sys.count === 1 ? '' : 's'} · ${explored} of ${sys.planets.length} sub-genres explored`)
        ),
        h('button', { class: 'icon-btn', 'aria-label': 'Close', onClick: () => setFocus(null) }, icon('x', { size: 20 }))
      ),
      h('button', { class: 'btn primary block', onClick: () => navigate(`swipe?focus=${sys.id}`) }, icon('cards', { size: 18 }), `Swipe ${sys.name}`)
    );
    panel.hidden = false;
    stage.classList.add('panel-open');
  }

  function showMoon(sysId, planetId, moonId) {
    const sys = galaxy.layout.systems.find((x) => x.id === sysId);
    const p = sys.planets.find((x) => x.id === planetId);
    const m = p.moons.find((x) => x.id === moonId);
    focus = sysId;
    highlight(sysId);
    clear(panel).append(
      h(
        'div',
        { class: 'map-panel-head' },
        h('span', { class: 'map-planet-icon' + (m.explored ? '' : ' hollow') }, moonIcon(m.id)),
        h(
          'div',
          {},
          h('h2', {}, m.name),
          h('p', { class: 'muted small' }, `Moon of ${p.name} (a variation of it) · ${m.explored ? `${m.count} song${m.count === 1 ? '' : 's'}` : 'not explored yet'}`)
        ),
        h('button', { class: 'icon-btn', 'aria-label': 'Close', onClick: () => setFocus(null) }, icon('x', { size: 20 }))
      ),
      h('button', { class: 'btn primary block', onClick: () => navigate(`swipe?focus=${m.id}`) }, icon('cards', { size: 18 }), m.explored ? `Swipe more ${m.name}` : `Start swiping ${m.name}`)
    );
    panel.hidden = false;
    stage.classList.add('panel-open');
  }

  function showPlanet(sysId, planetId) {
    const sys = galaxy.layout.systems.find((x) => x.id === sysId);
    const p = sys.planets.find((x) => x.id === planetId);
    focus = sysId;
    highlight(sysId);
    openPlanet(p.id);
    clearTimeout(declutterTimer);
    declutterTimer = setTimeout(declutter, 90);
    // Centre on the planet, close enough to see its moons and their names.
    const r = stage.getBoundingClientRect();
    // Room for the moon ring plus its names (beside it) and the panel (below).
    const halfW = (p.moons.length ? p.moonOrbit : p.r) + 60;
    const halfH = (p.moons.length ? p.moonOrbit * galaxy.layout.moonTilt : p.r) + 30;
    const k = clampK(Math.min(r.width / 2 / halfW, (r.height - 110) / 2 / halfH));
    animateTo({ k, x: p.x, y: p.y + 55 / k });
    const moons = p.moons.length ? ` · ${p.moons.length} variation${p.moons.length === 1 ? '' : 's'} (moons)` : '';
    clear(panel).append(
      h(
        'div',
        { class: 'map-panel-head' },
        h('span', { class: 'map-planet-icon' + (p.explored ? '' : ' hollow') }, planetIcon(p.id)),
        h(
          'div',
          {},
          h('h2', {}, p.name),
          h(
            'p',
            { class: 'muted small' },
            p.explored
              ? `${p.count} song${p.count === 1 ? '' : 's'} · in ${sys.name}${moons}`
              : `Unexplored planet in ${sys.name}${p.liked ? ' · you said you like it' : ''}${moons}. Want to discover it?`
          )
        ),
        h('button', { class: 'icon-btn', 'aria-label': 'Close', onClick: () => setFocus(null) }, icon('x', { size: 20 }))
      ),
      h('button', { class: 'btn primary block', onClick: () => navigate(`swipe?focus=${p.id}`) }, icon('cards', { size: 18 }), p.explored ? `Swipe more ${p.name}` : `Start swiping ${p.name}`)
    );
    panel.hidden = false;
    stage.classList.add('panel-open');
  }

  /* ---------- data loading ---------- */

  const onResize = () => {
    if (!galaxy) return;
    const old = stage.querySelector('.night-sky');
    if (old) old.replaceWith(nightSky(stage));
    apply();
  };
  addEventListener('resize', onResize);

  const unsubProgress = onClassifierProgress((p) => {
    updateProgress(p);
  });
  // The galaxy grows while the classifier works. Redraw at most every 8 s, and never
  // while you're touching the map or reading a panel (things would move under your finger).
  const scheduleRedraw = (delay) => {
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(() => {
      if (!panel.hidden || stage.matches(':active')) return scheduleRedraw(4000);
      draw();
    }, delay);
  };
  const unsubStore = storage.subscribe((_, reason) => {
    if (reason === 'artist-genres') {
      if (!redrawTimer) scheduleRedraw(8000); // batch the classifier's many small saves
    } else if (reason === 'remote' || reason === 'replace' || reason === 'profile') scheduleRedraw(0);
  });

  (async () => {
    await (knownReady() || loadKnownLibrary(storage.data));
    draw();
    updateProgress(classifierState());
    runClassifier();
  })();

  return () => {
    document.body.classList.remove('full-page');
    removeEventListener('resize', onResize);
    clearTimeout(redrawTimer);
    clearTimeout(declutterTimer);
    cancelAnimationFrame(anim);
    unsubProgress();
    unsubStore();
  };
}
