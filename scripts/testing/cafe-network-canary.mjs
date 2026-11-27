// Runs only in the owned disposable Linux canary container, never in a POS.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
const port = Number(process.env.CANARY_PORT || 3194);
const remote = new URL(process.env.CANARY_REMOTE);
if (remote.protocol !== 'http:' || !/^\d+\.\d+\.\d+\.\d+$/.test(remote.hostname)) throw Error('Explicit canary IPv4 required.');
const server = createServer((request, response) => {
  if (request.url === '/redirect') {
    response.writeHead(302, { location: new URL('/probe', remote).href }); response.end(); return;
  }
  response.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); response.end('cafe-boundary-canary-v1');
});
server.on('upgrade', (request, socket) => {
  if (request.url !== '/socket' || !request.headers['sec-websocket-key']) { socket.destroy(); return; }
  const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.write(Buffer.from([0x81, 2, 0x6f, 0x6b])); socket.on('error', () => {});
  socket.on('data', bytes => { if ((bytes[0] & 15) === 8) socket.end(Buffer.from([0x88, 0])); });
});
server.listen(port, '0.0.0.0');
