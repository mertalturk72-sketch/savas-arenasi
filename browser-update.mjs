// GERÇEK APK ortamı testi.
//
// Neden ayrı bir test: elimizdeki APK testleri APK'yı tam olarak taklit
// etmiyordu. Capacitor uygulamanın dosyalarını `https://localhost` üzerinden
// verir; yani sayfa "güvenli bir sunucudan geliyor" gibi görünür ama arkasında
// oyun sunucusu YOKTUR. Bu farktan iki gerçek hata doğdu ve ikisi de
// kullanıcının telefonunda "localhost adresine ulaşılamıyor" olarak çıktı:
//
//   1) Açılışta "GÜNCELLE" tercihi hatırlanıyorsa uygulama, sunucuya
//      ULAŞILABİLDİĞİNİ DOĞRULAMADAN kendi sayfasının üstüne yazıyordu.
//      Sunucu uykudaysa/adres bozuksa geriye tarayıcının hata sayfası kalıyor
//      ve dönüş yolu olmuyordu — uygulama tamamen kullanılamaz hâle geliyordu.
//   2) Eski bir sürümden kalan "localhost" sunucu adresi kayıtlıysa Online'a
//      basınca uygulama kendi kendine bağlanmaya çalışıyordu. Webview verisi
//      APK güncellenince silinmediği için bu kayıt telefonda kalıcıydı.
//
// Ayrıca: APK'da service worker'ın hiç kaydolmaması gerekir. `https://localhost`
// güvenli kaynak sayıldığı için kaydoluyordu ve yeni APK kurulduğunda ilk
// açılışta ESKİ sürümün önbellekten gelen dosyaları çalışıyordu.
//
// Çalıştır:  node test/browser-apk-real.mjs

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

// Capacitor'ün yaptığı işin aynısı: www/ klasörünü https://localhost'tan ver
// ve Capacitor köprüsünü sayfaya enjekte et.
async function apkBaglami({ sunucuVar = true, sunucuUyuyor = false, depo = {}, disariAcilir = false } = {}) {
  const ctx = await browser.newContext({ ...devices['Pixel 5'] });

  await ctx.route('**://localhost/**', async (route) => {
    const u = new URL(route.request().url());
    let p = u.pathname === '/' ? '/index.html' : u.pathname;
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
    if (!sunucuVar) { await route.abort('connectionrefused'); return; }
    if (sunucuUyuyor) { await new Promise((r) => setTimeout(r, 30000)); await route.abort('timedout'); return; }
    const u = new URL(route.request().url());
    if (u.pathname === '/surum.json') {
      await route.fulfill({
        status: 200, contentType: 'application/json; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ surum: 'sunucusurumu', oyun: 'savas-arenasi' }),
      });
      return;
    }
    // Android'in "bu adres uygulamanın dışında, Chrome'da açayım" davranışını
    // taklit ediyoruz: sayfa yönlendirmesi hiç gerçekleşmiyor, uygulama kendi
    // sayfasında kalıyor. (Sürüm sorgusu yine çalışıyor; sadece SAYFA açılmıyor.)
    if (disariAcilir) { await route.abort('aborted'); return; }
    await route.fulfill({
      status: 200, contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><title>SUNUCU SURUMU</title><h1 id="s">SUNUCU</h1>',
    });
  });

  // Capacitor köprüsü + varsa "kirli" localStorage (eski sürümden kalma)
  await ctx.addInitScript((d) => {
    window.Capacitor = { platform: 'android', isNativePlatform: () => true };
    try { for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v); } catch { /* yok say */ }
  }, depo);

  return ctx;
}

async function menuyuAc(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`sayfa hatası: ${e.message}`));
  // 'load' beklemiyoruz: güncelleme yönlendirmesi ağ katmanında iptal
  // edildiğinde (Android'in adresi dışarıda açması senaryosu) yükleme olayı
  // hiç tamamlanmıyor ve goto zaman aşımına düşüyordu.
  await page.goto('https://localhost/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#screenMenu.active', { timeout: 15000 });
  // Çevrimdışı motor dinamik import ile yükleniyor; mod birkaç yüz ms sonra
  // oturuyor. Ölçmeden önce oturmasını bekle.
  await page.waitForFunction(() => window.__net && window.__net.mode, { timeout: 10000 })
    .catch(() => {});
  return page;
}

