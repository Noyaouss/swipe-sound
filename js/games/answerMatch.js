/**
 * answerMatch — forgiving check of a typed song title (Game 4, "Guess the song").
 *
 * Both sides are normalised (case, accents, punctuation, "&" = "and", a leading "the",
 * extras like "(feat. …)", "(Remastered 2011)", " - Live"), then compared without spaces.
 * A typo is forgiven when the Damerau-Levenshtein distance is ≤ 1 for short titles, about
 * 20% of the length for longer ones; one more than that is "so close". The main part of the
 * title (before " - " or "(") is accepted too. Titles of 1–3 characters need an exact match.
 */

const EXTRA = /\b(feat|ft|featuring|with|remaster(ed)?|radio|edit|version|live|mono|stereo|mix|remix|acoustic|demo|single|bonus|deluxe|instrumental|from|original|edition|reprise)\b/i;

/** The title without "(…)" / "[…]" / " - …" extras that name a version (feat., remaster, live…). */
export function stripExtras(title) {
  let s = String(title || '');
  s = s.replace(/\s*[([][^)\]]*[)\]]/g, (m) => (EXTRA.test(m) ? '' : m));
  s = s.replace(/\s+-\s+.*$/, (m) => (EXTRA.test(m) || /\d{4}/.test(m) ? '' : m));
  s = s.replace(/\s+(feat|ft)\.?\s.*$/i, '');
  return s.trim();
}

/** The part before " - " or "(" ("Song - Something" → "Song"). */
export const mainPart = (title) => String(title || '').split(/\s+-\s+|\s*[([]/)[0].trim();

/** Comparable form: no case, accents, punctuation, spaces, leading "the"; "&" = "and". */
export function normTitle(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^the /, '')
    .replace(/ /g, '');
}

/** Damerau-Levenshtein (optimal string alignment) distance. */
export function typoDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const allowedTypos = (len) => (len <= 6 ? 1 : Math.max(1, Math.round(len * 0.2)));

/**
 * Check a typed answer against the real title.
 * @returns {{ ok: boolean, forgiven?: boolean, close?: boolean }}
 *   ok + forgiven: accepted despite a typo · close: just over the limit ("So close!")
 */
export function checkAnswer(typed, title) {
  const a = normTitle(stripExtras(typed));
  if (!a) return { ok: false };
  const targets = [...new Set([normTitle(stripExtras(title)), normTitle(mainPart(title)), normTitle(title)])].filter(Boolean);
  if (targets.includes(a)) return { ok: true };
  let close = false;
  for (const t of targets) {
    if (t.length <= 3) continue; // very short titles: exact only
    const d = typoDistance(a, t);
    const max = allowedTypos(t.length);
    if (d <= max) return { ok: true, forgiven: true };
    if (d === max + 1) close = true;
  }
  return { ok: false, close };
}
