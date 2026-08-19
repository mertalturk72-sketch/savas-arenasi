// Paketlenmiş sürümün (APK / tek dosya) kendi kendini güncellemesi.
//
// İstenen davranış:
//   1) Uygulama oyunun tamamını içinde taşır → internetsiz açılır.
//   2) İnternet varsa açılışta sunucudaki sürüm damgasına bakar.
//   3) Sunucuda YENİ sürüm varsa üstte "Yeni sürüm hazır — GÜNCELLE" çıkar.
//   4) GÜNCELLE'ye basınca uygulama sunucudaki güncel sürüme geçer ve bunu
//      hatırlar; sonraki açılışlarda doğrudan güncel sürüme gider.
//   5) İnternet YOKSA hiçbir şey olmaz, içindeki kopyayla sessizce açılır.
//   6) Sürümler aynıysa gereksiz yere "güncelle" demez.
//
// Çalıştır:  node test/browser-apkupdate.mjs   (kendi sahte sunucusunu kurar)

import http from 'node:http';
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve('dist/savas-arenasi.html');
if (!fs.existsSync(FILE)) {
  console.error('dist/savas-arenasi.html yok — önce: node scripts/build-single.mjs');
  process.exit(1);
}
const errors = [];

// Paketin kendi damgasını dosyadan okuyalım
const html = fs.readFileSync(FILE, 'utf-8');
const m = html.match(/__BUILD__ = "([a-f0-9]+)"/);
if (!m) { console.error('Pakette __BUILD__ damgası yok'); process.exit(1); }
const PAKET_SURUM = m[1];
console.log('paketin sürümü:', PAKET_SURUM);

// --- Sahte sunucu: sürümünü test sırasında değiştirebiliyoruz --------------
let sunucuSurum = PAKET_SURUM;              // başta aynı
let surumIstek = 0;
const server = http.createServer((req, res) => {
  if (req.url === '/surum.json') {
    surumIstek++;
    const body = JSON.stringify({ surum: sunucuSurum, oyun: 'savas-arenasi' });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }
  // Güncel sürümün ana sayfası — burada olduğumuzu anlayalım diye işaretli
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><title>GUNCEL SURUM</title><h1 id="guncel">GUNCEL SURUM</h1>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
console.log('sahte sunucu:', BASE);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});

// Uygulamanın bakacağı sunucuyu sahte sunucumuza yönlendiriyoruz.
// (Gerçekte shared/constants.js içindeki UPDATE_SERVER adresi kullanılıyor.)
// Uygulama gerçekte shared/constants.js'deki adrese (onrender) gidiyor.
// Testte o adresi ağ katmanında yakalayıp kendi sahte sunucumuzla
// cevaplıyoruz — hem fetch hem de sayfa yönlendirmesi böylece gerçek yoldan
// geçmiş oluyor. (fetch'i JS içinde değiştirmek yetmezdi: "GÜNCELLE" düğmesi
// location ile gidiyor, onu JS'ten yakalayamazsın.)
async function baglamKur(opts = {}) {
  const ctx = await browser.newContext({ ...devices['Pixel 5'], ...opts });
  await ctx.route('**://savas-arenasi.onrender.com/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/surum.json') {
      surumIstek++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ surum: sunucuSurum, oyun: 'savas-arenasi' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><title>GUNCEL SURUM</title><h1 id="guncel">GUNCEL SURUM</h1>',
    });
  });
  return ctx;
}

async function yeniSayfa(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`sayfa hatası: ${e.message}`));
  return page;
}

// Güncelleme ekranı artık tam ekran bir pencere (kamera çentiğinin altında
// kalmasın diye). Yani açıkken menüye dokunulamaz — bu kasıtlı. Menüyü
// sınayan bölümlerde önce "Şimdi değil" diyip kapatıyoruz; kapanmazsa bu
// başlı başına bir hatadır, çünkü kullanıcı oyuna hiç giremez demektir.
async function guncellemeyiKapat(page, etiket) {
  const acik = await page.locator('#updateOverlay:not(.hidden)')
    .waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  if (!acik) return false;
  await page.click('#btnSkipUpdate');
  await page.waitForSelector('#updateOverlay', { state: 'hidden', timeout: 3000 })
    .catch(() => errors.push(`${etiket}: "Şimdi değil" güncelleme ekranını kapatmadı`));
  return true;
}

