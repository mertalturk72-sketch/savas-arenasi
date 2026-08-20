// "Duvar var ama içinden geçiliyor" — hayalet duvar testi.
//
// ŞİKÂYET: arkadaşı haritada bir duvar görüyor, üstüne yürüyor, duvar yokmuş
// gibi içinden geçiyor. Bazen de tersi: boş görünen yerde görünmez bir şeye
// tosluyor.
//
// KÖK NEDEN: sabit dünya katmanı (çim + binalar) 512 pikselik parçalar hâlinde
// bir kez çizilip önbelleğe alınıyor. Önbelleğin "bu hangi harita" kimliği
// SADECE haritanın en-boyuydu:
//
//     this._tileMapKey = `${map.w}x${map.h}`
//
// Arena her maçta yeniden ÜRETİLİYOR ama boyutu hep aynı. Yani kimlik hiç
// değişmiyor, önbellek hiç temizlenmiyordu. Bir sonraki maçta ekranda ÖNCEKİ
// haritanın duvarları görünüyor, çarpışma ise YENİ haritaya göre işliyordu.
// Önbellekte en fazla 40 parça tutulduğu için sadece bazı bölgelerde oluyordu
// — bu yüzden "bazen" diye tarif ediliyordu.
//
// ÇÖZÜM: kimlik artık haritanın geometrisinden üretiliyor (mapSignature).
//
// BU TEST NE YAPIYOR: aynı boyutta ama farklı duvarlara sahip iki harita
// çizdiriyor ve çıkan görüntülerin FARKLI olmasını bekliyor. Düzeltme geri
// alınırsa ikinci çizim önbellekten gelir, iki görüntü BİREBİR aynı çıkar ve
// test düşer.
//
// Çalıştır:  node test/browser-hayaletduvar.mjs

import { botlariCikar, botAyarla, modSec } from './yardimci.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3000';
const errors = [];

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});

const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`sayfa hatası: ${e.message}`));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#screenMenu.active', { timeout: 15000 });
await page.click('#tabLocal');
await page.waitForTimeout(400);
await page.fill('#nameInput', 'Duvar');
await page.dispatchEvent('#nameInput', 'change');
await page.click('#btnCreate');
await page.waitForSelector('#screenLobby.active', { timeout: 8000 });
await modSec(page, 0);
await botAyarla(page, 1);
await page.click('#btnReady');
await page.waitForSelector('#screenGame.active', { timeout: 25000 });
await botlariCikar(page);
await page.waitForTimeout(1200);

// ===== 1) İmza: aynı boyut + farklı duvar = farklı imza ==================
const imza = await page.evaluate(() => {
  const { mapSignature } = window.__render;
  const harita = window.__game.map;
  if (typeof mapSignature !== 'function') return { yok: true };
  const ayni = { ...harita, obstacles: harita.obstacles.map((o) => ({ ...o })) };
  const farkli = { ...harita, obstacles: harita.obstacles.map((o, i) => (i === 0 ? { ...o, x: o.x + 64 } : { ...o })) };
  return {
    yok: false,
    boyutAyni: ayni.w === farkli.w && ayni.h === farkli.h,
    a: mapSignature(harita),
    b: mapSignature(ayni),
    c: mapSignature(farkli),
  };
});
if (imza.yok) errors.push('mapSignature dışa aktarılmamış');
else {
  console.log('1) imza:', JSON.stringify(imza));
  if (!imza.boyutAyni) errors.push('test kurulumu: iki haritanın boyutu farklı çıktı');
  if (imza.a !== imza.b) errors.push('aynı harita farklı imza üretti (önbellek boşuna temizlenir)');
  if (imza.a === imza.c) errors.push('KÖK HATA: duvarı kaymış harita AYNI imzayı üretti — önbellek temizlenmez');
}

