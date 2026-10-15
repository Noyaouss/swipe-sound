/**
 * blindspot — the Blind Spot engine: a friendly guide outside your comfort zone.
 *
 * Comfort ladder (via getProximityLevel and the genre graph):
 *   Level 1 Neighbor · Level 2 Cousin · Level 3 Explorer
 *
 * Pleasantness rules:
 *   1. Start at Level 1. 3 likes in a row unlock the next level; 3 dislikes in a
 *      row step back one level and insert a familiar-feeling card next.
 *   2. At least 1 card in 4 is a "near-sure win" (Level 1, high predicted match).
 *   3. Far genres only through accessible entry-point tracks (curated popular artists, their top songs).
 *   4. Disliked genres excluded unless "second chance" is on (then only their most accessible tracks).
 *   5. Never more than 2 cards in a row from the same genre.
 *   6. A friendly recap after ~15 cards.
 *
 * Learning rules: like = normal positive, dislike = very weak negative, "Not for now" = nothing
 * (see recommender.recomputeWeights). After 3+ likes in a new genre we offer to add it.
 */

import * as ds from './dataService.js';
import { storage } from './storage.js';
import { NODES, nodeForTrack, familyByName, bridgeOnPath, placeTrack } from './genreGraph.js';
import {
  getProximityLevel,
  pickExploreNodes,
  nodeTracks,
  predictedMatch,
  seenSets,
  songKey,
  isDislikedGenre,
  isDislikedStyle,
  dislikedFamilies,
  topWeights,
  TUNING,
  knownReady,
  isKnownSong,
} from './recommender.js';

export const LEVELS = {
  1: { name: 'Neighbor', plural: 'Neighbors', hint: 'Close to what you love' },
  2: { name: 'Cousin', plural: 'Cousins', hint: 'Two steps away, through a bridge' },
  3: { name: 'Explorer', plural: 'Explorers', hint: 'Far away, through their friendliest songs' },
};

export const RULES = {
  streakToLevelUp: 3,
  streakToStepBack: 3,
  nearSureEvery: 4,
  maxSameGenreInRow: 2,
  recapEvery: 15,
  askAfterLikes: 3,
  nearSureMinMatch: 0.55,
  tracksPerArtist: { 1: 2, 2: 2, 3: 1 }, // farther = only the most popular songs
  artistCooldown: 4, // no artist twice within this many cards
};

const LIKE_COPY = ['Nice, you found a new one!', 'Great ear!', 'Ooh, good pick.', 'New territory unlocked!', 'Love that for you.'];
const DISLIKE_COPY = ['No worries, on to the next.', 'Fair enough!', 'Noted. Something else coming up.'];
export const pickCopy = (list) => list[Math.floor(Math.random() * list.length)];

const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
const genreOf = (t) => NODES.get(placeTrack(t).family)?.name || t.genre || t.subGenre || '?';

/* ------------------------------------------------------------------ */
/* "Why this?"                                                          */
/* ------------------------------------------------------------------ */

export function whyLine(track, prox) {
  if (track.bridgeArtist) return `Fans of ${track.bridgeArtist} often love this`;
  const node = prox.node;
  if (!node || !prox.from) return `Something a little different for you`;
  const bridge = bridgeOnPath(prox.path, { last: prox.level >= 3 }) || prox.bridge;
  const why = bridge ? bridge.why : '';
  if (prox.level <= 1) {
    if (prox.from.kind === 'family' && node.family === prox.from.id) return `A different side of ${prox.from.name}: ${node.name}`;
    return `Close to ${prox.from.name}: ${why}`;
  }
  if (prox.level === 2) {
    const mid = prox.path.length > 2 ? NODES.get(prox.path[prox.path.length - 2]) : null;
    return mid && mid.id !== prox.from.id
      ? `From ${prox.from.name} via ${mid.name}: ${why}`
      : `If you like ${prox.from.name}: ${why}`;
  }
  return `A friendly way into ${node.name}: ${why || 'one of its most loved songs'}`;
}

/* ------------------------------------------------------------------ */
/* Feed                                                                 */
/* ------------------------------------------------------------------ */

export class BlindSpotFeed {
  constructor() {
    this.queue = [];
    this.pools = { 1: [], 2: [], 3: [] };
    this.loading = {};
    this.session = { cards: 0, likes: 0, newGenres: new Set(), sinceNearSure: 0, familiarNext: false, sinceRecap: 0 };
    this.lastGenres = [];
    this.lastArtists = [];
  }

  reset() {
    this.queue = [];
    this.pools = { 1: [], 2: [], 3: [] };
  }

  get state() {
    return storage.data.blindSpotState;
  }

