// Transport adapter only. Windows Firewall is the independent egress boundary.
// Customer package bytes and their manifested target are never edited.
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
assert.equal(process.platform, 'win32');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
assert.equal(process.env.POS_ACCEPTANCE_DISPOSABLE, '1');
const config=JSON.parse(readFileSync(process.env.POS_CAFE_TEST_TRANSPORT_FILE,'utf8'));
const boundary=JSON.parse(readFileSync(config.boundaryReceipt,'utf8'));
assert.equal(boundary.format,'cafe-hosted-egress-v1');assert.equal(boundary.state,'active');
assert.equal(boundary.owner,config.boundaryOwner);
const runtime=boundary.programs.find(p=>realpathSync.native(p.path).toLowerCase()===realpathSync.native(process.execPath).toLowerCase());
assert.ok(runtime,'Exact runtime must be included in enforced boundary.');
assert.equal(createHash('sha256').update(readFileSync(process.execPath)).digest('hex'),runtime.sha256);
const compiled=new URL(config.compiledOrigin), synthetic=new URL(config.syntheticApi), app=new URL(config.appOrigin);
assert.equal(compiled.protocol,'https:');assert.match(compiled.hostname,/^[a-z0-9]+\.supabase\.co$/);
assert.equal(synthetic.protocol,'http:');assert.equal(synthetic.hostname,'127.0.0.1');
assert.equal(app.protocol,'http:');assert.equal(app.hostname,'127.0.0.1');
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
  const request=new Request(input,init), url=new URL(request.url), headers=new Headers(request.headers);
  let target=url;
  if(url.origin===compiled.origin){
    target=new URL(url.pathname+url.search,synthetic);
    if(headers.get('apikey')===config.compiledAnon)headers.set('apikey',config.syntheticAnon);
    if(headers.get('authorization')==='Bearer '+config.compiledAnon)headers.set('authorization','Bearer '+config.syntheticAnon);
  }else assert.ok([synthetic.origin,app.origin].includes(url.origin),'Test process refused an unreviewed HTTP origin.');
  const forwarded=new Request(target,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body,duplex:'half',signal:request.signal,redirect:'manual'});
  const response=await originalFetch(forwarded);
  assert.ok(response.status<300||response.status>=400,'Redirects are refused by the synthetic transport.');
  return response;
};
globalThis.WebSocket=class { constructor(){throw Error('Realtime sockets are disabled in this isolated transport rehearsal.');} };
