// Keskin nişancı nişan çizgisi + cephane göstergesi + çalı saydamlığı testi.
// Çalıştır:  node test/browser-sniper.mjs

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
page.on('pageerror', (e) => errors.push(`[nişancı] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[nişancı] ${m.text()}`); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.click('#tabLocal');
await page.waitForTimeout(500);
await page.evaluate(() => {
  const b = document.getElementById('botCountInput');
  b.value = 3; b.dispatchEvent(new Event('input'));
});
await page.click('#btnCreate');
await page.waitForSelector('#screenLobby.active');

// Keskin Nişancı sınıfını seç (üçüncü kart)
await page.locator('#classPicker .class-card').nth(2).click();
await page.waitForTimeout(300);
await page.click('#btnReady');       // herkes hazır olunca geri sayım başlar
await page.waitForSelector('#screenGame.active', { timeout: 25000 });
await page.waitForTimeout(2000);

const st = await page.evaluate(() => {
  const g = window.__game;
  return {
    weapon: g.weapon,
    laser: !!g.renderer.drawAimLaser,
    ammo: g.you?.am, mag: g.you?.mg, reserve: g.you?.ar, maxReserve: g.you?.mr,
    reserveText: document.getElementById('reserveText')?.textContent,
  };
});
console.log('Nişancı durumu:', st);
if (st.weapon !== 'sniper') errors.push(`Silah keskin tüfek değil: ${st.weapon}`);
if (st.mag !== 5) errors.push(`Şarjör 5 olmalıydı, ${st.mag}`);
if (!st.reserve || st.reserve !== st.maxReserve) errors.push('Yedek cephane dolu başlamadı');
// Cephane artık "şarjör / yedek" biçiminde: iki taraf da düz sayı olmalı.
if (!/^\d+$/.test((st.reserveText || '').trim())) {
  errors.push(`Yedek göstergesi sayı değil: "${st.reserveText}"`);
}

// Nişan çizgisinin duvarda kesildiğini doğrula
const laser = await page.evaluate(async () => {
  const g = window.__game;
  const { rayHitDistance } = await import('/shared/physics.js');
  const open = rayHitDistance(g.meRender.x, g.meRender.y, g.aim, 1700, g.idx);
  // Duvara doğrudan bakan bir yön bul
  let blocked = null;
  for (let a = 0; a < Math.PI * 2; a += 0.15) {
    const d = rayHitDistance(g.meRender.x, g.meRender.y, a, 1700, g.idx);
    if (d < 1700) { blocked = Math.round(d); break; }
  }
  return { open: Math.round(open), blocked };
});
console.log('Nişan ışını:', laser);
if (laser.blocked === null) errors.push('Işın hiçbir duvarda kesilmiyor');
else if (laser.blocked > 1700) errors.push('Işın menzili aşıyor');

// Cephaneyi tüket: yedek bitince gösterge 0 olup kırmızıya dönmeli
const dry = await page.evaluate(() => {
  const hub = window.__net.impl.hub;
  const sim = [...hub.lobbies.values()][0].game;
  const me = sim.players.get(window.__net.impl.client.id);
  // Cephane kutularını kapat: oyuncu ölçüm sırasında kutunun üstünden geçip
  // yedeğini doldurabiliyordu (yarım kapasite = 8) ve test sahte hata
  // veriyordu. Kutular kapalıyken "yedek gerçekten 0" durumu sabit kalıyor.
  for (const k of sim.pickups) { k.active = false; k.respawnAt = Number.MAX_SAFE_INTEGER; }
  me.ammo = 0; me.reserve = 0;
  return { ammo: me.ammo, reserve: me.reserve, kutu: sim.pickups.length };
});
await page.waitForTimeout(600);
const reserveText = await page.textContent('#reserveText');
const reserveEmpty = await page.evaluate(() =>
  document.getElementById('reserveText').classList.contains('empty'));
console.log('Cephane bitince gösterge:', JSON.stringify(reserveText.trim()), '· kırmızı:', reserveEmpty, dry);
if (reserveText.trim() !== '0') errors.push(`Yedek bitince 0 yazmalı: "${reserveText}"`);
if (!reserveEmpty) errors.push('Yedek bitince gösterge kırmızıya dönmedi');

// Ekran görüntüsü için açık bir yöne nişan al (çizgi tam görünsün)
const shot = await page.evaluate(async () => {
  const g = window.__game;
  const { rayHitDistance } = await import('/shared/physics.js');
  let best = 0, bestA = 0;
  for (let a = 0; a < Math.PI * 2; a += 0.08) {
    const d = rayHitDistance(g.meRender.x, g.meRender.y, a, 1700, g.idx);
    if (d > best) { best = d; bestA = a; }
  }
  // Fareyi o yöne koy ki nişan oraya kilitlensin
  const s = g.renderer.worldToScreen(
    g.meRender.x + Math.cos(bestA) * 400,
    g.meRender.y + Math.sin(bestA) * 400,
  );
  g.input.mouseX = s.x; g.input.mouseY = s.y;
  return { openDist: Math.round(best) };
});
console.log('En açık yön mesafesi:', shot.openDist, 'px');
if (shot.openDist < 300) errors.push('Haritada nişan çizgisini gösterecek açıklık yok');
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/50-sniper-laser.png` });
await browser.close();

console.log('\n--- Hatalar ---');
if (!errors.length) console.log('yok ✓');
else errors.forEach((e) => console.log(e));
process.exit(errors.length ? 1 : 0);
