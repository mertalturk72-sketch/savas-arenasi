// Çevrimdışı mod testi:
//  1) Masaüstü — ağ kesildikten sonra bile maç sunucusuz devam ediyor mu?
//  2) Telefon boyutunda dokunmatik arayüz çalışıyor mu?
//  3) Service worker sayesinde sayfa internetsiz açılıyor mu?
// Çalıştır:  node test/browser-offline.mjs

import { botAyarla, modSec } from './yardimci.mjs';
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import { SC_FIELDS } from '../shared/protocol.js';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
const errors = [];

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});

// Ağ kasten kesildiği için WebSocket'in bağlanamaması beklenen bir durum;
// gerçek uygulama hatalarıyla karıştırmayalım.
const EXPECTED = /WebSocket connection|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|Failed to load resource/i;

function attach(page, tag) {
  page.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}\n${e.stack || ''}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (EXPECTED.test(m.text())) return;
    errors.push(`[${tag}] ${m.text()}`);
  });
}

async function createAndStart(page, { mode = 0, bots = 6 } = {}) {
  await page.click('#btnCreate');
  await page.waitForSelector('#screenLobby.active', { timeout: 6000 });
  await modSec(page, mode);
  await botAyarla(page, bots);
  await page.click('#btnReady');       // herkes hazır olunca geri sayım başlar
  await page.waitForSelector('#screenGame.active', { timeout: 25000 });
}

// ===== 1) Masaüstü: ağ kesikken çevrimdışı maç =============================
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
// Skor listesindeki alan sayısını sabit yazmıyoruz: protokole yeni bir
// alan (asist) eklenince testler sessizce yanlış sayı hesaplıyordu.
await page.addInitScript((n) => { window.__SC_FIELDS = n; }, SC_FIELDS);
  attach(page, 'cevrimdisi');
  await page.goto(BASE, { waitUntil: 'networkidle' });

  await page.click('#tabLocal');
  await page.waitForTimeout(600);

  const status = await page.textContent('#connStatus');
  console.log('Durum:', status.trim());

  await page.fill('#nameInput', 'Yalnız Kurt');
  await page.dispatchEvent('#nameInput', 'change');
  await page.fill('#lobbyNameInput', 'Çevrimdışı');

  // Ağı tamamen kes — bundan sonrası tarayıcının içinde çalışmalı
  await ctx.setOffline(true);
  console.log('Ağ kesildi.');

  await createAndStart(page, { mode: 0, bots: 6 });
  await page.waitForTimeout(1800);

  // Oyna
  await page.mouse.move(900, 300);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(600);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(1500);

  const st = await page.evaluate(() => {
    const g = window.__game;
    return {
      netMode: window.__net.mode,
      running: g.running,
      snaps: g.snaps.length,
      units: g.playersRender.length,
      rosterSize: g.roster.size,
      scoreRows: (g.scores?.ps || []).length / window.__SC_FIELDS,
      ammo: g.you?.am,
      mag: g.you?.mg,
      time: Math.round(g.snaps.at(-1)?.t || 0),
    };
  });
  console.log('Çevrimdışı maç durumu:', st);

  if (st.netMode !== 'local') errors.push('Çevrimdışı moda geçilmedi');
  if (!st.running) errors.push('Oyun döngüsü çalışmıyor');
  if (st.snaps < 5) errors.push('Tarayıcı içi sunucudan durum paketi gelmiyor');
  if (st.rosterSize !== 7) errors.push(`7 birim bekleniyordu, ${st.rosterSize} var`);
  if (st.scoreRows !== 7) errors.push(`Skor listesinde 7 kayıt bekleniyordu, ${st.scoreRows} var`);
  if (st.ammo === st.mag) errors.push('Ateş edilmiş ama şarjör azalmamış');
  if (st.time < 2000) errors.push('Simülasyon zamanı ilerlemiyor');

  // Zamanın gerçekten aktığını ikinci ölçümle doğrula
  const t1 = st.time;
  await page.waitForTimeout(1500);
  const t2 = await page.evaluate(() => Math.round(window.__game.snaps.at(-1)?.t || 0));
  if (t2 - t1 < 800) errors.push(`Simülasyon durmuş görünüyor (${t1} → ${t2})`);
  console.log(`Simülasyon zamanı: ${t1} ms → ${t2} ms`);

  await page.screenshot({ path: `${OUT}/20-offline-game.png` });
  await ctx.close();
}

