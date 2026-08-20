// Android simgelerini TEK dosyaya paketler / tek dosyadan geri açar.
//
// NEDEN VAR
// ---------
// GitHub'ın web arayüzü tek seferde en fazla 100 dosya kabul ediyor ve depo
// 99'a dayanmıştı — bir dosya daha eklense yükleme yapılamayacaktı. En kalabalık
// ve en "ölü" klasör android-icons: 16 dosya, hiç elle düzenlenmiyor, sadece
// APK derlenirken Android projesine kopyalanıyor.
//
// Bu 16 dosya artık depoda TEK dosya olarak duruyor: android-icons.pack.json
// (baytlar base64). Derleme başında bu betik onları geri açıyor.
//
// NEDEN YENİDEN ÜRETMİYORUZ
// -------------------------
// Simgeleri üreten scripts/make-icon.mjs ölçeklemeyi Chromium'un canvas'ında
// yapıyor (Playwright). Derleme makinesinde tarayıcı kurmak hem ağır hem de
// kırılgan olurdu; ayrıca üretimi oraya taşımak public/icons'u da yeniden
// yazardı — orası SÜRÜM DAMGASINA giriyor ve bir baytı bile değişirse
// paketlenmiş uygulama sunucuda durmadan "yeni sürüm var" sanır.
//
// Paketleyip açmak bu risklerin ikisini de taşımıyor: baytlar birebir aynı.
//
// Kullanım:
//   node scripts/simge-paketle.mjs paketle    android-icons/ -> android-icons.pack.json
//   node scripts/simge-paketle.mjs ac         android-icons.pack.json -> android-icons/

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KLASOR = path.join(ROOT, 'android-icons');
const PAKET = path.join(ROOT, 'android-icons.pack.json');

function dosyalar(dir, taban = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const tam = path.join(dir, e.name);
    const rel = taban ? `${taban}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...dosyalar(tam, rel));
    else if (e.isFile()) out.push({ rel, tam });
  }
  return out;
}

function ozet(veri) {
  return crypto.createHash('sha256').update(veri).digest('hex').slice(0, 16);
}

const komut = process.argv[2] || 'ac';

if (komut === 'paketle') {
  if (!fs.existsSync(KLASOR)) {
    console.error(`Klasör yok: ${KLASOR} — önce "node scripts/make-icon.mjs" çalıştır.`);
    process.exit(1);
  }
  const liste = dosyalar(KLASOR);
  const icerik = {};
  let toplam = 0;
  for (const d of liste) {
    const buf = fs.readFileSync(d.tam);
    icerik[d.rel] = buf.toString('base64');
    toplam += buf.length;
  }
  const paket = {
    aciklama: 'Android simgeleri. scripts/simge-paketle.mjs ac ile açılır.',
    kaynak: 'scripts/make-icon.mjs (assets/icon-source.png)',
    dosyaSayisi: liste.length,
    ozet: ozet(JSON.stringify(icerik)),
    dosyalar: icerik,
  };
  fs.writeFileSync(PAKET, JSON.stringify(paket, null, 1), 'utf-8');
  const boy = fs.statSync(PAKET).size;
  console.log(`paketlendi: ${liste.length} dosya · ${(toplam / 1024).toFixed(0)} KB → ${(boy / 1024).toFixed(0)} KB`);
  console.log(`özet: ${paket.ozet}`);
} else if (komut === 'ac') {
  if (!fs.existsSync(PAKET)) {
    console.error(`Paket yok: ${PAKET}`);
    process.exit(1);
  }
  const paket = JSON.parse(fs.readFileSync(PAKET, 'utf-8'));
  const bulunan = ozet(JSON.stringify(paket.dosyalar));
  if (paket.ozet && bulunan !== paket.ozet) {
    console.error(`Paket bozuk: özet tutmuyor (${bulunan} ≠ ${paket.ozet})`);
    process.exit(1);
  }
  let n = 0;
  for (const [rel, b64] of Object.entries(paket.dosyalar)) {
    const hedef = path.join(KLASOR, rel);
    fs.mkdirSync(path.dirname(hedef), { recursive: true });
    fs.writeFileSync(hedef, Buffer.from(b64, 'base64'));
    n++;
  }
  console.log(`açıldı: ${n} dosya → ${KLASOR}`);
  if (n !== paket.dosyaSayisi) {
    console.error(`Beklenen ${paket.dosyaSayisi} dosya, ${n} yazıldı`);
    process.exit(1);
  }
} else {
  console.error('Kullanım: node scripts/simge-paketle.mjs [paketle|ac]');
  process.exit(1);
}
