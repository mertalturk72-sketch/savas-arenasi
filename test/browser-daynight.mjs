// Gündüz/gece döngüsü ve güneşe göre gölge testi.
//
// Kontrol edilenler:
//   1) Her maç günün FARKLI (rastgele) bir saatinde başlıyor
//   2) Saat maç boyunca ilerliyor
//   3) Öğlen gece yarısından belirgin biçimde aydınlık
//   4) Gölge yönü güneşin tersi: sabah batıya, akşam doğuya düşüyor
//   5) Gölgeler öğlen kısa, ufka yakınken uzun
//   6) Gece oyuncunun etrafında aydınlık halka var (oyun oynanabilir kalıyor)
//
// Çalıştır:  node test/browser-daynight.mjs      (sunucu gerekmez, çevrimdışı)

import { chromium } from 'playwright';
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
const errors = [];

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`sayfa hatası: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`konsol: ${m.text()}`); });

await page.goto(URL_);
await page.waitForSelector('#screenMenu.active', { timeout: 10000 });

// ===== 1) Saat modelinin kendisi (saf hesap) =============================
{
  const r = await page.evaluate(() => {
    const d = window.__render;
    if (!d || !d.daylight) return null;
    const at = (h) => {
      const x = d.daylight(h);
      return { hour: x.hour, isDay: x.isDay, elev: +x.elev.toFixed(3),
        shadowX: +x.shadowX.toFixed(2), shadowY: +x.shadowY.toFixed(2),
        mul: x.mul, lamp: +x.lamp.toFixed(2) };
    };
    return { sabah: at(8), oglen: at(13), aksam: at(18.5), gece: at(1) };
  });
  if (!r) {
    errors.push('daylight() dışa aktarılmamış (window.__render yok)');
  } else {
    console.log('sabah  :', JSON.stringify(r.sabah));
    console.log('öğlen  :', JSON.stringify(r.oglen));
    console.log('akşam  :', JSON.stringify(r.aksam));
    console.log('gece   :', JSON.stringify(r.gece));

    // Güneş doğuda doğar → sabah gölge BATIYA (negatif x) düşer
    if (!(r.sabah.shadowX < 0)) errors.push(`sabah gölgesi batıya düşmüyor (${r.sabah.shadowX})`);
    // Akşam güneş batıda → gölge DOĞUYA (pozitif x)
    if (!(r.aksam.shadowX > 0)) errors.push(`akşam gölgesi doğuya düşmüyor (${r.aksam.shadowX})`);
    // Öğlen gölge kısa, ufukta uzun
    const kisa = Math.abs(r.oglen.shadowX) + Math.abs(r.oglen.shadowY);
    const uzun = Math.abs(r.aksam.shadowX) + Math.abs(r.aksam.shadowY);
    console.log(`gölge uzunluğu: öğlen ${kisa.toFixed(2)} · akşam ${uzun.toFixed(2)}`,
      uzun > kisa * 1.4 ? '✓' : '✗');
    if (!(uzun > kisa * 1.4)) errors.push('güneş alçalınca gölge uzamıyor');
    // Öğlen ışık dokunulmamış, gece koyu ve mavimsi
    if (r.oglen.mul.r < 250) errors.push('öğlen sahne gereksiz karartılıyor');
    if (!(r.gece.mul.b > r.gece.mul.r)) errors.push('gece rengi mavimsi değil');
    if (!(r.gece.mul.r < 120)) errors.push('gece yeterince karanlık değil');
    if (!(r.gece.lamp > 0.5)) errors.push('gecede oyuncu ışığı yok');
    if (r.oglen.lamp > 0.05) errors.push('öğlen gereksiz yere ışık halkası var');
  }
}

// ===== 2) Maçlar farklı saatlerde başlıyor mu? ===========================
{
  const hours = [];
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => {
      // lobiye/menüye dön
      const b = document.getElementById('setLeave');
      if (b && !document.getElementById('settingsOverlay').classList.contains('hidden')) b.click();
    });
    await page.goto(URL_);
    await page.waitForSelector('#screenMenu.active', { timeout: 10000 });
    await page.fill('#nameInput', 'Saat');
    await page.dispatchEvent('#nameInput', 'change');
    await page.locator('#modePicker .mode-card').nth(0).click();
    await page.evaluate(() => {
      const b = document.getElementById('botCountInput');
      b.value = 0; b.dispatchEvent(new Event('input'));
    });
    await page.click('#btnCreate');
    await page.waitForSelector('#screenLobby.active', { timeout: 8000 });
    await page.click('#btnReady');
    await page.waitForSelector('#screenGame.active', { timeout: 25000 });
    await page.waitForTimeout(600);
    hours.push(await page.evaluate(() => window.__game.startHour));
  }
  const rounded = hours.map((h) => Math.round(h * 10) / 10);
  const uniq = new Set(rounded).size;
  console.log('4 maçın başlangıç saatleri:', rounded.join(' · '), uniq >= 3 ? '✓' : '✗');
  if (uniq < 3) errors.push(`maçlar rastgele saatte başlamıyor (${uniq}/4 farklı)`);
  for (const h of hours) {
    if (!(h >= 0 && h < 24)) errors.push(`geçersiz başlangıç saati: ${h}`);
  }
}

// ===== 3) Saat maç boyunca ilerliyor mu? =================================
{
  // Sunucudan gelen skor paketi her an durumu ezdiği için burada saati elle
  // oynatmak yarış koşulu yaratıyordu. Onun yerine saati üreten saf fonksiyonu
  // doğrudan sınıyoruz — asıl kural bu.
  const r = await page.evaluate(() => {
    const { matchHour, daylight } = window.__render;
    const MATCH = 5 * 60 * 1000;
    const bas = matchHour(9, 0, MATCH);
    const orta = matchHour(9, MATCH / 2, MATCH);
    const son = matchHour(9, MATCH, MATCH);
    // gece yarısını geçen maç da doğru sarmalı
    const sarmal = matchHour(22, MATCH, MATCH);
    return { bas, orta, son, sarmal, geceIsDay: daylight(sarmal).isDay };
  });
  console.log(`saat: başta ${r.bas.toFixed(2)} · ortada ${r.orta.toFixed(2)} · sonda ${r.son.toFixed(2)}`);
  if (!(r.orta > r.bas && r.son > r.orta)) errors.push('maç ilerledikçe saat ilerlemiyor');
  if (Math.abs((r.son - r.bas) - 6) > 0.01) errors.push(`maç boyunca 6 saat geçmeli, ${(r.son - r.bas).toFixed(2)} geçiyor`);
  console.log(`gece yarısını aşan maç: 22:00 + 6sa → ${r.sarmal.toFixed(2)} (gündüz mü: ${r.geceIsDay})`);
  if (!(r.sarmal >= 3.9 && r.sarmal <= 4.1)) errors.push(`24'ü aşan saat yanlış sarıyor: ${r.sarmal}`);
}

