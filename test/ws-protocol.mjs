// server/ws.js — el yazması WebSocket sunucusunun protokol testi.
//
// Neden: `ws` paketini kaldırıp protokolü kendimiz yazdık. O yüzden RFC 6455'in
// kullandığımız her köşesini burada tek tek zorluyoruz. Bu dosya kasıtlı olarak
// HAM TCP soketiyle konuşuyor — yani bir kütüphanenin doğruluğuna güvenmiyor.
//
// Çalıştır:  node test/ws-protocol.mjs   (kendi sunucusunu açar, kapatır)

import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { WebSocketServer } from '../server/ws.js';

let pass = 0;
const fails = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

// --- test sunucusu ---------------------------------------------------------
const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

const seen = [];         // sunucunun aldığı mesajlar
const closes = [];       // kapanış kodları
wss.on('connection', (ws) => {
  ws.on('message', (data, isBinary) => {
    seen.push({ data, isBinary });
    if (data === 'yankı') ws.send('yankı-cevap');
    if (data === 'uzun') ws.send('x'.repeat(70000));
    if (data === 'kapat') ws.close(1000, 'bitti');
  });
  ws.on('pong', (p) => seen.push({ pong: p.toString() }));
  ws.on('close', (code) => closes.push(code));
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

// --- ham istemci yardımcıları ---------------------------------------------
function connect() {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(PORT, '127.0.0.1');
    let buf = Buffer.alloc(0);
    sock.on('error', reject);
    sock.on('data', function onData(c) {
      buf = Buffer.concat([buf, c]);
      const i = buf.indexOf('\r\n\r\n');
      if (i < 0) return;
      const head = buf.subarray(0, i).toString();
      sock.off('data', onData);
      const rest = buf.subarray(i + 4);
      resolve({ sock, head, rest, key });
    });
    sock.write(
      `GET / HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nUpgrade: websocket\r\n`
      + `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    );
  });
}

function clientFrame(opcode, payload, { fin = true, mask = true } = {}) {
  const p = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf-8');
  const len = p.length;
  const heads = [];
  let h;
  if (len < 126) { h = Buffer.allocUnsafe(2); h[1] = len; }
  else if (len < 65536) { h = Buffer.allocUnsafe(4); h[1] = 126; h.writeUInt16BE(len, 2); }
  else { h = Buffer.allocUnsafe(10); h[1] = 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(len, 6); }
  h[0] = (fin ? 0x80 : 0) | opcode;
  if (mask) {
    h[1] |= 0x80;
    const m = crypto.randomBytes(4);
    const masked = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) masked[i] = p[i] ^ m[i & 3];
    heads.push(h, m, masked);
  } else {
    heads.push(h, p);
  }
  return Buffer.concat(heads);
}

// Sunucudan gelen (maskesiz) çerçeveleri okur.
function reader(sock) {
  let buf = Buffer.alloc(0);
  const frames = [];
  const waiters = [];
  sock.on('data', (c) => {
    buf = Buffer.concat([buf, c]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if ((buf[1] & 0x80) !== 0) return;      // sunucu maskelememeli
      if (buf.length < off + len) return;
      const f = { fin, opcode, payload: buf.subarray(off, off + len) };
      buf = buf.subarray(off + len);
      frames.push(f);
      const w = waiters.shift();
      if (w) w(frames.shift());
    }
  });
  return {
    next(ms = 2000) {
      if (frames.length) return Promise.resolve(frames.shift());
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('çerçeve gelmedi')), ms);
        waiters.push((f) => { clearTimeout(t); resolve(f); });
      });
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===== 1) El sıkışma =======================================================
console.log('\n— El sıkışma —');
{
  const { sock, head, key } = await connect();
  const expect = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  ok('101 Switching Protocols dönüyor', /^HTTP\/1\.1 101/.test(head), head.split('\r\n')[0]);
  ok('Sec-WebSocket-Accept doğru hesaplanıyor', head.includes(expect));
  ok('Upgrade başlığı var', /upgrade:\s*websocket/i.test(head));
  sock.destroy();
}

// Eksik/yanlış el sıkışma reddedilmeli.
{
  const sock = net.connect(PORT, '127.0.0.1');
  const got = await new Promise((resolve) => {
    let s = '';
    sock.on('data', (c) => { s += c; if (s.includes('\r\n\r\n')) resolve(s); });
    sock.on('close', () => resolve(s));
    sock.write(`GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 8\r\nSec-WebSocket-Key: abc\r\n\r\n`);
  });
  ok('eski sürüm (v8) reddediliyor', /400/.test(got), got.split('\r\n')[0]);
  sock.destroy();
}

// ===== 2) Mesaj gidiş-gelişi ==============================================
console.log('\n— Mesaj —');
{
  const { sock, rest } = await connect();
  const rd = reader(sock);
  if (rest.length) sock.emit('data', rest);

  sock.write(clientFrame(0x1, 'yankı'));
  const f = await rd.next();
  ok('metin mesajı gidiyor ve cevap geliyor', f.opcode === 1 && f.payload.toString() === 'yankı-cevap');
  ok('sunucu çerçeveleri maskesiz gönderiyor', true);

  // Parçalı mesaj: "mer" + "ha" + "ba"
  sock.write(clientFrame(0x1, 'mer', { fin: false }));
  sock.write(clientFrame(0x0, 'ha', { fin: false }));
  sock.write(clientFrame(0x0, 'ba'));
  await sleep(120);
  ok('parçalı mesaj birleştiriliyor', seen.some((s) => s.data === 'merhaba'),
    JSON.stringify(seen.map((s) => s.data).slice(-3)));

  // Tek TCP yazımında iki çerçeve
  seen.length = 0;
  sock.write(Buffer.concat([clientFrame(0x1, 'bir'), clientFrame(0x1, 'iki')]));
  await sleep(120);
  ok('tek pakette iki çerçeve ayrıştırılıyor',
    seen.length === 2 && seen[0].data === 'bir' && seen[1].data === 'iki');

  // Çerçeveyi bayt bayt böl — TCP parçalanmasına dayanmalı
  seen.length = 0;
  const split = clientFrame(0x1, 'parçalı-tcp');
  for (const byte of split) { sock.write(Buffer.from([byte])); await sleep(1); }
  await sleep(150);
  ok('bayt bayt gelen çerçeve toparlanıyor', seen.some((s) => s.data === 'parçalı-tcp'));

  // 16 bit ve 64 bit uzunluk yolları
  seen.length = 0;
  const big = 'a'.repeat(3000);
  sock.write(clientFrame(0x1, big));
  await sleep(200);
  ok('126 (16-bit) uzunluk yolu çalışıyor', seen.some((s) => s.data === big));

  seen.length = 0;
  const huge = 'b'.repeat(70000);
  sock.write(clientFrame(0x1, huge));
  const closeF = await rd.next().catch(() => null);
  ok('maxPayload aşılınca 1009 ile kapatılıyor',
    !!closeF && closeF.opcode === 8 && closeF.payload.readUInt16BE(0) === 1009,
    closeF ? String(closeF.opcode) : 'yok');
  sock.destroy();
}

// ===== 3) Sunucudan büyük yük (64-bit uzunluk yazımı) =====================
console.log('\n— Büyük yük —');
{
  const { sock, rest } = await connect();
  const rd = reader(sock);
  if (rest.length) sock.emit('data', rest);
  sock.write(clientFrame(0x1, 'uzun'));
  const f = await rd.next(4000);
  ok('sunucu 70 KB tek çerçevede gönderebiliyor', f.opcode === 1 && f.payload.length === 70000,
    String(f.payload.length));
  sock.destroy();
}

// ===== 4) Kontrol çerçeveleri =============================================
console.log('\n— Ping / pong / kapanış —');
{
  const { sock, rest } = await connect();
  const rd = reader(sock);
  if (rest.length) sock.emit('data', rest);

  sock.write(clientFrame(0x9, 'sel'));
  const p = await rd.next();
  ok('ping → pong yanıtlanıyor', p.opcode === 10 && p.payload.toString() === 'sel');

  seen.length = 0;
  sock.write(clientFrame(0xa, 'geri'));
  await sleep(120);
  ok('istemci pong\'u olay olarak yayınlanıyor', seen.some((s) => s.pong === 'geri'));

  closes.length = 0;
  sock.write(clientFrame(0x1, 'kapat'));      // sunucu close(1000) çağırıyor
  const c = await rd.next();
  ok('sunucu kapanış çerçevesi gönderiyor', c.opcode === 8 && c.payload.readUInt16BE(0) === 1000);
  sock.write(clientFrame(0x8, Buffer.concat([Buffer.from([0x03, 0xe8]), Buffer.from('ok')])));
  await sleep(150);
  ok('kapanış sonrası close olayı tetikleniyor', closes.length === 1, JSON.stringify(closes));
  sock.destroy();
}

// ===== 5) Protokol ihlalleri ==============================================
console.log('\n— Bozuk girdi —');
{
  // Maskesiz istemci çerçevesi → 1002
  const { sock, rest } = await connect();
  const rd = reader(sock);
  if (rest.length) sock.emit('data', rest);
  sock.write(clientFrame(0x1, 'maskesiz', { mask: false }));
  const f = await rd.next().catch(() => null);
  ok('maskesiz istemci çerçevesi 1002 ile reddediliyor',
    !!f && f.opcode === 8 && f.payload.readUInt16BE(0) === 1002);
  sock.destroy();
}
{
  // 125 bayttan uzun kontrol çerçevesi → 1002
  const { sock, rest } = await connect();
  const rd = reader(sock);
  if (rest.length) sock.emit('data', rest);
  sock.write(clientFrame(0x9, 'z'.repeat(200)));
  const f = await rd.next().catch(() => null);
  ok('aşırı uzun kontrol çerçevesi reddediliyor',
    !!f && f.opcode === 8 && f.payload.readUInt16BE(0) === 1002);
  sock.destroy();
}
{
  // Bilinmeyen opcode → 1002
  const { sock, rest } = await connect();
  const rd = reader(sock);
  if (rest.length) sock.emit('data', rest);
  sock.write(clientFrame(0x3, 'garip'));
  const f = await rd.next().catch(() => null);
  ok('bilinmeyen opcode reddediliyor',
    !!f && f.opcode === 8 && f.payload.readUInt16BE(0) === 1002);
  sock.destroy();
}
{
  // Ani kopma → close olayı gelmeli, sunucu çökmemeli
  closes.length = 0;
  const { sock } = await connect();
  await sleep(80);
  sock.destroy();
  await sleep(200);
  ok('ani kopmada close olayı geliyor', closes.length >= 1, JSON.stringify(closes));
  ok('kopan istemci listeden düşüyor', wss.clients.size === 0, String(wss.clients.size));
}

// ===== 6) Çok istemcili dayanıklılık =====================================
console.log('\n— 30 istemci aynı anda —');
{
  const socks = [];
  for (let i = 0; i < 30; i++) {
    const { sock, rest } = await connect();
    if (rest.length) sock.emit('data', rest);
    socks.push(sock);
  }
  ok('30 bağlantı açıldı', wss.clients.size === 30, String(wss.clients.size));
  seen.length = 0;
  for (let i = 0; i < 30; i++) socks[i].write(clientFrame(0x1, `istemci-${i}`));
  await sleep(400);
  ok('30 mesajın hepsi alındı', seen.length === 30, String(seen.length));
  for (const s of socks) s.destroy();
  await sleep(300);
  ok('hepsi temizlendi', wss.clients.size === 0, String(wss.clients.size));
}

server.close();
console.log(`\n${pass} test geçti, ${fails.length} başarısız`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
console.log('✅ WebSocket protokol testleri geçti');
process.exit(0);
