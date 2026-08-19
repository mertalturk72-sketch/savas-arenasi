// Uygulama simgesini TEK KAYNAKTAN üretir.
//
// Kaynak: assets/icon-source.png  (nişangâh + çapraz kılıçlar, ortada nokta yok)
//
// Neden bu betik var?
//
//  1) APK'nın simgesi yanlıştı. `npx cap add android` kendi varsayılan
//     Capacitor simgesini koyuyor; Android tarafına hiç simge vermediğimiz için
//     telefonda alakasız bir ikon görünüyordu. Android'in istediği bütün
//     boyutları elle hazırlamak yerine tek kaynaktan üretiyoruz — böylece
//     Chrome'daki simge ile APK'nınki BİREBİR aynı oluyor.
//  2) Simge değişirse tek komutla her şey yeniden üretiliyor:
//     web (PWA) simgeleri + Android'in beş yoğunluğu + uyarlanabilir ön plan.
//
// Simgeyi kodla ÇİZMİYORUZ: kullanıcının verdiği görselin kendisi kullanılıyor,
// yani sonuç birebir o dosya. (Önceden elle yeniden çiziliyordu ve küçük
// farklar kaçınılmazdı.)
//
// Ölçekleme Chromium'un canvas'ında yapılıyor (Playwright zaten testler için
// kurulu). Node tarafında görüntü kütüphanesi gerekmiyor.
//
// Çalıştır:  node scripts/make-icon.mjs

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KAYNAK = path.join(ROOT, 'assets', 'icon-source.png');
const ICONS = path.join(ROOT, 'public', 'icons');
const ANDROID = path.join(ROOT, 'android-icons');

if (!fs.existsSync(KAYNAK)) {
  console.error(`Kaynak simge yok: ${KAYNAK}`);
  process.exit(1);
}
const kaynakB64 = fs.readFileSync(KAYNAK).toString('base64');

const browser = await chromium.launch({
  executablePath: fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined,
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');

// Kaynağı bir kez yükle ve köşe rengini öğren: uyarlanabilir simgenin arka
// plan rengi bu olacak, yoksa ön plandaki kare kenar belli olur.
const kose = await page.evaluate(async (b64) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  window.__kaynak = img;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);

  // ARKA PLANDAKİ TURUNCULUĞU AL.
  //
  // Kaynak görselin zemininde aşağı doğru sıcak (turuncumsu) bir geçiş var.
  // Sert bir eşikle "koyu pikselleri düz renk yap" dersek kenarlarda hale
  // oluşuyor. Onun yerine pikselin KOYULUĞU ölçüsünde renksizleştiriyoruz:
  //   • zemin (çok koyu)  → tamamen nötr griye çekiliyor, turunculuk gidiyor
  //   • kılıç/halka (parlak) → hiç dokunulmuyor
  //   • aradaki yumuşatma pikselleri → oranla karışıyor, hale çıkmıyor
  const im = x.getImageData(0, 0, c.width, c.height);
  const d2 = im.data;
  const ESIK = 96;                       // bu parlaklığın altı zemin sayılır
  for (let i = 0; i < d2.length; i += 4) {
    const r = d2[i], g = d2[i + 1], b = d2[i + 2];
    const par = 0.299 * r + 0.587 * g + 0.114 * b;
    if (par >= ESIK) continue;
    const w = (ESIK - par) / ESIK;       // 0 (sınırda) .. 1 (kapkara)
    const notr = par;                    // aynı parlaklıkta renksiz gri
    d2[i] = Math.round(r + (notr - r) * w);
    d2[i + 1] = Math.round(g + (notr - g) * w);
    d2[i + 2] = Math.round(b + (notr - b) * w);
  }
  x.putImageData(im, 0, 0);

  // Bundan sonrası düzeltilmiş görselle çalışsın.
  const temiz = new Image();
  temiz.src = c.toDataURL('image/png');
  await temiz.decode();
  window.__kaynak = temiz;

  const d = x.getImageData(3, 3, 1, 1).data;
  return { r: d[0], g: d[1], b: d[2], w: img.naturalWidth, h: img.naturalHeight };
}, kaynakB64);
const koseHex = '#' + [kose.r, kose.g, kose.b].map((v) => v.toString(16).padStart(2, '0')).join('');
console.log(`Kaynak: ${kose.w}x${kose.h} · köşe rengi ${koseHex}`);

