// "Nişanla, bırakınca ateşle" testi (dokunmatik):
//   • Pompalı / keskin tüfek: çubuk basılıyken ateş ETMEMELİ
//   • Parmağı kaldırınca tam bir atış yapmalı
//   • Tüfek / makineli: basılı tuttukça ateş etmeli
// Çalıştır:  node test/browser-aimfire.mjs

import { chromium, devices } from 'playwright';
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

// Sanal çubuğu dokunma olaylarıyla sürükleyip bırakan yardımcılar
const AIM_HOLD = `(() => {
  const el = document.getElementById('stickAim');
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const fire = (type, x, y) => el.dispatchEvent(new TouchEvent(type, {
    bubbles: true, cancelable: true,
    changedTouches: [new Touch({ identifier: 7, target: el, clientX: x, clientY: y })],
    touches: [new Touch({ identifier: 7, target: el, clientX: x, clientY: y })],
  }));
  fire('touchstart', cx, cy);
  fire('touchmove', cx + 45, cy);
  window.__aimRelease = () => fire('touchend', cx + 45, cy);
})()`;

async function testWeapon(classIndex, name, expectAuto) {
  const ctx = await browser.newContext({
    ...devices['Pixel 7'], viewport: { width: 900, height: 420 }, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.click('#tabLocal');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const b = document.getElementById('botCountInput');
    b.value = 2; b.dispatchEvent(new Event('input'));
  });
  await page.click('#btnCreate');
  await page.waitForSelector('#screenLobby.active');
  await page.locator('#classPicker .class-card').nth(classIndex).click();
  await page.waitForTimeout(300);
  await page.click('#btnReady');       // herkes hazır olunca geri sayım başlar
  await page.waitForSelector('#screenGame.active', { timeout: 25000 });
  await page.waitForTimeout(1800);

  const ammo0 = await page.evaluate(() => window.__game.you.am);

  // Çubuğu bastır ve 1,2 saniye tut
  await page.evaluate(AIM_HOLD);
  await page.waitForTimeout(1200);
  const ammoHeld = await page.evaluate(() => window.__game.you.am);

  const aimingClass = await page.evaluate(() =>
    document.getElementById('stickAim').classList.contains('aiming'));

  // Parmağı kaldır
  await page.evaluate(() => window.__aimRelease && window.__aimRelease());
  await page.waitForTimeout(700);
  const ammoAfter = await page.evaluate(() => window.__game.you.am);

  console.log(`${name}: başlangıç ${ammo0} · basılıyken ${ammoHeld} · bırakınca ${ammoAfter} · nişan vurgusu ${aimingClass}`);

  if (expectAuto) {
    if (ammoHeld >= ammo0) errors.push(`${name}: otomatik silah basılıyken ateş etmedi`);
    if (aimingClass) errors.push(`${name}: otomatik silahta nişan modu açılmamalı`);
  } else {
    if (ammoHeld !== ammo0) errors.push(`${name}: çubuk basılıyken ateş etti (${ammo0} → ${ammoHeld})`);
    if (!aimingClass) errors.push(`${name}: nişan vurgusu görünmedi`);
    if (ammoAfter !== ammoHeld - 1) {
      errors.push(`${name}: bırakınca tam 1 atış olmalıydı (${ammoHeld} → ${ammoAfter})`);
    }
  }

  if (!expectAuto) await page.screenshot({ path: `${OUT}/60-aim-${name}.png` });
  await ctx.close();
}

// Sınıf sırası: 0 Komando(tüfek/oto) · 1 Akıncı(pompalı) · 2 Nişancı(keskin) · 3 Ağır(makineli/oto)
await testWeapon(1, 'pompali', false);
await testWeapon(2, 'keskin', false);
await testWeapon(0, 'tufek', true);

await browser.close();

console.log('\n--- Hatalar ---');
if (!errors.length) console.log('yok ✓');
else errors.forEach((e) => console.log(e));
process.exit(errors.length ? 1 : 0);