// Güncelleme penceresi çıkarsa kapat (menüyü kapatıyor, kasıtlı).
async function guncellemeyiKapat(page) {
  const acik = await page.locator('#updateOverlay:not(.hidden)').waitFor({ timeout: 6000 })
    .then(() => true).catch(() => false);
  if (!acik) return;
  await page.click('#btnSkipUpdate');
  await page.waitForSelector('#updateOverlay', { state: 'hidden', timeout: 3000 }).catch(() => {});
}

// ===== 1) Temiz kurulum ==================================================
{
  const ctx = await apkBaglami();
  const page = await menuyuAc(ctx);

  const d = await page.evaluate(() => ({
    bundled: !!window.__BUNDLED__,
    capacitor: !!window.Capacitor,
    proto: location.protocol,
    host: location.host,
    mode: window.__net && window.__net.mode,
    surum: window.__BUILD__,
  }));
  console.log('1) APK ortamı:', JSON.stringify(d));
  if (!d.bundled) errors.push('www/index.html içine __BUNDLED__ konmamış');
  if (!d.surum) errors.push('www/index.html içine sürüm damgası konmamış');
  if (d.mode !== 'local') errors.push('APK çevrimdışı başlamıyor');

  // Service worker KAYDOLMAMALI
  await page.waitForTimeout(1500);
  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return -1;
    const r = await navigator.serviceWorker.getRegistrations();
    return r.length;
  });
  console.log('   kayıtlı service worker:', sw);
  if (sw > 0) errors.push(`APK'da ${sw} service worker kayıtlı — yeni sürüm eski önbellekten açılır`);

  await guncellemeyiKapat(page);
  await page.click('#tabOnline');
  await page.waitForTimeout(1200);
  const on = await page.evaluate(() => ({
    hedef: window.__net.url,
    kutu: document.getElementById('serverInput').value.trim(),
    durum: (document.getElementById('connStatus').textContent || '').trim(),
    cubuk: (document.getElementById('connText')?.textContent || '').trim(),
  }));
  console.log('   Online hedefi:', JSON.stringify(on.hedef));
  if (/localhost/i.test(on.hedef || '')) errors.push('Online kendi kendine (localhost) bağlanıyor');
  if (!/onrender/.test(on.hedef || '')) errors.push(`Online bulut sunucuya gitmiyor: ${on.hedef}`);
  if (/localhost/i.test(on.durum + on.cubuk)) errors.push('ekranda hâlâ localhost yazıyor');
  await ctx.close();
}

// ===== 2) Eski sürümden kalan "localhost" sunucu kaydı ===================
{
  const ctx = await apkBaglami({ depo: { sa_server: 'localhost', sa_mode: 'online' } });
  const page = await menuyuAc(ctx);
  await guncellemeyiKapat(page);
  await page.click('#tabOnline');
  await page.waitForTimeout(1500);
  const on = await page.evaluate(() => ({
    hedef: window.__net.url,
    kayit: localStorage.getItem('sa_server'),
    cubuk: (document.getElementById('connText')?.textContent || '').trim(),
  }));
  console.log('2) Kirli kayıt sonrası hedef:', JSON.stringify(on.hedef), '· kayıt:', JSON.stringify(on.kayit));
  if (/localhost/i.test(on.hedef || '')) errors.push('kayıtlı "localhost" hâlâ kullanılıyor');
  if (!/onrender/.test(on.hedef || '')) errors.push(`kirli kayıtta bulut sunucuya düşülmedi: ${on.hedef}`);
  if (/localhost/i.test(on.cubuk)) errors.push(`bağlantı çubuğunda localhost: "${on.cubuk}"`);
  await ctx.close();
}