/**
 * Kaynağı istenen boyutta yeniden üretir.
 * @param {number} S kenar uzunluğu
 * @param {{pay?: number, arka?: boolean}} o pay: güvenli alan payı (0..0.5)
 */
async function uret(S, o = {}) {
  const b64 = await page.evaluate(({ boy, opt, kosePx }) => {
    const img = window.__kaynak;
    const cv = document.getElementById('c');
    cv.width = boy; cv.height = boy;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, boy, boy);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const p = opt.pay || 0;
    if (opt.arka) { ctx.fillStyle = kosePx; ctx.fillRect(0, 0, boy, boy); }
    const ic = boy * (1 - p * 2);
    const kay = (boy - ic) / 2;
    // Kaynak neredeyse kare (510x511); kareye oturtmak için gerdiriyoruz.
    // Fark binde iki, gözle görülmez.
    ctx.drawImage(img, kay, kay, ic, ic);
    return cv.toDataURL('image/png').split(',')[1];
  }, { boy: S, opt: o, kosePx: koseHex });
  return Buffer.from(b64, 'base64');
}

function yaz(dosya, buf) {
  fs.mkdirSync(path.dirname(dosya), { recursive: true });
  fs.writeFileSync(dosya, buf);
}

// --- 1) Web / PWA simgeleri ---------------------------------------------
yaz(path.join(ICONS, 'icon-512.png'), await uret(512));
yaz(path.join(ICONS, 'icon-192.png'), await uret(192));
yaz(path.join(ICONS, 'apple-touch-icon.png'), await uret(180));
yaz(path.join(ICONS, 'favicon-32.png'), await uret(32));
// Maskelenebilir sürümde kenarlar kırpılabildiği için çizim küçültülüp
// arkası dolduruluyor.
yaz(path.join(ICONS, 'maskable-512.png'), await uret(512, { pay: 0.12, arka: true }));
yaz(path.join(ICONS, 'maskable-192.png'), await uret(192, { pay: 0.12, arka: true }));

// --- 2) Android launcher simgeleri --------------------------------------
// ic_launcher / ic_launcher_round eski launcher'lar için tam kare;
// ic_launcher_foreground uyarlanabilir simgenin ön planı (maske kenarlardan
// kırptığı için pay bırakıyoruz, arkası da köşe rengiyle doluyor ki kare
// kenarı belli olmasın).
const YOGUNLUK = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
fs.rmSync(ANDROID, { recursive: true, force: true });
for (const [ad, boy] of Object.entries(YOGUNLUK)) {
  const kare = await uret(boy);
  yaz(path.join(ANDROID, `mipmap-${ad}`, 'ic_launcher.png'), kare);
  yaz(path.join(ANDROID, `mipmap-${ad}`, 'ic_launcher_round.png'), kare);
  const on = Math.round(boy * 108 / 48);            // ön plan 108dp tuval
  yaz(path.join(ANDROID, `mipmap-${ad}`, 'ic_launcher_foreground.png'),
    await uret(on, { pay: 0.19, arka: true }));
}
yaz(path.join(ANDROID, 'values', 'ic_launcher_background.xml'),
  Buffer.from('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
    + `    <color name="ic_launcher_background">${koseHex}</color>\n</resources>\n`, 'utf-8'));

await browser.close();

const say = (d) => fs.readdirSync(d, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? say(path.join(d, e.name)) : 1), 0);
console.log(`Web simgeleri: ${ICONS}`);
console.log(`Android simgeleri: ${ANDROID} (${say(ANDROID)} dosya)`);
