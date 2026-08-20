// Oyun içi ayarlar penceresi + doğuş noktası testi.
//
// Kontrol edilenler:
//  - Sağ üstteki ⚙ düğmesi maçta görünüyor ve paneli açıyor
//  - Panel açıkken tuşlar oyuna gitmiyor (karakter yürümüyor, ateş etmiyor)
//  - Esc paneli açıp kapatıyor
//  - "MAÇTAN ÇIK" ana menüye döndürüyor
//  - Ses ayarı kaydediliyor
//  - Oyuncular haritanın kenarında değil, iç tarafta doğuyor
//  - Cephane "30 / 60" biçiminde yazıyor ("yedek 90" değil)
//  - Skor tablosunda "ayakta" yerine "yaşıyor" yazıyor
//  - Sınıf listesinde Ağır Piyade yok
//
// Çalıştır:  node test/browser-settings.mjs      (sunucu gerekmez, çevrimdışı)

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
// Paketlenmiş sürüm açılışta sunucuya "yeni sürüm var mı" diye sorar.
// Testte internet yok; bu isteğin başarısız olması beklenen bir durumdur.
const SURUM_GURULTUSU = /surum\.json|ERR_TUNNEL|ERR_INTERNET|ERR_NAME_NOT_RESOLVED|Failed to load resource/i;

const errors = [];
// Menüde görünmesini beklediğimiz sınıflar (shared/constants.js ile aynı olmalı)
const BEKLENEN_SINIFLAR = ['Komando', 'Akıncı', 'Keskin Nişancı', 'Bombacı'];

// Varsayılan bot sayısı 1: maça tek başına girilemiyor (en az iki savaşçı).
// Bu testin ölçtüğü şey ayarlar paneli; rakip sayısı umurunda değil.
async function startMatch(page, { mode = 0, bots = 1 } = {}) {
  await page.locator('#modePicker .mode-card').nth(mode).click();
  await page.evaluate((n) => {
    const b = document.getElementById('botCountInput');
    b.value = n; b.dispatchEvent(new Event('input'));
  }, bots);
  await page.click('#btnCreate');
  await page.waitForSelector('#screenLobby.active', { timeout: 6000 });

  const classes = await page.evaluate(() =>
    [...document.querySelectorAll('#classPicker .class-card .cc-name')].map((e) => e.textContent.trim()));
  if (classes.length) {
    console.log('sınıflar:', classes.join(' · '));
    if (classes.some((c) => /ağır|agir/i.test(c))) errors.push('Ağır Piyade hâlâ listede');
    // Sınıf sayısı sabit değil (bombacı eklendi). Sabit sayıya bakmak yerine
    // sınıf listesinin sabitlerle birebir aynı olduğunu doğruluyoruz.
    if (classes.length !== BEKLENEN_SINIFLAR.length) {
      errors.push(`${BEKLENEN_SINIFLAR.length} sınıf bekleniyordu, ${classes.length} bulundu`);
    }
    for (const ad of BEKLENEN_SINIFLAR) {
      if (!classes.includes(ad)) errors.push(`sınıf listesinde eksik: ${ad}`);
    }
  }

  await page.click('#btnReady');
  await page.waitForSelector('#screenGame.active', { timeout: 25000 });
  await page.waitForTimeout(1200);
}

