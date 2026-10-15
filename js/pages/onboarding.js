/**
 * Onboarding (first launch) — genres, artists, albums, songs.
 * Each step is also exported so the Profile page can edit with the same UI.
 */

import { h, icon, clear, spinner, errorBox, errorMessage, debounce, cover } from '../ui.js';
import * as ds from '../dataService.js';
import { storage } from '../storage.js';
import { player } from '../audio.js';
import { recomputeWeights } from '../recommender.js';
import { familyByDeezerId, stylesOf } from '../genreGraph.js';
import { navigate } from '../router.js';

// Shown first in "I listen to everything" mode / when no genre is liked.
const POPULAR_GENRE_IDS = [132, 152, 116, 106, 165, 85, 113, 129, 169, 466];

/* ------------------------------------------------------------------ */
/* Shared helpers                                                       */
/* ------------------------------------------------------------------ */

/** Round-robin merge of several lists, de-duplicated by key. */
function interleave(lists, key, limit) {
  const out = [];
  const seen = new Set();
  for (let i = 0; out.length < limit && lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const x = l[i];
      if (x && !seen.has(key(x))) {
        seen.add(key(x));
        out.push(x);
      }
    }
  }
  return out.slice(0, limit);
}

const settle = (promises) => Promise.allSettled(promises).then((r) => r.filter((x) => x.status === 'fulfilled').map((x) => x.value));

/**
 * Generic searchable picker.
 * opts: { placeholder, selected(): [], key, isSelected(item), toggle(item), suggestions(): Promise<[]>,
 *         search(q): Promise<[]>, renderItem(item, selected, onToggle), layout: 'grid'|'list', chipLabel(item), emptyText }
 */
function picker(opts) {
  const results = h('div', {});
  const strip = h('div', { class: 'selected-strip', 'aria-label': 'Your picks' });
  const input = h('input', { class: 'input', type: 'search', placeholder: opts.placeholder, 'aria-label': opts.placeholder, autocomplete: 'off' });
  let currentItems = [];
  let reqId = 0;

  const renderStrip = () => {
    clear(strip);
    for (const item of opts.selected()) {
      strip.append(
        h(
          'button',
          {
            class: 'chip static',
            'data-state': 'liked',
            'aria-label': `Remove ${opts.chipLabel(item)}`,
            onClick: () => {
              opts.toggle(item);
              update();
            },
          },
          opts.chipLabel(item),
          h('span', { class: 'x' }, icon('x', { size: 14 }))
        )
      );
    }
    if (!strip.firstChild) strip.append(h('span', { class: 'strip-empty' }, 'Your picks will appear here'));
  };

  const renderItems = (items) => {
    currentItems = items;
    clear(results);
    if (!items.length) {
      results.append(h('p', { class: 'muted' }, opts.emptyText || 'Nothing found.'));
      return;
    }
    const wrap = h(opts.layout === 'list' ? 'ul' : 'div', { class: opts.layout === 'list' ? 'list' : 'grid' });
    for (const item of items) {
      wrap.append(
        opts.renderItem(item, opts.isSelected(item), () => {
          opts.toggle(item);
          update();
        })
      );
    }
    results.append(wrap);
  };

  const update = () => {
    renderStrip();
    renderItems(currentItems);
  };

  const load = async (q) => {
    const id = ++reqId;
    clear(results).append(spinner(q ? 'Searching…' : 'Finding suggestions…'));
    try {
      const items = q ? await opts.search(q) : await opts.suggestions();
      if (id === reqId) renderItems(items);
    } catch (err) {
      if (id === reqId) clear(results).append(errorBox(errorMessage(err), () => load(q)));
    }
  };

  input.addEventListener('input', debounce(() => load(input.value.trim()), 350));
  renderStrip();
  load('');

  return h(
    'div',
    {},
    h('div', { class: 'search', style: { marginBottom: '12px' } }, icon('search', { size: 20 }), input),
    strip,
    results
  );
}

function pickTile({ img, alt, name, sub, round, pressed, onToggle }) {
  return h(
    'button',
    { class: 'pick' + (round ? ' round' : ''), 'aria-pressed': String(pressed), onClick: onToggle },
    cover(img, alt),
    h('span', { class: 'badge-check' }, icon('check', { size: 16 })),
    h('span', { class: 'name' }, name),
    sub && h('span', { class: 'sub' }, sub)
  );
}

/* ------------------------------------------------------------------ */
/* Step 1: Genres                                                       */
/* ------------------------------------------------------------------ */

/**
 * Tri-state chip: tap once to like (♥), twice to dislike (✕), a third time to reset.
 * get() returns 'liked' | 'disliked' | 'neutral'; set(next) stores the new state.
 */
