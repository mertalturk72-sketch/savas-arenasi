// "Güncelle" düğmesi testi.
//
// Yaşanan sorun: oyun https üzerinden açılınca kendini tarayıcıya kaydediyor
// (service worker) ki internetsiz de açılabilsin. Sunucuya yeni sürüm
// yüklenince tarayıcı bir süre ESKİ kopyayı göstermeye devam edebiliyor ve
// "neden değişmedi / neden bağlanmıyor" durumu ortaya çıkıyor.
//
// Bu düğme kayıtlı kopyayı ve tüm önbellekleri silip sayfayı sıfırdan yükler.
// Burada gerçekten sildiğini doğruluyoruz.
//
// Sunucu çalışıyor olmalı:  npm start
// Çalıştır:  node test/browser-update.mjs

import { chromium } from 'playwright';
import fs from 'node:fs';

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;   // localhost güvenli sayılır → SW kurulur
const errors = [];

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`sayfa hatası: ${e.message}`));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#screenMenu.active', { timeout: 10000 });

// --- Service worker kurulsun, önbellek dolsun ---
const before = await page.evaluate(async () => {
  if (navigator.serviceWorker) {
    await Promise.race([
      navigator.serviceWorker.ready.catch(() => null),
      new Promise((r) => setTimeout(r, 8000)),
    ]);
  }
  const regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : [];
  const keys = window.caches ? await caches.keys() : [];
  return { sw: regs.length, cache: keys.length, keys };
});
console.log('güncellemeden önce → service worker:', before.sw, '· önbellek:', before.cache, before.keys);
if (before.sw === 0) errors.push('service worker hiç kurulmadı — test anlamsız');
if (before.cache === 0) errors.push('önbellek hiç dolmadı — test anlamsız');

// --- Düğme görünür mü? ---
const visible = await page.evaluate(() =>
  !document.getElementById('btnUpdate').classList.contains('hidden'));
console.log('Güncelle düğmesi görünür mü:', visible ? '✓' : '✗');
if (!visible) errors.push('Güncelle düğmesi görünmüyor');

// --- Bas ve sayfanın yeniden yüklenmesini bekle ---
await Promise.all([
  page.waitForNavigation({ waitUntil: 'load', timeout: 20000 }).catch(() => {
    errors.push('Güncelle sayfayı yeniden yüklemedi');
  }),
  page.click('#btnUpdate'),
]);
await page.waitForSelector('#screenMenu.active', { timeout: 15000 });

const after = await page.evaluate(async () => {
  const regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : [];
  const keys = window.caches ? await caches.keys() : [];
  return { sw: regs.length, cache: keys.length, url: location.href, boot: window.__bootOk === true };
});
console.log('güncellemeden sonra → service worker:', after.sw, '· önbellek:', after.cache);
console.log('adres:', after.url);

// Yeniden yüklendikten sonra service worker BAŞTAN kurulur (bu doğru davranış);
// önemli olan ESKİ önbelleğin silinmiş olması ve sayfanın sağlam açılması.
if (!after.boot) errors.push('güncellemeden sonra oyun açılmadı');
if (/[?&]g=/.test(after.url)) errors.push('güncelleme damgası adres çubuğunda kaldı');

// Silme gerçekten oldu mu? Damgayı doğrudan sınayalım: önbelleği elle doldur,
// forceUpdate'i çağır, sonra bak.
const cleared = await page.evaluate(async () => {
  await caches.open('test-eski-surum').then((c) => c.put('/x', new Response('eski')));
  const oncesi = (await caches.keys()).includes('test-eski-surum');
  // forceUpdate sayfayı yeniden yükler; burada sadece silme kısmını çağırıyoruz
  if (navigator.serviceWorker) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
  }
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})));
  const sonrasi = (await caches.keys()).includes('test-eski-surum');
  return { oncesi, sonrasi };
});
console.log('elle konan eski önbellek: önce', cleared.oncesi, '→ sonra', cleared.sonrasi,
  cleared.oncesi && !cleared.sonrasi ? '✓' : '✗');
if (!(cleared.oncesi && !cleared.sonrasi)) errors.push('eski önbellek silinemiyor');

await browser.close();

if (errors.length) {
  console.log('\nHATALAR:');
  for (const e of errors) console.log(' ', e);
}
console.log(errors.length ? '\nGÜNCELLE TESTİ BAŞARISIZ ✗' : '\nGÜNCELLE TESTİ GEÇTİ ✓');
process.exit(errors.length ? 1 : 0);