// ===== 4) Öğlen gerçekten gece yarısından aydınlık mı? ===================
{
  const bright = async (h) => {
    await page.evaluate((hh) => {
      const g = window.__game;
      Object.defineProperty(g, 'startHour', { value: hh, configurable: true });
      g.scores = { ...(g.scores || {}), left: 300 };
    }, h);
    await page.waitForTimeout(400);
    const shot = await page.screenshot({ clip: { x: 0, y: 120, width: 960, height: 380 } });
    // ortalama parlaklık
    return page.evaluate(async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const cx = c.getContext('2d');
      cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
      return sum / (d.length / 4);
    }, shot.toString('base64'));
  };

  const noon = await bright(12);
  const night = await bright(1);
  const dusk = await bright(19.4);
  console.log(`parlaklık — öğlen ${noon.toFixed(1)} · gün batımı ${dusk.toFixed(1)} · gece ${night.toFixed(1)}`);
  if (!(noon > night * 1.4)) errors.push(`öğlen geceden yeterince aydınlık değil (${noon.toFixed(1)} / ${night.toFixed(1)})`);
  if (!(noon > dusk)) errors.push('gün batımı öğlenden aydınlık görünüyor');
}

await page.screenshot({ path: `${OUT}/daynight.png` });
await browser.close();

if (errors.length) {
  console.log('\nHATALAR:');
  for (const e of errors) console.log(' ', e);
}
console.log(errors.length ? '\nGÜNDÜZ/GECE TESTİ BAŞARISIZ ✗' : '\nGÜNDÜZ/GECE TESTİ GEÇTİ ✓');
process.exit(errors.length ? 1 : 0);
