// Kamera yüksekliği (yakınlaştırma) ÖNİZLEMESİ.
//
// Şikâyet: "mobilde bombanın nereye gittiğini göremiyorum."
// Sebep: telefonda yakınlaştırma tabanı 0.62'de sabit; bombanın azami menzili
// 675 dünya pikseli, bu da ekranın kenarına denk geliyor. Kamera biraz
// yükselirse (yakınlaştırma düşerse) düşeceği yer rahat görünüyor.
//
// Bu betik aynı sahneyi KADEME KADEME farklı yükseklikte fotoğraflıyor:
// bombacı elinde bomba, menzil tam dolu, hedef halkası ekranda.
//
// Çalıştır:  node scripts/onizleme-kamera.mjs
// Çıktı:     dist/onizleme/kamera-*.png

import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = 'dist/onizleme';
fs.mkdirSync(OUT, { recursive: true });

// Kademeler: şu anki 0.62'den başlayıp yavaşça uzaklaşıyoruz.
const KADEMELER = [0.62, 0.56, 0.50, 0.44, 0.38];

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});

const ctx = await browser.newContext({
  ...devices['Pixel 5'],
  viewport: { width: 900, height: 420 },
  isMobile: true, hasTouch: true, deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#screenMenu.active', { timeout: 15000 });
await page.click('#tabLocal');
await page.waitForTimeout(300);
await page.fill('#nameInput', 'Nuri');
await page.dispatchEvent('#nameInput', 'change');
await page.click('#btnCreate');
await page.waitForSelector('#screenLobby.active', { timeout: 8000 });
await page.evaluate(() => {
  const b = document.getElementById('lobbyBotInput');
  b.value = '2';
  b.dispatchEvent(new Event('input', { bubbles: true }));
  b.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(600);
// Bombacıyı seç
await page.evaluate(() => {
  const k = [...document.querySelectorAll('#classPicker .class-card')];
  const i = k.findIndex((x) => /bombac/i.test(x.textContent || ''));
  if (i >= 0) k[i].click();
});
await page.waitForTimeout(400);
await page.click('#btnReady');
await page.waitForSelector('#screenGame.active', { timeout: 30000 });
await page.waitForTimeout(2000);

// Açık bir koridora taşı ki hedef halkası duvara takılmasın
const yer = await page.evaluate(() => {
  const g = window.__game;
  const sim = [...window.__net.impl.hub.lobbies.values()][0].game;
  const me = sim.players.get(window.__net.impl.client.id);
  const map = sim.map;
  const bos = (x, y) => map.obstacles.every((o) =>
    !(x > o.x - 60 && x < o.x + o.w + 60 && y > o.y - 60 && y < o.y + o.h + 60));
  for (let i = 0; i < 6000; i++) {
    const x = 200 + Math.random() * (map.w - 1200);
    const y = 200 + Math.random() * (map.h - 400);
    let ok = true;
    for (let d = 0; d <= 760; d += 40) {
      if (!bos(x + d, y - 60) || !bos(x + d, y) || !bos(x + d, y + 60)) { ok = false; break; }
    }
    if (!ok) continue;
    me.x = x; me.y = y;
    g.me.x = x; g.me.y = y;
    g.meRender.x = x; g.meRender.y = y;
    return { x: Math.round(x), y: Math.round(y) };
  }
  return null;
});
console.log('açık koridor:', JSON.stringify(yer));

for (const z of KADEMELER) {
  await page.evaluate((zoom) => {
    const g = window.__game;
    // Kamerayı sabitle: menzil tam dolu, sağa nişan.
    g.renderer.zoom = zoom;
    g.aim = 0;
    g.charge = 1;
    g.aiming = true;
  }, z);
  await page.waitForTimeout(450);
  const ad = `kamera-${String(Math.round(z * 100)).padStart(3, '0')}.png`;
  await page.screenshot({ path: path.join(OUT, ad) });
  console.log(`yakınlaştırma ${z.toFixed(2)} → ${ad}`);
}

await ctx.close();
await browser.close();
console.log(`Konum: ${OUT}`);
