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

// Çalı engel olmamalı: içinden yürüyerek çıkabilmeli.
//
// Dikkat: harita her maçta yeniden üretiliyor, bu yüzden çalının hemen yanında
// bir duvar olabilir. Duvara çarpıp "çalı yolu kesiyor" demek yanlış olurdu —
// önce oyuncunun gerçekten sığdığı bir çalı+yön çifti seçiyoruz, ölçümü ondan
// sonra yapıyoruz. (Bu testin daha önce ara sıra düşmesinin sebebi buydu.)
const walked = await page.evaluate(async () => {
  const hub = window.__net.impl.hub;
  const sim = [...hub.lobbies.values()][0].game;
  const me = sim.players.get(window.__net.impl.client.id);
  const R = 16;                       // oyuncu yarıçapı
  const DIRS = [
    { k: 8, dx: 1, dy: 0 },           // sağ
    { k: 4, dx: -1, dy: 0 },          // sol
    { k: 2, dx: 0, dy: 1 },           // aşağı
    { k: 1, dx: 0, dy: -1 },          // yukarı
  ];

  // Oyuncu dairesi bu koridorda engele değiyor mu? (çalılar engel değildir)
  const corridorClear = (x, y, dx, dy, len) => {
    for (let t = 0; t <= len; t += 8) {
      const px = x + dx * t, py = y + dy * t;
      for (const o of sim.map.obstacles) {
        const cx = Math.max(o.x, Math.min(px, o.x + o.w));
        const cy = Math.max(o.y, Math.min(py, o.y + o.h));
        if ((px - cx) ** 2 + (py - cy) ** 2 < (R + 2) ** 2) return false;
      }
      if (px < R || py < R || px > sim.map.w - R || py > sim.map.h - R) return false;
    }
    return true;
  };

  // Büyük çalılar arasında, içinden geçilebilecek bir yön bulunanı seç
  for (const b of sim.bushes.filter((x) => x.r > 45)) {
    for (const d of DIRS) {
      // Çalının bir ucundan girip diğer ucundan çıkacak şekilde konumlan
      const sx = b.x - d.dx * (b.r - 4);
      const sy = b.y - d.dy * (b.r - 4);
      if (!corridorClear(sx, sy, d.dx, d.dy, 200)) continue;

      me.x = sx; me.y = sy;
      sim.updateHidden();
      const start = { x: me.x, y: me.y };
      for (let i = 0; i < 90; i++) sim.applyInput(me, { s: i, d: 16, k: d.k, a: 0 });
      return {
        dist: Math.round(Math.hypot(me.x - start.x, me.y - start.y)),
        wasInside: true,
        bushR: Math.round(b.r),
      };
    }
  }
  return { dist: -1, wasInside: false, bushR: 0 };
});
console.log('Çalı içinden yürünen mesafe:', walked.dist, 'px (çalı yarıçapı', walked.bushR + ')');
if (!walked.wasInside) errors.push('Test için uygun (etrafı açık) çalı bulunamadı');
else if (walked.dist < 120) errors.push(`Çalı yolu kesiyor (sadece ${walked.dist} px ilerlendi)`);

await browser.close();

console.log('\n--- Hatalar ---');
if (!errors.length) console.log('yok ✓');
else errors.forEach((e) => console.log(e));
process.exit(errors.length ? 1 : 0);
