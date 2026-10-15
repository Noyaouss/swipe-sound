/**
 * Profile — edit onboarding choices, see your learned taste, settings, backup.
 */

import { h, icon, clear, cover, toast, confirmDialog, dialog, downloadFile } from '../ui.js';
import { storage, defaultData, migrate } from '../storage.js';
import { PLATFORMS } from '../dataService.js';
import { mountSpotify, spotifySummary } from './spotify.js';
import { recomputeWeights, knownReady } from '../recommender.js';
import { tasteCounts } from '../musicMap.js';
import { NODES } from '../genreGraph.js';
import { STEPS } from './onboarding.js';
import { player } from '../audio.js';
import { navigate } from '../router.js';

export function mount(view, params) {
  if (params[0] === 'edit' && STEPS.some((s) => s.id === params[1])) return mountEdit(view, params[1]);
  if (params[0] === 'import' || params[0] === 'spotify') return mountSpotify(view); // 'spotify': old links
  const render = () => {
    const y = window.scrollY;
    clear(view).append(renderProfile());
    window.scrollTo(0, y);
  };
  render();
  let alive = true;
  knownReady().then(() => alive && render()); // the Spotify library may still be loading
  const unsub = storage.subscribe((_, reason) => {
    if (reason === 'remote' || reason === 'replace' || reason === 'merge') render();
  });
  return () => {
    alive = false;
    unsub();
  };
}

/* ------------------------------------------------------------------ */
/* Edit a step with the onboarding UI                                   */
/* ------------------------------------------------------------------ */

function mountEdit(view, stepId) {
  const step = STEPS.find((s) => s.id === stepId);
  const draft = structuredClone(storage.data.profile);
  const body = step.render(draft, {});
  const save = () => {
    storage.update((d) => {
      d.profile = draft;
      recomputeWeights(d);
    }, 'profile');
    toast('Profile updated', { icon: 'check' });
    navigate('profile');
  };
  view.append(
    h(
      'div',
      { class: 'onb' },
      h(
        'div',
        { class: 'page-head' },
        h('a', { class: 'icon-btn', href: '#/profile', 'aria-label': 'Back to profile' }, icon('back')),
        h('h1', { style: { flex: '1' } }, step.title)
      ),
      h('p', { class: 'muted' }, step.intro),
      h('div', { class: 'onb-body' }, body),
      h(
        'div',
        { class: 'onb-footer' },
        h('a', { class: 'btn ghost', href: '#/profile' }, 'Cancel'),
        h('button', { class: 'btn primary', onClick: save }, 'Save')
      )
    )
  );
  return () => {
    player.stop();
    body.cleanup && body.cleanup();
  };
}

/* ------------------------------------------------------------------ */
/* Main profile view                                                    */
/* ------------------------------------------------------------------ */

function bars(entries, labelOf = (k) => k, showValue = false) {
  if (!entries.length) return h('p', { class: 'muted small' }, 'Swipe a few songs and this will fill in.');
  const max = Math.max(...entries.map(([, v]) => v));
  return h(
    'div',
    { class: 'bars' },
    entries.map(([k, v]) =>
      h(
        'div',
        { class: 'bar-row' },
        h('span', { class: 'label', title: labelOf(k) }, labelOf(k)),
        h(
          'div',
          { class: 'bar-track', role: 'img', 'aria-label': showValue ? `${labelOf(k)}: ${v} songs` : `${labelOf(k)}: ${Math.round((v / max) * 100)}%` },
          h('div', { class: 'bar-fill', style: { width: `${Math.max(6, (v / max) * 100)}%` } })
        ),
        showValue && h('span', { class: 'bar-value' }, v.toLocaleString())
      )
    )
  );
}

function section(title, editStep, ...children) {
  return h(
    'section',
    { class: 'profile-section', 'aria-label': title },
    h(
      'h2',
      {},
      title,
      editStep && h('a', { class: 'btn small ghost', href: `#/profile/edit/${editStep}`, 'aria-label': `Edit ${title.toLowerCase()}` }, icon('edit', { size: 16 }), 'Edit')
    ),
    ...children
  );
}

function miniCovers(items, img, name, round) {
  if (!items.length) return h('p', { class: 'muted small' }, 'None yet.');
  return h(
    'div',
    { class: 'mini-covers' },
    items.map((it) =>
      h('div', { class: 'pick' + (round ? ' round' : '') }, cover(img(it), ''), h('span', { class: 'name' }, name(it)))
    )
  );
}

