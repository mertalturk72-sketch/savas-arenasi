// Giriş noktası: HTTP (statik dosyalar) + WebSocket (oyun) sunucusu.

import http from 'node:http';
import os from 'node:os';
import { WebSocketServer } from './ws.js';

import {
  TICK_MS, MAX_PLAYERS, CLIENT_TIMEOUT_MS,
} from '../shared/constants.js';
import { S } from '../shared/protocol.js';
import { serveStatic } from './static.js';
import { Hub } from '../shared/sim/hub.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// --- Sunucu kurulumu -------------------------------------------------------
const hub = new Hub();
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      clients: hub.clients.size,
      lobbies: hub.lobbies.size,
      uptime: Math.round(process.uptime()),
    }));
    return;
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress || '';
  const client = hub.addClient(ws, ip);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    // Basit hız sınırı: saniyede 200 mesaj (60 Hz girdi + arayüz için bol bol yeter)
    const now = Date.now();
    if (now - client.msgWindow > 1000) { client.msgWindow = now; client.msgCount = 0; }
    if (++client.msgCount > 200) return;

    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg.ty !== 'string') return;
    try {
      hub.handle(client, msg);
    } catch (err) {
      console.error('[hata] mesaj işlenemedi:', msg.ty, err);
    }
  });

  ws.on('close', () => hub.dropClient(client, 'disconnect'));
  ws.on('error', () => hub.dropClient(client, 'error'));
});

// --- Ana döngü -------------------------------------------------------------
let last = process.hrtime.bigint();
let acc = 0;
let listTimer = 0;
let pingTimer = 0;

const loop = setInterval(() => {
  const now = process.hrtime.bigint();
  let elapsed = Number(now - last) / 1e6;
  last = now;
  if (elapsed > 250) elapsed = 250;   // sekme/uyku sonrası patlamayı engelle
  acc += elapsed;

  let steps = 0;
  while (acc >= TICK_MS && steps < 5) {
    acc -= TICK_MS;
    steps++;
    hub.tick(TICK_MS);
  }
  if (steps === 5) acc = 0;

  listTimer += elapsed;
  if (listTimer >= 1000) { listTimer = 0; hub.flushLobbyList(); }

  pingTimer += elapsed;
  if (pingTimer >= 4000) {
    pingTimer = 0;
    const t = Date.now();
    for (const c of hub.clients.values()) {
      hub.send(c, S.PING, { t });
      if (t - c.lastSeen > CLIENT_TIMEOUT_MS) {
        try { c.ws.terminate(); } catch { /* yok say */ }
        hub.dropClient(c, 'timeout');
      }
    }
  }
}, TICK_MS);

// WebSocket seviyesinde ölü bağlantı temizliği
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { try { ws.terminate(); } catch { /* yok say */ } continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* yok say */ }
  }
}, 15000);

server.listen(PORT, HOST, () => {
  const nets = os.networkInterfaces();
  const lan = [];
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) lan.push(n.address);
    }
  }

  const line = (t = '') => console.log(`  ${t}`);
  const rule = () => console.log('  ' + '─'.repeat(58));

  console.log('');
  line('⚔  SAVAŞ ARENASI sunucusu ayakta');
  rule();
  line();
  line('BU BİLGİSAYARDA');
  line(`   http://localhost:${PORT}`);
  line();
  line('AYNI WİFİDEKİLER (ev içi)');
  if (lan.length) for (const a of lan) line(`   http://${a}:${PORT}`);
  else line('   (ağ adresi bulunamadı)');
  line('   ⚠ Bu adres SADECE aynı wifi ağındaki cihazlarda açılır.');
  line('     Mobil veriden ya da başka bir evden AÇILMAZ.');
  line();
  line('DIŞARIDAN (arkadaşın başka yerdeyse)');
  line('   Yukarıdaki adresler işe yaramaz. İki yol var:');
  line();
  line('   1) Geçici — bu bilgisayar açıkken:');
  line(`      cloudflared tunnel --url http://localhost:${PORT}`);
  line('      Verdiği https://...trycloudflare.com adresini paylaş.');
  line('      (Pencereyi kapatınca adres ölür.)');
  line();
  line('   2) Kalıcı — bu bilgisayar kapalıyken de çalışır:');
  line('      README → "Bilgisayarın kapalıyken online oynamak"');
  line('      (Render, ücretsiz, kredi kartı istemez.)');
  line();
  rule();
  line(`Lobi başına en fazla ${MAX_PLAYERS} oyuncu · Durdurmak için Ctrl+C`);
  console.log('');
});

function shutdown() {
  console.log('\nKapatılıyor…');
  clearInterval(loop);
  clearInterval(heartbeat);
  for (const ws of wss.clients) { try { ws.close(1001, 'sunucu kapanıyor'); } catch { /* yok say */ } }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { hub, server };
