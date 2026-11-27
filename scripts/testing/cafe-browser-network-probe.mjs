import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const [phase, executable, remote, local] = process.argv.slice(2);
assert.ok(['before','blocked'].includes(phase));
assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
assert.equal(process.env.POS_ACCEPTANCE_DISPOSABLE,'1');assert.equal(process.platform,'win32');
assert.ok(!process.env.NODE_OPTIONS,'Native browser probes must not inherit interception.');
const { chromium }=createRequire(path.join(process.cwd(),'package.json'))('playwright-core');
const browser=await chromium.launch({executablePath:executable,headless:true,args:['--disable-background-networking','--disable-component-update']});
try{
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
  assert.equal((await page.goto(new URL('/probe',local).href)).status(),200);
  assert.equal(await page.textContent('body'),'cafe-boundary-canary-v1');
  const ws=url=>page.evaluate(value=>new Promise((resolve,reject)=>{
    const socket=new WebSocket(value),timer=setTimeout(()=>{socket.close();reject(Error('timeout'));},3500);
    socket.onopen=()=>{clearTimeout(timer);socket.close();resolve(true);};socket.onerror=()=>{clearTimeout(timer);reject(Error('refused'));};
  }),new URL('/socket',url).href.replace('http:','ws:'));
  assert.equal(await ws(local),true);
  if(phase==='before'){
    assert.equal(await ws(remote),true);
    assert.equal((await page.goto(new URL('/probe',remote).href,{timeout:5000})).status(),200);
    assert.equal((await page.goto(new URL('/redirect',local).href,{timeout:5000})).status(),200);
  }else{
    await assert.rejects(ws(remote));
    for(const url of [new URL('/probe',remote).href,new URL('/redirect',local).href,'https://1.1.1.1/']) await assert.rejects(page.goto(url,{timeout:5000}));
  }
  await context.close();
  console.log(JSON.stringify({format:'cafe-browser-network-probe-v1',phase,executable,serviceWorkers:'block',interception:false,
    loopbackHttp:'passed',loopbackWebSocket:'passed',remoteHttp:phase,remoteWebSocket:phase,redirect:phase,externalHttps:phase==='blocked'?'denied':'NOT_RUN'}));
}finally{await browser.close();}
