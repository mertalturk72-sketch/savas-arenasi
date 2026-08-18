// Tarayıcı testi: gerçek Chromium ile menü → lobi → maç akışını doğrular,
// konsol hatalarını yakalar ve ekran görüntüsü alır.
// Çalıştır:  node test/browser.mjs

import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const logs = [];

function attach(page, tag) {
  page.on('console', (m) => {
    const t = `[${tag}:${m.type()}] ${m.text()}`;
    logs.push(t);
    if (m.type() === 'error') errors.push(t);
  });
  page.on('pageerror', (e) => errors.push(`[${tag}:pageerror] ${e.message}\n${e.stack}`));
  page.on('requestfailed', (r) => {
    const f = r.failure();
    if (f && !/net::ERR_ABORTED/.test(f.errorText)) errors.push(`[${tag}:req] ${r.url()} ${f.errorText}`);
  });
}

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});

// --- 1) Kurucu oyuncu -------------------------------------------------------
const ctx1 = await browser.newContext({ viewport: { width: 1440, height: 860 } });
const host = await ctx1.newPage();
attach(host, 'host');
await host.goto(BASE, { waitUntil: 'networkidle' });

await host.fill('#nameInput', 'Komutan');
await host.dispatchEvent('#nameInput', 'change');
await host.fill('#lobbyNameInput', 'Test Lobisi');
await host.locator('#modePicker .mode-card').first().click();      // FFA
await host.evaluate(() => {
  const b = document.getElementById('botCountInput');
  b.value = 5; b.dispatchEvent(new Event('input'));
});
await host.click('#btnCreate');
await host.waitForSelector('#screenLobby.active', { timeout: 5000 });
await host.waitForTimeout(400);
await host.screenshot({ path: `${OUT}/02-lobby.png` });

const code = (await host.textContent('#lobbyCode')).trim();
console.log('Lobi kodu:', code);

// --- 2) İkinci oyuncu kodla katılıyor --------------------------------------
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const guest = await ctx2.newPage();
attach(guest, 'guest');
await guest.goto(BASE, { waitUntil: 'networkidle' });
await guest.fill('#nameInput', 'Er Ali');
await guest.dispatchEvent('#nameInput', 'change');
await guest.fill('#codeInput', code);
await guest.click('#btnJoinCode');
await guest.waitForSelector('#screenLobby.active', { timeout: 5000 });
await guest.waitForTimeout(300);

const rosterCount = await host.locator('#roster .roster-item').count();
console.log('Lobideki oyuncu sayısı (host görünümü):', rosterCount);
if (rosterCount !== 2) errors.push(`Lobide 2 oyuncu bekleniyordu, ${rosterCount} var`);

// Sohbet
await guest.fill('#chatInput', 'selam komutanım');
await guest.press('#chatInput', 'Enter');
await host.waitForTimeout(400);
const chatText = await host.textContent('#chatLog');
if (!chatText.includes('selam komutanım')) errors.push('Sohbet mesajı diğer oyuncuya ulaşmadı');

// Sınıf değiştir
await guest.locator('#classPicker .class-card').nth(1).click();
await host.waitForTimeout(300);
await host.screenshot({ path: `${OUT}/03-lobby-2p.png` });

// --- 3) Menüdeki lobi listesi ----------------------------------------------
const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const lurker = await ctx3.newPage();
attach(lurker, 'lurker');
await lurker.goto(BASE, { waitUntil: 'networkidle' });
await lurker.waitForTimeout(1400);
const listed = await lurker.locator('#lobbyList .lobby-item').count();
console.log('Menüde listelenen lobi sayısı:', listed);
if (listed < 1) errors.push('Açık lobi listede görünmüyor');
await lurker.screenshot({ path: `${OUT}/01-menu.png` });

// --- 4) Maçı başlat --------------------------------------------------------
await guest.click('#btnReady');
await host.click('#btnReady');        // herkes hazır → 5-4-3-2-1
await host.waitForSelector('#screenGame.active', { timeout: 25000 });
await guest.waitForSelector('#screenGame.active', { timeout: 25000 });
console.log('Maç başladı.');
await host.waitForTimeout(1500);

// Oyna: hareket + ateş
await host.mouse.move(900, 300);
await host.keyboard.down('KeyD');
await host.waitForTimeout(700);
await host.mouse.down();
await host.waitForTimeout(900);
await host.mouse.up();
await host.keyboard.up('KeyD');
await host.keyboard.down('KeyW');
await host.waitForTimeout(600);
await host.keyboard.up('KeyW');
await host.waitForTimeout(1200);

const hud = await host.evaluate(() => ({
  hp: document.getElementById('hpText').textContent,
  ammo: document.getElementById('ammoText').textContent,
  net: document.getElementById('netInfo').textContent,
  info: document.getElementById('matchInfo').textContent,
}));
console.log('HUD:', hud);
if (hud.ammo === '30') errors.push('Ateş edildi ama şarjör azalmadı (girdi sunucuya ulaşmıyor olabilir)');

// Konum gerçekten değişmiş mi?
const moved = await host.evaluate(() => window.__debugPos || null);
void moved;

await host.screenshot({ path: `${OUT}/04-game.png` });
await guest.screenshot({ path: `${OUT}/05-game-guest.png` });

// Skor tablosu
await host.keyboard.down('Tab');
await host.waitForTimeout(500);
await host.screenshot({ path: `${OUT}/06-scoreboard.png` });
await host.keyboard.up('Tab');

// Oyun içi sohbet
await host.keyboard.press('Enter');
await host.waitForTimeout(200);
await host.keyboard.type('vurun!');
await host.keyboard.press('Enter');
await guest.waitForTimeout(400);

// Botlar hareket ediyor mu?
const stats = await host.evaluate(() => {
  const g = window.__game;
  if (!g) return null;
  return {
    players: g.playersRender.length,
    bullets: g.bulletsRender.length,
    snaps: g.snaps.length,
    myPos: { x: Math.round(g.me.x), y: Math.round(g.me.y) },
    ping: Math.round(g.net.ping),
  };
});
console.log('Oyun durumu:', stats);

// Görüş kısıtı nedeniyle anlık görünen birim sayısı değişir; skor tablosu
// ise herkesi listelemeli (2 oyuncu + 5 bot = 7).
const sbRows = await host.evaluate(() => {
  const g = window.__game;
  g.renderScoreboard();
  return document.querySelectorAll('#scoreboard .sb-table tr').length - 1;
});
console.log('Skor tablosundaki satır sayısı:', sbRows);
if (sbRows !== 7) errors.push(`Skor tablosunda 7 satır bekleniyordu, ${sbRows} var`);

// Birkaç saniye boyunca en az bir düşman görünmeli
let maxSeen = 0;
for (let i = 0; i < 12; i++) {
  const n = await host.evaluate(() => window.__game.playersRender.length);
  maxSeen = Math.max(maxSeen, n);
  await host.waitForTimeout(400);
}
console.log('En fazla eşzamanlı görülen birim:', maxSeen);
if (maxSeen < 2) errors.push('Hiçbir düşman görünmedi — görüş kısıtı fazla agresif olabilir');

await host.waitForTimeout(2500);
await host.screenshot({ path: `${OUT}/07-game-later.png` });

await browser.close();

console.log('\n--- Konsol hataları ---');
if (errors.length === 0) console.log('yok ✓');
else errors.forEach((e) => console.log(e));
console.log(`\nEkran görüntüleri: ${OUT}`);
process.exit(errors.length ? 1 : 0);
