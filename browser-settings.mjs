// Paketlenmiş sürüm testi (APK'nın içindeki hali):
// www/ klasörü tek başına servis edilir, hiçbir oyun sunucusu çalışmaz.
// Uygulama açılışta doğrudan çevrimdışı moda girmeli ve maç oynanabilmeli.
//
// Çalıştır:  node test/browser-bundle.mjs      (varsayılan: http://localhost:3100)

import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BUNDLE_BASE || 'http://localhost:3100';
const OUT = '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
const errors = [];

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});

const ctx = await browser.newContext({
  ...devices['Pixel 7'],
  viewport: { width: 880, height: 400 },
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`[paket] ${e.message}\n${e.stack || ''}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !/WebSocket|ERR_INTERNET|Failed to load resource/i.test(m.text())) {
    errors.push(`[paket] ${m.text()}`);
  }
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

const boot = await page.evaluate(() => ({
  bundled: !!window.__BUNDLED__,
  mode: window.__net?.mode,
  status: document.getElementById('connStatus')?.textContent?.trim(),
  offlinePanelVisible: !document.getElementById('offlinePanel')?.classList.contains('hidden'),
}));
console.log('Açılış:', boot);
if (!boot.bundled) errors.push('Paket işareti yok');
if (boot.mode !== 'local') errors.push(`Paketlenmiş sürüm çevrimdışı başlamadı (mod: ${boot.mode})`);
if (!boot.offlinePanelVisible) errors.push('Çevrimdışı bilgi paneli görünmüyor');

// Ağı tamamen kes — APK'da zaten sunucu yok
await ctx.setOffline(true);

await page.locator('#modePicker .mode-card').nth(1).click();     // Takım Savaşı
await page.evaluate(() => {
  const b = document.getElementById('botCountInput');
  b.value = 9; b.dispatchEvent(new Event('input'));
});
await page.click('#btnCreate');
await page.waitForSelector('#screenLobby.active', { timeout: 8000 });
await page.click('#btnReady');       // herkes hazır olunca geri sayım başlar
await page.waitForSelector('#screenGame.active', { timeout: 25000 });
await page.waitForTimeout(2500);

const st = await page.evaluate(() => {
  const g = window.__game;
  return {
    running: g.running,
    mode: g.mode?.id,
    teams: g.teams,
    myTeam: g.myTeam,
    rosterSize: g.roster.size,
    snaps: g.snaps.length,
    t: Math.round(g.snaps.at(-1)?.t || 0),
    touchUi: !document.getElementById('touchUI').classList.contains('hidden'),
  };
});
console.log('Paketlenmiş maç:', st);
if (!st.running) errors.push('Maç çalışmıyor');
if (st.mode !== 'tdm') errors.push('Takım Savaşı başlamadı');
if (st.rosterSize !== 10) errors.push(`10 birim bekleniyordu, ${st.rosterSize} var`);
if (st.t < 1500) errors.push('Simülasyon ilerlemiyor');
if (!st.touchUi) errors.push('Dokunmatik kumanda görünmüyor');

await page.screenshot({ path: `${OUT}/30-bundle-game.png` });

// Manifest ve ikonlar erişilebilir mi (kurulabilirlik için gerekli)
await ctx.setOffline(false);
const manifest = await page.evaluate(async () => {
  const r = await fetch('/manifest.webmanifest');
  if (!r.ok) return null;
  const j = await r.json();
  return { name: j.name, icons: j.icons.length, display: j.display, orientation: j.orientation };
});
console.log('Manifest:', manifest);
if (!manifest) errors.push('manifest.webmanifest okunamadı');
else if (manifest.icons < 4) errors.push('Manifest ikonları eksik');

await browser.close();

console.log('\n--- Hatalar ---');
if (!errors.length) console.log('yok ✓');
else errors.forEach((e) => console.log(e));
process.exit(errors.length ? 1 : 0);
