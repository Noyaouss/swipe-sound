/**
 * planetArt — flat, illustrated suns and planets (SVG) for the Music Map.
 *
 * Suns get a star class from how big the genre is in your taste:
 *   blue giant → white → yellow → orange → red dwarf (smallest).
 * Planets get one of several illustrated styles, picked at random but stable per
 * sub-genre (the same sub-genre always looks the same): banded gas giant, ringed
 * giant, earth-like, rocky with craters, ice giant, swirled (Venus-like).
 *
 * Every drawing is centred on (0, 0); callers position it with a transform.
 */

const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, ...children) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  for (const c of children) if (c) e.append(c);
  return e;
}

/** Small deterministic hash → [0, 1) generator, so a sub-genre always gets the same look. */
export function rng(seedText) {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];

let uid = 0;
const nextId = (p) => `${p}${++uid}`;

/**
 * Gradients and textures shared by every drawing (defined once per page, not per planet:
 * the map has hundreds of bodies). url(#id) works across all inline SVGs of the page.
 */
let defsReady = false;
function sharedDefs() {
  if (defsReady || typeof document === 'undefined') return;
  defsReady = true;
  const stop = (offset, color, opacity) => el('stop', { offset, 'stop-color': color, 'stop-opacity': opacity });
  const defs = el(
    'defs',
    {},
    // Lit from the upper left: highlight, then a soft terminator into the shadow.
    el('radialGradient', { id: 'pa-shade', cx: '32%', cy: '30%', r: '85%' }, stop('0%', '#ffffff', 0.28), stop('30%', '#ffffff', 0), stop('62%', '#050a1c', 0.18), stop('100%', '#050a1c', 0.78)),
    // Thin glowing atmosphere just inside the edge.
    el('radialGradient', { id: 'pa-rim' }, stop('82%', '#cfe6ff', 0), stop('96%', '#cfe6ff', 0.32), stop('100%', '#cfe6ff', 0)),
    // Each star class: white-hot centre, darker towards the edge (limb darkening).
    ...STAR_CLASSES.map((c) =>
      el('radialGradient', { id: 'pa-sun-' + c.id, cx: '45%', cy: '42%', r: '62%' }, stop('0%', '#ffffff', 1), stop('30%', c.rim, 1), stop('72%', c.core, 1), stop('100%', c.spot, 1))
    ),
    ...STAR_CLASSES.map((c) => el('radialGradient', { id: 'pa-corona-' + c.id }, stop('48%', c.glow, 0.55), stop('62%', c.glow, 0.18), stop('100%', c.glow, 0)))
  );
  document.body.append(el('svg', { width: 0, height: 0, 'aria-hidden': 'true', style: 'position:absolute;width:0;height:0;overflow:hidden' }, defs));
}

/* ------------------------------------------------------------------ */
/* Suns                                                                 */
/* ------------------------------------------------------------------ */

export const STAR_CLASSES = [
  // From the biggest genres to the smallest.
  { id: 'blue-giant', name: 'Blue giant', core: '#8ec5ff', rim: '#d6ecff', spot: '#5e9fe8', glow: '#7fb8ff', text: '#0c1c3a' },
  { id: 'white', name: 'White star', core: '#f3f6ff', rim: '#ffffff', spot: '#c9d4ee', glow: '#e8eeff', text: '#1a2340' },
  { id: 'yellow', name: 'Yellow star', core: '#ffc928', rim: '#ffe48a', spot: '#f0a30a', glow: '#ffd75e', text: '#4a2b00' },
  { id: 'orange', name: 'Orange star', core: '#ff9330', rim: '#ffc27a', spot: '#e06a12', glow: '#ff9f50', text: '#3f1800' },
  { id: 'red-dwarf', name: 'Red dwarf', core: '#e5483d', rim: '#ff8a7a', spot: '#b52a22', glow: '#ff5a4a', text: '#ffffff' },
];

/** Star class from a genre's rank among your genres (0 = biggest). */
export function starClass(rank, total, count) {
  if (!count) return { ...STAR_CLASSES[4], dormant: true };
  const q = total <= 1 ? 0 : rank / (total - 1); // 0 … 1
  return STAR_CLASSES[Math.min(4, Math.floor(q * 5))];
}

