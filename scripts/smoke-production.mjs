import assert from 'node:assert/strict';

const base=new URL(process.argv[2] || 'http://127.0.0.1:3100');
assert.ok(['127.0.0.1','localhost'].includes(base.hostname),'Only an isolated local server may be smoke-tested');
for(const [path,method,status] of [['/','GET',307],['/login','GET',200],['/admin','GET',307],['/api/users','POST',401],['/api/users','PATCH',401],['/manifest.json','GET',200]]) {
  const response=await fetch(new URL(path,base),{method,redirect:'manual'});
  assert.equal(response.status,status,`${method} ${path}`);
  if(status===307) assert.equal(new URL(response.headers.get('location'),base).pathname,'/login');
  if(path==='/login') assert.match(await response.text(),/Selecciona tu perfil/);
  console.log(`PASS ${method} ${path}: ${status}`);
}
const response=await fetch(new URL('/sw.js',base),{redirect:'manual'});
assert.equal(response.status,200,'Service worker must be public to update before login');
const worker=await response.text();
assert.match(response.headers.get('cache-control'), /no-store/);
assert.ok(!/addEventListener\(['"]fetch['"]/.test(worker),'Financial requests must use the browser network path');
assert.ok(worker.includes('legacyCaches'),'Existing installed POS caches must be retired');
console.log('PASS public service worker; no-store update; no fetch interception; legacy cache cleanup');
