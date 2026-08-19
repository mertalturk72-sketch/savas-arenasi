// Tek dosyalık sürüm testi (dist/savas-arenasi.html).
//
// Bu, kullanıcının "ne mobil veride açılıyor ne de internetsiz oynayabiliyorum"
// şikâyetinin kök çözümü: dosyayı file:// üzerinden, ağ tamamen kapalıyken aç
// ve gerçek bir maçın baştan sona döndüğünü doğrula. Hiçbir dış istek olmamalı.
//
// Çalıştır:  node test/browser-single.mjs

import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve('dist/savas-arenasi.html');
if (!fs.existsSync(FILE)) {
  console.error('dist/savas-arenasi.html yok — önce: node scripts/build-single.mjs');
  process.exit(1);
}
const URL_ = 'file://' + FILE;
const OUT = '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});

const errors = [];
const external = [];

function attach(page, tag) {
  page.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}\n${e.stack || ''}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // Sürüm sorgusu internetsizken başarısız olur; bu beklenen bir durum.
    if (/surum\.json|ERR_TUNNEL|ERR_INTERNET|ERR_NAME_NOT_RESOLVED|Failed to load resource/i.test(m.text())) return;
    errors.push(`[${tag}] ${m.text()}`);
  });
  // Dosya kendi kendine yetmeli: file:// dışına çıkan tek meşru istek, sunucuda
  // yeni sürüm olup olmadığını soran /surum.json. Başka her şey hatadır.
  const IZINLI = /\/surum\.json(\?|$)/;
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('file://') || IZINLI.test(u)) return;
    external.push(`[${tag}] ${u}`);
  });
}

async function playAMatch(page, { mode = 0, bots = 6 } = {}) {
  await page.locator('#modePicker .mode-card').nth(mode).click();
  await page.evaluate((n) => {
    const b = document.getElementById('botCountInput');
    b.value = n; b.dispatchEvent(new Event('input'));
  }, bots);
  await page.click('#btnCreate');
  await page.waitForSelector('#screenLobby.active', { timeout: 6000 });

  // Geri sayım gerçekten 5→1 akıyor mu?
  await page.click('#btnReady');
  await page.waitForSelector('#countdownOverlay:not(.hidden)', { timeout: 6000 });
  const seen = new Set();
  const until = Date.now() + 9000;
  while (Date.now() < until && seen.size < 5) {
    const n = await page.textContent('#countdownNum').catch(() => null);
    if (n && /^[1-5]$/.test(n.trim())) seen.add(n.trim());
    await page.waitForTimeout(120);
  }
  console.log('  geri sayım:', [...seen].sort((a, b) => b - a).join(' → ') || '(görülmedi)');

  await page.waitForSelector('#screenGame.active', { timeout: 25000 });
}

// ===== 1) Masaüstü: ağ tamamen kapalı, file:// ============================
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, offline: true });
  const page = await ctx.newPage();
  attach(page, 'masaustu');
  await page.goto(URL_);
  await page.waitForSelector('#screenMenu.active', { timeout: 10000 });

  const mode = await page.evaluate(() => ({
    tabLocalActive: document.getElementById('tabLocal').classList.contains('sel'),
    netMode: window.__net && window.__net.mode,
    bundled: !!window.__BUNDLED__,
    status: (document.getElementById('connStatus').textContent || '').trim(),
  }));
  console.log('Paketli mi:', mode.bundled, '· çevrimdışı sekmesi seçili mi:', mode.tabLocalActive);
  console.log('Durum:', mode.status);
  if (!mode.bundled) errors.push('window.__BUNDLED__ ayarlanmamış');
  if (!mode.tabLocalActive) errors.push('file:// üzerinde çevrimdışı sekmesi seçili değil');
  if (mode.netMode !== 'local') errors.push(`file:// üzerinde çevrimdışı moda geçilmedi (mode=${mode.netMode})`);

  await page.fill('#nameInput', 'Tek Dosya');
  await page.dispatchEvent('#nameInput', 'change');
  await playAMatch(page, { mode: 0, bots: 8 });
  console.log('Maç başladı ✓');

  // Karakter çizimi ve simülasyonun gerçekten ilerlediğini doğrula.
  await page.waitForTimeout(2500);
  const a = await page.evaluate(() => Math.round(window.__game.snaps.at(-1)?.t || 0));
  await page.waitForTimeout(1500);
  const b = await page.evaluate(() => Math.round(window.__game.snaps.at(-1)?.t || 0));
  console.log('Sim zamanı ilerliyor:', a, '→', b, b > a ? '✓' : '✗');
  if (!(b > a)) errors.push('simülasyon ilerlemiyor');

  // Hareket + ateş
  await page.keyboard.down('w');
  await page.waitForTimeout(500);
  await page.keyboard.up('w');
  await page.mouse.move(800, 400);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(400);

  const hud = await page.evaluate(() => ({
    hp: (document.getElementById('hpText').textContent || '').trim(),
    ammo: (document.getElementById('ammoText').textContent || '').trim(),
    reserve: (document.getElementById('reserveText').textContent || '').trim(),
    info: (document.getElementById('matchInfo').textContent || '').trim(),
  }));
  console.log('HUD:', JSON.stringify(hud));
  if (!/^\d+:\d\d$/.test(hud.info)) errors.push(`üst HUD sadece süre olmalı, "${hud.info}" bulundu`);

  await page.screenshot({ path: `${OUT}/single-desktop.png` });
  await ctx.close();
}

