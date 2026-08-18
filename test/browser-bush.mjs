// Çalı ve HUD testi (tarayıcıda, çevrimdışı modda):
//   • Çalıya giren oyuncu "gizli" sayılıyor mu?
//   • Ekranda GİZLİSİN rozeti çıkıyor mu?
//   • Üst bilgide süreden başka bir şey var mı?
//   • Ateş düğmesi gerçekten kaldırıldı mı?
// Çalıştır:  node test/browser-bush.mjs

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

const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`[çalı] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[çalı] ${m.text()}`); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.click('#tabLocal');
await page.waitForTimeout(500);

await page.locator('#modePicker .mode-card').nth(0).click();
await page.evaluate(() => {
  const b = document.getElementById('botCountInput');
  b.value = 4; b.dispatchEvent(new Event('input'));
});
await page.click('#btnCreate');
await page.waitForSelector('#screenLobby.active');
await page.click('#btnReady');       // herkes hazır olunca geri sayım başlar
await page.waitForSelector('#screenGame.active', { timeout: 25000 });
await page.waitForTimeout(2000);

// Çevrimdışı modda oyun sunucusu sayfanın içinde; oyuncuyu bir çalıya taşı.
const info = await page.evaluate(() => {
  const hub = window.__net.impl.hub;
  const sim = [...hub.lobbies.values()][0].game;
  const me = sim.players.get(window.__net.impl.client.id);
  const b = sim.bushes.find((x) => x.r > 45);
  me.x = b.x; me.y = b.y;
  sim.updateHidden();
  return {
    hidden: me.hidden,
    bushCount: sim.bushes.length,
    map: { w: sim.map.w, h: sim.map.h },
  };
});
console.log('Çalı durumu:', info);
if (!info.hidden) errors.push('Çalıya giren oyuncu gizli sayılmadı');
if (info.bushCount < 10) errors.push(`Haritada yeterli çalı yok (${info.bushCount})`);
if (info.map.w < 3400 || info.map.h < 2400) errors.push('Harita büyümemiş');

await page.waitForTimeout(900);

const badge = await page.isVisible('#hideHint');
if (!badge) errors.push('GİZLİSİN rozeti görünmüyor');

const hud = (await page.textContent('#matchInfo')).trim();
console.log('Üst bilgi:', JSON.stringify(hud));
if (!/^\d+:\d{2}$/.test(hud)) errors.push(`Üst bilgide süreden başka şey var: "${hud}"`);

const fireBtn = await page.locator('#btnTouchFire').count();
if (fireBtn !== 0) errors.push('Ateş düğmesi hâlâ duruyor');

await page.screenshot({ path: `${OUT}/40-bush-hidden.png` });

// Çalı engel olmamalı: içinden yürüyerek çıkabilmeli
const walked = await page.evaluate(async () => {
  const hub = window.__net.impl.hub;
  const sim = [...hub.lobbies.values()][0].game;
  const me = sim.players.get(window.__net.impl.client.id);
  const start = { x: me.x, y: me.y };
  for (let i = 0; i < 90; i++) sim.applyInput(me, { s: i, d: 16, k: 8, a: 0 });
  return Math.round(Math.hypot(me.x - start.x, me.y - start.y));
});
console.log('Çalı içinden yürünen mesafe:', walked, 'px');
if (walked < 120) errors.push(`Çalı yolu kesiyor (sadece ${walked} px ilerlendi)`);

await browser.close();

console.log('\n--- Hatalar ---');
if (!errors.length) console.log('yok ✓');
else errors.forEach((e) => console.log(e));
process.exit(errors.length ? 1 : 0);