// ===== 3) "GÜNCELLE" hatırlanıyor ama SUNUCU YOK =========================
// En kritik senaryo: uygulama kendi sayfasını kapatıp hata sayfasında
// kalmamalı. Oyun kendi kopyasıyla açılmalı ve oynanabilmeli.
{
  const ctx = await apkBaglami({ sunucuVar: false, depo: { sa_online_surum: '1' } });
  const page = await menuyuAc(ctx);
  await page.waitForTimeout(4000);

  const d = await page.evaluate(() => ({
    url: location.href,
    menu: document.getElementById('screenMenu').classList.contains('active'),
    mode: window.__net && window.__net.mode,
  }));
  console.log('3) Sunucu yokken açılış:', JSON.stringify(d));
  if (!/^https:\/\/localhost\//.test(d.url)) errors.push(`uygulama kendi sayfasından ayrıldı: ${d.url}`);
  if (!d.menu) errors.push('menü açılmadı — kullanıcı hata sayfasında kalır');
  if (d.mode !== 'local') errors.push('sunucu yokken çevrimdışına düşmedi');

  // Ve gerçekten oynanabilmeli
  await guncellemeyiKapat(page);
  await page.locator('#modePicker .mode-card').nth(0).click();
  await page.evaluate(() => {
    const b = document.getElementById('botCountInput');
    b.value = 3; b.dispatchEvent(new Event('input'));
  });
  await page.click('#btnCreate');
  await page.waitForSelector('#screenLobby.active', { timeout: 8000 });
  await page.click('#btnReady');
  await page.waitForSelector('#screenGame.active', { timeout: 25000 })
    .catch(() => errors.push('sunucu yokken maç başlamadı'));
  console.log('   maç başladı ✓');
  await ctx.close();
}

// ===== 4) Kullanıcının telefonundaki TAM durum ===========================
// "GÜNCELLE" tercihi hatırlanıyor + kayıtlı sunucu adresi "localhost" +
// sunucuya ulaşılamıyor. Eski davranış: uygulama açılır açılmaz
// http://localhost'a yönlendirip "ulaşılamıyor" hata sayfasında kalıyordu.
// Doğru davranış: hiçbir yere gitme, kendi kopyanla aç.
{
  const ctx = await apkBaglami({ sunucuVar: false, depo: { sa_online_surum: '1', sa_server: 'localhost' } });
  const page = await menuyuAc(ctx);
  await page.waitForTimeout(4000);
  const d = await page.evaluate(() => ({
    url: location.href,
    menu: document.getElementById('screenMenu').classList.contains('active'),
    mode: window.__net && window.__net.mode,
  }));
  console.log('4) Kirli kayıt + güncelleme tercihi + sunucu yok:', JSON.stringify(d));
  if (!/^https:\/\/localhost\//.test(d.url)) errors.push(`hatalı adrese yönlendirildi: ${d.url}`);
  if (!d.menu) errors.push('menü açılmadı — kullanıcı hata sayfasında kalır');
  if (d.mode !== 'local') errors.push('çevrimdışına düşmedi');
  await ctx.close();
}

// ===== 5) Sunucu VAR ve güncelleme tercihi var → gitmeli =================
{
  const ctx = await apkBaglami({ depo: { sa_online_surum: '1' } });
  const page = await ctx.newPage();
  await page.goto('https://localhost/');
  const gitti = await page.waitForURL(/onrender\.com/, { timeout: 20000 })
    .then(() => true).catch(() => false);
  console.log('5) Sunucu varken yönlendirme:', gitti ? `${page.url()} ✓` : 'OLMADI ✗');
  if (!gitti) errors.push('sunucu erişilebilirken güncel sürüme geçilmedi');
  await ctx.close();
}

// ===== 6) Yönlendirme uygulama DIŞINDA açılırsa kendini toparlamalı ======
// Eski kurulumlarda adres allowNavigation listesinde olmadığı için Android
// güncel sürümü Chrome'da açıyor ve uygulama kendi sayfasında kalıyordu.
// Tercih kayıtlı olduğu için bu HER AÇILIŞTA tekrarlanıyordu — kullanıcının
// "APK'yı açınca beni Chrome'a atıyor" dediği şey buydu.
// Doğru davranış: bir kez olur, tercih silinir, bir daha olmaz.
{
  const ctx = await apkBaglami({ disariAcilir: true, depo: { sa_online_surum: '1' } });
  const page = await menuyuAc(ctx);
  await page.waitForTimeout(6000);
  const d = await page.evaluate(() => ({
    url: location.href,
    menu: document.getElementById('screenMenu').classList.contains('active'),
    tercih: localStorage.getItem('sa_online_surum'),
    mode: window.__net && window.__net.mode,
  }));
  console.log('6) Yönlendirme dışarı açıldı:', JSON.stringify(d));
  if (!/^https:\/\/localhost\//.test(d.url)) errors.push(`uygulama kendi sayfasından ayrıldı: ${d.url}`);
  if (!d.menu) errors.push('menü açılmadı');
  if (d.tercih === '1') errors.push('tercih temizlenmedi — her açılışta Chrome\'a atmaya devam eder');
  if (d.mode !== 'local') errors.push('çevrimdışına düşmedi');
  await ctx.close();
}

await browser.close();

if (errors.length) {
  console.log('\nHATALAR:');
  for (const e of errors) console.log(' ', e);
}
console.log(errors.length ? '\nGERÇEK APK TESTİ BAŞARISIZ ✗' : '\nGERÇEK APK TESTİ GEÇTİ ✓');
process.exit(errors.length ? 1 : 0);