export function sunArt(r, star, seed) {
  sharedDefs();
  const g = el('g', { class: 'sun-art' });
  const rand = rng(seed);
  g.append(
    el('circle', { class: 'sun-glow', r: r * 2.1, fill: `url(#pa-corona-${star.id})`, opacity: star.dormant ? 0.25 : 1 }),
    el('circle', { r, fill: star.rim, opacity: 0.9 }), // the pale rim, like the illustration
    el('circle', { class: 'sun-body', r: r * 0.88, fill: `url(#pa-sun-${star.id})` })
  );
  // Granulation: irregular light and dark cells, denser towards the middle.
  const gran = el('g', { opacity: star.dormant ? 0.4 : 1 });
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * r * 0.8;
    gran.append(el('circle', { cx: Math.cos(a) * d, cy: Math.sin(a) * d, r: r * (0.02 + rand() * 0.05), fill: i % 3 ? '#ffffff' : star.spot, opacity: 0.06 + rand() * 0.1 }));
  }
  g.append(gran);
  // Sunspots (dark, with a lighter penumbra) and bright faculae.
  const spots = el('g', { opacity: star.dormant ? 0.35 : 0.7 });
  for (let i = 0; i < 5; i++) {
    const a = rand() * Math.PI * 2;
    const d = r * (0.2 + rand() * 0.5);
    const rx = r * (0.05 + rand() * 0.08);
    const t = `rotate(${rand() * 180} ${Math.cos(a) * d} ${Math.sin(a) * d})`;
    spots.append(
      el('ellipse', { cx: Math.cos(a) * d, cy: Math.sin(a) * d, rx: rx * 1.6, ry: rx, transform: t, fill: star.spot, opacity: 0.55 }),
      el('ellipse', { cx: Math.cos(a) * d, cy: Math.sin(a) * d, rx: rx * 0.8, ry: rx * 0.5, transform: t, fill: '#1a0c08', opacity: 0.35 })
    );
  }
  for (let i = 0; i < 6; i++) {
    const a = rand() * Math.PI * 2;
    const d = r * (0.3 + rand() * 0.5);
    spots.append(el('circle', { cx: Math.cos(a) * d, cy: Math.sin(a) * d, r: r * (0.03 + rand() * 0.04), fill: '#fff', opacity: 0.45 }));
  }
  g.append(spots);
  return g;
}

/* ------------------------------------------------------------------ */
/* Planets                                                              */
/* ------------------------------------------------------------------ */

const PALETTES = {
  gas: [
    ['#e9d3b0', '#c79a6a', '#a8714a', '#f5e6cc'], // Jupiter
    ['#f0c79a', '#d98e57', '#b8653a', '#fde3c2'],
    ['#d9c7e8', '#a98bc7', '#7d63a6', '#efe4f7'],
    ['#bfe0d0', '#82b9a0', '#4f8d75', '#e2f3ea'],
  ],
  ring: [
    ['#f1d58e', '#d7ae5c', '#b9893c', '#e8c77a'], // Saturn
    ['#c9d9f2', '#97b2df', '#6d8cc7', '#b9cdee'],
    ['#f2c2b0', '#d98f78', '#b66a55', '#f0b49d'],
  ],
  earth: [
    ['#3f8fd8', '#5cbf6a', '#ffffff'],
    ['#3a7bd5', '#e0b85a', '#ffffff'],
    ['#2fa7b8', '#7cc46a', '#ffffff'],
  ],
  rocky: [
    ['#d0613a', '#a8432a', '#e98a5f'], // Mars
    ['#9e9aa4', '#77737e', '#c2bfc7'], // Mercury / moon
    ['#c08f5a', '#94683d', '#dcb07f'],
  ],
  ice: [
    ['#7cc6f0', '#5aa9dc', '#b8e4fa'], // Neptune
    ['#b9ecec', '#8fd3d6', '#e2fafa'], // Uranus
    ['#9fb4f5', '#7a91e0', '#d1dcff'],
  ],
  swirl: [
    ['#f0b45a', '#d98e3a', '#fbd79a'], // Venus
    ['#e7a9c4', '#c97ba0', '#f6d3e2'],
  ],
};
export const PLANET_TYPES = Object.keys(PALETTES);