  /** Fetch candidates for one level into its pool. */
  async fillPool(level) {
    if (this.loading[level]) return this.loading[level];
    this.loading[level] = (async () => {
      const data = storage.data;
      const allow = this.state.allowDislikedGenres;
      const jobs = [];
      let nodes = pickExploreNodes(data, 4, level, level);
      if (allow) {
        // Second chance: add one style from a disliked family, accessible tracks only.
        const fams = dislikedFamilies(data);
        const extra = [...NODES.values()].filter((n) => n.kind === 'style' && fams.has(n.family));
        if (extra.length) nodes = nodes.concat(shuffle(extra).slice(0, 1).map((n) => Object.assign(Object.create(n), { secondChance: true })));
      }
      for (const node of nodes) {
        jobs.push(
          nodeTracks(node, { artists: 2, perArtist: 6 }).then((tracks) => {
            // Rule 3: only the most popular (accessible) songs of each entry artist.
            const per = node.secondChance ? 1 : RULES.tracksPerArtist[level];
            const byArtist = {};
            return tracks
              .sort((a, b) => b.rank - a.rank)
              .filter((t) => (byArtist[t.artistId] = (byArtist[t.artistId] || 0) + 1) <= per)
              .map((t) => Object.assign(t, { secondChance: !!node.secondChance }));
          })
        );
      }
      // Artist bridges: related artists of artists you like.
      if (level <= 2) {
        const liked = data.profile.artists.length ? data.profile.artists : topWeights(data.tasteWeights.artists, 5, 1).map(([artistId]) => ({ artistId }));
        for (const a of shuffle(liked).slice(0, 2)) {
          jobs.push(
            ds.getRelatedArtists(a.artistId, 15).then(async (rel) => {
              const lists = await Promise.allSettled(shuffle(rel).slice(0, 3).map((r) => ds.getArtistTopTracks(r.artistId, 3)));
              const name = a.name || data.likedSongs.find((s) => s.artistId === a.artistId)?.artistName;
              const tracks = lists.flatMap((r) => (r.status === 'fulfilled' ? r.value.slice(0, 1) : []));
              await Promise.allSettled(tracks.map((t) => ds.enrichGenre(t)));
              return tracks.map((t) => Object.assign(t, { bridgeArtist: name || null }));
            })
          );
        }
      }
      const results = await Promise.allSettled(jobs);
      const fresh = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      if (!fresh.length) {
        const err = results.find((r) => r.status === 'rejected');
        if (err && !this.pools[level].length) throw err.reason;
      }
      const ids = new Set(this.pools[level].map((t) => t.trackId));
      for (const t of shuffle(fresh)) {
        if (ids.has(t.trackId)) continue;
        ids.add(t.trackId);
        const prox = getProximityLevel(t, data);
        if (prox.level === 0) continue; // already home: not a blind spot
        const lvl = Math.min(3, Math.max(1, prox.level));
        t.bs = { level: lvl, prox };
        this.pools[lvl].push(t);
      }
    })().finally(() => (this.loading[level] = null));
    return this.loading[level];
  }

  usable(t, data, seen, queuedKeys) {
    if (seen.has(t) || queuedKeys.has(songKey(t))) return false;
    if (!this.state.allowDislikedGenres && (isDislikedGenre(t, data) || isDislikedStyle(t, data))) return false;
    if (t.secondChance && !this.state.allowDislikedGenres) return false;
    return true;
  }

  /** Choose one card according to the pleasantness rules. */
  pick(data) {
    const seen = seenSets(data);
    const queuedKeys = new Set(this.queue.map(songKey));
    const recent = [...this.lastGenres, ...this.queue.map(genreOf)].slice(-RULES.maxSameGenreInRow);
    const blockedGenre = recent.length === RULES.maxSameGenreInRow && recent.every((g) => g === recent[0]) ? recent[0] : null;

    const wantNearSure = this.session.familiarNext || this.session.sinceNearSure >= RULES.nearSureEvery - 1;
    const level = wantNearSure ? 1 : this.state.currentLevel;

    const recentArtists = new Set([...this.lastArtists, ...this.queue.map((t) => t.artistId)].slice(-RULES.artistCooldown));
    const from = (lvl, nearSure) => {
      let list = this.pools[lvl].filter((t) => this.usable(t, data, seen, queuedKeys));
      const fresh = list.filter((t) => !recentArtists.has(t.artistId));
      if (fresh.length) list = fresh;
      // Drop the stale ones (seen elsewhere) from the pool.
      this.pools[lvl] = this.pools[lvl].filter((t) => !seen.has(t));
      const preferred = list.filter((t) => genreOf(t) !== blockedGenre);
      if (preferred.length) list = preferred;
      if (!list.length) return null;
      if (nearSure) {
        list = list
          .map((t) => ({ t, m: predictedMatch(t, data) + (t.bridgeArtist ? 0.15 : 0) }))
          .sort((a, b) => b.m - a.m)
          .map((x) => x.t);
      }
      return list[0];
    };

    let track = from(level, wantNearSure);
    for (const alt of [level - 1, level + 1, 1, 2, 3]) if (!track && this.pools[alt]) track = from(alt, false);
    if (!track) return null;
    for (const lvl of [1, 2, 3]) this.pools[lvl] = this.pools[lvl].filter((t) => t !== track);

    const nearSure = wantNearSure && track.bs.level === 1 && predictedMatch(track, data) >= RULES.nearSureMinMatch - 0.2;
    track.bs = { ...track.bs, nearSure, why: whyLine(track, track.bs.prox) };
    if (nearSure || track.bs.level === 1) this.session.sinceNearSure = 0;
    else this.session.sinceNearSure++;
    this.session.familiarNext = false;
    return track;
  }

