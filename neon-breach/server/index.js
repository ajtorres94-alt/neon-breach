// HTTP static server + WebSocket game server for Neon Breach.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room, cleanName } from './room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 3000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
};

// ------------------------------------------------------------------ rooms
const rooms = new Map();
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = ''; for (let i = 0; i < 4; i++) c += A[(Math.random() * A.length) | 0];
    if (!rooms.has(c)) return c;
  }
}
function makePublic(code, settings) { const r = new Room(code, { isPublic: true, settings }); rooms.set(code, r); return r; }
makePublic('PUB1', { map: 'foundry', mode: 'dm', limit: 30, bots: 6, time: 420 });
makePublic('PUB2', { map: 'atrium', mode: 'ctf', limit: 3, bots: 6, time: 540, items: 'classic' });
makePublic('PUB3', { map: 'courtyard', mode: 'tdm', limit: 50, bots: 6, time: 480 });

setInterval(() => { // reap empty private rooms
  const t = Date.now() / 1000;
  for (const [code, r] of rooms) if (!r.isPublic && r.idleSince && t - r.idleSince > 30) { r.destroy(); rooms.delete(code); }
}, 10000);

// ------------------------------------------------------------------ http
function serveStatic(req, res) {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (url === '/api/rooms') {
    const list = [...rooms.values()].filter(r => r.isPublic).map(r => r.info());
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(list));
  }
  if (url === '/') url = '/index.html';
  let file;
  if (url.startsWith('/shared/')) file = path.join(ROOT, url);
  else file = path.join(ROOT, 'client', url);
  file = path.normalize(file);
  const okDirs = [path.join(ROOT, 'client') + path.sep, path.join(ROOT, 'shared') + path.sep];
  if (!okDirs.some(d => file.startsWith(d))) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}
const server = http.createServer(serveStatic);

// ------------------------------------------------------------------ websocket
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let room = null, player = null, msgCount = 0, windowStart = Date.now();

  ws.on('message', (raw) => {
    const now = Date.now();
    if (now - windowStart > 1000) { windowStart = now; msgCount = 0; }
    if (++msgCount > 120) return; // flood guard
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'join') {
      if (player) return;
      const name = cleanName(msg.name) || 'Operator' + ((Math.random() * 90 + 10) | 0);
      let target = null;
      if (msg.create) { const code = newCode(); target = new Room(code, {}); rooms.set(code, target); }
      else if (msg.quick) {
        const pub = [...rooms.values()].filter(r => r.isPublic && (r.humans.length < 8))
          .sort((a, b) => b.humans.length - a.humans.length);
        target = pub[0] || null;
      } else target = rooms.get(String(msg.room || '').toUpperCase().trim()) || null;
      if (!target) return ws.send(JSON.stringify({ t: 'err', msg: 'Room not found. Check the code and try again.' }));
      const p = target.join(ws, name, msg.op);
      if (!p) return ws.send(JSON.stringify({ t: 'err', msg: 'That room is full.' }));
      room = target; player = p; return;
    }
    if (msg.t === 'leave') { if (room && player) { room.removePlayer(player); room = null; player = null; } return; }
    if (room && player) room.handle(player, msg);
  });

  ws.on('close', () => { if (room && player) room.removePlayer(player); });
  ws.on('error', () => {});
});

setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
}, 25000);

server.listen(PORT, '0.0.0.0', () => console.log(`Neon Breach server listening on :${PORT}`));