// ===== 1) Masaüstü: panel, tuş kilidi, çıkış =============================
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[masaüstü] ${e.message}`));
  page.on('console', (m) => { if (m.type() !== 'error') return;
    if (SURUM_GURULTUSU.test(m.text())) return;
    errors.push(`[masaüstü] ${m.text()}`); });

  await page.goto(URL_);
  await page.waitForSelector('#screenMenu.active', { timeout: 10000 });
  await page.fill('#nameInput', 'Ayarcı');
  await page.dispatchEvent('#nameInput', 'change');
  await startMatch(page);

  // Düğme görünür ve sağ üstte mi?
  const box = await page.locator('#btnSettings').boundingBox();
  const vp = page.viewportSize();
  const topRight = box && box.y < 80 && box.x > vp.width * 0.6;
  console.log('⚙ düğmesi sağ üstte:', topRight ? '✓' : '✗', box && `x=${Math.round(box.x)} y=${Math.round(box.y)}`);
  if (!topRight) errors.push('ayarlar düğmesi sağ üstte değil');

  // Mini haritanın üstüne binmemeli
  const mm = await page.locator('#minimap').boundingBox();
  const overlap = box && mm && !(box.x + box.width <= mm.x + 1 || box.x >= mm.x + mm.width - 1);
  console.log('mini haritayla çakışma:', overlap ? 'VAR ✗' : 'yok ✓');
  if (overlap) errors.push('ayarlar düğmesi mini haritanın üstüne biniyor');

  await page.click('#btnSettings');
  await page.waitForSelector('#settingsOverlay:not(.hidden)', { timeout: 3000 });
  console.log('panel açıldı ✓');

  // Panel açıkken W basılı: karakter kıpırdamamalı
  const before = await page.evaluate(() => ({ x: window.__game.me.x, y: window.__game.me.y }));
  await page.keyboard.down('w');
  await page.waitForTimeout(900);
  await page.keyboard.up('w');
  const after = await page.evaluate(() => ({ x: window.__game.me.x, y: window.__game.me.y }));
  const moved = Math.hypot(after.x - before.x, after.y - before.y);
  console.log('panel açıkken hareket:', Math.round(moved), 'px', moved < 12 ? '✓' : '✗');
  if (moved >= 12) errors.push(`panel açıkken karakter yürüdü (${Math.round(moved)} px)`);

  // Esc ile kapan, tekrar Esc ile aç
  await page.keyboard.press('Escape');
  await page.waitForSelector('#settingsOverlay', { state: 'hidden', timeout: 3000 });
  console.log('Esc kapatıyor ✓');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#settingsOverlay:not(.hidden)', { timeout: 3000 });
  console.log('Esc açıyor ✓');

  // Panel kapanınca hareket geri gelmeli.
  // Harita her maçta yeniden üretildiği için körlemesine "sağa yürü" demek
  // bazen duvara toslamak oluyordu; önce gerçekten açık bir yön seçiyoruz.
  await page.click('#setResume');
  await page.waitForSelector('#settingsOverlay', { state: 'hidden', timeout: 3000 });
  const dir = await page.evaluate(() => {
    const hub = window.__net.impl.hub;
    const sim = [...hub.lobbies.values()][0].game;
    const me = sim.players.get(window.__net.impl.client.id);
    const R = 18;
    const clear = (dx, dy) => {
      for (let t = 0; t <= 240; t += 8) {
        const px = me.x + dx * t, py = me.y + dy * t;
        if (px < R || py < R || px > sim.map.w - R || py > sim.map.h - R) return false;
        for (const o of sim.map.obstacles) {
          const cx = Math.max(o.x, Math.min(px, o.x + o.w));
          const cy = Math.max(o.y, Math.min(py, o.y + o.h));
          if ((px - cx) ** 2 + (py - cy) ** 2 < (R + 4) ** 2) return false;
        }
      }
      return true;
    };
    for (const d of [['d', 1, 0], ['a', -1, 0], ['s', 0, 1], ['w', 0, -1]]) {
      if (clear(d[1], d[2])) return d[0];
    }
    me.x = sim.map.w / 2; me.y = sim.map.h / 2;
    return 'd';
  });
  // Ölüysek hareket edemeyiz — ölçüm öncesi hayatta olduğumuzu garanti et.
  await page.evaluate(() => {
    const hub = window.__net.impl.hub;
    const sim = [...hub.lobbies.values()][0].game;
    const me = sim.players.get(window.__net.impl.client.id);
    if (!me.alive) sim.respawn(me);
  });
  await page.waitForTimeout(300);
  const b2 = await page.evaluate(() => ({ x: window.__game.me.x, y: window.__game.me.y }));
  await page.keyboard.down(dir);
  await page.waitForTimeout(700);
  await page.keyboard.up(dir);
  const a2 = await page.evaluate(() => ({ x: window.__game.me.x, y: window.__game.me.y }));
  const moved2 = Math.hypot(a2.x - b2.x, a2.y - b2.y);
  console.log('panel kapanınca hareket:', Math.round(moved2), 'px', moved2 > 30 ? '✓' : '✗');
  if (moved2 <= 30) errors.push('panel kapandıktan sonra karakter hareket etmiyor');

  // Ses ayarı kaydediliyor mu?
  await page.click('#btnSettings');
  await page.evaluate(() => {
    const v = document.getElementById('setVolume');
    v.value = 25; v.dispatchEvent(new Event('input'));
    const s = document.getElementById('setSound');
    s.checked = false; s.dispatchEvent(new Event('change'));
  });
  const saved = await page.evaluate(() => ({
    vol: localStorage.getItem('sa_volume'), snd: localStorage.getItem('sa_sound'),
    label: document.getElementById('setVolumeVal').textContent,
  }));
  console.log('ses ayarı kaydı:', JSON.stringify(saved));
  if (saved.vol !== '25' || saved.snd !== '0') errors.push('ses ayarı kaydedilmedi');

  await page.screenshot({ path: `${OUT}/settings-panel.png` });

  // --- Cephane biçimi: "30 / 60" ---
  await page.click('#setResume');
  await page.waitForSelector('#settingsOverlay', { state: 'hidden', timeout: 3000 });
  const ammo = await page.evaluate(() => ({
    cur: (document.getElementById('ammoText').textContent || '').trim(),
    res: (document.getElementById('reserveText').textContent || '').trim(),
    magEl: !!document.getElementById('magText'),
    hepsi: (document.querySelector('.ammo-wrap').textContent || '').replace(/\s+/g, ' ').trim(),
  }));
  console.log('cephane satırı:', JSON.stringify(ammo.hepsi));
  if (ammo.magEl) errors.push('eski şarjör kapasitesi alanı hâlâ duruyor');
  if (/yedek/i.test(ammo.hepsi)) errors.push('"yedek" yazısı hâlâ görünüyor');
  if (!/^\d+$/.test(ammo.res)) errors.push(`yedek sayı olmalı, "${ammo.res}" bulundu`);
  if (ammo.res !== '60') errors.push(`komando yedeği 60 olmalı, ${ammo.res} bulundu`);
  if (ammo.cur !== '30' && Number(ammo.cur) > 30) errors.push(`şarjör 30'u aşamaz: ${ammo.cur}`);

  // --- Skor tablosu: "yaşıyor" ---
  await page.keyboard.down('Tab');
  await page.waitForTimeout(400);
  const sb = await page.evaluate(() => (document.getElementById('scoreboard').textContent || ''));
  await page.keyboard.up('Tab');
  console.log('skor tablosu "yaşıyor" içeriyor:', /yaşıyor/.test(sb) ? '✓' : '✗',
    '· "ayakta" içeriyor:', /ayakta/i.test(sb) ? 'EVET ✗' : 'hayır ✓');
  if (!/yaşıyor/.test(sb)) errors.push('skor tablosunda "yaşıyor" yazmıyor');
  if (/ayakta/i.test(sb)) errors.push('skor tablosunda hâlâ "ayakta" yazıyor');
  if (/\byerde\b/i.test(sb)) errors.push('skor tablosunda hâlâ "yerde" yazıyor');

  // Çıkış → ana menü (panel yukarıda kapatılmıştı, tekrar aç)
  await page.click('#btnSettings');
  await page.waitForSelector('#settingsOverlay:not(.hidden)', { timeout: 3000 });
  await page.click('#setLeave');
  await page.waitForSelector('#screenMenu.active', { timeout: 8000 });
  const closed = await page.evaluate(() => ({
    hidden: document.getElementById('settingsOverlay').classList.contains('hidden'),
    inMatch: window.__state.inMatch,
  }));
  console.log('çıkış → ana menü ✓ · panel kapandı:', closed.hidden ? '✓' : '✗');
  if (!closed.hidden) errors.push('çıkıştan sonra panel açık kaldı');
  if (closed.inMatch) errors.push('çıkıştan sonra hâlâ maçta görünüyor');

  await ctx.close();
}

