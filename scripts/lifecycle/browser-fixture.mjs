// This fixture is served only by the loopback lifecycle drill, never by Next.
// It models an already controlling Workbox worker; it is not the café's exact
// generated worker, whose installed bytes have not been captured.
export const legacyWorker = `
self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (new URL(e.request.url).pathname === '/__cache_probe')
    e.respondWith(caches.open('apis').then(c => c.match(e.request)).then(r => r || fetch(e.request)));
});
`;

export const fixture = `<!doctype html><html lang="en"><meta charset="utf-8">
<title>POS local lifecycle verification</title>
<style>body{font:17px system-ui;max-width:920px;margin:40px auto;color:#172233;background:#f5f5f7}button,a{display:inline-block;padding:12px;margin:8px;background:white;border:1px solid #ccd;border-radius:12px}pre{white-space:pre-wrap;background:white;padding:24px;border-radius:16px}h1{font-size:27px}</style>
<h1>POS Café · isolated lifecycle drill</h1>
<p>Synthetic local data only. This test page is outside the owner's app.</p>
<button id="install">Install legacy worker and cache fixtures</button>
<button id="probe">Check cached response</button>
<button id="upgrade">Update installed worker</button>
<button id="inspect">Inspect worker and caches</button>
<button id="draft">Inspect unpaid cart draft</button>
<button id="cleanup">Remove this drill's worker and cache</button>
<a href="/">Open owner's POS</a>
<pre id="result">Ready. Use a dedicated local origin: 127.0.0.1:3110.</pre>
<script>
let changes = 0;
navigator.serviceWorker.addEventListener('controllerchange', () => changes++);
const output = document.querySelector('#result');
const wait = ms => new Promise(r => setTimeout(r,ms));
async function report(extra = {}) {
  const r = await navigator.serviceWorker.getRegistration('/');
  const state = {...extra, controller: navigator.serviceWorker.controller?.scriptURL || null,
    active: r?.active?.state || null, waiting: r?.waiting?.state || null,
    installing: r?.installing?.state || null, controllerChanges:changes,
    caches:(await caches.keys()).sort()};
  output.textContent=JSON.stringify(state,null,2);
  await fetch('/__evidence', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)});
}
async function action(fn) { try { await fn(); } catch(e) { output.textContent='FAILED: '+e.message; } }
document.querySelector('#install').onclick = () => action(async () => {
  if (await navigator.serviceWorker.getRegistration('/')) throw Error('Origin already has a worker: clean this dedicated test origin first.');
  const r = await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});
  await navigator.serviceWorker.ready;
  for(let i=0;i<50 && !navigator.serviceWorker.controller;i++) await wait(100);
  if(!navigator.serviceWorker.controller) throw Error('Legacy worker never controlled the page');
  for (const name of ['start-url','apis','cross-origin','workbox-precache-v2-lifecycle','lifecycle-unrelated']) {
    const c=await caches.open(name);
    await c.put('/__cache_probe',new Response('STALE_LEGACY_RESPONSE'));
  }
  await report({event:'legacy-installed',updateViaCache:r.updateViaCache});
});
document.querySelector('#probe').onclick = () => action(async () => {
  const result=await (await fetch('/__cache_probe',{cache:'no-store'})).text();
  await report({event:'probe',response:result});
});
document.querySelector('#upgrade').onclick = () => action(async () => {
  const r=await navigator.serviceWorker.getRegistration('/');
  if(!r) throw Error('No installed worker');
  await r.update();
  for(let i=0;i<100 && (await caches.keys()).includes('apis');i++) await wait(100);
  await report({event:'upgraded',updateViaCache:r.updateViaCache});
});
document.querySelector('#inspect').onclick = () => action(() => report({event:'inspect'}));
document.querySelector('#draft').onclick = () => action(async () => {
  const keys=Object.keys(localStorage).filter(k => k.startsWith('mi_cafe_cart_draft:v1:'));
  const drafts=keys.map(k => JSON.parse(localStorage.getItem(k)));
  await report({event:'draft',drafts});
});
document.querySelector('#cleanup').onclick = () => action(async () => {
  const r=await navigator.serviceWorker.getRegistration('/'); if(r) await r.unregister();
  await caches.delete('lifecycle-unrelated');
  await report({event:'cleaned'});
});
</script></html>`;
