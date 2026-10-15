/**
 * Profile ▸ Import your music — no login anywhere. Your Spotify data comes from Spotify's own
 * "Download your data" export (or Exportify); Deezer playlists and profiles from a pasted link.
 * Imported songs are never suggested ("already known")
 * and fill your Music Map. The app works fine without any of this.
 */

import { h, icon, clear, spinner, toast, confirmDialog, timeAgo, errorMessage } from '../ui.js';
import { storage } from '../storage.js';
import * as ds from '../dataService.js';
import { loadKnownLibrary, knownStats } from '../recommender.js';
import { importFiles } from '../importers.js';
import { runClassifier } from '../musicMap.js';
import { importStreams } from '../playStats.js';
import { parseDeezerLinks, fetchImport, deezerTotals } from '../deezerImport.js';

const PRIVACY_URL = 'https://www.spotify.com/account/privacy/';
const ACCEPT = '.zip,.csv,.json,application/zip,text/csv,application/json';

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

/** "1,204 liked songs · 12 playlists · 380 artists · 9,812 plays" */
function foundLine(imp) {
  const s = imp.stats;
  if (!s) return plural(imp.count, 'song');
  return [plural(s.liked, 'liked song'), plural(s.playlists, 'playlist'), plural(s.artists, 'artist'), s.plays ? plural(s.plays, 'play') : null].filter(Boolean).join(' · ');
}

/** Read the files, save them as your library, and start sorting the new artists into the Music Map. */
async function runImport(files) {
  const r = await importFiles(files);
  if (!r.tracks.length) throw new Error('No songs found in this file. Use the .zip from Spotify’s “Download your data” email (or from Exportify), as it is.');
  await ds.importSpotifyLibrary(r.tracks, r.files, r.stats);
  await importStreams(r.streams); // play counts, for the Games (merged, never counted twice)
  await loadKnownLibrary(storage.data);
  runClassifier();
  return r;
}

/** Files dropped on an element (or picked when it's clicked) go to onFiles. */
function acceptDrops(el, onFiles) {
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.classList.add('over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('over');
    const files = [...e.dataTransfer.files];
    if (files.length) onFiles(files);
  });
}

/**
 * Gentle reminder until a library has been imported (Profile and Music Map): links to the
 * import page, and the zip can be dropped right on it.
 */
export function importReminder() {
  const box = h(
    'a',
    { class: 'import-reminder', href: '#/profile/import', hidden: true },
    icon('upload', { size: 18 }),
    h('span', {}, 'Waiting for your Spotify data? Drop the zip here when it arrives.')
  );
  acceptDrops(box, async (files) => {
    try {
      const r = await runImport(files);
      toast(`${plural(r.tracks.length, 'song')} imported`, { icon: 'check' });
      box.hidden = true;
    } catch (err) {
      toast(errorMessage(err), { duration: 6000 });
    }
  });
  ds.getSpotifyStatus()
    .then((st) => (box.hidden = !!(st.imported || st.connected || (storage.data.deezerImports || []).length)))
    .catch(() => {});
  return box;
}

/** Small card shown on the main Profile page. */
export function spotifySummary() {
  const body = h('div', {}, h('p', { class: 'muted small' }, 'Checking…'));
  const card = h(
    'section',
    { class: 'profile-section', 'aria-label': 'Your music' },
    h('h2', {}, 'Your music', h('a', { class: 'btn small ghost', href: '#/profile/import' }, 'Import', icon('chevron', { size: 16 }))),
    body
  );
  ds.getSpotifyStatus()
    .then((st) => {
      const k = knownStats();
      const hidden = storage.data.profile.hideKnownSongs ? ` ${plural(k.count, 'song')} you already know are hidden.` : ' Hiding songs you know is turned off.';
      const dz = storage.data.deezerImports || [];
      const t = deezerTotals(dz);
      const lines = [
        st.imported && `Spotify data imported ${timeAgo(st.imported.importedAt)}: ${foundLine(st.imported)}.`,
        st.connected && !st.imported && 'Your library from the earlier Spotify connection is kept.',
        dz.length && `Deezer: ${plural(t.playlists, 'playlist')} · ${plural(t.songs, 'song')}.`,
      ].filter(Boolean);
      clear(body).append(lines.length ? h('p', { class: 'small' }, `${lines.join(' ')}${hidden}`) : importReminder());
    })
    .catch(() => clear(body).append(h('p', { class: 'muted small' }, "Can't reach the server.")));
  return card;
}