function renderProfile() {
  const d = storage.data;
  const p = d.profile;
  // "Your taste" uses the same data as the Music Map: Spotify library + liked songs.
  const taste = tasteCounts(d);
  const topGenres = [...taste.families.entries()]
    .filter(([, f]) => f.count)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 6)
    .map(([id, f]) => [NODES.get(id).name, f.count]);
  const topStyles = [...taste.families.values()]
    .flatMap((f) => [...f.styles.entries()])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, n]) => [NODES.get(id).name, n]);
  const likes = d.swipes.filter((s) => s.liked).length + d.blindSpotSwipes.filter((s) => s.liked).length;
  const swipeCount = d.swipes.length + d.blindSpotSwipes.filter((s) => !s.skipped).length;

  const set = (fn, reason = 'settings') => storage.update(fn, reason);

  const platformSelect = h(
    'select',
    {
      class: 'select',
      id: 'platform',
      onChange: (e) => set((dd) => (dd.profile.preferredPlatform = e.target.value)),
    },
    Object.entries(PLATFORMS).map(([k, label]) => h('option', { value: k, selected: p.preferredPlatform === k }, label))
  );

  const lengthSeg = h(
    'div',
    { class: 'segmented', role: 'group', 'aria-label': 'Preview length' },
    [15, 30].map((n) =>
      h(
        'button',
        {
          'aria-pressed': String(p.previewLength === n),
          onClick: (e) => {
            set((dd) => (dd.profile.previewLength = n));
            e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
          },
        },
        `${n}s`
      )
    )
  );

  const switchRow = (id, label, hint, checked, onChange) =>
    h(
      'div',
      { class: 'switch-row' },
      h('label', { for: id }, label, hint && h('span', { class: 'hint' }, hint)),
      h('input', { type: 'checkbox', role: 'switch', class: 'switch', id, checked, onChange: (e) => onChange(e.target.checked) })
    );

  const discoveries = (d.blindSpotState.discoveries || []).map((id) => NODES.get(id)?.name || id);

  return h(
    'div',
    {},
    h('div', { class: 'page-head' }, h('h1', {}, 'Profile')),

    // Taste summary
    section(
      'Your taste',
      null,
      h(
        'p',
        { class: 'muted small' },
        `${taste.total.toLocaleString()} songs in your taste (Spotify library + likes) · ${swipeCount} swipes · ${likes} likes`
      ),
      h('h3', { class: 'section-title' }, 'Top genres'),
      bars(topGenres, (k) => k, true),
      topStyles.length ? h('h3', { class: 'section-title', style: { marginTop: '16px' } }, 'Top styles') : null,
      topStyles.length ? bars(topStyles, (k) => k, true) : null,
      h('h3', { class: 'section-title', style: { marginTop: '16px' } }, 'Top artists'),
      bars(taste.artists.slice(0, 6), (k) => k, true),
      taste.total > taste.mapped
        ? h('p', { class: 'muted small', style: { marginTop: '10px' } }, `${(taste.total - taste.mapped).toLocaleString()} library songs are still being sorted into genres (see the Map).`)
        : null,
      h('a', { class: 'btn small ghost', href: '#/map', style: { marginTop: '10px' } }, icon('map', { size: 16 }), 'See it as a map')
    ),

    // Onboarding choices
    section(
      'Genres',
      'genres',
      p.listenAll && h('p', {}, '🌍 You listen to everything.'),
      h('div', { class: 'chips' }, [
        ...p.likedGenres.map((g) => h('span', { class: 'chip static', 'data-state': 'liked' }, '♥ ', g.name)),
        ...p.dislikedGenres.map((g) => h('span', { class: 'chip static', 'data-state': 'disliked' }, g.name)),
      ]),
      (p.likedSubGenres || []).length || (p.dislikedSubGenres || []).length
        ? h(
            'div',
            { class: 'chips', style: { marginTop: '8px' }, 'aria-label': 'Styles' },
            (p.likedSubGenres || []).map((x) => h('span', { class: 'chip static small', 'data-state': 'liked' }, '♥ ', x.name)),
            (p.dislikedSubGenres || []).map((x) => h('span', { class: 'chip static small', 'data-state': 'disliked' }, x.name))
          )
        : null,
      !p.likedGenres.length && !p.dislikedGenres.length && !p.listenAll && h('p', { class: 'muted small' }, 'No genres picked.'),
      h(
        'div',
        { style: { marginTop: '8px' } },
        switchRow('listen-all', 'I listen to everything', 'More exploration in your feed', p.listenAll, (v) =>
          set((dd) => {
            dd.profile.listenAll = v;
            recomputeWeights(dd);
          }, 'profile')
        )
      )
    ),
    section('Favorite artists', 'artists', miniCovers(p.artists, (a) => a.picture, (a) => a.name, true)),
    section('Albums', 'albums', miniCovers(p.albums, (a) => a.coverSmall, (a) => a.title)),
    section('Songs', 'songs', miniCovers(p.songs, (s) => s.coverSmall, (s) => s.title)),
    discoveries.length &&
      section('Discovered in Blind Spot', null, h('div', { class: 'chips' }, discoveries.map((n) => h('span', { class: 'chip static', 'data-state': 'liked' }, '🧭 ', n)))),

    // Streaming account
    spotifySummary(),

    // Settings
    section(
      'Settings',
      null,
      h('div', { class: 'switch-row' }, h('label', { for: 'platform' }, 'Listen on', h('span', { class: 'hint' }, 'Where "Listen on…" links open')), platformSelect),
      h(
        'div',
        { class: 'switch-row' },
        h('span', {}, 'Preview length', h('span', { class: 'hint' }, '15s plays the most energetic part ("Best part")')),
        lengthSeg
      ),
      switchRow('group-sub', 'Group decks by sub-genre', 'Splits decks with 10+ cards', d.playlistSettings.groupBySubGenre, (v) =>
        set((dd) => (dd.playlistSettings.groupBySubGenre = v))
      ),
      h(
        'div',
        { class: 'switch-row' },
        h('label', { for: 'min-songs' }, 'Smallest deck', h('span', { class: 'hint' }, 'Smaller genres go to "Other / Just starting"')),
        h(
          'select',
          {
            class: 'select',
            id: 'min-songs',
            onChange: (e) => set((dd) => (dd.playlistSettings.minSongsPerPlaylist = Number(e.target.value))),
          },
          [1, 2, 3, 5, 8].map((n) => h('option', { value: n, selected: d.playlistSettings.minSongsPerPlaylist === n }, `${n} song${n > 1 ? 's' : ''}`))
        )
      ),
      switchRow(
        'second-chance',
        'Give my disliked genres a second chance',
        'Blind Spot may show their most accessible songs',
        d.blindSpotState.allowDislikedGenres,
        (v) => set((dd) => (dd.blindSpotState.allowDislikedGenres = v))
      )
    ),

    // Backup
    section(
      'Backup',
      null,
      h(
        'p',
        { class: 'muted small' },
        storage.mode === 'server'
          ? 'Your data is saved on your PC (data/userdata.json), with a daily backup copy.'
          : storage.mode === 'device'
            ? 'Your data is saved on this phone only. Download a backup now and then (e.g. to Google Drive) so you never lose your likes.'
            : "Your PC can't be reached: data is saved on this device for now."
      ),
      h(
        'div',
        { class: 'row wrap' },
        h('button', { class: 'btn', onClick: downloadBackup }, icon('download', { size: 18 }), 'Download backup'),
        h('label', { class: 'btn', tabindex: '0', onKeydown: (e) => e.key === 'Enter' && e.currentTarget.click() }, icon('upload', { size: 18 }), 'Restore from file',
          h('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', onChange: restoreBackup })
        )
      ),
      h('div', { style: { marginTop: '10px' } }, h('a', { class: 'btn ghost small', href: '#/onboarding' }, 'Redo the setup'))
    ),

    // Danger zone
    h(
      'section',
      { class: 'profile-section danger-zone', 'aria-label': 'Reset' },
      h('h2', {}, 'Reset'),
      h('p', { class: 'muted small' }, 'Deletes your profile, swipes, likes, decks, Blind Spot progress and cached preview offsets.'),
      h('button', { class: 'btn danger', onClick: resetAll }, icon('trash', { size: 18 }), 'Reset all my data')
    ),
    h('p', { class: 'muted small', style: { textAlign: 'center', marginTop: '20px' } }, 'Swipe Sound · previews by Deezer & iTunes · tags by MusicBrainz')
  );
}