function triChip(label, get, set, { small = false, onChange } = {}) {
  const NEXT = { neutral: 'liked', liked: 'disliked', disliked: 'neutral' };
  const MARK = { liked: '♥', disliked: '✕', neutral: '' };
  const chip = h('button', { class: 'chip' + (small ? ' small' : '') }, h('span', { class: 'st', 'aria-hidden': 'true' }), label);
  const paint = () => {
    const st = get();
    chip.dataset.state = st;
    chip.querySelector('.st').textContent = MARK[st];
    chip.setAttribute('aria-label', `${label}: ${st}. Tap to change.`);
  };
  chip.addEventListener('click', () => {
    set(NEXT[get()]);
    paint();
    onChange && onChange();
  });
  paint();
  return chip;
}

/** Like / dislike lists of { key, name } objects inside the draft profile. */
function triState(draft, likedKey, dislikedKey, idKey) {
  const get = (item) =>
    draft[likedKey].some((x) => x[idKey] === item[idKey]) ? 'liked' : draft[dislikedKey].some((x) => x[idKey] === item[idKey]) ? 'disliked' : 'neutral';
  const set = (item, st) => {
    draft[likedKey] = draft[likedKey].filter((x) => x[idKey] !== item[idKey]);
    draft[dislikedKey] = draft[dislikedKey].filter((x) => x[idKey] !== item[idKey]);
    if (st === 'liked') draft[likedKey].push(item);
    if (st === 'disliked') draft[dislikedKey].push(item);
  };
  return { get, set };
}

/**
 * Genres step (onboarding and Profile ▸ Edit): every genre is an expandable category.
 * The genre keeps its own like/dislike; opening it lists its sub-genres, each with its
 * own like/dislike. Choices are independent (like Rock but dislike Grunge, or the reverse).
 */
export function genresStep(draft, { onEverything } = {}) {
  draft.likedSubGenres ||= [];
  draft.dislikedSubGenres ||= [];
  const root = h('div', {});
  const list = h('div', { class: 'genre-list', role: 'list', 'aria-label': 'Genres' });
  const genre = triState(draft, 'likedGenres', 'dislikedGenres', 'genreId');
  const style = triState(draft, 'likedSubGenres', 'dislikedSubGenres', 'id');

  const everythingBtn = h(
    'button',
    {
      class: 'everything-btn',
      'aria-pressed': String(!!draft.listenAll),
      onClick: () => {
        draft.listenAll = !draft.listenAll;
        everythingBtn.setAttribute('aria-pressed', String(draft.listenAll));
        if (draft.listenAll && onEverything) onEverything();
      },
    },
    h('span', { style: { fontSize: '1.6rem' }, 'aria-hidden': 'true' }, '🌍'),
    h('span', {}, 'I listen to everything', h('br'), h('span', { class: 'muted small' }, 'Skip genres and explore a bit of everything'))
  );

  const row = (g) => {
    const fam = familyByDeezerId(g.genreId);
    const styles = fam ? stylesOf(fam.id).map((n) => ({ id: n.id, name: n.name })) : [];
    const panelId = `styles-${g.genreId}`;
    const summary = h('span', { class: 'genre-summary', 'aria-hidden': 'true' });
    const paintSummary = () => {
      const liked = styles.filter((x) => style.get(x) === 'liked').length;
      const disliked = styles.filter((x) => style.get(x) === 'disliked').length;
      summary.textContent = [liked && `${liked} ♥`, disliked && `${disliked} ✕`].filter(Boolean).join(' · ');
    };
    const panel = h(
      'div',
      { class: 'chips genre-styles', id: panelId, hidden: true, role: 'group', 'aria-label': `${g.name} styles` },
      styles.map((x) => triChip(x.name, () => style.get(x), (st) => style.set(x, st), { small: true, onChange: paintSummary }))
    );
    const toggle =
      styles.length &&
      h(
        'button',
        {
          class: 'genre-expand',
          'aria-expanded': 'false',
          'aria-controls': panelId,
          'aria-label': `${g.name}: show its ${styles.length} styles`,
          onClick: () => {
            panel.hidden = !panel.hidden;
            toggle.setAttribute('aria-expanded', String(!panel.hidden));
            toggle.classList.toggle('open', !panel.hidden);
          },
        },
        summary,
        `${styles.length} styles`,
        icon('chevron', { size: 16 })
      );
    paintSummary();
    // Open categories that already hold choices, so they're visible when editing.
    if (styles.some((x) => style.get(x) !== 'neutral')) {
      panel.hidden = false;
      toggle && toggle.setAttribute('aria-expanded', 'true');
      toggle && toggle.classList.add('open');
    }
    return h(
      'div',
      { class: 'genre-row', role: 'listitem' },
      h('div', { class: 'genre-head' }, triChip(g.name, () => genre.get(g), (st) => genre.set({ genreId: g.genreId, name: g.name }, st)), toggle),
      panel
    );
  };

  const load = async () => {
    clear(list).append(spinner('Loading genres…'));
    try {
      const genres = await ds.getGenres();
      clear(list).append(...genres.map(row));
    } catch (err) {
      clear(list).append(errorBox(errorMessage(err), load));
    }
  };
  load();

  root.append(
    everythingBtn,
    h('p', { class: 'muted' }, 'Tap once to like, twice to dislike, three times to reset. Open a genre to pick its styles.'),
    h('div', { class: 'legend' }, h('span', { class: 'l-like' }, 'Liked'), h('span', { class: 'l-nope' }, 'Disliked'), h('span', { class: 'l-neutral' }, 'Neutral')),
    list
  );
  return root;
}

