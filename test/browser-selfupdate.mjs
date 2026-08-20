// Uygulamanın KENDİNİ güncellemesi (APK'yı yeniden kurmadan).
//
// Native indirme işini burada çalıştıramayız — bu ortamda Android yok. Ama asıl
// kırılgan kısım native değil, KARAR MANTIĞI:
//
//   • eklenti varsa: paket indirilmeli ve kurulmalı, sayfa DIŞARI gitmemeli
//   • eklenti yoksa: eski davranışa düşülmeli (sunucudaki web sürümüne git)
//   • indirme patlarsa: kullanıcı bilgilendirilmeli, uygulama kilitlenmemeli
//   • yeni paket açılınca notifyAppReady() çağrılmalı (yoksa eklenti geri alır)
//
// Eklentinin yerine sahte bir köprü koyup bunların hepsini sınıyoruz.
//
// Çalıştır:  node test/browser-selfupdate.mjs

import { botAyarla, modSec } from './yardimci.mjs';
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const WWW = path.resolve('www');
if (!fs.existsSync(path.join(WWW, 'index.html'))) {
  console.error('www/ yok — önce: node scripts/build-www.mjs');
  process.exit(1);
}
const errors = [];
const TIP = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json',
};

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});

// APK ortamı: www/ https://localhost'tan servis ediliyor + Capacitor köprüsü.
// eklenti=false ise köprüde CapacitorUpdater yok (eski APK'yı taklit eder).
async function apk({ eklenti = true, indirmeHata = false } = {}) {
  const ctx = await browser.newContext({ ...devices['Pixel 5'] });

  await ctx.route('**://localhost/**', async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname === '/' ? '/index.html' : u.pathname;
    const dosya = path.join(WWW, p);
    if (!dosya.startsWith(WWW) || !fs.existsSync(dosya) || fs.statSync(dosya).isDirectory()) {
      await route.fulfill({ status: 404, body: '' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: TIP[path.extname(dosya)] || 'application/octet-stream',
      body: fs.readFileSync(dosya),
    });
  });

  await ctx.route('**://savas-arenasi.onrender.com/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/surum.json') {
      await route.fulfill({
        status: 200, contentType: 'application/json; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ surum: 'yenisurum9', oyun: 'savas-arenasi' }),
      });
      return;
    }
    await route.fulfill({
      status: 200, contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><title>SUNUCU SURUMU</title><h1>SUNUCU</h1>',
    });
  });

  await ctx.addInitScript(({ ek, hata }) => {
    window.__cagrilar = { download: [], set: [], ready: 0 };
    const eklentiler = {};
    if (ek) {
      eklentiler.CapacitorUpdater = {
        async download(o) {
          window.__cagrilar.download.push(o);
          if (hata) throw new Error('ağ hatası (test)');
          return { id: 'paket-' + o.version, version: o.version };
        },
        async set(v) {
          window.__cagrilar.set.push(v);
          // Gerçekte uygulama burada yeniden başlar; testte sadece kaydediyoruz.
        },
        async notifyAppReady() { window.__cagrilar.ready++; },
      };
    }
    window.Capacitor = { platform: 'android', isNativePlatform: () => true, Plugins: eklentiler };
  }, { ek: eklenti, hata: indirmeHata });

  return ctx;
}

async function ac(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`sayfa hatası: ${e.message}`));
  await page.goto('https://localhost/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#screenMenu.active', { timeout: 15000 });
  await page.waitForSelector('#updateOverlay:not(.hidden)', { timeout: 10000 })
    .catch(() => errors.push('güncelleme ekranı çıkmadı'));
  return page;
}

// ===== 1) Eklenti VAR → uygulama kendini güncellemeli ====================
{
  const ctx = await apk();
  const page = await ac(ctx);

  const hazir = await page.evaluate(() => window.__cagrilar.ready);
  console.log('1) notifyAppReady çağrıldı mı:', hazir > 0 ? '✓' : '✗');
  if (!hazir) errors.push('notifyAppReady() çağrılmıyor — eklenti güncellemeyi geri alır');

  await page.click('#btnGetUpdate');
  await page.waitForFunction(() => window.__cagrilar.set.length > 0, { timeout: 8000 })
    .catch(() => errors.push('set() çağrılmadı — paket kurulmadı'));

  const c = await page.evaluate(() => ({
    ...window.__cagrilar,
    url: location.href,
    yazi: (document.getElementById('updateText').textContent || '').trim(),
  }));
  console.log('   download:', JSON.stringify(c.download));
  console.log('   set:', JSON.stringify(c.set), '· adres:', c.url);
  if (c.download.length !== 1) errors.push(`download() bir kez çağrılmalı, ${c.download.length} kez çağrıldı`);
  if (!/paket\.zip/.test(c.download[0]?.url || '')) errors.push(`yanlış paket adresi: ${c.download[0]?.url}`);
  if (!/onrender\.com/.test(c.download[0]?.url || '')) errors.push('paket bulut sunucudan indirilmiyor');
  if (c.download[0]?.version !== 'yenisurum9') errors.push('paket sürümü yanlış geçiliyor');
  if (c.set.length !== 1) errors.push('indirilen paket kurulmadı (set çağrılmadı)');
  if (!/^https:\/\/localhost\//.test(c.url)) {
    errors.push(`eklenti varken sayfa dışarı gitti: ${c.url} — kendi kendini güncellemeliydi`);
  }
  await ctx.close();
}

