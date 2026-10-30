// Online-only POS. Never cache receipts, authenticated pages or database calls.
// Keeping /sw.js replaces the old installed Workbox worker at the same scope.
const legacyCaches = new Set([
  'start-url', 'google-fonts-webfonts', 'google-fonts-stylesheets',
  'static-font-assets', 'static-image-assets', 'next-image',
  'static-audio-assets', 'static-video-assets', 'static-js-assets',
  'static-style-assets', 'next-data', 'static-data-assets', 'apis',
  'others', 'cross-origin',
]);
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => legacyCaches.has(name) || name.startsWith('workbox-precache-'))
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
// No fetch handler: requests use the browser network path without a fallback.