/* ------------------------------------------------------------------ */
/* Backup / restore / reset                                             */
/* ------------------------------------------------------------------ */

async function downloadBackup() {
  await storage.flush();
  const today = new Date().toISOString().slice(0, 10);
  downloadFile(`swipe-sound-backup-${today}.json`, JSON.stringify({ app: 'swipe-sound', exportedAt: new Date().toISOString(), data: storage.data }, null, 2));
  toast('Backup downloaded', { icon: 'download' });
}

async function restoreBackup(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return dialog({ title: "That file can't be read", text: 'Please choose a Swipe Sound backup (.json).' });
  }
  const data = parsed && parsed.data && parsed.data.profile ? parsed.data : parsed;
  if (!data || typeof data !== 'object' || !data.profile) {
    return dialog({ title: 'Not a Swipe Sound backup', text: "This file doesn't look like a backup from this app." });
  }
  const m = migrate(data);
  const ok = await confirmDialog(
    'Restore this backup?',
    `It contains ${m.swipes.length} swipes and ${m.likedSongs.length} liked songs. Your current data will be replaced.`,
    'Restore'
  );
  if (!ok) return;
  recomputeWeights(m);
  await storage.replaceAll(m);
  toast('Backup restored', { icon: 'check' });
  navigate(m.onboarded ? 'profile' : 'onboarding');
}

async function resetAll() {
  const ok = await confirmDialog(
    'Reset all your data?',
    'This deletes everything: profile, swipes, liked songs, decks, Blind Spot progress and cached offsets. Tip: download a backup first.',
    'Reset everything',
    'danger'
  );
  if (!ok) return;
  player.stop();
  await storage.replaceAll(defaultData());
  toast('All data reset');
  navigate('onboarding');
}