// ===== 2) Eklenti YOK → eski davranış (sunucudaki sürüme git) ============
{
  const ctx = await apk({ eklenti: false });
  const page = await ac(ctx);
  await Promise.all([
    page.waitForURL(/onrender\.com/, { timeout: 12000 })
      .catch(() => errors.push('eklenti yokken sunucuya geçilmedi')),
    page.click('#btnGetUpdate'),
  ]);
  console.log('2) eklentisiz →', page.url());
  await ctx.close();
}

// ===== 3) İndirme patlarsa uygulama kilitlenmemeli =======================
{
  const ctx = await apk({ indirmeHata: true });
  const page = await ac(ctx);
  await page.click('#btnGetUpdate');
  await page.waitForTimeout(2000);
  const d = await page.evaluate(() => ({
    url: location.href,
    set: window.__cagrilar.set.length,
    yazi: (document.getElementById('updateText').textContent || '').trim(),
    dugmeAcik: !document.getElementById('btnGetUpdate').disabled,
    menu: document.getElementById('screenMenu').classList.contains('active'),
  }));
  console.log('3) indirme hatası →', JSON.stringify(d));
  if (d.set !== 0) errors.push('indirme patladığı hâlde paket kurulmaya çalışıldı');
  if (!/^https:\/\/localhost\//.test(d.url)) errors.push('hata sonrası uygulama kendi sayfasından ayrıldı');
  if (!/tekrar dene/i.test(d.yazi)) errors.push(`kullanıcıya anlaşılır hata verilmedi: "${d.yazi}"`);
  if (!d.dugmeAcik) errors.push('hata sonrası GÜNCELLE düğmesi kilitli kaldı');
  if (!d.menu) errors.push('hata sonrası menü kayboldu');

  // Ve oyun hâlâ oynanabilmeli
  await page.click('#btnSkipUpdate');
  await page.waitForTimeout(300);
  await page.click('#btnCreate');
  await page.waitForSelector('#screenLobby.active', { timeout: 8000 });
  await modSec(page, 0);
  await botAyarla(page, 2);
  await page.click('#btnReady');
  await page.waitForSelector('#screenGame.active', { timeout: 25000 })
    .catch(() => errors.push('güncelleme hatasından sonra maç başlamadı'));
  console.log('   hata sonrası maç başladı ✓');
  await ctx.close();
}

await browser.close();

// ===== 4) Sunucu paketi gerçekten veriyor mu? ============================
// (Ayrı bir süreç: statik sunucu zaten çalışıyor.)
{
  const BASE = process.env.BASE || 'http://localhost:3000';
  try {
    const r = await fetch(`${BASE}/paket.zip`);
    const buf = Buffer.from(await r.arrayBuffer());
    const zipMi = buf[0] === 0x50 && buf[1] === 0x4b;      // "PK"
    console.log('4) /paket.zip →', r.status, `${(buf.length / 1024).toFixed(0)} KB`, zipMi ? 'geçerli zip ✓' : 'ZIP DEĞİL ✗');
    if (!r.ok) errors.push(`/paket.zip sunulmuyor (${r.status})`);
    if (!zipMi) errors.push('/paket.zip geçerli bir zip değil');
    if (buf.length < 50000) errors.push(`/paket.zip fazla küçük (${buf.length} bayt)`);
    if (r.headers.get('access-control-allow-origin') !== '*') {
      errors.push('/paket.zip CORS başlığı yok — uygulama indiremez');
    }
  } catch (e) {
    errors.push(`/paket.zip istenemedi: ${e.message}`);
  }
}

if (errors.length) {
  console.log('\nHATALAR:');
  for (const e of errors) console.log(' ', e);
}
console.log(errors.length ? '\nKENDİNİ GÜNCELLEME TESTİ BAŞARISIZ ✗' : '\nKENDİNİ GÜNCELLEME TESTİ GEÇTİ ✓');
process.exit(errors.length ? 1 : 0);