/** Full page. */
export function mountSpotify(view) {
  let st = null;
  const head = h(
    'div',
    { class: 'page-head' },
    h('a', { class: 'icon-btn', href: '#/profile', 'aria-label': 'Back to profile' }, icon('back')),
    h('h1', { style: { flex: '1' } }, 'Import your music')
  );
  const body = h('div', {}, spinner());
  view.append(head, body);

  async function refresh() {
    try {
      st = await ds.getSpotifyStatus();
    } catch (err) {
      clear(body).append(h('p', { class: 'muted' }, errorMessage(err)));
      return;
    }
    render();
    loadKnownLibrary(storage.data).then(() => body.isConnected && renderStats());
  }

  const statsEl = h('p', { class: 'small' });
  function renderStats() {
    const k = knownStats();
    statsEl.textContent = storage.data.profile.hideKnownSongs
      ? `${plural(k.count, 'song')} hidden from your suggestions${k.skipped ? ` · ${k.skipped} skipped this session` : ''}.`
      : 'Hiding is turned off: songs you know may be suggested.';
  }

  /* ---------- Spotify ---------- */

  function spotifySection() {
    const result = h('div', { role: 'status', 'aria-live': 'polite' });
    const onFiles = async (files) => {
      clear(result).append(spinner('Reading your library…'));
      try {
        const r = await runImport(files);
        toast(`${plural(r.tracks.length, 'song')} imported`, { icon: 'check' });
        refresh();
      } catch (err) {
        clear(result).append(h('p', { class: 'small', style: { color: 'var(--nope)' } }, errorMessage(err)));
      }
    };
    const input = h('input', {
      type: 'file',
      class: 'sr-only',
      multiple: true,
      accept: ACCEPT,
      onChange: (e) => {
        const files = [...e.target.files];
        e.target.value = '';
        if (files.length) onFiles(files);
      },
    });
    const zone = h(
      'label',
      { class: 'drop-zone', tabindex: '0', onKeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.click()) },
      icon('upload', { size: 30 }),
      h('strong', {}, st.imported ? 'Drop a newer zip to refresh' : 'Drop your Spotify zip here'),
      h('span', { class: 'muted small' }, 'or tap to choose it · the .zip as it is, no need to unzip'),
      input
    );
    acceptDrops(zone, onFiles);

    return h(
      'section',
      { class: 'profile-section' },
      h('h2', {}, 'From Spotify'),
      st.imported
        ? h('div', {}, h('p', { class: 'small' }, `Imported ${timeAgo(st.imported.importedAt)}: ${foundLine(st.imported)}.`), statsEl)
        : st.connected
          ? h('div', {}, h('p', { class: 'small' }, 'Your library from the earlier Spotify connection is kept. Import your data below to refresh it.'), statsEl)
          : h('p', { class: 'muted small' }, 'No login, no app to set up: Spotify sends you a copy of your data.'),
      h(
        'ol',
        { class: 'small', style: { paddingLeft: '20px', margin: '10px 0' } },
        h('li', {}, 'Open your Spotify account’s ', h('strong', {}, 'Privacy settings'), ' (button below).'),
        h(
          'li',
          {},
          'Under ',
          h('strong', {}, 'Download your data'),
          ', tick ',
          h('strong', {}, 'Account data'),
          ' (and optionally ',
          h('strong', {}, 'Extended streaming history'),
          ' for your full history), then confirm.'
        ),
        h('li', {}, 'Confirm the email Spotify sends you.'),
        h('li', {}, 'In a few days you’ll get a zip by email: drop it here.')
      ),
      h('a', { class: 'btn block', href: PRIVACY_URL, target: '_blank', rel: 'noopener' }, 'Open Spotify privacy settings', icon('external', { size: 16 })),
      h('div', { class: 'stack', style: { marginTop: '12px' } }, zone, result),
      h(
        'details',
        { class: 'disclose', style: { marginTop: '12px' } },
        h('summary', {}, 'Other option: Exportify (instant, liked songs and playlists)'),
        h(
          'ol',
          { class: 'small', style: { paddingLeft: '20px', margin: '8px 0 0' } },
          h('li', {}, 'Open ', h('a', { href: 'https://exportify.app/', target: '_blank', rel: 'noopener' }, 'exportify.app'), ', click ', h('strong', {}, 'Get Started'), ' and log in with Spotify.'),
          h('li', {}, 'Optional: in its ⚙ settings tick ', h('strong', {}, 'Include artists data'), ': your Music Map then sorts your library instantly.'),
          h('li', {}, 'Click ', h('strong', {}, 'Export All'), ' and drop the .zip in the box above.')
        )
      ),
      st.imported &&
        h(
          'button',
          {
            class: 'btn ghost small',
            style: { marginTop: '10px' },
            onClick: async () => {
              if (!(await confirmDialog('Remove the imported library?', 'Songs from it may be suggested again.', 'Remove', 'danger'))) return;
              await ds.removeSpotifyImport();
              await loadKnownLibrary(storage.data);
              refresh();
            },
          },
          icon('trash', { size: 16 }),
          'Remove imported library'
        )
    );
  }

  /* ---------- Deezer ---------- */

  let deezerMessages = []; // results of the last "Add", shown under the field

  /** Save (or replace) an imported playlist/profile, then update the library and the Music Map. */
  async function saveDeezer(entries, removeKey) {
    storage.update((d) => {
      const keys = new Set(entries.map((e) => e.key).concat(removeKey || []));
      d.deezerImports = (d.deezerImports || []).filter((e) => !keys.has(e.key)).concat(entries);
    }, 'deezer-import');
    await loadKnownLibrary(storage.data);
    if (entries.length) runClassifier();
    render();
  }

  function deezerSection() {
    const imports = storage.data.deezerImports || [];
    const field = h('textarea', {
      class: 'input',
      rows: 2,
      style: { paddingLeft: '16px', resize: 'vertical' },
      placeholder: 'deezer.com/playlist/… or deezer.com/profile/…',
      'aria-label': 'Deezer links, one or more',
    });
    const result = h('div', { role: 'status', 'aria-live': 'polite' }, deezerMessages.map((m) => h('p', { class: 'small', style: m.error ? { color: 'var(--nope)' } : {} }, m.text)));
    const addBtn = h('button', { class: 'btn primary block', onClick: add }, 'Add');

    async function add() {
      const { found, bad } = parseDeezerLinks(field.value);
      if (!found.length) {
        clear(result).append(h('p', { class: 'small', style: { color: 'var(--nope)' } }, bad.length ? 'That isn’t a Deezer playlist or profile link.' : 'Paste a Deezer link first.'));
        return;
      }
      addBtn.disabled = true;
      clear(result).append(spinner(`Reading ${plural(found.length, 'link')} from Deezer…`));
      const done = [];
      deezerMessages = [];
      for (const item of found) {
        try {
          const e = await fetchImport(item);
          done.push(e);
          deezerMessages.push({ text: `✓ ${e.name}: ${plural(e.tracks.length, 'song')}${e.note ? `. ${e.note}` : ''}` });
        } catch (err) {
          deezerMessages.push({ error: true, text: errorMessage(err) });
        }
      }
      for (const word of bad) deezerMessages.push({ error: true, text: `Skipped “${word}”: not a Deezer playlist or profile link.` });
      await saveDeezer(done);
    }

    async function refreshOne(e, btn) {
      btn.disabled = true;
      btn.classList.add('is-loading');
      try {
        const fresh = await fetchImport({ kind: e.kind, id: e.id });
        const added = fresh.tracks.length - e.tracks.length;
        toast(`${e.name}: ${added > 0 ? `${plural(added, 'new song')}` : 'up to date'}`, { icon: 'check' });
        deezerMessages = [];
        await saveDeezer([fresh]);
      } catch (err) {
        toast(errorMessage(err), { duration: 6000 });
        btn.disabled = false;
        btn.classList.remove('is-loading');
      }
    }

    const t = deezerTotals(imports);
    return h(
      'section',
      { class: 'profile-section' },
      h('h2', {}, 'From Deezer'),
      imports.length
        ? h('p', { class: 'small' }, `${plural(t.playlists, 'playlist')} · ${plural(t.songs, 'song')} · ${plural(t.artists, 'artist')}`)
        : h('p', { class: 'muted small' }, 'Paste the link of a public playlist, or of your profile to bring all its public playlists and favourite tracks. No login.'),
      imports.length
        ? h(
            'ul',
            { class: 'import-list' },
            imports.map((e) =>
              h(
                'li',
                {},
                e.picture ? h('img', { src: e.picture, alt: '', width: 40, height: 40, loading: 'lazy' }) : h('span', { class: 'import-ph' }, icon(e.kind === 'profile' ? 'user' : 'music', { size: 18 })),
                h(
                  'div',
                  { style: { flex: '1', minWidth: '0' } },
                  h('a', { href: e.link, target: '_blank', rel: 'noopener', class: 'import-name' }, e.name),
                  h('div', { class: 'muted small' }, `${e.kind === 'profile' ? `Profile · ${plural(e.playlists, 'playlist')} · ` : ''}${plural(e.tracks.length, 'song')} · ${timeAgo(e.importedAt)}`)
                ),
                h('button', { class: 'icon-btn', 'aria-label': `Refresh ${e.name}`, title: 'Refresh', onClick: (ev) => refreshOne(e, ev.currentTarget) }, icon('refresh', { size: 18 })),
                h(
                  'button',
                  {
                    class: 'icon-btn',
                    'aria-label': `Remove ${e.name}`,
                    title: 'Remove',
                    onClick: async () => {
                      if (!(await confirmDialog(`Remove “${e.name}”?`, 'Its songs may be suggested again.', 'Remove', 'danger'))) return;
                      deezerMessages = [];
                      await saveDeezer([], e.key);
                    },
                  },
                  icon('trash', { size: 18 })
                )
              )
            )
          )
        : null,
      h('div', { class: 'stack', style: { marginTop: '10px' } }, field, addBtn, result),
      h(
        'p',
        { class: 'muted small', style: { marginTop: '8px' } },
        'In Deezer: Share → Copy link. Private playlists can’t be read: make them public first (and your profile, for favourite tracks).'
      )
    );
  }

  function settingsSection() {
    const p = storage.data.profile;
    const toggle = (id, label, hint, key) =>
      h(
        'div',
        { class: 'switch-row' },
        h('label', { for: id }, label, h('span', { class: 'hint' }, hint)),
        h('input', {
          type: 'checkbox',
          role: 'switch',
          class: 'switch',
          id,
          checked: p[key] !== false,
          onChange: async (e) => {
            storage.update((d) => (d.profile[key] = e.target.checked), 'settings');
            await loadKnownLibrary(storage.data);
            renderStats();
          },
        })
      );
    return h(
      'section',
      { class: 'profile-section' },
      toggle('hide-known', 'Hide songs I already know', 'Never suggest songs from my imported music', 'hideKnownSongs'),
      toggle('known-playlists', 'Include my playlists', 'Songs in my playlists count as known', 'knownIncludePlaylists')
    );
  }

  function render() {
    renderStats();
    clear(body).append(
      ...[
        h('p', { class: 'muted small' }, 'Optional: Swipe Sound works without it. Imported songs are never suggested to you, and they fill your Music Map.'),
        spotifySection(),
        deezerSection(),
        (st.imported || st.connected || (storage.data.deezerImports || []).length) && settingsSection(),
      ].filter(Boolean)
    );
  }

  refresh();
}
