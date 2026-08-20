// Uykudan uyanan sunucu (soğuk açılış) testi.
//
// Gerçek olay: Render'ın ücretsiz planında servis 15 dk boştaysa uyur. Uyanma
// anına denk gelen ilk istek yarım döner — HTML gelir ama /css/style.css yerine
// sunucunun kendi hata sayfası gelir. Tarayıcı onu stil olarak kabul etmez ve
// oyun biçimsiz bir metin yığınına dönüşür (kullanıcı tam bunu yaşadı).
//
// Burada o durumu birebir taklit ediyoruz: ilk N istekte CSS'i 503 ile
// çeviren küçük bir vekil sunucu kuruyoruz ve açılış bekçisinin sayfayı
// kendiliğinden düzeltip düzeltmediğine bakıyoruz.
//
// Çalıştır:  node test/browser-coldstart.mjs

import http from 'node:http';
import { chromium } from 'playwright';
import fs from 'node:fs';
import { serveStatic } from '../server/static.js';

const errors = [];
let cssFails = 2;          // ilk 2 CSS isteği "uykuda" davranır
let cssRequests = 0;

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/css/style.css')) {
    cssRequests++;
    if (cssFails > 0) {
      cssFails--;
      // Render'ın uyanma sırasında döndürdüğüne benzer bir HTML hata sayfası
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body>Service is waking up</body></html>');
      return;
    }
  }
  serveStatic(req, res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});

// ===== 1) Soğuk açılış: kendiliğinden toparlıyor mu? =====================
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });

  // İlk hâlde stil YOK — bozuk sayfa
  const broken = await page.evaluate(() => {
    const p = document.createElement('div');
    p.className = 'hidden';
    document.body.appendChild(p);
    const ok = getComputedStyle(p).display === 'none';
    p.remove();
    return !ok;
  });
  console.log('ilk yükleme biçimsiz mi (beklenen: evet):', broken ? 'evet ✓' : 'hayır ✗');
  if (!broken) errors.push('taklit edilen soğuk açılış sayfayı bozmadı — test anlamsız');

  // "Sunucu uyanıyor…" perdesi çıkmalı
  await page.waitForSelector('#bootMsg.show', { timeout: 9000 })
    .catch(() => errors.push('uyarı perdesi hiç görünmedi'));
  const msg = await page.textContent('#bootMsg');
  console.log('perde metni:', msg.replace(/\s+/g, ' ').trim().slice(0, 60) + '…');

  // Sayfa kendiliğinden tazelenip düzelmeli
  await page.waitForFunction(() => {
    const p = document.createElement('div');
    p.className = 'hidden';
    document.body.appendChild(p);
    const ok = getComputedStyle(p).display === 'none';
    p.remove();
    return ok && window.__bootOk === true;
  }, null, { timeout: 25000 }).catch(() => errors.push('sayfa kendiliğinden düzelmedi'));

  // Bekçi sağlıklı olduğunu anlayınca sayacı temizler — ona kadar bekle.
  await page.waitForFunction(() => {
    try { return sessionStorage.getItem('sa_boot_retry') === null; } catch { return true; }
  }, null, { timeout: 8000 }).catch(() => { /* aşağıdaki kontrol yakalar */ });

  const fixed = await page.evaluate(() => ({
    hidden: document.getElementById('bootMsg').classList.contains('show'),
    menu: document.getElementById('screenMenu').classList.contains('active'),
    retry: (() => { try { return sessionStorage.getItem('sa_boot_retry'); } catch { return 'yok'; } })(),
  }));
  console.log(`CSS isteği sayısı: ${cssRequests} · menü aktif: ${fixed.menu ? '✓' : '✗'} · perde kapandı: ${!fixed.hidden ? '✓' : '✗'}`);
  if (!fixed.menu) errors.push('tazeleme sonrası menü açılmadı');
  if (fixed.retry !== null) errors.push(`deneme sayacı temizlenmedi (${fixed.retry})`);
  await ctx.close();
}

// ===== 2) Sunucu hep bozuksa sonsuz döngüye girmemeli ===================
{
  cssFails = 999;
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  let loads = 0;
  page.on('load', () => { loads++; });
  await page.goto(BASE, { waitUntil: 'load' });

  await page.waitForSelector('#bootRetry:visible', { timeout: 45000 })
    .catch(() => errors.push('vazgeçme mesajı ve düğmesi çıkmadı'));
  const txt = await page.textContent('#bootText');
  console.log(`kalıcı hata: ${loads} yükleme sonra pes etti ✓`);
  console.log('mesaj:', txt.replace(/\s+/g, ' ').trim().slice(0, 70) + '…');
  if (loads > 6) errors.push(`sonsuz tazeleme döngüsü riski: ${loads} yükleme`);

  await page.waitForTimeout(6000);
  console.log('6 sn daha bekledikten sonra yükleme sayısı:', loads);
  if (loads > 6) errors.push('pes ettikten sonra da tazelemeye devam ediyor');
  await ctx.close();
}

// ===== 3) Sağlıklı sunucuda perde hiç görünmemeli ========================
{
  cssFails = 0;
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(6000);
  const shown = await page.evaluate(() => document.getElementById('bootMsg').classList.contains('show'));
  console.log('sağlıklı açılışta perde:', shown ? 'GÖRÜNDÜ ✗' : 'görünmedi ✓');
  if (shown) errors.push('sorun yokken uyarı perdesi çıkıyor');
  await ctx.close();
}

await browser.close();
server.close();

if (errors.length) {
  console.log('\nHATALAR:');
  for (const e of errors) console.log(' ', e);
}
console.log(errors.length ? '\nSOĞUK AÇILIŞ TESTİ BAŞARISIZ ✗' : '\nSOĞUK AÇILIŞ TESTİ GEÇTİ ✓');
process.exit(errors.length ? 1 : 0);