/** Pick a planet's look (type + palette + variations) from its id. */
export function planetLook(id) {
  const r = rng('planet:' + id);
  const type = pick(r, PLANET_TYPES);
  return { type, colors: pick(r, PALETTES[type]), rand: r, tilt: -25 + r() * 50 };
}

/** Draw a planet of radius r. */
export function planetArt(id, r) {
  sharedDefs();
  const { type, colors, rand, tilt } = planetLook(id);
  const g = el('g', { class: `planet-art planet-${type}` });
  const clip = nextId('pc');
  g.append(el('clipPath', { id: clip }, el('circle', { r })));
  const body = el('g', { 'clip-path': `url(#${clip})` });
  const ringBack = type === 'ring' ? ring(r, colors, tilt, 'back') : null;
  if (ringBack) g.append(ringBack);

  if (type === 'gas' || type === 'ring') {
    body.append(el('circle', { r, fill: colors[0] }));
    // Horizontal bands of varying thickness, slightly tilted for the ringed ones.
    const bands = el('g', { transform: type === 'ring' ? `rotate(${tilt * 0.4})` : null });
    let y = -r;
    let k = 0;
    while (y < r) {
      const hgt = r * (0.12 + rand() * 0.2);
      if (k % 2) bands.append(el('rect', { x: -r, y, width: r * 2, height: hgt, fill: colors[1 + (k % 3 === 1 ? 0 : 1)], opacity: 0.85 }));
      y += hgt;
      k++;
    }
    // Fine bands and wavy turbulence along the band edges.
    for (let i = 0; i < 5; i++) {
      const fy = -r + rand() * r * 2;
      bands.append(el('rect', { x: -r, y: fy, width: r * 2, height: r * 0.035, fill: colors[3], opacity: 0.5 }));
      const w = r * 0.25;
      bands.append(el('path', { d: `M${-r} ${fy + r * 0.12} q${w / 2} ${-r * 0.06} ${w} 0 t${w} 0 t${w} 0 t${w} 0 t${w} 0 t${w} 0 t${w} 0 t${w} 0`, fill: 'none', stroke: i % 2 ? colors[3] : colors[2], 'stroke-width': r * 0.04, opacity: 0.45 }));
    }
    body.append(bands);
    if (type === 'gas') {
      // The "great red spot": a storm with a lighter eye and a swirl around it.
      const sx = r * (0.1 + rand() * 0.3);
      const sy = r * (0.2 + rand() * 0.25);
      body.append(
        el('ellipse', { cx: sx, cy: sy, rx: r * 0.3, ry: r * 0.15, fill: colors[3], opacity: 0.6 }),
        el('ellipse', { cx: sx, cy: sy, rx: r * 0.22, ry: r * 0.11, fill: '#d9634a', opacity: 0.7 }),
        el('ellipse', { cx: sx - r * 0.03, cy: sy - r * 0.01, rx: r * 0.1, ry: r * 0.05, fill: '#f2a07e', opacity: 0.8 })
      );
      // Small white ovals.
      for (let i = 0; i < 3; i++) body.append(el('ellipse', { cx: (rand() - 0.5) * r * 1.4, cy: (rand() - 0.5) * r * 1.4, rx: r * 0.07, ry: r * 0.04, fill: '#ffffff', opacity: 0.55 }));
    }
  } else if (type === 'earth') {
    body.append(el('circle', { r, fill: colors[0] }));
    for (let i = 0; i < 3; i++) body.append(blob(r, rand, colors[1], 0.28 + rand() * 0.22));
    for (let i = 0; i < 2; i++) body.append(blob(r, rand, '#2f6e3a', 0.12 + rand() * 0.08)); // forests
    // Polar ice caps.
    body.append(el('ellipse', { cx: 0, cy: -r * 0.97, rx: r * 0.6, ry: r * 0.2, fill: '#ffffff', opacity: 0.9 }));
    body.append(el('ellipse', { cx: 0, cy: r * 0.98, rx: r * 0.45, ry: r * 0.15, fill: '#ffffff', opacity: 0.85 }));
    // Cloud swirls.
    for (let i = 0; i < 3; i++) {
      const y = -r * 0.6 + rand() * r * 1.2;
      body.append(el('path', { d: `M${-r * 0.8} ${y} q${r * 0.4} ${-r * 0.2} ${r * 0.8} 0 t${r * 0.8} 0`, fill: 'none', stroke: colors[2], 'stroke-width': r * 0.09, 'stroke-linecap': 'round', opacity: 0.85 }));
    }
  } else if (type === 'rocky') {
    body.append(el('circle', { r, fill: colors[0] }));
    body.append(blob(r, rand, colors[2], 0.4));
    body.append(blob(r, rand, colors[1], 0.3));
    // Craters: lit rim on the lower right, dark floor offset to the upper left.
    for (let i = 0; i < 8; i++) {
      const a = rand() * Math.PI * 2;
      const d = rand() * r * 0.8;
      const cr = r * (i < 3 ? 0.12 + rand() * 0.12 : 0.04 + rand() * 0.05);
      const cx = Math.cos(a) * d;
      const cy = Math.sin(a) * d;
      body.append(el('circle', { cx: cx + cr * 0.15, cy: cy + cr * 0.15, r: cr, fill: colors[2], opacity: 0.9 }));
      body.append(el('circle', { cx: cx - cr * 0.1, cy: cy - cr * 0.1, r: cr * 0.85, fill: colors[1], opacity: 0.95 }));
    }
  } else if (type === 'ice') {
    body.append(el('circle', { r, fill: colors[0] }));
    for (let i = 0; i < 5; i++) {
      const y = -r * 0.85 + i * r * 0.38 + rand() * r * 0.15;
      body.append(el('rect', { x: -r, y, width: r * 2, height: r * (0.06 + rand() * 0.1), fill: i % 2 ? colors[1] : colors[2], opacity: 0.4 }));
    }
    // A dark storm with bright companion clouds (Neptune).
    const sx = (rand() - 0.5) * r * 0.8;
    const sy = (rand() - 0.2) * r * 0.6;
    body.append(el('ellipse', { cx: sx, cy: sy, rx: r * 0.2, ry: r * 0.1, fill: '#1d3f78', opacity: 0.55 }));
    body.append(el('ellipse', { cx: sx + r * 0.05, cy: sy + r * 0.15, rx: r * 0.14, ry: r * 0.04, fill: '#ffffff', opacity: 0.7 }));
  } else {
    // swirl (Venus-like)
    body.append(el('circle', { r, fill: colors[0] }));
    for (let i = 0; i < 7; i++) {
      const y = -r * 0.9 + i * r * 0.3;
      body.append(el('path', { d: `M${-r} ${y} c${r * 0.5} ${r * (0.2 + rand() * 0.2)} ${r} ${-r * 0.3} ${r * 2} 0`, fill: 'none', stroke: i % 2 ? colors[1] : colors[2], 'stroke-width': r * (0.06 + rand() * 0.1), opacity: 0.65 }));
    }
  }
  // Lighting: highlight, terminator and night side, then a thin glowing atmosphere.
  body.append(el('circle', { r, fill: 'url(#pa-shade)' }));
  body.append(el('circle', { r, fill: 'url(#pa-rim)' }));
  g.append(body);
  // Thin darker outline, like the illustration.
  g.append(el('circle', { r, fill: 'none', stroke: '#0a1230', 'stroke-opacity': 0.3, 'stroke-width': Math.max(0.5, r * 0.04) }));
  if (type === 'ring') g.append(ring(r, colors, tilt, 'front'));
  return g;
}

