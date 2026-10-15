/**
 * Service worker: makes the app installable and lets the app shell open offline.
 * Network first (so updates show immediately), cache as a fallback.
 * Never caches /api (music data, audio previews and your data stay live).
 */
const CACHE = 'swipe-sound-v14'; // bump on every release so installed apps update
// Paths are relative to this file, so the app also works from a sub-folder (GitHub Pages).
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/main.js',
  'js/deezerImport.js',
  'js/fullSong.js',
  'js/playStats.js',
  'js/games/pool.js',
  'js/games/common.js',
  'js/games/answerMatch.js',
  'js/games/mostStreamed.js',
  'js/games/guessYear.js',
  'js/games/whichGenre.js',
  'js/games/guessSong.js',
  'js/mode.js',
  'js/direct.js',
  'js/ui.js',
  'js/storage.js',
  'js/dataService.js',
  'js/genreGraph.js',
  'js/genreData.js',
  'js/recommender.js',
  'js/analysis.js',
  'js/audio.js',
  'js/deck.js',
  'js/library.js',
  'js/blindspot.js',
  'js/playlistsCore.js',
  'js/importers.js',
  'js/router.js',
  'js/musicMap.js',
  'js/planetArt.js',
  'js/intro.js',
  'js/deckFly.js',
  'js/pages/map.js',
  'js/pages/games.js',
  'js/pages/onboarding.js',
  'js/pages/swipe.js',
  'js/pages/blindspot.js',
  'js/pages/playlists.js',
  'js/pages/profile.js',
  'js/pages/spotify.js',
];

self.addEventListener('install', (e) => {
  // Cache each file on its own: one missing file must not block the whole update.
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((f) => c.add(new Request(f, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    // Always revalidate with the server (a cheap 304 when unchanged): hosts like GitHub Pages
    // let browsers reuse files for minutes, which could mix old and new app files after an update.
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(e.request, { ignoreSearch: true });
        if (cached) return cached;
        // Offline and not cached: page loads get the app shell, anything else a clean error
        // (never HTML in place of a script).
        if (e.request.mode === 'navigate') return (await caches.match('index.html')) || Response.error();
        return Response.error();
      })
  );
});