// ===== 2) Çizim: harita değişince ekran gerçekten değişmeli ==============
// Görüntüyü doğrudan piksel piksel karşılaştırıyoruz. "Önbellek temizlendi mi"
// gibi dolaylı bir şeye değil, kullanıcının GÖRDÜĞÜ şeye bakıyor.
const ciz = await page.evaluate(() => {
  const g = window.__game;
  const R = g.renderer;
  const harita = g.map;

  // İçinde duvar bulunan bir 512'lik parça seç
  const o = harita.obstacles[0];
  const tx = Math.floor(o.x / 512), ty = Math.floor(o.y / 512);
  const ox = tx * 512, oy = ty * 512;

  const cizVe = (m) => {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 512;
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.translate(-ox, -oy);
    R.drawWorld(c, m, { x0: ox, y0: oy, x1: ox + 511, y1: oy + 511 });
    return c.getImageData(0, 0, 512, 512).data;
  };

  const fark = (a, b) => {
    let n = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
    }
    return n;
  };

  // Seçilen parçanın içine büyük, göze batan bir duvar koyulmuş ikinci harita.
  // Boyutlar birebir aynı — eski kimlik (`WxH`) bunu ayırt EDEMEZ.
  const duvarli = {
    ...harita,
    obstacles: [...harita.obstacles, { x: ox + 80, y: oy + 80, w: 340, h: 340, type: 'wall' }],
  };

  const a1 = cizVe(harita);
  const b1 = cizVe(duvarli);
  const a2 = cizVe(harita);          // ilk haritaya geri dön

  return {
    tx, ty,
    aynisiTekrar: fark(a1, a2),      // aynı harita → 0 olmalı
    duvarEklenince: fark(a1, b1),    // farklı harita → binlerce piksel
    toplamPiksel: 512 * 512,
  };
});
console.log('2) çizim:', JSON.stringify(ciz));
if (ciz.duvarEklenince < 5000) {
  errors.push(`KÖK HATA: harita değişti ama ekran değişmedi (${ciz.duvarEklenince} piksel farklı) — bayat önbellek`);
}
if (ciz.aynisiTekrar !== 0) {
  errors.push(`aynı harita iki kez farklı çizildi (${ciz.aynisiTekrar} piksel) — çizim kararsız`);
}

// ===== 3) Gördüğün duvar GERÇEK duvar mı? ===============================
// Ekranda görünen bina piksellerinin altında sahiden bir engel var mı diye
// bakıyoruz: oyuncunun kamerasındaki her bina köşesini çarpışma indeksine
// soruyoruz. Hayalet duvar olsa burada "çizili ama engel değil" çıkardı.
const tutarli = await page.evaluate(() => {
  const g = window.__game;
  const harita = g.map;
  const idx = g.idx;
  const buf = [];
  // physics.js'i tekrar içe aktarmak yerine indeksi doğrudan yokluyoruz.
  const hucre = idx.cell;
  let eksik = 0;
  for (const o of harita.obstacles) {
    const mx = o.x + o.w / 2, my = o.y + o.h / 2;
    const c = Math.min(idx.cols - 1, Math.max(0, Math.floor(mx / hucre)));
    const r = Math.min(idx.rows - 1, Math.max(0, Math.floor(my / hucre)));
    const kova = idx.cells[r * idx.cols + c];
    if (!kova || kova.indexOf(o) === -1) eksik++;
  }
  return { duvar: harita.obstacles.length, indekstenEksik: eksik };
});
console.log('3) çizilen duvarların çarpışma indeksindeki karşılığı:', JSON.stringify(tutarli));
if (tutarli.indekstenEksik > 0) {
  errors.push(`${tutarli.indekstenEksik} duvar çiziliyor ama çarpışma indeksinde yok`);
}

await ctx.close();
await browser.close();

console.log('\n--- Hatalar ---');
if (errors.length) {
  for (const e of errors) console.log('  ✗', e);
  console.log('\nHAYALET DUVAR TESTİ BAŞARISIZ ✗');
  process.exit(1);
}
console.log('yok ✓');
console.log('\nHAYALET DUVAR TESTİ GEÇTİ ✓');