/** Saturn-like ring, drawn in two halves so it passes behind and in front of the planet. */
function ring(r, colors, tilt, half) {
  const g = el('g', { transform: `rotate(${tilt})` });
  const rx = r * 1.9;
  const ry = r * 0.5;
  // Back half: top arc. Front half: bottom arc.
  const sweep = half === 'back' ? 0 : 1;
  const d = `M${-rx} 0 A${rx} ${ry} 0 0 ${sweep} ${rx} 0`;
  const fade = half === 'back' ? 0.6 : 1; // the far half is in the planet's shadow
  // Several bands with a dark gap (Cassini division).
  g.append(el('path', { d, fill: 'none', stroke: colors[3], 'stroke-width': r * 0.34, 'stroke-linecap': 'round', opacity: 0.85 * fade }));
  g.append(el('path', { d, fill: 'none', stroke: colors[0], 'stroke-width': r * 0.12, opacity: 0.7 * fade, transform: 'scale(1.06)' }));
  g.append(el('path', { d, fill: 'none', stroke: '#0a1230', 'stroke-width': r * 0.03, opacity: 0.45 * fade, transform: 'scale(0.97)' }));
  g.append(el('path', { d, fill: 'none', stroke: colors[2], 'stroke-width': r * 0.08, opacity: 0.8 * fade, transform: 'scale(0.86)' }));
  return g;
}

