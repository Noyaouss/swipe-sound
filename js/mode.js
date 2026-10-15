/**
 * mode — is there a Swipe Sound server behind this page?
 *
 *   'server'     : served by `npm start` on the PC (API proxy, shared data file)
 *   'standalone' : a plain static copy (e.g. GitHub Pages installed on the phone).
 *                  The app talks to the music APIs directly and keeps your data
 *                  on this device.
 */

const KEY = 'swipe-sound-mode';
let mode = null;

export async function initMode() {
  let detected = null;
  try {
    const res = await fetch('api/health', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    const body = res.ok ? await res.json().catch(() => null) : null;
    detected = body && body.app === 'swipe-sound' ? 'server' : 'standalone';
  } catch {
    // Network error: the PC server may just be off. Keep what we knew last time.
    try {
      detected = localStorage.getItem(KEY);
    } catch {
      /* storage blocked */
    }
    detected ||= location.hostname.endsWith('github.io') ? 'standalone' : 'server';
  }
  mode = detected;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* storage blocked */
  }
  return mode;
}

export const isStandalone = () => mode === 'standalone';
export const getMode = () => mode;
