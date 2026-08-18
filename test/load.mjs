// Yük testi: 20 gerçek WebSocket istemcisi tek lobiye girer, maç başlar,
// hepsi 60 Hz girdi gönderir. Bant genişliği ve gecikme ölçülür.
// Çalıştır:  node test/load.mjs

import WebSocket from 'ws';
import { C, S } from '../shared/protocol.js';
import { MAX_PLAYERS, INPUT_RATE, IN_UP, IN_DOWN, IN_LEFT, IN_RIGHT, IN_FIRE } from '../shared/constants.js';

const URL = process.env.URL || 'ws://localhost:3000';
const N = Number(process.env.N) || MAX_PLAYERS;
const SECONDS = Number(process.env.SECONDS) || 20;

const clients = [];
let lobbyId = null;
let started = 0;
let bytesIn = 0, snapCount = 0;
const errors = [];

function makeClient(i) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    const c = { i, ws, id: 0, inMatch: false, seq: 0, keys: 0, aim: 0, snaps: 0 };
    clients.push(c);

    ws.on('open', () => ws.send(JSON.stringify({ ty: C.HELLO, name: `Yuk${i}` })));

    ws.on('message', (data) => {
      bytesIn += data.length;
      let m;
      try { m = JSON.parse(data); } catch { return; }

      switch (m.ty) {
        case S.WELCOME:
          c.id = m.id;
          resolve(c);
          break;
        case S.PING:
          ws.send(JSON.stringify({ ty: C.PONG, t: m.t }));
          break;
        case S.LOBBY_STATE:
          lobbyId = m.lobby.id;
          break;
        case S.MATCH_START:
          c.inMatch = true;
          started++;
          break;
        case S.SNAPSHOT:
          c.snaps++; snapCount++;
          break;
        case S.ERROR:
          errors.push(`istemci ${i}: ${m.message}`);
          break;
        default: break;
      }
    });

    ws.on('error', (e) => errors.push(`istemci ${i} soket hatası: ${e.message}`));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`${N} istemci bağlanıyor…`);
await Promise.all(Array.from({ length: N }, (_, i) => makeClient(i)));
console.log('Bağlantılar tamam.');

// İlk istemci lobiyi kurar
clients[0].ws.send(JSON.stringify({
  ty: C.LOBBY_CREATE, name: 'Yük Testi', mode: 'ffa', maxPlayers: MAX_PLAYERS, botCount: 0, private: true,
}));
await wait(400);
if (!lobbyId) { console.error('Lobi kurulamadı'); process.exit(1); }

for (let i = 1; i < N; i++) {
  clients[i].ws.send(JSON.stringify({ ty: C.LOBBY_JOIN, id: lobbyId }));
  await wait(25);
}
await wait(600);

// 21. istemci reddedilmeli
const extra = await makeClient(999);
extra.ws.send(JSON.stringify({ ty: C.LOBBY_JOIN, id: lobbyId }));
await wait(400);
const rejected = errors.some((e) => e.includes('istemci 999') && /dolu/i.test(e));
console.log(rejected ? '✓ 21. oyuncu doğru şekilde reddedildi (lobi 20 kişilik)' : '✗ 21. oyuncu reddedilmedi!');
if (!rejected) errors.push('Lobi kapasitesi zorlanamadı');

clients[0].ws.send(JSON.stringify({ ty: C.START }));
await wait(6500);
console.log(`Maç başladı — ${started}/${N} istemci oyunda.`);
if (started < N) errors.push(`${N - started} istemci maça girmedi`);

// Girdi gönderimi
bytesIn = 0; snapCount = 0;
const t0 = Date.now();
const stepMs = 1000 / INPUT_RATE;

const timer = setInterval(() => {
  for (const c of clients) {
    if (!c.inMatch) continue;
    if (Math.random() < 0.03) {
      c.keys = [IN_UP, IN_DOWN, IN_LEFT, IN_RIGHT, IN_UP | IN_LEFT, IN_DOWN | IN_RIGHT][Math.floor(Math.random() * 6)];
      if (Math.random() < 0.55) c.keys |= IN_FIRE;
    }
    c.aim += (Math.random() - 0.5) * 0.4;
    if (c.ws.readyState === 1) {
      c.ws.send(JSON.stringify({ ty: C.INPUT, s: ++c.seq, d: Math.round(stepMs), k: c.keys, a: +c.aim.toFixed(2) }));
    }
  }
}, stepMs);

await wait(SECONDS * 1000);
clearInterval(timer);

const secs = (Date.now() - t0) / 1000;
const kbPerClient = bytesIn / 1024 / secs / N;
console.log('\n--- Sonuçlar ---');
console.log(`Süre                 : ${secs.toFixed(1)} sn`);
console.log(`Toplam gelen veri    : ${(bytesIn / 1024 / 1024).toFixed(2)} MB`);
console.log(`İstemci başına       : ${kbPerClient.toFixed(1)} KB/sn  (~${(kbPerClient * 8).toFixed(0)} kbit/sn)`);
console.log(`Alınan durum paketi  : ${snapCount} (istemci başına ${(snapCount / N / secs).toFixed(1)}/sn)`);

const perClientRate = snapCount / N / secs;
if (perClientRate < 15) errors.push(`Durum paketi hızı düşük: ${perClientRate.toFixed(1)}/sn (beklenen ~20)`);

for (const c of clients) c.ws.close();
extra.ws.close();
await wait(300);

console.log('\n--- Hatalar ---');
const real = errors.filter((e) => !e.includes('istemci 999'));
if (real.length === 0) console.log('yok ✓');
else real.forEach((e) => console.log(e));
process.exit(real.length ? 1 : 0);