/** An irregular blob (continents, plains) inside a planet of radius r. */
function blob(r, rand, fill, size) {
  const cx = (rand() - 0.5) * r * 1.1;
  const cy = (rand() - 0.5) * r * 1.1;
  const pts = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const d = r * size * (0.6 + rand() * 0.6);
    pts.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d]);
  }
  // Smooth closed curve through the points.
  let d = `M${(pts[0][0] + pts[n - 1][0]) / 2} ${(pts[0][1] + pts[n - 1][1]) / 2}`;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    d += ` Q${p[0]} ${p[1]} ${(p[0] + q[0]) / 2} ${(p[1] + q[1]) / 2}`;
  }
  return el('path', { d: d + 'Z', fill, opacity: 0.95 });
}

/* ------------------------------------------------------------------ */
/* Background stars                                                     */
/* ------------------------------------------------------------------ */

/** Scattered dots and small 4-point stars over a world-space rectangle. */
export function starfield(bounds, seed = 'sky') {
  const rand = rng(seed);
  const g = el('g', { class: 'starfield' });
  const area = bounds.w * bounds.h;
  const n = Math.min(500, Math.round(area / 9000));
  for (let i = 0; i < n; i++) {
    const x = bounds.minX + rand() * bounds.w;
    const y = bounds.minY + rand() * bounds.h;
    if (rand() < 0.15) {
      const s = 2 + rand() * 3;
      g.append(el('path', { d: `M${x} ${y - s} L${x + s * 0.25} ${y - s * 0.25} L${x + s} ${y} L${x + s * 0.25} ${y + s * 0.25} L${x} ${y + s} L${x - s * 0.25} ${y + s * 0.25} L${x - s} ${y} L${x - s * 0.25} ${y - s * 0.25}Z`, fill: '#cfd8ff', opacity: 0.35 + rand() * 0.4 }));
    } else {
      g.append(el('circle', { cx: x, cy: y, r: 0.6 + rand() * 1.1, fill: '#e6ebff', opacity: 0.2 + rand() * 0.5 }));
    }
  }
  return g;
}

/* ------------------------------------------------------------------ */
/* Moons (variations of a sub-genre)                                    */
/* ------------------------------------------------------------------ */

// Like Jupiter's moons: sulphur yellow (Io), icy (Europa), brown (Ganymede), dark (Callisto), rusty.
const MOON_TONES = [
  ['#e8d25c', '#c9a227', '#f6ea9c'],
  ['#e3d9c8', '#b9a689', '#f5efe4'],
  ['#b08a63', '#7d5d3f', '#d4b38c'],
  ['#8d7f74', '#5f544c', '#b3a69a'],
  ['#c4552f', '#8f3518', '#e08a5e'],
  ['#c9c6d2', '#9692a3', '#e8e6ee'],
];

/** A small moon of radius r: mottled surface, a few craters, lit like the planets (no clip path). */
export function moonArt(id, r) {
  sharedDefs();
  const rand = rng('moon:' + id);
  const [base, dark, light] = pick(rand, MOON_TONES);
  const g = el('g', { class: 'moon-art' });
  g.append(el('circle', { r, fill: base }));
  // Mottling and craters, kept inside the disc.
  for (let i = 0; i < 6; i++) {
    const a = rand() * Math.PI * 2;
    const cr = r * (i < 2 ? 0.3 + rand() * 0.15 : 0.1 + rand() * 0.1);
    const d = rand() * (r - cr);
    const fill = i < 2 ? (i ? light : dark) : dark;
    g.append(el('circle', { cx: Math.cos(a) * d, cy: Math.sin(a) * d, r: cr, fill, opacity: i < 2 ? 0.45 : 0.6 }));
  }
  g.append(el('circle', { r, fill: 'url(#pa-shade)' }));
  g.append(el('circle', { r, fill: 'none', stroke: '#0a1230', 'stroke-opacity': 0.3, 'stroke-width': Math.max(0.3, r * 0.06) }));
  return g;
}
