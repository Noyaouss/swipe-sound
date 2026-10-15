/**
 * main — app entry: loads data, runs onboarding once, then a hash router
 * over the four tabs (Swipe, Blind Spot, Playlists, Profile).
 */

import { storage } from './storage.js';
import { h, icon, clear, spinner, errorBox } from './ui.js';
import { checkServer } from './dataService.js';
import { player } from './audio.js';
import { recomputeWeights, loadKnownLibrary } from './recommender.js';
import { initMode, isStandalone } from './mode.js';
import { pruneCache } from './direct.js';
import { retagSongs } from './library.js';
import { shouldPlayIntro, playIntro } from './intro.js';
import { navigate } from './router.js';

const TABS = [
  { route: 'swipe', label: 'Swipe', icon: 'cards' },
  { route: 'blindspot', label: 'Blind Spot', icon: 'compass' },
  { route: 'map', label: 'Map', icon: 'map' },
  { route: 'games', label: 'Games', icon: 'games' },
  { route: 'decks', label: 'Decks', icon: 'decks' },
  { route: 'profile', label: 'Profile', icon: 'user' },
];
const PAGES = new Set(['swipe', 'blindspot', 'map', 'games', 'decks', 'playlists', 'profile', 'onboarding']);
// Route -> page module. Decks were called Playlists before: old #/playlists links still work.
const MODULES = { decks: 'playlists', playlists: 'playlists' };

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
let cleanup = null;
let renderToken = 0;

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
  let page = PAGES.has(parts[0]) ? parts[0] : 'swipe';
  if (page === 'playlists') page = 'decks';
  return { page, params: parts.slice(1).map(decodeURIComponent) };
}


function renderTabbar(active) {
  clear(tabbar).append(
    h(
      'div',
      { class: 'tabs' },
      TABS.map((t) =>
        h(
          'a',
          { href: '#/' + t.route, 'aria-current': t.route === active ? 'page' : null },
          icon(t.icon, { size: 24 }),
          h('span', {}, t.label)
        )
      )
    )
  );
}

async function render() {
  const token = ++renderToken;
  let { page, params } = parseRoute();
  if (!storage.data.onboarded && page !== 'onboarding') page = 'onboarding';

  if (cleanup) {
    try {
      cleanup();
    } catch (err) {
      console.error(err);
    }
    cleanup = null;
  }
  player.stop();

  const showTabs = page !== 'onboarding';
  tabbar.hidden = !showTabs;
  document.body.classList.toggle('no-tabbar', !showTabs);
  if (showTabs) renderTabbar(page);

  clear(view).append(spinner());
  try {
    const mod = await import(`./pages/${MODULES[page] || page}.js`);
    if (token !== renderToken) return; // user navigated away meanwhile
    clear(view);
    view.scrollTo?.(0, 0);
    window.scrollTo(0, 0);
    cleanup = (await mod.mount(view, params)) || null;
    document.title = `${page === 'onboarding' ? 'Welcome' : TABS.find((t) => t.route === page).label} · Swipe Sound`;
  } catch (err) {
    console.error(err);
    if (token === renderToken) clear(view).append(errorBox('This page failed to load. ' + err.message, render));
  }
}

/* ---------- Offline screen & server status ---------- */

const offlineEl = document.getElementById('offline');
const banner = document.getElementById('status-banner');
let offlineDismissed = false;

function showOffline(show) {
  if (!show) {
    offlineEl.hidden = true;
    offlineDismissed = false;
    return;
  }
  if (offlineDismissed) return;
  player.stop();
  clear(offlineEl).append(
    h(
      'div',
      { class: 'inner', role: 'alertdialog', 'aria-labelledby': 'offline-title' },
      icon('wifiOff', { size: 56 }),
      h('h1', { id: 'offline-title' }, "You're offline"),
      h('p', { class: 'muted' }, 'Swipe Sound needs the internet to find music and play previews. Your likes and decks are safe.'),
      h(
        'div',
        { class: 'stack' },
        h('button', { class: 'btn primary block', onClick: retryOnline }, icon('refresh', { size: 18 }), 'Try again'),
        h(
          'button',
          {
            class: 'btn ghost block',
            onClick: () => {
              offlineDismissed = true;
              offlineEl.hidden = true;
              navigate('decks');
            },
          },
          'Browse my decks anyway'
        )
      )
    )
  );
  offlineEl.hidden = false;
}

async function retryOnline() {
  if (navigator.onLine && (await checkServer())) {
    showOffline(false);
    storage.reconnect();
  }
}

function updateBanner() {
  if (storage.mode === 'local') {
    banner.textContent = "Can't reach Swipe Sound on your PC. Changes are saved on this device and will sync when it's back.";
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

addEventListener('offline', () => showOffline(true));
addEventListener('online', retryOnline);

/* ---------- Boot ---------- */

async function boot() {
  view.append(spinner('Loading your music…'));
  await initMode(); // PC server, or standalone on the phone?
  if (isStandalone()) {
    pruneCache();
    // Data lives only on this device: ask the browser not to clear it under storage pressure.
    navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {});
  }
  await storage.load();
  recomputeWeights(storage.data); // time decay moves on, tuning may have changed
  loadKnownLibrary(storage.data); // songs you already know on Spotify (if connected)
  setTimeout(() => retagSongs().catch(() => {}), 3000); // V2 sub-genre clean-up, in the background
  updateBanner();
  storage.subscribe((data, reason) => {
    if (reason === 'mode') updateBanner();
    // Another device changed things: re-render the current page.
    if (reason === 'remote') render();
  });
  if (!navigator.onLine) showOffline(true);
  addEventListener('hashchange', render);

  // Opening animation: the Swipe page loads underneath (hidden), then fades in and the
  // first card slides up once the map has drawn itself.
  const intro = shouldPlayIntro();
  if (intro) document.body.classList.add('intro-pending');
  render();
  if (intro) {
    await playIntro().catch((err) => console.error(err));
    document.body.classList.remove('intro-pending');
    document.body.classList.add('intro-reveal');
    const done = () => document.body.classList.remove('intro-reveal');
    view.addEventListener('animationend', (e) => e.target.classList?.contains('card') && done());
    setTimeout(done, 6000); // the first card may still be loading: stop waiting after a while
  }

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