/* ------------------------------------------------------------------ */
/* Step 2: Artists                                                      */
/* ------------------------------------------------------------------ */

function genreIdsFor(draft) {
  const liked = draft.likedGenres.map((g) => g.genreId);
  if (liked.length && !draft.listenAll) return liked;
  const disliked = new Set(draft.dislikedGenres.map((g) => g.genreId));
  return [...new Set([...liked, ...POPULAR_GENRE_IDS])].filter((id) => !disliked.has(id));
}

export function artistsStep(draft) {
  const key = (a) => a.artistId;
  return picker({
    placeholder: 'Search any artist',
    layout: 'grid',
    selected: () => draft.artists,
    chipLabel: (a) => a.name,
    isSelected: (a) => draft.artists.some((x) => x.artistId === a.artistId),
    toggle: (a) => {
      const i = draft.artists.findIndex((x) => x.artistId === a.artistId);
      if (i >= 0) draft.artists.splice(i, 1);
      else draft.artists.push({ artistId: a.artistId, name: a.name, picture: a.pictureSmall || a.picture });
    },
    suggestions: async () => {
      const ids = genreIdsFor(draft);
      const per = Math.max(4, Math.ceil(36 / ids.length));
      const lists = await settle(ids.map((id) => ds.getGenreArtists(id, per)));
      if (!lists.length) throw new Error("Couldn't load artists.");
      return interleave(lists, key, 36);
    },
    search: (q) => ds.searchArtists(q, 24),
    emptyText: 'No artists found. Try another spelling.',
    renderItem: (a, pressed, onToggle) =>
      pickTile({ img: a.pictureSmall || a.picture, alt: '', name: a.name, round: true, pressed, onToggle }),
  });
}

/* ------------------------------------------------------------------ */
/* Step 3: Albums                                                       */
/* ------------------------------------------------------------------ */

export function albumsStep(draft) {
  const key = (a) => a.albumId;
  return picker({
    placeholder: 'Search any album',
    layout: 'grid',
    selected: () => draft.albums,
    chipLabel: (a) => a.title,
    isSelected: (a) => draft.albums.some((x) => x.albumId === a.albumId),
    toggle: (a) => {
      const i = draft.albums.findIndex((x) => x.albumId === a.albumId);
      if (i >= 0) draft.albums.splice(i, 1);
      else
        draft.albums.push({
          albumId: a.albumId,
          title: a.title,
          artistId: a.artistId,
          artistName: a.artistName,
          coverSmall: a.coverSmall,
          genreId: a.genreId,
          year: a.year,
        });
    },
    suggestions: async () => {
      const fromArtists = await settle(
        draft.artists.slice(0, 10).map((a) =>
          ds.getArtistAlbums(a.artistId, 25).then((list) => list.slice(0, 4).map((al) => ({ ...al, artistName: al.artistName || a.name })))
        )
      );
      const fromGenres = await settle(genreIdsFor(draft).slice(0, 6).map((id) => ds.getGenreTopAlbums(id, 12)));
      return interleave([...fromArtists, ...fromGenres], key, 36);
    },
    search: (q) => ds.searchAlbums(q, 24),
    emptyText: 'No albums found.',
    renderItem: (a, pressed, onToggle) =>
      pickTile({ img: a.coverSmall, alt: '', name: a.title, sub: [a.artistName, a.year].filter(Boolean).join(' · '), pressed, onToggle }),
  });
}

/* ------------------------------------------------------------------ */
/* Step 4: Songs                                                        */
/* ------------------------------------------------------------------ */

