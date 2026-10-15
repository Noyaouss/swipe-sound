/**
 * ui — tiny DOM helpers shared by all pages (no framework).
 */

/**
 * Create an element. h('button', { class: 'btn', onClick: fn, 'aria-label': 'Play' }, 'Play')
 * Children may be strings, nodes, arrays, or null/false (skipped).
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, val); // CSS custom properties
        else el.style[prop] = val;
      }
    }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const escapeText = (s) => String(s ?? '');

/* ------------------------------------------------------------------ */
/* Icons (inline SVG, stroke-based, inherit currentColor)               */
/* ------------------------------------------------------------------ */

const ICONS = {
  heart: '<path d="M12 21s-7.5-4.6-9.5-9.3C1 8.2 3.3 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.7 0 6 3.7 4.5 7.2C19.5 16.4 12 21 12 21z" fill="currentColor" stroke="none"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
  play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 4h4v16H7zM13 4h4v16h-4z" fill="currentColor" stroke="none"/>',
  next: '<path d="M5 5l10 7-10 7z" fill="currentColor" stroke="none"/><path d="M19 5v14"/>',
  prev: '<path d="M19 5L9 12l10 7z" fill="currentColor" stroke="none"/><path d="M5 5v14"/>',
  cards: '<rect x="4" y="6" width="12" height="15" rx="2"/><path d="M8 3h10a2 2 0 012 2v13"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z" fill="currentColor"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1" fill="currentColor"/><circle cx="3.5" cy="12" r="1" fill="currentColor"/><circle cx="3.5" cy="18" r="1" fill="currentColor"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  skip: '<path d="M5 12h12M13 7l5 5-5 5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M4 4h16"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  more: '<circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="currentColor" stroke="none"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" fill="currentColor" stroke="none"/>',
  move: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0112 6c5 0 9 6 9 6a17 17 0 01-3 3.4M6.4 7.6C4.2 9.1 3 12 3 12s4 6 9 6a8.6 8.6 0 004-1"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  wifiOff: '<path d="M3 3l18 18M8.5 16.5a5 5 0 017 0M5 12.9a10 10 0 015.2-2.7M19 12.9a10 10 0 00-2.3-1.6M2 9a15 15 0 014.4-2.7M22 9a15 15 0 00-9.4-3.9"/><circle cx="12" cy="20" r="1" fill="currentColor"/>',
  decks: '<rect x="7" y="3" width="13" height="16" rx="2" opacity=".45"/><rect x="5" y="5" width="13" height="16" rx="2" opacity=".7"/><rect x="3" y="7" width="13" height="15" rx="2" fill="currentColor" fill-opacity=".15"/>',
  map: '<circle cx="6" cy="7" r="2.5" fill="currentColor" stroke="none"/><circle cx="17" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="16" cy="17" r="3" fill="currentColor" stroke="none"/><circle cx="5" cy="18" r="1.4" fill="currentColor" stroke="none"/><path d="M8.3 6.6L15.4 5.3M7.5 9l6.6 6M6 9.5V16.6" stroke-width="1.2" opacity=".6"/>',
  games: '<rect x="2.5" y="7" width="19" height="11" rx="5.5"/><path d="M7.5 10.5v4M5.5 12.5h4"/><circle cx="15.5" cy="11.5" r="1" fill="currentColor"/><circle cx="17.5" cy="13.5" r="1" fill="currentColor"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
};

