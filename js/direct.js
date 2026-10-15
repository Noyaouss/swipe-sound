/**
 * direct — talk to the music APIs straight from the phone (standalone mode).
 *
 * Does in the browser what server.js does on the PC:
 *   - Deezer: JSONP (Deezer's API sends no CORS headers, but supports JSONP)
 *   - iTunes and MusicBrainz: normal fetch (both allow it)
 *   - a request queue per service (same spacing as the server)
 *   - a cache in IndexedDB with the same lifetimes (info for days, tracks for hours,
 *     never beyond a preview link's expiry)
 */

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

export class DirectError extends Error {
  constructor(message, { status = 0, offline = false } = {}) {
    super(message);
    this.status = status;
    this.offline = offline;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- queues ---------- */

function makeQueue(minIntervalMs) {
  let last = 0;
  let chain = Promise.resolve();
  return (fn) => {
    const slot = chain.then(async () => {
      const wait = last + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
    });
    chain = slot.catch(() => {});
    return slot.then(fn);
  };
}
const queues = { deezer: makeQueue(120), itunes: makeQueue(3000), mb: makeQueue(1100) };

/* ---------- cache (IndexedDB) ---------- */

let dbPromise = null;
function db() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('swipe-sound-cache', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('http');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function cacheGet(key) {
  try {
    const d = await db();
    return await new Promise((resolve) => {
      const r = d.transaction('http').objectStore('http').get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
async function cacheSet(key, body, ttl) {
  if (!(ttl > 0)) return;
  try {
    const d = await db();
    d.transaction('http', 'readwrite').objectStore('http').put({ expires: Date.now() + ttl, body }, key);
  } catch {
    /* quota or private mode: just don't cache */
  }
}

/** Remove entries that expired more than a day ago (called once at startup). */
export async function pruneCache() {
  try {
    const d = await db();
    const store = d.transaction('http', 'readwrite').objectStore('http');
    const req = store.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      if (!cur.value || cur.value.expires < Date.now() - DAY) cur.delete();
      cur.continue();
    };
  } catch {
    /* ignore */
  }
}

/* ---------- lifetimes (same rules as server.js) ---------- */

function deezerTtl(path) {
  const p = path.split('?')[0];
  if (/^\/genre(\/\d+)?$/.test(p)) return 7 * DAY;
  if (/^\/artist\/\d+(\/(related|albums))?$/.test(p)) return 3 * DAY;
  if (/^\/album\/\d+$/.test(p)) return 3 * DAY;
  if (/^\/search\/(artist|album)$/.test(p)) return DAY;
  return 6 * HOUR;
}

/** Earliest `exp=` in Deezer preview links, as a TTL (1 minute safety margin). */
export function previewExpiryTtl(body) {
  const m = JSON.stringify(body).match(/exp=(\d{9,})/g);
  if (!m) return Infinity;
  return Math.min(...m.map((x) => Number(x.slice(4)) * 1000)) - Date.now() - 60 * 1000;
}

/* ---------- transports ---------- */

let jsonpId = 0;
function jsonp(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const name = `__dz${Date.now().toString(36)}${jsonpId++}`;
    const script = document.createElement('script');
    const cleanup = () => {
      clearTimeout(timer);
      delete window[name];
      script.remove();
    };
    const timer = setTimeout(() => {
      cleanup();
      window[name] = () => {}; // a late answer must not throw
      reject(new DirectError('Deezer took too long to answer', { offline: !navigator.onLine }));
    }, timeout);
    window[name] = (data) => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new DirectError("Couldn't reach Deezer", { offline: true }));
    };
    script.src = url + (url.includes('?') ? '&' : '?') + `output=jsonp&callback=${name}`;
    document.head.append(script);
  });
}

async function fetchJson(url, timeout) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  } catch {
    throw new DirectError("Couldn't reach the music service", { offline: true });
  }
  if (res.status === 429 || res.status === 503) throw new DirectError('The music service is busy', { status: 503 });
  if (!res.ok) throw new DirectError(`Request failed (${res.status})`, { status: res.status === 404 ? 404 : 502 });
  return res.json();
}

const inFlight = new Map();

/**
 * Get JSON from a provider, through the cache and the queue.
 * @param {'deezer'|'itunes'|'mb'} provider
 * @param {string} path   e.g. '/chart/0/tracks?limit=10' (Deezer), '/search?term=…' (iTunes), '/artist?query=…' (MusicBrainz)
 */
export async function getJson(provider, path, { fresh = false, timeout = 20000 } = {}) {
  const key = provider + ' ' + path;
  if (!fresh) {
    const hit = await cacheGet(key);
    if (hit && hit.expires > Date.now()) return hit.body;
  }
  if (inFlight.has(key)) return inFlight.get(key);
  const job = (async () => {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        let body;
        let ttl;
        if (provider === 'deezer') {
          body = await queues.deezer(() => jsonp('https://api.deezer.com' + path, timeout));
          if (body && body.error) {
            if (body.error.code === 4) {
              // Quota exceeded (50 requests / 5 s): back off and retry.
              lastErr = new DirectError('Deezer is busy', { status: 503 });
              await sleep(2000 * (attempt + 1));
              continue;
            }
            throw new DirectError(body.error.message || 'Deezer error', { status: body.error.code === 800 ? 404 : 502 });
          }
          ttl = deezerTtl(path);
          if (/^\/track\/\d+/.test(path)) ttl = Math.min(ttl, previewExpiryTtl(body));
        } else if (provider === 'itunes') {
          body = await queues.itunes(() => fetchJson('https://itunes.apple.com' + path, timeout));
          ttl = DAY;
        } else {
          const sep = path.includes('?') ? '&' : '?';
          body = await queues.mb(() => fetchJson('https://musicbrainz.org/ws/2' + path + sep + 'fmt=json', timeout));
          ttl = 14 * DAY;
        }
        cacheSet(key, body, ttl);
        return body;
      } catch (err) {
        lastErr = err;
        if (err.status && err.status !== 503) break; // real errors: don't retry
        await sleep(600 * (attempt + 1));
      }
    }
    // Couldn't get a fresh answer: an expired cached one is better than nothing.
    const stale = await cacheGet(key);
    if (stale) return stale.body;
    throw lastErr;
  })();
  inFlight.set(key, job);
  try {
    return await job;
  } finally {
    inFlight.delete(key);
  }
}
