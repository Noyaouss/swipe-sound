/**
 * deckFly — when you like a song, its card flies into its deck.
 * A small deck stack pops up above the tab bar with the deck's name; the song's
 * cover flies from where the card was into the top of that stack.
 * With prefers-reduced-motion, the stack just appears (no flight).
 */

import { h, cover } from './ui.js';

let dock = null;
let hideTimer = null;

function getDock() {
  if (dock && dock.isConnected) return dock;
  dock = h(
    'div',
    { class: 'fly-dock', role: 'status', 'aria-live': 'polite', hidden: true },
    h(
      'div',
      { class: 'fly-stack', 'aria-hidden': 'true' },
      h('span', { class: 'fly-layer', style: { '--i': 2 } }),
      h('span', { class: 'fly-layer', style: { '--i': 1 } }),
      h('div', { class: 'fly-top' })
    ),
    h('div', { class: 'fly-text' }, h('div', { class: 'fly-title' }), h('div', { class: 'fly-caption' }))
  );
  document.body.append(dock);
  return dock;
}

/**
 * @param {object} o
 * @param {DOMRect} [o.fromRect]  where the liked card was on screen
 * @param {string}  o.cover       cover image URL
 * @param {string}  o.deckName    deck the song lands in
 * @param {string}  [o.caption]   small line under the title (e.g. Blind Spot encouragement)
 */
export function flyToDeck({ fromRect, cover: coverUrl, deckName, caption }) {
  const d = getDock();
  const top = d.querySelector('.fly-top');
  d.querySelector('.fly-title').textContent = `Added to your ${deckName} deck`;
  d.querySelector('.fly-caption').textContent = caption || '';
  d.querySelector('.fly-caption').hidden = !caption;
  d.hidden = false;
  d.classList.remove('out');
  clearTimeout(hideTimer);

  const land = () => {
    top.replaceChildren(cover(coverUrl, ''));
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      d.querySelector('.fly-stack').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
    }
    hideTimer = setTimeout(() => {
      d.classList.add('out');
      hideTimer = setTimeout(() => (d.hidden = true), 300);
    }, 1800);
  };

  if (!fromRect || matchMedia('(prefers-reduced-motion: reduce)').matches) return land();

  // The flying card: a copy of the cover, from the card's place to the top of the stack.
  requestAnimationFrame(() => {
    const target = top.getBoundingClientRect();
    const size = Math.min(fromRect.width, fromRect.height, 220);
    const startX = fromRect.left + fromRect.width / 2 - size / 2;
    const startY = fromRect.top + fromRect.height / 2 - size / 2;
    const flyer = h('div', { class: 'fly-card', style: { left: `${startX}px`, top: `${startY}px`, width: `${size}px`, height: `${size}px` } }, cover(coverUrl, ''));
    document.body.append(flyer);
    const dx = target.left + target.width / 2 - (startX + size / 2);
    const dy = target.top + target.height / 2 - (startY + size / 2);
    const scale = target.width / size;
    flyer
      .animate(
        [
          { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1 },
          { transform: `translate(${dx * 0.55}px, ${dy * 0.35 - 60}px) rotate(-8deg) scale(${(1 + scale) / 2})`, opacity: 1, offset: 0.55 },
          { transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(${scale})`, opacity: 1 },
        ],
        { duration: 650, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)' }
      )
      .finished.then(() => {
        flyer.remove();
        land();
      })
      .catch(() => {
        flyer.remove();
        land();
      });
  });
}
