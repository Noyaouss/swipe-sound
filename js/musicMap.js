/**
 * musicMap — your whole music taste as data, and its "galaxy" layout.
 *
 * DATA
 *   Songs = your imported/synced Spotify library + songs you liked here (deduplicated).
 *   Liked songs carry their own genre/sub-genre. Library songs get their artist's
 *   genre/sub-genre, found once per artist by a background classifier
 *   (MusicBrainz tags first, Deezer as a fallback) and saved in data.artistGenres.
 *
 * LAYOUT
 *   Each genre (family) is a sun sized by its song count; its sub-genres (styles) are
 *   planets on orbit rings. Related genres are pulled together by their graph links
 *   (the constellation lines). Everything is computed in "world" units; the page
 *   pans/zooms over it.
 */

import { NODES, FAMILIES, stylesOf, moonsOf, familyByName, nodeByName, classifyTags, familyLinks, placeTrack } from './genreGraph.js';
import { libraryTracks, songKey } from './recommender.js';
import { starClass } from './planetArt.js';
import * as ds from './dataService.js';
import { storage } from './storage.js';

export const normArtist = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

const MAP_FAMILIES = () => FAMILIES.filter((f) => !f.noExplore);

/* ------------------------------------------------------------------ */
/* Songs & counts                                                       */
/* ------------------------------------------------------------------ */

/**
 * Every song in your taste: { artist, key, family, style } (family/style may be null
 * while the artist isn't classified yet).
 */
export function tasteSongs(data = storage.data) {
  const out = [];
  const keys = new Set();
  for (const s of data.likedSongs) {
    const key = songKey(s);
    if (keys.has(key)) continue;
    keys.add(key);
    out.push({ artist: s.artistName, key, ...placeTrack(s) });
  }
  for (const [artists, title] of libraryTracks()) {
    const artist = artists[0];
    const key = songKey({ artistName: artist, title });
    if (keys.has(key)) continue;
    keys.add(key);
    const c = data.artistGenres[normArtist(artist)];
    out.push({ artist, key, family: c ? c.f : null, style: c ? c.s : null, moon: c ? c.m || null : null, fromLibrary: true });
  }
  return out;
}

/**
 * Counts for the map and the profile:
 * { total, mapped, families: Map(fid -> { count, styles: Map(sid -> count), moons: Map(mid -> count) }),
 *   artists: [[name, count]] }
 */
export function tasteCounts(data = storage.data) {
  const families = new Map(MAP_FAMILIES().map((f) => [f.id, { count: 0, styles: new Map(), moons: new Map() }]));
  const artists = new Map();
  let mapped = 0;
  const songs = tasteSongs(data);
  for (const s of songs) {
    const a = artists.get(normArtist(s.artist)) || { name: s.artist, count: 0 };
    a.count++;
    artists.set(normArtist(s.artist), a);
    const f = s.family && families.get(s.family);
    if (!f) continue;
    mapped++;
    f.count++;
    if (s.style) f.styles.set(s.style, (f.styles.get(s.style) || 0) + 1);
    if (s.moon) f.moons.set(s.moon, (f.moons.get(s.moon) || 0) + 1);
  }
  return {
    total: songs.length,
    mapped,
    families,
    artists: [...artists.values()].sort((x, y) => y.count - x.count).map((a) => [a.name, a.count]),
  };
}

/** How many songs of yours each artist has (library + likes), by normalized name. */
export function artistSongCounts(data = storage.data) {
  const m = new Map();
  for (const s of tasteSongs(data)) m.set(normArtist(s.artist), (m.get(normArtist(s.artist)) || 0) + 1);
  return m;
}

/* ------------------------------------------------------------------ */
/* Background artist classifier                                         */
/* ------------------------------------------------------------------ */

const classifier = { running: null, done: 0, todo: 0, listeners: new Set() };
/** Bumped when classification improves (2 = moons): older entries are sorted again (cached, so quick). */
const CLASSIFIER_VERSION = 2;
const TAG_BATCH = 10; // artists per MusicBrainz request
const isCurrent = (entry) => entry && (entry.v || 1) >= CLASSIFIER_VERSION;

/** Subscribe to progress: fn({ done, todo, running }). */
export function onClassifierProgress(fn) {
  classifier.listeners.add(fn);
  return () => classifier.listeners.delete(fn);
}
const emitProgress = () => {
  for (const fn of classifier.listeners) fn({ done: classifier.done, todo: classifier.todo, running: !!classifier.running });
};