export function songsStep(draft) {
  const key = (t) => t.trackId;
  const unsub = [];
  const el = picker({
    placeholder: 'Search any song',
    layout: 'list',
    selected: () => draft.songs,
    chipLabel: (t) => t.title,
    isSelected: (t) => draft.songs.some((x) => x.trackId === t.trackId),
    toggle: (t) => {
      const i = draft.songs.findIndex((x) => x.trackId === t.trackId);
      if (i >= 0) draft.songs.splice(i, 1);
      else
        draft.songs.push({
          trackId: t.trackId,
          title: t.title,
          artistId: t.artistId,
          artistName: t.artistName,
          albumId: t.albumId,
          coverSmall: t.coverSmall,
          genre: t.genre,
          year: t.year,
        });
    },
    suggestions: async () => {
      const fromArtists = await settle(draft.artists.slice(0, 10).map((a) => ds.getArtistTopTracks(a.artistId, 4)));
      const fromAlbums = await settle(
        draft.albums.slice(0, 8).map((al) => ds.getAlbum(al.albumId).then((a) => (a.tracks || []).sort((x, y) => y.rank - x.rank).slice(0, 3)))
      );
      let lists = [...fromArtists, ...fromAlbums];
      if (!lists.some((l) => l.length)) lists = await settle(genreIdsFor(draft).slice(0, 6).map((id) => ds.getGenreTopTracks(id, 8)));
      return interleave(lists, key, 40);
    },
    search: (q) => ds.searchTracks(q, 25),
    emptyText: 'No songs found.',
    renderItem: (t, pressed, onToggle) => {
      const playBtn = h(
        'button',
        {
          class: 'icon-btn',
          'aria-label': `Play preview of ${t.title}`,
          disabled: !t.hasPreview,
          onClick: (e) => {
            e.stopPropagation();
            player.toggle(t);
          },
        },
        icon(player.isPlaying(t.trackId) ? 'pause' : 'play', { size: 20 })
      );
      unsub.push(
        player.subscribe((s) => {
          const playing = s.trackId === t.trackId && (s.status === 'playing' || s.status === 'loading');
          playBtn.replaceChildren(icon(playing ? 'pause' : 'play', { size: 20 }));
        })
      );
      return h(
        'li',
        {
          class: 'list-item selectable',
          'aria-pressed': String(pressed),
          role: 'button',
          tabindex: '0',
          'aria-label': `${t.title} by ${t.artistName}${pressed ? ', selected' : ''}`,
          onClick: onToggle,
          onKeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle()),
        },
        cover(t.coverSmall, '', 'thumb'),
        h('div', { class: 'meta' }, h('div', { class: 't' }, t.title), h('div', { class: 's' }, t.artistName)),
        playBtn,
        h('span', { class: 'check', 'aria-hidden': 'true' }, icon('check', { size: 16 }))
      );
    },
  });
  el.cleanup = () => unsub.forEach((u) => u());
  return el;
}

/* ------------------------------------------------------------------ */
/* Flow                                                                 */
/* ------------------------------------------------------------------ */

export const STEPS = [
  { id: 'genres', title: 'What do you like?', intro: 'Pick the genres you love and the ones you can skip.', render: genresStep },
  { id: 'artists', title: 'Favorite artists', intro: 'Tap the artists you love. Search for anyone.', render: artistsStep },
  { id: 'albums', title: 'Albums you love', intro: 'Based on your artists and genres.', render: albumsStep },
  { id: 'songs', title: 'A few songs', intro: 'Tap to pick, ▶ to preview.', render: songsStep },
];

export function mount(view) {
  const draft = structuredClone(storage.data.profile);
  let step = 0;
  let current = null;

  const finish = () => {
    player.stop();
    storage.update((d) => {
      d.profile = draft;
      d.onboarded = true;
      recomputeWeights(d);
    });
    navigate('swipe'); // re-renders even if the address already says #/swipe (installed app)
  };

  const go = (i) => {
    if (current && current.cleanup) current.cleanup();
    player.stop();
    if (i >= STEPS.length) return finish();
    step = Math.max(0, i);
    render();
  };

  function render() {
    const s = STEPS[step];
    const last = step === STEPS.length - 1;
    current = s.render(draft, { onEverything: () => setTimeout(() => go(step + 1), 250) });
    clear(view).append(
      h(
        'div',
        { class: 'onb' },
        h(
          'div',
          { class: 'onb-progress', role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': String(STEPS.length), 'aria-valuenow': String(step + 1), 'aria-label': 'Setup progress' },
          h('div', { style: { width: `${((step + 1) / STEPS.length) * 100}%` } })
        ),
        h('div', { class: 'onb-step-label' }, `Step ${step + 1} of ${STEPS.length}`),
        h('h1', {}, s.title),
        h('p', { class: 'muted' }, s.intro),
        h('div', { class: 'onb-body' }, current),
        h(
          'div',
          { class: 'onb-footer' },
          step > 0 && h('button', { class: 'btn ghost', onClick: () => go(step - 1) }, 'Back'),
          h('button', { class: 'btn ghost', onClick: () => go(step + 1) }, last ? 'Skip & finish' : 'Skip'),
          h('button', { class: 'btn primary', onClick: () => go(step + 1) }, last ? "Let's go!" : 'Next')
        )
      )
    );
    view.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  render();
  return () => current && current.cleanup && current.cleanup();
}
