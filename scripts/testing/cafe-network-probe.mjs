// Native probes intentionally run without the transport preload or browser routes.
import assert from 'node:assert/strict';
import { get } from 'node:http';
import { get as httpsGet } from 'node:https';
import { connect } from 'node:net';
const [phase, remoteValue, localValue] = process.argv.slice(2);
assert.ok(['before', 'blocked'].includes(phase));
assert.equal(process.env.POS_ACCEPTANCE_DISPOSABLE, '1');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
assert.equal(process.platform, 'win32');
assert.ok(!process.env.NODE_OPTIONS, 'Network probes must not inherit an interception preload.');
const remote = new URL(remoteValue), local = new URL(localValue);
assert.equal(local.hostname, '127.0.0.1'); assert.equal(local.protocol, 'http:');
assert.equal(remote.protocol, 'http:'); assert.match(remote.hostname, /^\d+\.\d+\.\d+\.\d+$/);
assert.notEqual(remote.hostname.split('.')[0], '127');
const timeout = 3500;
function http(url, https = false) { return new Promise((resolve, reject) => {
  const request = (https ? httpsGet : get)(url, response => {
    let body = ''; response.on('data', b => { body += b; }); response.on('end', () => resolve({ status: response.statusCode, body }));
  });
  request.setTimeout(timeout, () => request.destroy(Error('timeout'))); request.once('error', reject);
}); }
function tcp(host, port) { return new Promise((resolve, reject) => {
  const socket = connect({ host, port }); socket.setTimeout(timeout);
  socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('timeout', () => socket.destroy(Error('timeout'))); socket.once('error', reject);
}); }
function websocket(url) { return new Promise((resolve, reject) => {
  const socket = new WebSocket(url), timer = setTimeout(() => { socket.close(); reject(Error('timeout')); }, timeout);
  socket.onopen = () => { clearTimeout(timer); socket.close(); resolve(true); }; socket.onerror = () => { clearTimeout(timer); reject(Error('websocket refused')); };
}); }
assert.equal((await http(new URL('/probe', local))).body, 'cafe-boundary-canary-v1');
assert.equal(await websocket(new URL('/socket', local).href.replace('http:', 'ws:')), true);
const direct = [() => http(new URL('/probe', remote)), () => tcp(remote.hostname, Number(remote.port)),
  () => websocket(new URL('/socket', remote).href.replace('http:', 'ws:')),
  () => fetch(new URL('/redirect', local), { signal: AbortSignal.timeout(timeout) }).then(r => { assert.equal(r.status, 200); return r.text(); })];
for (const action of direct) {
  if (phase === 'before') await action(); else await assert.rejects(action);
}
if (phase === 'blocked') {
  await assert.rejects(http('https://1.1.1.1/', true));
  await assert.rejects(tcp('1.1.1.1', 443));
}
console.log(JSON.stringify({ format: 'cafe-native-network-probe-v1', phase, executable: process.execPath,
  loopbackHttp: 'passed', loopbackWebSocket: 'passed', rawHttp: phase, rawTcp: phase, rawWebSocket: phase, redirect: phase,
  externalHttps: phase === 'blocked' ? 'denied' : 'NOT_RUN', externalTcp: phase === 'blocked' ? 'denied' : 'NOT_RUN' }));