// ===== 1) Sürümler aynı → uyarı çıkmamalı ================================
{
  const ctx = await baglamKur();
  const page = await yeniSayfa(ctx);
  await page.goto('file://' + FILE);
  await page.waitForSelector('#screenMenu.active', { timeout: 10000 });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({
    bar: !document.getElementById('updateOverlay').classList.contains('hidden'),
    surum: (document.getElementById('buildInfo').textContent || '').trim(),
    surumGizli: document.getElementById('buildInfo').classList.contains('hidden'),
  }));
  console.log('1) aynı sürüm → uyarı:', r.bar ? 'ÇIKTI ✗' : 'çıkmadı ✓', '· etiket:', JSON.stringify(r.surum));
  if (r.bar) errors.push('sürümler aynıyken gereksiz güncelleme uyarısı çıkıyor');
  if (r.surumGizli) errors.push('paket sürümü menüde gösterilmiyor');
  if (!r.surum.includes(PAKET_SURUM)) errors.push('menüdeki sürüm etiketi yanlış');
  if (surumIstek === 0) errors.push('sunucudan sürüm hiç sorulmadı');
  await ctx.close();
}

// ===== 2) Sunucuda yeni sürüm → uyarı çıkmalı ============================
sunucuSurum = 'yenisurum123';
{
  const ctx = await baglamKur();
  const page = await yeniSayfa(ctx);
  await page.goto('file://' + FILE);
  await page.waitForSelector('#screenMenu.active', { timeout: 10000 });
  await page.waitForSelector('#updateOverlay:not(.hidden)', { timeout: 8000 })
    .catch(() => errors.push('yeni sürüm varken uyarı çıkmadı'));
  const txt = await page.textContent('#updateText');
  console.log('2) yeni sürüm → uyarı çıktı ✓ ·', JSON.stringify(txt.trim()));

  // "Şimdi değil" → uyarı kapanmalı ve bir daha bu sürüm için çıkmamalı
  await page.click('#btnSkipUpdate');
  await page.waitForSelector('#updateOverlay', { state: 'hidden', timeout: 3000 });
  await page.reload();
  await page.waitForSelector('#screenMenu.active', { timeout: 10000 });
  await page.waitForTimeout(1500);
  const yine = await page.evaluate(() =>
    !document.getElementById('updateOverlay').classList.contains('hidden'));
  console.log('   "şimdi değil" sonrası tekrar sorar mı:', yine ? 'EVET ✗' : 'hayır ✓');
  if (yine) errors.push('"şimdi değil" dendiği hâlde aynı sürüm için tekrar soruyor');
  await ctx.close();
}

// ===== 3) GÜNCELLE → sunucudaki sürüme geçmeli ===========================
{
  const ctx = await baglamKur();
  const page = await yeniSayfa(ctx);
  await page.goto('file://' + FILE);
  await page.waitForSelector('#screenMenu.active', { timeout: 10000 });
  await page.waitForSelector('#updateOverlay:not(.hidden)', { timeout: 8000 });

  await Promise.all([
    page.waitForURL(/onrender\.com/, { timeout: 15000 })
      .catch(() => errors.push('GÜNCELLE sunucuya götürmedi')),
    page.click('#btnGetUpdate'),
  ]);
  const basligi = await page.title().catch(() => '');
  console.log('3) GÜNCELLE →', page.url(), '·', JSON.stringify(basligi));
  if (!/GUNCEL/.test(basligi)) errors.push('güncel sürüm sayfası açılmadı');

  // Tercih hatırlanmış olmalı: aynı bağlamda paketi tekrar açınca doğrudan
  // sunucuya gitmeli.
  const page2 = await yeniSayfa(ctx);
  await page2.goto('file://' + FILE);
  await page2.waitForURL(/onrender\.com/, { timeout: 15000 })
    .catch(() => errors.push('tercih hatırlanmadı: paket yine kendi kopyasını açtı'));
  console.log('   sonraki açılış doğrudan:', page2.url(), '✓');
  await ctx.close();
}

// ===== 4) İnternet yokken sessiz kalmalı =================================
{
  const ctx = await baglamKur({ offline: true });
  const page = await yeniSayfa(ctx);
  await page.goto('file://' + FILE);
  await page.waitForSelector('#screenMenu.active', { timeout: 10000 });
  await page.waitForTimeout(2000);
  const r = await page.evaluate(() => ({
    bar: !document.getElementById('updateOverlay').classList.contains('hidden'),
    mode: window.__net && window.__net.mode,
  }));
  console.log('4) internet yokken → uyarı:', r.bar ? 'ÇIKTI ✗' : 'çıkmadı ✓', '· mod:', r.mode);
  if (r.bar) errors.push('internet yokken güncelleme uyarısı çıkıyor');
  if (r.mode !== 'local') errors.push('internet yokken çevrimdışı moda geçmedi');

  // Ve oyun gerçekten oynanabilmeli
  await page.fill('#nameInput', 'Kopuk');
  await page.dispatchEvent('#nameInput', 'change');
  await page.locator('#modePicker .mode-card').nth(0).click();
  await page.evaluate(() => {
    const b = document.getElementById('botCountInput');
    b.value = 3; b.dispatchEvent(new Event('input'));
  });
  await page.click('#btnCreate');
  await page.waitForSelector('#screenLobby.active', { timeout: 8000 });
  await page.click('#btnReady');
  await page.waitForSelector('#screenGame.active', { timeout: 25000 })
    .catch(() => errors.push('internetsiz maç başlamadı'));
  console.log('   internetsiz maç başladı ✓');
  await ctx.close();
}