/** Artists of the library not classified yet, the ones with the most songs first. */
function pendingArtists(data) {
  const counts = new Map();
  for (const [artists] of libraryTracks()) {
    const n = normArtist(artists[0]);
    if (!n || isCurrent(data.artistGenres[n])) continue;
    const c = counts.get(n) || { name: artists[0], count: 0 };
    c.count++;
    counts.set(n, c);
  }
  return [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
}

async function classifyArtist(name) {
  // 1. MusicBrainz tags: usually give the sub-genre (and therefore the genre) in one request.
  const tags = await ds.getArtistTags(name);
  const fromTags = classifyTags(tags);
  if (fromTags.family) return fromTags;
  // 2. Fallback: the genre of the artist's most popular album on Deezer.
  try {
    const artist = await ds.findArtistByName(name);
    if (!artist) return fromTags;
    const [top] = await ds.getArtistTopTracks(artist.artistId, 1);
    if (!top) return fromTags;
    await ds.enrichGenre(top);
    const fam = familyByName(top.genre);
    return { family: fam ? fam.id : null, style: null, moon: null };
  } catch {
    return fromTags;
  }
}

/**
 * Artists whose songs came with Spotify genres (Exportify "Include artists data"):
 * classify them right away, no network needed. Returns the number classified.
 */
function classifyFromSpotifyGenres() {
  const byArtist = new Map(); // normalized artist -> Map(genre -> votes)
  for (const [artists, , , , genres] of libraryTracks()) {
    if (!genres || !genres.length) continue;
    const n = normArtist(artists[0]);
    if (!n || isCurrent(storage.data.artistGenres[n])) continue;
    const votes = byArtist.get(n) || new Map();
    for (const g of genres) votes.set(g, (votes.get(g) || 0) + 1);
    byArtist.set(n, votes);
  }
  if (!byArtist.size) return 0;
  const batch = {};
  for (const [n, votes] of byArtist) {
    const tags = [...votes.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
    const r = classifyTags(tags);
    batch[n] = { f: r.family, s: r.style, m: r.moon, v: CLASSIFIER_VERSION, at: Date.now(), src: 'spotify' };
  }
  storage.update((d) => Object.assign(d.artistGenres, batch), 'artist-genres');
  return byArtist.size;
}

/**
 * Classify library artists in the background (one at a time, so swiping stays fast).
 * Results are saved every few artists. Safe to call often: only one run at a time.
 */
export function runClassifier() {
  if (classifier.running) return classifier.running;
  classifyFromSpotifyGenres();
  const pending = pendingArtists(storage.data);
  classifier.done = Object.values(storage.data.artistGenres).filter(isCurrent).length;
  classifier.todo = classifier.done + pending.length;
  if (!pending.length) {
    emitProgress();
    return Promise.resolve();
  }
  classifier.running = (async () => {
    let batch = {};
    const flush = () => {
      if (!Object.keys(batch).length) return;
      const b = batch;
      batch = {};
      storage.update((d) => Object.assign(d.artistGenres, b), 'artist-genres');
    };
    emitProgress();
    for (let i = 0; i < pending.length; i += TAG_BATCH) {
      if (!navigator.onLine) break;
      const chunk = pending.slice(i, i + TAG_BATCH);
      await ds.prefetchArtistTags(chunk.map(([, c]) => c.name));
      // Parallel: cached tags are instant, and the API queues keep each service's rate limit.
      await Promise.all(
        chunk.map(async ([key, { name }]) => {
          let r;
          try {
            r = await classifyArtist(name);
          } catch {
            r = { family: null, style: null };
          }
          batch[key] = { f: r.family, s: r.style, m: r.moon || null, v: CLASSIFIER_VERSION, at: Date.now() };
          classifier.done++;
          emitProgress();
        })
      );
      flush();
    }
    flush();
  })().finally(() => {
    classifier.running = null;
    emitProgress();
  });
  return classifier.running;
}

export const classifierState = () => ({ done: classifier.done, todo: classifier.todo, running: !!classifier.running });

/* ------------------------------------------------------------------ */
/* Galaxy layout                                                        */
/* ------------------------------------------------------------------ */

const SUN_MIN = 16;
export const SUN_MAX = 70;
const PLANET_MIN = 8;
const PLANET_MAX = 18;
const UNEXPLORED_R = 7;
const MOON_MIN = 6; // moons: variations of a sub-genre, shown around their planet when you open it
export const MOON_MAX = 11;
const MOON_UNEXPLORED_R = 5.5;
// Distance between two planet orbits (was 22). Planets on neighbouring orbits are ~137° apart
// around the sun (golden angle), so they never collide even with their moons.
const ORBIT_STEP = 34;
// Tilted-rings test design (?rings=1): rings seen at an angle, a few planets per ring.
const TILT = 0.36; // ring height / width
const RING_STEP = 110;
const RING_SPACING = 95; // room for one planet and its name along a ring
const DEPTH_SCALE = 0.15;
const TILT_SQUEEZE = 0.6;
const MOON_TILT = 0.6; // an opened planet's moons: a rounder ring, room for their names
const SYSTEM_GAP = 150; // extra room between two solar systems
const LABEL_FONT = 9; // planet label size (world units)
const textWidth = (text, size) => text.length * size * 0.56;

/** Deterministic pseudo-random numbers (same layout every time). */
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/**
 * Compute the galaxy.
 * @param counts  tasteCounts() result
 * @param likedStyles  Set of style ids the user marked as liked (shown with a marker if unheard)
 * @param rings  test design: planets share a few rings, seen at an angle (TILT)
 * @returns { systems: [...], links: [...], bounds }
 */
export function computeLayout(counts, likedStyles = new Set(), { rings: tilted = false } = {}) {
  const tilt = tilted ? TILT : 1;
  const moonTilt = tilted ? MOON_TILT : 1;
  const fams = MAP_FAMILIES();
  const maxFam = Math.max(1, ...[...counts.families.values()].map((f) => f.count));
  let maxStyle = 1;
  let maxMoon = 1;
  for (const f of counts.families.values()) {
    for (const c of f.styles.values()) maxStyle = Math.max(maxStyle, c);
    for (const c of f.moons.values()) maxMoon = Math.max(maxMoon, c);
  }

  const systems = fams.map((fam, index) => {
    const fc = counts.families.get(fam.id) || { count: 0, styles: new Map(), moons: new Map() };
    const sunR = fc.count ? SUN_MIN + 6 + (SUN_MAX - SUN_MIN - 6) * Math.sqrt(fc.count / maxFam) : SUN_MIN;
    const planets = stylesOf(fam.id)
      .map((node) => {
        const count = fc.styles.get(node.id) || 0;
        return {
          id: node.id,
          name: node.name,
          count,
          explored: count > 0,
          liked: likedStyles.has(node.id),
          r: count ? PLANET_MIN + (PLANET_MAX - PLANET_MIN) * Math.sqrt(count / maxStyle) : UNEXPLORED_R,
          moons: moonsOf(node.id).map((m) => {
            const mc = fc.moons.get(m.id) || 0;
            return { id: m.id, name: m.name, count: mc, explored: mc > 0, r: mc ? MOON_MIN + (MOON_MAX - MOON_MIN) * Math.sqrt(mc / maxMoon) : MOON_UNEXPLORED_R };
          }),
        };
      }); // fixed order (as in the genre graph): planets never swap places as your counts grow
    // How much room a planet and its name take (same for every planet, so positions stay put).
    const FOOT = PLANET_MAX + 17;

    // One orbit per planet, like a real solar system. The angle of each planet is
    // spread out with the golden angle from a per-genre seed: stable, never lined up.
    // Planets on neighbouring orbits are always far apart around the circle, so orbits
    // can sit closer together than a planet's diameter without anything overlapping.
    const rings = [];
    const rand = seeded(1000 + index * 97);
    const start = rand() * Math.PI * 2;
    let radius = SUN_MAX + 20;
    let ringN = 0; // tilted: planets on the current ring
    let j = 0; // tilted: index on the current ring
    let ringStart = start;
    planets.forEach((p, k) => {
      if (!tilted) {
        radius += k ? ORBIT_STEP : FOOT;
        p.angle = start + k * 2.39996 + (rand() - 0.5) * 0.5;
        rings.push(radius);
      } else {
        // A few shared rings: fill the inner one, then the next (offset so planets don't line up).
        if (j === ringN) {
          // The first ring clears the sun even seen at an angle.
          radius = rings.length ? radius + RING_STEP : Math.max(radius + FOOT, (sunR + PLANET_MAX + 12) / TILT);
          rings.push(radius);
          ringN = Math.min(planets.length - k, Math.floor((2 * Math.PI * radius) / RING_SPACING));
          ringStart += Math.PI / ringN + 0.7;
          j = 0;
        }
        p.angle = ringStart + (j++ / ringN) * Math.PI * 2;
        p.depth = Math.sin(p.angle); // -1 = behind the sun, 1 = in front
        p.r *= 1 + DEPTH_SCALE * p.depth; // nearer looks bigger
      }
      p.orbit = radius;
      p.dx = Math.cos(p.angle) * radius;
      p.dy = Math.sin(p.angle) * radius * tilt;
      // Moons: evenly around their planet, only drawn when you open it (room for their names).
      p.moonOrbit = p.r + MOON_MAX + 16 + 2.5 * p.moons.length;
      const m0 = rand() * Math.PI * 2;
      p.moons.forEach((m, j) => {
        m.angle = m0 + (j / p.moons.length) * Math.PI * 2;
      });
    });
    const outer = rings.length ? rings[rings.length - 1] + FOOT : sunR;
    return {
      id: fam.id,
      name: fam.name,
      deezerId: fam.deezerId,
      count: fc.count,
      hue: Math.round((index * 360) / fams.length + 200) % 360,
      sunR,
      planets,
      rings,
      R: outer + 46, // room for labels
      x: 0,
      y: 0,
    };
  });

  // Star class by size rank: your biggest genres are blue giants, the smallest red dwarfs.
  const ranked = systems.filter((x) => x.count).sort((a, b) => b.count - a.count);
  for (const sys of systems) sys.star = starClass(ranked.indexOf(sys), ranked.length, sys.count);

  // Force layout of the suns: constellation links pull, overlapping systems push apart.
  const byId = new Map(systems.map((s) => [s.id, s]));
  const links = familyLinks().filter((l) => byId.has(l.a) && byId.has(l.b));
  const order = systems.slice().sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const rand = seeded(42);
  // Start from a fixed genre order (not by song count) so the sky stays recognisable as it grows.
  systems.forEach((s, i) => {
    const a = i * 2.39996;
    const d = i ? 90 * Math.sqrt(i) : 0;
    s.x = Math.cos(a) * d + rand();
    s.y = Math.sin(a) * d + rand();
  });
  for (let step = 0; step < 500; step++) {
    const cool = 1 - step / 500;
    for (const l of links) {
      const A = byId.get(l.a);
      const B = byId.get(l.b);
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const d = Math.hypot(dx, dy) || 1;
      const target = A.R + B.R + SYSTEM_GAP + 40;
      const f = ((d - target) / d) * 0.02 * cool;
      A.x += dx * f;
      A.y += dy * f;
      B.x -= dx * f;
      B.y -= dy * f;
    }
    for (let i = 0; i < systems.length; i++) {
      for (let j = i + 1; j < systems.length; j++) {
        const A = systems[i];
        const B = systems[j];
        let dx = B.x - A.x;
        let dy = B.y - A.y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) (dx = rand() - 0.5), (dy = rand() - 0.5), (d = Math.hypot(dx, dy));
        const min = A.R + B.R + SYSTEM_GAP;
        if (d < min) {
          const push = ((min - d) / d) * 0.5;
          A.x -= dx * push;
          A.y -= dy * push;
          B.x += dx * push;
          B.y += dy * push;
        }
      }
    }
    for (const s of systems) {
      s.x *= 1 - 0.004 * cool; // gentle gravity keeps the sky compact
      s.y *= 1 - 0.004 * cool;
    }
  }
  // Tilted systems are flatter than round ones: squeeze the sky vertically to match.
  if (tilted) for (const s of systems) s.y *= TILT_SQUEEZE;
  // Put your biggest genre at the centre (the opening animation grows from there).
  const c = order[0];
  const ox = c.x;
  const oy = c.y;
  for (const s of systems) (s.x -= ox), (s.y -= oy);

  // Labels: radial, outside each planet; drop a label if it would overlap another one.
  const boxes = [];
  const overlaps = (b) => boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
  for (const s of order) {
    const sunLabel = { x: s.x - textWidth(s.name, 12) / 2, y: s.y + s.sunR + 4, w: textWidth(s.name, 12), h: 14 };
    boxes.push(sunLabel);
    for (const p of s.planets) {
      p.x = s.x + p.dx;
      p.y = s.y + p.dy;
      for (const m of p.moons) {
        m.x = p.x + Math.cos(m.angle) * p.moonOrbit;
        m.y = p.y + Math.sin(m.angle) * p.moonOrbit * moonTilt;
      }
      const text = p.explored ? `${p.name} ${p.count}` : p.name;
      const w = textWidth(text, LABEL_FONT);
      const cos = Math.cos(p.angle);
      const sin = Math.sin(p.angle);
      const lx = p.x + cos * (p.r + 4);
      const ly = p.y + sin * (p.r + 4);
      const anchor = cos > 0.35 ? 'start' : cos < -0.35 ? 'end' : 'middle';
      const bx = anchor === 'start' ? lx : anchor === 'end' ? lx - w : lx - w / 2;
      const by = sin > 0.35 ? ly : sin < -0.35 ? ly - LABEL_FONT : ly - LABEL_FONT / 2;
      const box = { x: bx, y: by, w, h: LABEL_FONT + 2 };
      p.label = { x: lx, y: by + LABEL_FONT - 1, anchor, visible: !overlaps(box) };
      if (p.label.visible) boxes.push(box);
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of systems) {
    minX = Math.min(minX, s.x - s.R);
    const ry = tilted ? s.R * TILT + 60 : s.R; // + room for the sun and its name
    minY = Math.min(minY, s.y - ry);
    maxX = Math.max(maxX, s.x + s.R);
    maxY = Math.max(maxY, s.y + ry);
  }
  return {
    tilt,
    moonTilt,
    systems,
    order,
    links: links.map((l) => ({ ...l, A: byId.get(l.a), B: byId.get(l.b) })),
    bounds: { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY },
  };
}
