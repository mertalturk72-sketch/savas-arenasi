// Lobi testi: karakter seçimi + hazır sayacı + 5-4-3-2-1 geri sayımı.
// Çalıştır:  node test/browser-lobby.mjs

import { botAyarla } from './yardimci.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
const errors = [];

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});

function attach(page, tag) {
  page.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] ${m.text()}`); });
}

// --- İki oyunculu online lobi ---------------------------------------------
const ctx1 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const host = await ctx1.newPage();
attach(host, 'host');
await host.goto(BASE, { waitUntil: 'networkidle' });
await host.click('#tabOnline');
await host.waitForTimeout(700);
await host.fill('#nameInput', 'Komutan');
await host.dispatchEvent('#nameInput', 'change');
await host.fill('#lobbyNameInput', 'Hazır testi');
await host.click('#btnCreate');
await host.waitForSelector('#screenLobby.active', { timeout: 6000 });
await botAyarla(host, 0);

const code = (await host.textContent('#lobbyCode')).trim();

const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const guest = await ctx2.newPage();
attach(guest, 'guest');
await guest.goto(BASE, { waitUntil: 'networkidle' });
await guest.click('#tabOnline');
await guest.waitForTimeout(700);
await guest.fill('#nameInput', 'Er Ali');
await guest.dispatchEvent('#nameInput', 'change');
await guest.fill('#codeInput', code);
await guest.click('#btnJoinCode');
await guest.waitForSelector('#screenLobby.active', { timeout: 6000 });
await host.waitForTimeout(600);

// --- Karakter seçimi -------------------------------------------------------
const charCards = await host.locator('#charPicker .char-card').count();
console.log('Karakter sayısı:', charCards);
if (charCards < 6) errors.push(`Karakter seçiminde ${charCards} kart var`);

const charsDiffer = await host.evaluate(() => {
  const l = window.__state.lobby;
  return new Set(l.members.map((m) => m.char)).size === l.members.length;
});
if (!charsDiffer) errors.push('İki oyuncuya aynı karakter verilmiş');

await host.locator('#charPicker .char-card').nth(3).click();
await host.waitForTimeout(500);
const hostChar = await host.evaluate(() =>
  window.__state.lobby.members.find((m) => m.id === window.__state.me.id).char);
const seenByGuest = await guest.evaluate(() => {
  const l = window.__state.lobby;
  const other = l.members.find((m) => m.id !== window.__state.me.id);
  return other && other.char;
});
console.log('Host karakteri:', hostChar, '· misafir bunu görüyor:', seenByGuest);
if (hostChar !== seenByGuest) errors.push('Karakter seçimi diğer oyuncuya yansımadı');

await host.screenshot({ path: `${OUT}/80-lobby-chars.png` });

// Zorla başlatma düğmesi kaldırıldı: tek yol herkesin hazır olması
const forceBtn = await host.locator('#btnStart').count();
if (forceBtn !== 0) errors.push('"Herkesi beklemeden başlat" düğmesi hâlâ duruyor');

// --- Hazır sayacı: tek kişi hazır deyince BAŞLAMAMALI ----------------------
await guest.click('#btnReady');
await host.waitForTimeout(700);

const statusAfterOne = (await host.textContent('#readyStatus')).trim();
const startedEarly = await host.evaluate(() => window.__state.lobby.state !== 'waiting');
console.log('Bir kişi hazırken durum:', JSON.stringify(statusAfterOne), '· lobi durumu değişti mi:', startedEarly);
if (!/1\s*\/\s*2/.test(statusAfterOne)) errors.push(`Hazır sayacı yanlış: "${statusAfterOne}"`);
if (startedEarly) errors.push('Tek kişi hazır deyince maç başladı!');

// --- Herkes hazır → geri sayım --------------------------------------------
await host.click('#btnReady');
await host.waitForTimeout(600);

const cdVisible = await host.isVisible('#countdownOverlay');
const firstNum = (await host.textContent('#countdownNum')).trim();
console.log('Geri sayım görünür mü:', cdVisible, '· ilk sayı:', firstNum);
if (!cdVisible) errors.push('Geri sayım perdesi açılmadı');
if (!['5', '4'].includes(firstNum)) errors.push(`Geri sayım 5'ten başlamadı: ${firstNum}`);

await host.screenshot({ path: `${OUT}/81-countdown.png` });

// Sayıların gerçekten azaldığını gör
const seq = [];
for (let i = 0; i < 8; i++) {
  const n = (await host.textContent('#countdownNum')).trim();
  if (!seq.length || seq[seq.length - 1] !== n) seq.push(n);
  await host.waitForTimeout(500);
}
console.log('Geri sayım dizisi:', seq.join(' → '));
if (seq.length < 3) errors.push('Geri sayım ilerlemiyor');

await host.waitForSelector('#screenGame.active', { timeout: 12000 });
await guest.waitForSelector('#screenGame.active', { timeout: 12000 });
console.log('Maç başladı ✓');
await host.waitForTimeout(2000);
await host.screenshot({ path: `${OUT}/82-game-characters.png` });

await browser.close();

console.log('\n--- Hatalar ---');
if (!errors.length) console.log('yok ✓');
else errors.forEach((e) => console.log(e));
process.exit(errors.length ? 1 : 0);
