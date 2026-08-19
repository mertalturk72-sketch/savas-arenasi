// Uyuyan sunucuya bağlanma testi.
//
// Yaşanan sorun: telefonda mobil veriyle sunucuya hiç bağlanılamıyordu.
// Sebep oyunun sabırsızlığıydı — 3 saniyede bağlanamazsa çevrimdışına düşüp
// WebSocket denemelerini tamamen bırakıyordu. Ücretsiz sunucu (Render) uykudan
// uyanırken 30-60 saniye WebSocket'i reddediyor, mobil veride el sıkışma da
// yavaş. Yani istemci sunucuya hiç şans tanımıyordu.
//
// Burada tam olarak o sunucuyu taklit ediyoruz: ilk N saniye WebSocket
// yükseltmesini reddeden, ama /health isteğiyle "uyanan" bir sunucu.
//
// Çalıştır:  node test/browser-slowserver.mjs

import http from 'node:http';
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import { serveStatic } from '../server/static.js';
import { WebSocketServer } from '../server/ws.js';
import { Hub } from '../shared/sim/hub.js';
import { TICK_MS } from '../shared/constants.js';
import { S } from '../shared/protocol.js';

const errors = [];

// --- Uykuda başlayan sunucu ----------------------------------------------
let awake = false;
let wakeRequests = 0;
let refusedUpgrades = 0;
const WAKE_MS = 6000;          // /health'e dokunulduktan 6 sn sonra uyanır

const hub = new Hub();
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    wakeRequests++;
    if (!awake) {
      // Render'ın uyanma sırasındaki davranışı: HTTP isteği uyandırmayı başlatır
      if (wakeRequests === 1) setTimeout(() => { awake = true; }, WAKE_MS);
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('waking');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
// Uyanana kadar WebSocket yükseltmesini reddet
const realUpgrade = wss._upgrade.bind(wss);
wss._upgrade = function (req, socket, head) {
  if (!awake) {
    refusedUpgrades++;
    socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    return;
  }
  realUpgrade(req, socket, head);
};

wss.on('connection', (ws, req) => {
  const client = hub.addClient(ws, req.socket.remoteAddress || '');
  ws.on('message', (data) => {
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg.ty !== 'string') return;
    try { hub.handle(client, msg); } catch (e) { errors.push('sunucu: ' + e.message); }
  });
  ws.on('close', () => hub.dropClient(client, 'disconnect'));
});
const loop = setInterval(() => hub.tick(TICK_MS), TICK_MS);

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});

// ===== Telefon: uyuyan sunucuya sabırla bağlanıyor mu? ===================
{
  const ctx = await browser.newContext({ ...devices['Pixel 5'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[telefon] ${e.message}`));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#screenMenu.active', { timeout: 15000 });

  // 4 saniye sonra (eski 3 sn sınırının ötesinde) HÂLÂ online denemeye devam
  // etmeli — çevrimdışına kaçmamalı. Eski hata tam burada ortaya çıkıyordu.
  await page.waitForTimeout(4500);
  const mid = await page.evaluate(() => ({
    mode: window.__net && window.__net.mode,
    status: (document.getElementById('connStatus').textContent || '').trim(),
    offerOffline: !document.getElementById('btnPlayOffline').classList.contains('hidden'),
  }));
  console.log('4,5 sn sonra mod:', mid.mode, mid.mode === 'online' ? '✓' : '✗ (çevrimdışına kaçtı)');
  console.log('  durum:', mid.status);
  if (mid.mode !== 'online') errors.push('sunucu uyanmadan çevrimdışına düşüyor — asıl hata bu');

  // Sunucuyu uyandıracak HTTP isteği gerçekten atılmış olmalı
  console.log('/health uyandırma isteği:', wakeRequests, wakeRequests > 0 ? '✓' : '✗');
  if (wakeRequests === 0) errors.push('sunucuyu uyandıran HTTP isteği hiç atılmadı');

  // Kullanıcı beklemek istemezse çıkış yolu sunulmuş olmalı
  console.log('"çevrimdışı oyna" düğmesi:', mid.offerOffline ? 'görünür ✓' : 'gizli ✗');
  if (!mid.offerOffline) errors.push('beklerken çevrimdışı seçeneği sunulmuyor');

  // Sunucu uyanınca kendiliğinden bağlanmalı
  // Bağlantı açılmasıyla oturumun açılması (WELCOME) aynı an değil; ikisini de
  // bekliyoruz, yoksa test kendi yarışına takılıyor.
  await page.waitForFunction(() => window.__net && window.__net.connected === true,
    null, { timeout: 40000 }).catch(() => errors.push('sunucu uyandığı hâlde bağlanılamadı'));
  await page.waitForFunction(() => window.__state && window.__state.me.id > 0,
    null, { timeout: 15000 }).catch(() => errors.push('bağlantı kurulduğu hâlde oturum açılmadı'));

  const done = await page.evaluate(() => ({
    mode: window.__net.mode,
    id: window.__state.me.id,
    status: (document.getElementById('connStatus').textContent || '').trim(),
    offerOffline: !document.getElementById('btnPlayOffline').classList.contains('hidden'),
  }));
  console.log(`bağlandı ✓ · reddedilen deneme: ${refusedUpgrades} · oyuncu no: ${done.id}`);
  console.log('  durum:', done.status);
  if (done.mode !== 'online') errors.push('bağlantı sonrası online moda geçilmedi');
  if (done.offerOffline) errors.push('bağlandıktan sonra çevrimdışı düğmesi ekranda kaldı');
  if (refusedUpgrades < 2) errors.push(`sunucu yeterince reddetmedi (${refusedUpgrades}) — test zayıf`);

  // Gerçekten oynanabiliyor mu?
  await page.fill('#nameInput', 'Mobil');
  await page.dispatchEvent('#nameInput', 'change');
  await page.click('#btnCreate');
  await page.waitForSelector('#screenLobby.active', { timeout: 10000 })
    .catch(() => errors.push('uyandıktan sonra lobi kurulamadı'));
  const code = await page.textContent('#lobbyCode');
  console.log('lobi kuruldu:', code.trim(), '✓');
  await ctx.close();
}

await browser.close();
clearInterval(loop);
server.close();

if (errors.length) {
  console.log('\nHATALAR:');
  for (const e of errors) console.log(' ', e);
}
console.log(errors.length ? '\nUYUYAN SUNUCU TESTİ BAŞARISIZ ✗' : '\nUYUYAN SUNUCU TESTİ GEÇTİ ✓');
process.exit(errors.length ? 1 : 0);
