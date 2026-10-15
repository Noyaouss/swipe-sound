/**
 * router — go to a route like 'swipe' or 'map'.
 * Setting location.hash to the hash it already has does nothing in browsers, which left
 * the app stuck (e.g. finishing onboarding while the address already said #/swipe).
 * navigate() re-renders in that case too.
 */
export function navigate(path) {
  const hash = '#/' + path.replace(/^#?\/?/, '');
  if (location.hash === hash) dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}
