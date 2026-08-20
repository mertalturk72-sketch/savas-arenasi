// www/ klasörünü tek bir ZIP dosyasına paketler: dist/paket.zip
//
// NEDEN: uygulamanın kendini içeriden güncelleyebilmesi için. APK "GÜNCELLE"
// deyince sunucudan bu zip'i indirip içindeki dosyaları kendi web katmanının
// yerine koyuyor; yeniden kurulum gerekmiyor (bkz. README "Uygulama kendini
// nasıl günceller").
//
// Neden elle zip yazıyoruz? Projenin kuralı: sunucunun ÇALIŞMASI için dış
// paket gerekmiyor. Bir sıkıştırma kütüphanesi eklemek yerine ZIP biçimini
// doğrudan yazıyoruz — sıkıştırma zaten Node'un içindeki zlib'de var.
//
// Çalıştır:  node scripts/make-bundle.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(ROOT, 'www');
const CIKTI = path.join(ROOT, 'dist', 'paket.zip');

// --- CRC32 (ZIP başlıkları için zorunlu) ---------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosyalar(dir, taban = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const tam = path.join(dir, e.name);
    const rel = taban ? `${taban}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...dosyalar(tam, rel));
    else if (e.isFile()) out.push({ rel, tam });
  }
  return out;
}

if (!fs.existsSync(path.join(WWW, 'index.html'))) {
  console.error('www/ yok — önce: node scripts/build-www.mjs');
  process.exit(1);
}

const kayitlar = [];
const parcalar = [];
let ofset = 0;

// ZIP'te tarih alanı var; sabit bir tarih kullanıyoruz ki aynı içerik her
// zaman aynı dosyayı üretsin (tekrarlanabilir çıktı).
const DOS_TARIH = 0x2821;   // 2000-01-01
const DOS_SAAT = 0;

for (const { rel, tam } of dosyalar(WWW).sort((a, b) => a.rel.localeCompare(b.rel))) {
  const ham = fs.readFileSync(tam);
  const sikis = zlib.deflateRawSync(ham, { level: 9 });
  // Sıkışma işe yaramadıysa (zaten sıkışık jpg/png) olduğu gibi sakla.
  const deflate = sikis.length < ham.length;
  const veri = deflate ? sikis : ham;
  const ad = Buffer.from(rel, 'utf-8');
  const crc = crc32(ham);

  const yerel = Buffer.alloc(30);
  yerel.writeUInt32LE(0x04034b50, 0);       // yerel başlık imzası
  yerel.writeUInt16LE(20, 4);               // gereken sürüm
  yerel.writeUInt16LE(0x0800, 6);           // bayrak: dosya adı UTF-8
  yerel.writeUInt16LE(deflate ? 8 : 0, 8);  // yöntem
  yerel.writeUInt16LE(DOS_SAAT, 10);
  yerel.writeUInt16LE(DOS_TARIH, 12);
  yerel.writeUInt32LE(crc, 14);
  yerel.writeUInt32LE(veri.length, 18);
  yerel.writeUInt32LE(ham.length, 22);
  yerel.writeUInt16LE(ad.length, 26);
  yerel.writeUInt16LE(0, 28);

  parcalar.push(yerel, ad, veri);
  kayitlar.push({ ad, crc, sikisik: veri.length, ham: ham.length, deflate, ofset });
  ofset += yerel.length + ad.length + veri.length;
}

const merkez = [];
for (const k of kayitlar) {
  const b = Buffer.alloc(46);
  b.writeUInt32LE(0x02014b50, 0);           // merkezi dizin imzası
  b.writeUInt16LE(20, 4);                   // üreten sürüm
  b.writeUInt16LE(20, 6);                   // gereken sürüm
  b.writeUInt16LE(0x0800, 8);
  b.writeUInt16LE(k.deflate ? 8 : 0, 10);
  b.writeUInt16LE(DOS_SAAT, 12);
  b.writeUInt16LE(DOS_TARIH, 14);
  b.writeUInt32LE(k.crc, 16);
  b.writeUInt32LE(k.sikisik, 20);
  b.writeUInt32LE(k.ham, 24);
  b.writeUInt16LE(k.ad.length, 28);
  b.writeUInt32LE(k.ofset, 42);
  merkez.push(b, k.ad);
}
const merkezBuf = Buffer.concat(merkez);

const son = Buffer.alloc(22);
son.writeUInt32LE(0x06054b50, 0);           // merkezi dizin sonu
son.writeUInt16LE(kayitlar.length, 8);
son.writeUInt16LE(kayitlar.length, 10);
son.writeUInt32LE(merkezBuf.length, 12);
son.writeUInt32LE(ofset, 16);

fs.mkdirSync(path.dirname(CIKTI), { recursive: true });
fs.writeFileSync(CIKTI, Buffer.concat([...parcalar, merkezBuf, son]));

const boy = fs.statSync(CIKTI).size;
console.log(`paket.zip hazır — ${kayitlar.length} dosya · ${(boy / 1024).toFixed(0)} KB`);
console.log(`Konum: ${CIKTI}`);