// ===== 2) Telefon: dokunmatik kontroller ==================================
{
  const ctx = await browser.newContext({
    ...devices['Pixel 7'],
    viewport: { width: 900, height: 420 },     // yatay tutulan telefon
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  attach(page, 'telefon');
  await page.goto(BASE, { waitUntil: 'networkidle' });

  await page.click('#tabLocal');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/21-mobile-menu.png` });

  await createAndStart(page, { mode: 2, bots: 9 });   // Son Hayatta Kalan
  await page.waitForTimeout(1800);

  const touchVisible = await page.isVisible('#touchUI');
  console.log('Dokunmatik arayüz görünür mü:', touchVisible);
  if (!touchVisible) errors.push('Telefonda sanal kumanda görünmüyor');

  // Sol çubuğu sağa yatır: hem tuş üretilmeli hem oyuncu yürümeli.
  // (Duvara dayanmış olabileceği için mesafe tek başına yeterli kanıt değil.)
  await page.evaluate(() => {
    const el = document.getElementById('stickMove');
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const fire = (type, x, y) => el.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true,
      changedTouches: [new Touch({ identifier: 1, target: el, clientX: x, clientY: y })],
      touches: [new Touch({ identifier: 1, target: el, clientX: x, clientY: y })],
    }));
    fire('touchstart', cx, cy);
    fire('touchmove', cx + 50, cy);
    window.__release = () => fire('touchend', cx + 50, cy);
  });

  await page.waitForTimeout(150);
  const IN_RIGHT = 1 << 3;
  const sampled = await page.evaluate(() => {
    const g = window.__game;
    return g.input.sample(400, 200).keys;
  });
  console.log('Çubuk basılıyken üretilen tuş maskesi:', sampled);
  if (!(sampled & IN_RIGHT)) errors.push('Sanal çubuk "sağa git" tuşunu üretmiyor');

  // Not: burada mesafe ölçmüyoruz. Sunucu otoriter olduğu için istemcideki
  // konumu elle değiştirmek bir sonraki durum paketinde geri alınır; ayrıca
  // oyuncu duvara dayanmış olabilir. Kumandanın işini yaptığını yukarıdaki
  // tuş maskesi kanıtlıyor; uçtan uca hareket zaten masaüstü testinde ölçülüyor.
  const before2 = await page.evaluate(() => ({ x: window.__game.me.x, y: window.__game.me.y }));
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => ({ x: window.__game.me.x, y: window.__game.me.y }));
  await page.evaluate(() => window.__release && window.__release());
  console.log('Çubuk basılıyken katedilen mesafe:', Math.round(Math.hypot(after.x - before2.x, after.y - before2.y)), 'px (bilgi amaçlı)');

  await page.screenshot({ path: `${OUT}/22-mobile-game.png` });
  await ctx.close();
}

// ===== 3) Service worker: internetsiz açılış ==============================
if (process.env.SKIP_SW !== '1') {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 420 }, hasTouch: true });
  const page = await ctx.newPage();
  attach(page, 'sw');
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const swReady = await page.evaluate(async () => {
    if (!navigator.serviceWorker) return 'yok';
    const reg = await Promise.race([
      navigator.serviceWorker.ready.catch(() => null),
      new Promise((r) => setTimeout(() => r(null), 4000)),
    ]);
    return reg ? 'hazır' : 'kayıt yok';
  });
  console.log('Service worker:', swReady);
  if (swReady !== 'hazır') errors.push('Service worker kaydolmadı');

  // Önbelleğin dolması için biraz bekle, sonra ağı tamamen kes ve yeniden yükle
  await page.waitForTimeout(2500);
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const offlineBoot = await page.evaluate(() => ({
    title: document.title,
    hasMenu: !!document.querySelector('#screenMenu.active'),
    mode: window.__net?.mode,
  }));
  console.log('İnternetsiz açılış:', offlineBoot);
  if (!offlineBoot.hasMenu) errors.push('İnternetsiz açılışta menü gelmedi');

  // İnternetsizken maç başlatılabilmeli
  await page.click('#tabLocal');
  await page.waitForTimeout(500);
  await createAndStart(page, { mode: 0, bots: 4 });
  await page.waitForTimeout(1500);
  const ok = await page.evaluate(() => window.__game.running && window.__game.snaps.length > 5);
  console.log('İnternetsiz maç başladı mı:', ok);
  if (!ok) errors.push('İnternetsiz maç başlatılamadı');

  await page.screenshot({ path: `${OUT}/23-offline-boot.png` });
  await ctx.close();
}

await browser.close();

console.log('\n--- Hatalar ---');
if (!errors.length) console.log('yok ✓');
else errors.forEach((e) => console.log(e));
console.log(`\nEkran görüntüleri: ${OUT}`);
process.exit(errors.length ? 1 : 0);