// ===== 5) Sunucudan açılan sürüm kendini güncellemeye çalışmamalı ========
{
  const ctx = await baglamKur();
  const page = await yeniSayfa(ctx);
  await page.goto('https://savas-arenasi.onrender.com/surum.json');
  const gorulen = await page.textContent('body');
  console.log('5) /surum.json:', gorulen.slice(0, 60));
  if (!gorulen.includes('surum')) errors.push('/surum.json beklenen biçimde değil');
  await ctx.close();
}

// ===== 6) APK'nın gerçek durumu: sayfa https://localhost'tan servis ediliyor
// Capacitor uygulamanın kendi dosyalarını `https://localhost` üzerinden verir.
// Bu "gerçek bir sunucudan geliyor" gibi göründüğü için oyun Online'a basınca
// kendi kendine bağlanmaya çalışıp "Bağlanılıyor: localhost" ekranında
// takılıyordu. Burada o durumu birebir kuruyoruz.
{
  const ctx = await baglamKur();
  // https://localhost adresini APK'nın içeriğiyle cevapla
  await ctx.route('**://localhost/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/' || u.pathname === '/index.html') {
      await route.fulfill({
        status: 200, contentType: 'text/html; charset=utf-8',
        body: fs.readFileSync(FILE, 'utf-8'),
      });
      return;
    }
    await route.fulfill({ status: 404, body: '' });
  });

  const page = await yeniSayfa(ctx);
  await page.goto('https://localhost/');
  await page.waitForSelector('#screenMenu.active', { timeout: 10000 });

  const paket = await page.evaluate(() => ({
    bundled: !!window.__BUNDLED__,
    proto: location.protocol,
    host: location.host,
    mode: window.__net && window.__net.mode,
  }));
  console.log('6) APK ortamı:', JSON.stringify(paket));
  if (!paket.bundled) errors.push('APK ortamında __BUNDLED__ yok — test kurulumu yanlış');
  if (paket.mode !== 'local') errors.push('APK açılışta çevrimdışı başlamıyor');

  // Sunucuda hâlâ yeni sürüm duruyor → APK ortamında da güncelleme ekranı
  // çıkmalı ve kapatılabilmeli. Kapanmadan menüye erişilemez.
  const cikti = await guncellemeyiKapat(page, '6');
  console.log('   güncelleme ekranı:', cikti ? 'çıktı ve kapandı ✓' : 'ÇIKMADI ✗');
  if (!cikti) errors.push('APK ortamında (https://localhost) güncelleme ekranı çıkmıyor');

  // Online'a bas: localhost'a değil, bulut sunucuya gitmeli
  await page.click('#tabOnline');
  await page.waitForTimeout(1200);
  const online = await page.evaluate(() => ({
    hedef: window.__net.url,
    kutu: document.getElementById('serverInput').value.trim(),
    durum: (document.getElementById('connStatus').textContent || '').trim(),
  }));
  console.log('   Online → hedef:', JSON.stringify(online.hedef));
  console.log('   durum:', online.durum.slice(0, 80));
  if (/localhost/i.test(online.hedef || '')) {
    errors.push('APK Online modunda kendi kendine (localhost) bağlanmaya çalışıyor');
  }
  if (!/onrender/.test(online.hedef || '')) {
    errors.push(`APK Online modunda bulut sunucuya gitmiyor: ${online.hedef}`);
  }
  if (/localhost/i.test(online.durum)) errors.push('durum yazısında hâlâ localhost görünüyor');
  await ctx.close();
}

await browser.close();
server.close();

if (errors.length) {
  console.log('\nHATALAR:');
  for (const e of errors) console.log(' ', e);
}
console.log(errors.length ? '\nPAKET GÜNCELLEME TESTİ BAŞARISIZ ✗' : '\nPAKET GÜNCELLEME TESTİ GEÇTİ ✓');
process.exit(errors.length ? 1 : 0);
