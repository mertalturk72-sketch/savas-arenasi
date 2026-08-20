// Zemin dokusu geç yüklenirse ne oluyor?
//
// Kullanıcının şikâyeti: "haritanın çimenleri bazen yüklenmiyor."
//
// Kök neden: zemin 512 px'lik parçalara BİR KEZ çizilip önbelleğe alınıyor.
// Doku görseli o an henüz inmemişse parça, kodla üretilen YEDEK çimenle
// pişiyor ve orada kalıyordu. Görsel sonradan gelse bile ekrandaki parçalar
// eski kalıyordu — yani doku aslında yüklenmişti, görünmüyordu.
//
// Bu test dokuyu bilerek GEÇ veriyor ve ayırt edilebilir bir renkte veriyor:
//   • parlak macenta bir görsel  → yüklendiyse zemin macenta olur
//   • kodla üretilen yedek çimen → yeşil olur
// Böylece "gerçek doku mu, yedek mi" sorusu piksel okuyarak kesin cevaplanıyor.
//
// Çalıştır:  node test/browser-grass.mjs

import { chromium } from 'playwright';
import zlib from 'node:zlib';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3000';
const GECIKME_MS = 20000;         // doku maç başladıktan SONRA gelsin
const T0 = Date.now();
const sn = () => ((Date.now() - T0) / 1000).toFixed(1) + 's';
const errors = [];

// --- Tek renkli PNG üret (dış paket kullanmadan) --------------------------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(tip, veri) {
  const len = Buffer.alloc(4); len.writeUInt32BE(veri.length);
  const govde = Buffer.concat([Buffer.from(tip, 'ascii'), veri]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(govde));
  return Buffer.concat([len, govde, crc]);
}
function duzRenkPng(boy, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(boy, 0); ihdr.writeUInt32BE(boy, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8 bit RGB
  const satir = Buffer.alloc(1 + boy * 3);
  for (let x = 0; x < boy; x++) { satir[1 + x * 3] = r; satir[2 + x * 3] = g; satir[3 + x * 3] = b; }
  const ham = Buffer.concat(Array.from({ length: boy }, () => satir));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(ham)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const MACENTA = duzRenkPng(64, [255, 0, 255]);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });

let dokuIstek = 0;
let verildiAt = 0;
await ctx.route('**/textures/grass.*', async (route) => {
  dokuIstek++;
  console.log(`   [${sn()}] doku istendi (#${dokuIstek}), ${GECIKME_MS}ms bekletiliyor`);
  await new Promise((r) => setTimeout(r, GECIKME_MS));
  verildiAt = verildiAt || Date.now();
  console.log(`   [${sn()}] doku VERİLDİ`);
  await route.fulfill({ status: 200, contentType: 'image/png', body: MACENTA });
});

const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`sayfa hatası: ${e.message}`));
// DİKKAT: 'load' beklenirse sayfa, geciktirdiğimiz dokunun inmesini de bekler
// ve testin kurmak istediği durum (maç başladı ama doku hâlâ yolda) hiç
// oluşmaz. O yüzden domcontentloaded yetiyor.
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#screenMenu.active', { timeout: 15000 });
await page.click('#tabLocal');
await page.waitForTimeout(400);
await page.fill('#nameInput', 'Cim');
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

// Zeminden örnek al: oyuncunun/HUD'un olmadığı noktalardan.
async function zeminRengi() {
  return page.evaluate(() => {
    const c = document.getElementById('canvas');
    const g = c.getContext('2d', { willReadFrequently: true });
    const noktalar = [];
    for (let i = 1; i <= 4; i++) {
      for (let j = 1; j <= 3; j++) {
        noktalar.push([Math.round(c.width * i / 5), Math.round(c.height * j / 4)]);
      }
    }
    let yesil = 0, macenta = 0;
    for (const [x, y] of noktalar) {
      const d = g.getImageData(x, y, 1, 1).data;
      const [r, gg, b] = d;
      if (gg > r + 12 && gg > b + 12) yesil++;
      else if (r > gg + 25 && b > gg + 25) macenta++;
    }
    return { yesil, macenta, toplam: noktalar.length,
      ornek: noktalar.slice(0, 4).map(([x, y]) => Array.from(g.getImageData(x, y, 1, 1).data).slice(0, 3).join(',')) };
  });
}

// 1) Doku daha inmedi → yedek çimen (yeşil) görünmeli
await page.waitForTimeout(900);
const once = await zeminRengi();
console.log(`1) [${sn()}] doku inmeden :`, JSON.stringify(once), '(yedek çimen bekleniyor)');
// Bu, ürünü değil TESTİN KURULUMUNU doğruluyor: doku maç başlamadan inmiş
// olsaydı sınamak istediğimiz durum hiç oluşmazdı.
if (once.macenta > 2) {
  errors.push('test kurulumu bozuk: doku maç başlamadan inmiş, geç yükleme senaryosu kurulamadı');
}

// 2) Doku indikten HEMEN SONRA zemin gerçek dokuya dönmeli.
//
// "Hemen"in altını çiziyoruz: parça önbelleği güneş kaydıkça zaten kendi
// kendine tazeleniyor, yani birkaç saniye beklersek hata kendini gizler.
// Kullanıcının gördüğü şikâyet tam da bu aradaki pencere. O yüzden dokunun
// indiği anı bekleyip sadece 1,5 saniye sonra ölçüyoruz.
while (!verildiAt) await page.waitForTimeout(250);
await page.waitForTimeout(1500);
const sonra = await zeminRengi();
console.log(`2) [${sn()}] doku indikten sonra:`, JSON.stringify(sonra), '(macenta bekleniyor)');
console.log('   doku isteği sayısı:', dokuIstek);

if (dokuIstek === 0) errors.push('zemin dokusu hiç istenmedi');
if (sonra.macenta < 6) {
  errors.push(`doku indiği hâlde zemin güncellenmedi (macenta ${sonra.macenta}/${sonra.toplam}) `
    + '— parça önbelleği yedek çimenle pişip kalmış');
}

await page.screenshot({ path: '/tmp/shots/cim-sonra.png' });
await browser.close();

if (errors.length) {
  console.log('\nHATALAR:');
  for (const e of errors) console.log(' ', e);
}
console.log(errors.length ? '\nÇİMEN TESTİ BAŞARISIZ ✗' : '\nÇİMEN TESTİ GEÇTİ ✓');
process.exit(errors.length ? 1 : 0);