// ===== 2) Telefon: düğmeye dokunulabiliyor mu? ===========================
{
  const ctx = await browser.newContext({ ...devices['Pixel 5'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[telefon] ${e.message}`));
  await page.goto(URL_);
  await page.waitForSelector('#screenMenu.active', { timeout: 10000 });
  await page.fill('#nameInput', 'Cep');
  await page.dispatchEvent('#nameInput', 'change');
  await startMatch(page, { mode: 0, bots: 1 });

  const b = await page.locator('#btnSettings').boundingBox();
  console.log('telefonda düğme boyutu:', b && `${Math.round(b.width)}×${Math.round(b.height)}`);
  if (!b || b.width < 34 || b.height < 34) errors.push('telefonda ayarlar düğmesi çok küçük');

  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForSelector('#settingsOverlay:not(.hidden)', { timeout: 3000 })
    .catch(() => errors.push('telefonda panel açılmadı'));
  console.log('telefonda panel açıldı ✓');
  await page.screenshot({ path: `${OUT}/settings-phone.png` });
  await ctx.close();
}

// ===== 3) Doğuş: oyuncu kenarda mı doğuyor? ==============================
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[doğuş] ${e.message}`));
  await page.goto(URL_);
  await page.waitForSelector('#screenMenu.active', { timeout: 10000 });
  await page.fill('#nameInput', 'Doğan');
  await page.dispatchEvent('#nameInput', 'change');
  await startMatch(page, { mode: 0, bots: 12 });

  // DİKKAT: canlı konumları ölçmek yanlış olur — oyuncular doğduktan sonra
  // yürüyor ve kenara yaklaşabiliyorlar. Ölçülmesi gereken şey DOĞUŞ
  // NOKTALARININ kendisi. (Bu test önce canlı konumu ölçtüğü için ara sıra
  // haksız yere düşüyordu.)
  const res = await page.evaluate(() => {
    const hub = window.__net.impl.hub;
    const sim = [...hub.lobbies.values()][0].game;
    const w = sim.map.w, h = sim.map.h;
    const pts = [];
    for (const key of ['all', 1, 2]) {
      for (const s2 of (sim.spawns[key] || [])) pts.push(s2);
    }
    const edges = pts.map((p) => Math.min(p.x, w - p.x, p.y, h - p.y));
    return {
      w, h, n: pts.length,
      min: Math.min(...edges),
      avg: edges.reduce((a, b) => a + b, 0) / edges.length,
    };
  });
  const limit = Math.min(res.w, res.h) * 0.12;
  console.log(`harita ${res.w}×${res.h} · ${res.n} doğuş noktası · en yakın kenar mesafesi ${Math.round(res.min)} px · ortalama ${Math.round(res.avg)} px`);
  if (res.min < limit) errors.push(`doğuş noktası kenara çok yakın: ${Math.round(res.min)} px (sınır ${Math.round(limit)})`);
  await ctx.close();
}

await browser.close();
if (errors.length) {
  console.log('\nHATALAR:');
  for (const e of errors) console.log(' ', e);
}
console.log(errors.length ? '\nAYARLAR TESTİ BAŞARISIZ ✗' : '\nAYARLAR TESTİ GEÇTİ ✓');
process.exit(errors.length ? 1 : 0);
