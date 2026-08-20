// Girdi modu testi: dokunmatik arayüz ne zaman açılmalı?
//
// Yaşanan sorun: dokunmatik ekranlı bir Windows dizüstüde oyun telefon
// arayüzüne (sanal çubuklar) düşüyordu — "babamın bilgisayarı android gibi
// oldu". Sebep, kodun "cihazda dokunmatik VAR mı" diye sorması; oysa doğru
// soru "şu an hangi girdi KULLANILIYOR".
//
// Üç durumu sınıyoruz:
//   1) Klasik masaüstü (fare var, dokunmatik yok)     → masaüstü arayüzü
//   2) Dokunmatik ekranlı dizüstü (fare VE dokunmatik) → masaüstü arayüzü
//   3) Telefon (fare yok, dokunmatik var)              → dokunmatik arayüz
//   4) Dizüstüde kullanıcı ekrana dokunursa           → dokunmatik arayüze geç
//      sonra fareyi oynatırsa                          → masaüstüne geri dön
//
// Çalıştır:  node test/browser-inputmode.mjs

import { botAyarla, modSec } from './yardimci.mjs';
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve('dist/savas-arenasi.html');
if (!fs.existsSync(FILE)) {
  console.error('dist/savas-arenasi.html yok — önce: node scripts/build-single.mjs');
  process.exit(1);
}
const URL_ = 'file://' + FILE;
const errors = [];

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});

async function startMatch(page) {
  await page.click('#btnCreate');
  await page.waitForSelector('#screenLobby.active', { timeout: 8000 });
  await modSec(page, 0);
  await botAyarla(page, 3);
  await page.click('#btnReady');
  await page.waitForSelector('#screenGame.active', { timeout: 25000 });
  await page.waitForTimeout(800);
}

const readMode = (page) => page.evaluate(() => ({
  touchClass: document.body.classList.contains('touch'),
  uiHidden: document.getElementById('touchUI').classList.contains('hidden'),
  maxTouchPoints: navigator.maxTouchPoints,
  finePointer: window.matchMedia('(pointer: fine)').matches,
}));

// ===== 1) Klasik masaüstü ================================================
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[masaüstü] ${e.message}`));
  await page.goto(URL_);
  await page.waitForSelector('#screenMenu.active', { timeout: 10000 });
  await page.fill('#nameInput', 'Masaüstü');
  await page.dispatchEvent('#nameInput', 'change');
  await startMatch(page);
  const m = await readMode(page);
  console.log('1) masaüstü:', JSON.stringify(m));
  if (m.touchClass || !m.uiHidden) errors.push('klasik masaüstünde dokunmatik arayüz açıldı');
  await ctx.close();
}

// ===== 2) Dokunmatik ekranlı dizüstü (asıl hata) =========================
{
  // Fare VAR (pointer: fine) ama dokunmatik de var — Windows dizüstülerin hâli
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    hasTouch: true,
    isMobile: false,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[dizüstü] ${e.message}`));

  // Playwright "dokunmatik var" dediğinde işaretçiyi de kaba (coarse) yapıyor;
  // gerçek bir dokunmatik dizüstüde ise fare olduğu için (pointer: fine) DOĞRU
  // döner. Playwright'ın taklit edemediği bu bileşimi burada elle kuruyoruz —
  // testin taklit ettiği donanım tam olarak babanın bilgisayarı.
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) => {
      if (q === '(pointer: fine)' || q === '(any-pointer: fine)') return { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
      return real(q);
    };
  });

  await page.goto(URL_);
  await page.waitForSelector('#screenMenu.active', { timeout: 10000 });
  await page.fill('#nameInput', 'Baba');
  await page.dispatchEvent('#nameInput', 'change');
  await startMatch(page);

  const m = await readMode(page);
  console.log('2) dokunmatik dizüstü:', JSON.stringify(m));
  if (m.maxTouchPoints === 0) errors.push('test kurulumu yanlış: dokunmatik taklit edilmedi');
  if (m.touchClass || !m.uiHidden) {
    errors.push('dokunmatik ekranlı dizüstüde telefon arayüzüne düştü — asıl hata bu');
  }

  // Klavye gerçekten çalışıyor mu?
  const b1 = await page.evaluate(() => {
    const g = window.__game; return { x: g.me.x, y: g.me.y };
  });
  await page.keyboard.down('d');
  await page.waitForTimeout(700);
  await page.keyboard.up('d');
  const b2 = await page.evaluate(() => {
    const g = window.__game; return { x: g.me.x, y: g.me.y };
  });
  const moved = Math.hypot(b2.x - b1.x, b2.y - b1.y);
  console.log('   klavyeyle yürüdü:', Math.round(moved), 'px', moved > 30 ? '✓' : '✗');
  if (moved <= 30) errors.push('dizüstünde klavyeyle hareket etmiyor');

  // --- ekrana dokunursa dokunmatik arayüze geçmeli ---
  await page.touchscreen.tap(700, 500);
  await page.waitForTimeout(300);
  const afterTouch = await readMode(page);
  console.log('   ekrana dokununca:', afterTouch.touchClass ? 'dokunmatik ✓' : 'değişmedi ✗');
  if (!afterTouch.touchClass) errors.push('dizüstünde ekrana dokununca dokunmatik arayüze geçmiyor');

  // --- fareyi oynatınca geri masaüstüne dönmeli ---
  await page.waitForTimeout(900);           // dokunma sonrası sahte olay penceresi geçsin
  await page.mouse.move(400, 300);
  await page.mouse.move(520, 380);
  await page.waitForTimeout(300);
  const afterMouse = await readMode(page);
  console.log('   fareyi oynatınca:', !afterMouse.touchClass ? 'masaüstü ✓' : 'dokunmatik kaldı ✗');
  if (afterMouse.touchClass) errors.push('fare kullanılınca masaüstü arayüzüne dönmüyor');

  await ctx.close();
}

// ===== 3) Telefon ========================================================
{
  const ctx = await browser.newContext({ ...devices['Pixel 5'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[telefon] ${e.message}`));
  await page.goto(URL_);
  await page.waitForSelector('#screenMenu.active', { timeout: 10000 });
  await page.fill('#nameInput', 'Cep');
  await page.dispatchEvent('#nameInput', 'change');
  await startMatch(page);
  const m = await readMode(page);
  console.log('3) telefon:', JSON.stringify(m));
  if (!m.touchClass || m.uiHidden) errors.push('telefonda dokunmatik arayüz açılmadı');

  // Dokunup bıraktıktan sonra sahte fare olayları yüzünden masaüstüne
  // KAÇMAMALI — telefonda en can sıkıcı hata bu olurdu.
  await page.touchscreen.tap(360, 500);
  await page.waitForTimeout(1200);
  const after = await readMode(page);
  console.log('   dokunma sonrası:', after.touchClass ? 'dokunmatik kaldı ✓' : 'masaüstüne kaçtı ✗');
  if (!after.touchClass) errors.push('telefonda dokunma sonrası masaüstü arayüzüne kaçıyor');
  await ctx.close();
}

await browser.close();

if (errors.length) {
  console.log('\nHATALAR:');
  for (const e of errors) console.log(' ', e);
}
console.log(errors.length ? '\nGİRDİ MODU TESTİ BAŞARISIZ ✗' : '\nGİRDİ MODU TESTİ GEÇTİ ✓');
process.exit(errors.length ? 1 : 0);