// ===== 2) Telefon: ağ AÇIK ama dosyadan açılmış — yine de çevrimdışı çalışmalı
// (navigator.onLine=true olduğu için burada "packaged" dalı sınanıyor)
{
  const ctx = await browser.newContext({ ...devices['Pixel 5'] });
  const page = await ctx.newPage();
  attach(page, 'telefon');
  await page.goto(URL_);
  await page.waitForSelector('#screenMenu.active', { timeout: 10000 });

  const pm = await page.evaluate(() => window.__net && window.__net.mode);
  console.log('Ağ açıkken dosyadan açılış modu:', pm, pm === 'local' ? '✓' : '✗');
  if (pm !== 'local') errors.push(`ağ açıkken file:// çevrimdışına geçmedi (mode=${pm})`);

  await page.fill('#nameInput', 'Cep');
  await page.dispatchEvent('#nameInput', 'change');
  await playAMatch(page, { mode: 1, bots: 6 });

  const touch = await page.evaluate(() => !document.getElementById('touchUI').classList.contains('hidden'));
  console.log('Dokunmatik arayüz:', touch ? 'açık ✓' : 'kapalı ✗');
  if (!touch) errors.push('telefonda dokunmatik arayüz açılmadı');

  // Sol çubukla yürü
  const st = await page.locator('#stickMove').boundingBox();
  await page.touchscreen.tap(st.x + st.width / 2, st.y + st.height / 2);
  await page.waitForTimeout(800);

  await page.screenshot({ path: `${OUT}/single-phone.png` });
  await ctx.close();
}

// ===== 3) Paketlenmiş sürümde "Online" boş adrese gitmemeli ==============
// Tek dosyanın kendi sunucusu yoktur; boş adres "bu sayfanın sunucusu"
// anlamına geldiği için bağlanılamayan boş bir hedefe dönüşüyordu ve ekranda
// adresi olmayan "… adresine ulaşılamıyor" mesajı çıkıyordu.
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  // Bulut sunucuya giden istekleri yakala (testte gerçek ağ yok)
  await ctx.route('**://savas-arenasi.onrender.com/**', (r) => r.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: '{"surum":"testsurum"}',
  }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[online] ${e.message}`));
  await page.goto(URL_);
  await page.waitForSelector('#screenMenu.active', { timeout: 10000 });
  await page.click('#tabOnline');
  await page.waitForTimeout(1200);

  const r = await page.evaluate(() => ({
    kutu: document.getElementById('serverInput').value.trim(),
    hedef: window.__net.url,
    durum: (document.getElementById('connStatus').textContent || '').trim(),
  }));
  console.log('Online sekmesi → hedef:', JSON.stringify(r.hedef));
  if (!r.hedef) errors.push('paketlenmiş sürümde Online boş adrese bağlanmaya çalışıyor');
  if (!r.kutu) errors.push('sunucu adresi kutusu boş kaldı');
  // Durum yazısında adres görünmeli; "…: (3. deneme)" gibi adressiz olmamalı
  if (/:\s*\(/.test(r.durum)) errors.push(`durum yazısında adres yok: "${r.durum}"`);
  await ctx.close();
}

await browser.close();

if (external.length) {
  console.log('\nDIŞ İSTEKLER (olmamalı):');
  for (const u of external.slice(0, 20)) console.log(' ', u);
}
if (errors.length) {
  console.log('\nHATALAR:');
  for (const e of errors) console.log(' ', e);
}
const ok = errors.length === 0 && external.length === 0;
console.log(ok ? '\nTEK DOSYA TESTİ GEÇTİ ✓' : '\nTEK DOSYA TESTİ BAŞARISIZ ✗');
process.exit(ok ? 0 : 1);