  async ensure(n = 3) {
    await knownReady();
    const data = storage.data;
    this.queue = this.queue.filter((t, i) => i === 0 || !isKnownSong(t));
    let guard = 0;
    while (this.queue.length < n && guard++ < 8) {
      const lvl = this.session.familiarNext ? 1 : this.state.currentLevel;
      if (this.pools[lvl].length < 4 || this.pools[1].length < 3) {
        await Promise.allSettled([this.fillPool(lvl), this.pools[1].length < 3 && lvl !== 1 ? this.fillPool(1) : null]);
      }
      const t = this.pick(data);
      if (!t) {
        await this.fillPool(Math.max(1, Math.min(3, lvl))).catch((e) => {
          if (!this.queue.length) throw e;
        });
        continue;
      }
      await ds.enrichGenre(t).catch(() => {}); // year + album genres (cached)
      this.queue.push(t);
    }
    return this.queue;
  }

  /** Re-plan the hidden part of the queue after the level changed. */
  replan(keep = 1) {
    const dropped = this.queue.splice(keep);
    for (const t of dropped) if (t.bs) this.pools[t.bs.level].unshift(t);
  }

  /**
   * Apply a reaction to the streak/ladder state. Returns UI messages:
   * { message, levelChange: +1|-1|0, askGenre: node|null }
   */
  react(track, action) {
    const out = { message: null, levelChange: 0, askGenre: null };
    this.queue = this.queue.filter((t) => t.trackId !== track.trackId);
    this.lastGenres.push(genreOf(track));
    this.lastArtists.push(track.artistId);
    if (this.lastGenres.length > 5) this.lastGenres.shift();
    if (this.lastArtists.length > 8) this.lastArtists.shift();
    this.session.cards++;
    this.session.sinceRecap++;
    const node = nodeForTrack(track);
    const genreKey = node ? node.name : genreOf(track);
    if (!storage.data.blindSpotState.exploredGenres[genreKey]) this.session.newGenres.add(genreKey);

    storage.update((d) => {
      const s = d.blindSpotState;
      const g = (s.exploredGenres[genreKey] ||= { likes: 0, dislikes: 0, skips: 0, firstAt: Date.now(), lastAt: 0, askedAt: 0, level: track.bs?.level || 1 });
      g.lastAt = Date.now();
      if (action === 'like') {
        g.likes++;
        s.likeStreak++;
        s.dislikeStreak = 0;
        this.session.likes++;
        out.message = pickCopy(LIKE_COPY);
        if (s.likeStreak >= RULES.streakToLevelUp && s.currentLevel < 3) {
          s.currentLevel++;
          s.likeStreak = 0;
          out.levelChange = 1;
        }
        const known = (s.discoveries || []).includes(node && node.id);
        if (node && !known && g.likes >= RULES.askAfterLikes && g.likes >= (g.askedAt || 0) + RULES.askAfterLikes) out.askGenre = node;
      } else if (action === 'nope') {
        g.dislikes++;
        s.dislikeStreak++;
        s.likeStreak = 0;
        out.message = pickCopy(DISLIKE_COPY);
        if (s.dislikeStreak >= RULES.streakToStepBack) {
          s.dislikeStreak = 0;
          if (s.currentLevel > 1) {
            s.currentLevel--;
            out.levelChange = -1;
          }
          this.session.familiarNext = true;
          out.message = "No worries, we'll try something closer.";
        }
      } else {
        g.skips++;
      }
    }, 'blindspot-state');

    if (out.levelChange || this.session.familiarNext) this.replan(0);
    return out;
  }

  /** Mark a genre question as answered. yes = add to the comfort zone / profile. */
  answerGenre(node, yes) {
    storage.update((d) => {
      const s = d.blindSpotState;
      const g = s.exploredGenres[node.name];
      if (g) g.askedAt = g.likes;
      if (yes) {
        if (!s.discoveries.includes(node.id)) s.discoveries.push(node.id);
        // Families are real Deezer genres: add them to liked genres too.
        const fam = node.kind === 'family' ? familyByName(node.name) : null;
        if (fam && !d.profile.likedGenres.some((x) => x.genreId === fam.deezerId)) {
          d.profile.likedGenres.push({ genreId: fam.deezerId, name: fam.name });
          d.profile.dislikedGenres = d.profile.dislikedGenres.filter((x) => x.genreId !== fam.deezerId);
        }
      }
    }, yes ? 'profile' : 'blindspot-state');
  }

  needsRecap() {
    return this.session.sinceRecap >= RULES.recapEvery;
  }

  recap() {
    const s = this.session;
    const out = { cards: s.cards, likes: s.likes, newGenres: s.newGenres.size };
    s.sinceRecap = 0;
    return out;
  }
}

export { TUNING };