export function icon(name, { size = 24, label } = {}) {
  const svg = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${
    label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'
  }>${ICONS[name] || ''}</svg>`;
  const t = document.createElement('template');
  t.innerHTML = svg;
  return t.content.firstChild;
}

/* ------------------------------------------------------------------ */
/* Components                                                           */
/* ------------------------------------------------------------------ */

export function cover(url, alt, cls = 'cover') {
  if (!url) return h('div', { class: cls + ' cover-empty', role: 'img', 'aria-label': alt }, icon('music', { size: 32 }));
  return h('img', { class: cls, src: url, alt, loading: 'lazy', decoding: 'async' });
}

export function spinner(label = 'Loading…') {
  return h('div', { class: 'loading', role: 'status' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('span', {}, label));
}

/** Friendly error with a Retry button. */
export function errorBox(message, onRetry) {
  return h(
    'div',
    { class: 'error-box', role: 'alert' },
    h('p', {}, message || 'Something went wrong.'),
    onRetry && h('button', { class: 'btn', onClick: onRetry }, icon('refresh', { size: 18 }), 'Retry')
  );
}

export function emptyState({ title, text, action }) {
  return h('div', { class: 'empty' }, h('h2', {}, title), text && h('p', {}, text), action);
}

/** Friendly message for an ApiError (or anything thrown). */
export function errorMessage(err) {
  if (!navigator.onLine) return "You're offline. Connect to the internet to discover music.";
  if (err && err.offline) return "Couldn't reach the music service. Check your connection and try again.";
  if (err && err.status === 503) return 'The music service is busy right now. Try again in a moment.';
  return (err && err.message) || 'Something went wrong.';
}

/* ------------------------------------------------------------------ */
/* Toasts                                                               */
/* ------------------------------------------------------------------ */

let toastRoot;
export function toast(message, { icon: ic, action, duration = 2800 } = {}) {
  toastRoot ||= document.getElementById('toasts');
  const el = h(
    'div',
    { class: 'toast', role: 'status' },
    ic && icon(ic, { size: 18 }),
    h('span', {}, message),
    action &&
      h(
        'button',
        {
          class: 'toast-action',
          onClick: () => {
            action.onClick();
            dismiss();
          },
        },
        action.label
      )
  );
  const dismiss = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 250);
  };
  toastRoot.append(el);
  while (toastRoot.children.length > 3) toastRoot.firstChild.remove();
  setTimeout(dismiss, duration);
  return dismiss;
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                              */
/* ------------------------------------------------------------------ */

/**
 * Show a modal dialog. Resolves with the clicked button's value (or null if dismissed).
 * buttons: [{ label, value, kind: 'primary'|'danger'|'ghost' }]
 * body may be a node, or a function (close) => node for custom controls.
 */
export function dialog({ title, text, body, buttons = [{ label: 'OK', value: true, kind: 'primary' }] }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const close = (value) => {
      overlay.classList.add('out');
      setTimeout(() => overlay.remove(), 200);
      document.removeEventListener('keydown', onKey);
      prevFocus && prevFocus.focus && prevFocus.focus();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Tab') {
        // Keep keyboard focus inside the dialog.
        const f = [...overlay.querySelectorAll('button, a[href], input, select, textarea')].filter((x) => !x.disabled);
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      }
    };
    const titleId = 'dlg-' + Math.random().toString(36).slice(2);
    const overlay = h(
      'div',
      { class: 'overlay', onClick: (e) => e.target === overlay && close(null) },
      h(
        'div',
        { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
        h('h2', { id: titleId }, title),
        text && h('p', {}, text),
        typeof body === 'function' ? body(close) : body,
        h(
          'div',
          { class: 'dialog-actions' },
          buttons.map((b) => h('button', { class: 'btn ' + (b.kind || 'ghost'), onClick: () => close(b.value) }, b.label))
        )
      )
    );
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    const first = overlay.querySelector('.btn.primary, .btn.danger, .btn');
    first && first.focus();
  });
}

export const confirmDialog = (title, text, okLabel = 'OK', kind = 'primary') =>
  dialog({
    title,
    text,
    buttons: [
      { label: 'Cancel', value: false, kind: 'ghost' },
      { label: okLabel, value: true, kind },
    ],
  }).then(Boolean);

/** A list of choices. Resolves with the chosen value or null. */
export function chooser(title, options) {
  return dialog({
    title,
    body: (close) =>
      h(
        'div',
        { class: 'chooser' },
        options.map((o) => h('button', { class: 'chooser-item', onClick: () => close(o.value) }, o.label))
      ),
    buttons: [{ label: 'Cancel', value: null, kind: 'ghost' }],
  });
}

/** Save a text blob as a file download. */
export function downloadFile(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copy text to the clipboard (works on plain-http phones too). */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function timeAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString();
}
