// Bütün kaynak kodu TEK dosyada toplar: dist/TUM-KOD.txt
//
// NEDEN: sohbet silinse, ortam sıfırlansa, aylar geçse bile projenin tamamı
// tek bir metin dosyasından geri kurulabilsin. Kullanıcı bu dosyayı saklayıp
// gerektiğinde yapıştırıyor; içindeki geri kurma betiği de dosyanın kendi
// içinde yazılı.
//
// İkili dosyalar (simge, doku) metne sığmaz; onlar zip'te. Üretilen dosyalar
// (www/, dist/, savas-arenasi.html, package-lock.json) da alınmaz — komutla
// yeniden üretiliyorlar.
//
// Çalıştır:  node scripts/make-source-dump.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CIKTI = path.join(ROOT, 'dist', 'TUM-KOD.txt');

const KLASORLER = ['shared', 'server', 'public', 'scripts', 'test', '.github'];
const KOK_DOSYALAR = ['package.json', 'capacitor.config.json', 'render.yaml', '.gitignore', 'README.md', 'PROJE-HAFIZASI.md'];
const UZANTI = new Set(['.js', '.mjs', '.css', '.html', '.yml', '.json', '.webmanifest', '.md']);
// Üretilen ya da ikili olanlar
const ATLA = new Set(['savas-arenasi.html']);
const ATLA_KLASOR = new Set(['icons', 'textures', 'node_modules']);

function topla(dir, taban = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (ATLA_KLASOR.has(e.name)) continue;
    const tam = path.join(dir, e.name);
    const rel = taban ? `${taban}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...topla(tam, rel));
    else if (e.isFile() && UZANTI.has(path.extname(e.name)) && !ATLA.has(e.name)) out.push({ rel, tam });
  }
  return out;
}

const dosyalar = [];
for (const k of KLASORLER) {
  if (fs.existsSync(path.join(ROOT, k))) dosyalar.push(...topla(path.join(ROOT, k), k));
}
for (const d of KOK_DOSYALAR) {
  if (fs.existsSync(path.join(ROOT, d))) dosyalar.push({ rel: d, tam: path.join(ROOT, d) });
}

const AYRAC = '='.repeat(78);
const parcalar = [];

parcalar.push(`${AYRAC}
SAVAŞ ARENASI — TÜM KAYNAK KOD (tek dosya)
${AYRAC}

Bu dosya projenin bütün kaynak kodunu içerir. Her dosya şu satırla başlar:

    ${AYRAC}
    >>> DOSYA: yol/adi.js
    ${AYRAC}

NASIL GERİ KURULUR
------------------
Bu dosyayı bir klasöre koy ve yanına şu betiği "geri-kur.mjs" adıyla kaydedip
çalıştır (node geri-kur.mjs TUM-KOD.txt):

    import fs from 'node:fs';
    import path from 'node:path';
    const metin = fs.readFileSync(process.argv[2] || 'TUM-KOD.txt', 'utf-8');
    const parcalar = metin.split(/^={78}\\n>>> DOSYA: (.+)\\n={78}\\n/m);
    for (let i = 1; i < parcalar.length; i += 2) {
      const yol = parcalar[i].trim();
      fs.mkdirSync(path.dirname(yol), { recursive: true });
      fs.writeFileSync(yol, parcalar[i + 1]);
      console.log('yazıldı:', yol);
    }

Sonra:
    npm install          (sadece APK derlemek için; sunucu için gerekmez)
    node scripts/make-icon.mjs      (simgeler — assets/icon-source.png gerekir)
    node scripts/make-texture.mjs   (çim dokusu — kaynak görsel gerekir)
    npm start

BU DOSYADA OLMAYANLAR (ikili oldukları için)
--------------------------------------------
  assets/icon-source.png      simgenin kaynağı
  public/icons/*.png          üretilmiş simgeler
  public/textures/grass.jpg   çim dokusu
  android-icons/**            üretilmiş Android simgeleri
  package-lock.json           "npm install" yeniden üretir

Bunlar zip paketinde var. Kaybolurlarsa oyun yine çalışır: simge yerine
varsayılan, çimen yerine kodla üretilen yedek doku devreye girer.

${AYRAC}
İÇİNDEKİLER (${dosyalar.length} dosya)
${AYRAC}
`);

for (const d of dosyalar) {
  const boy = fs.statSync(d.tam).size;
  parcalar.push(`  ${d.rel.padEnd(46)} ${String(boy).padStart(7)} bayt\n`);
}
parcalar.push('\n');

// Biçim BİLEREK sade: ayraç satırı, dosya adı, ayraç satırı, sonra içerik.
// Araya fazladan boş satır KOYMUYORUZ — koyduğumuzda geri kurarken onu
// silmek gerekiyor, silince de dosyanın kendi son satır sonu gidiyordu
// (son dosyada fark ediliyordu). Şimdi geri kurma hiçbir şey kırpmıyor.
for (const d of dosyalar) {
  parcalar.push(`${AYRAC}\n>>> DOSYA: ${d.rel}\n${AYRAC}\n`);
  parcalar.push(fs.readFileSync(d.tam, 'utf-8').replace(/\n?$/, '\n'));
}

fs.mkdirSync(path.dirname(CIKTI), { recursive: true });
fs.writeFileSync(CIKTI, parcalar.join(''), 'utf-8');

const boy = fs.statSync(CIKTI).size;
const satir = fs.readFileSync(CIKTI, 'utf-8').split('\n').length;
console.log(`TUM-KOD.txt hazır — ${dosyalar.length} dosya · ${(boy / 1024).toFixed(0)} KB · ${satir} satır`);
console.log(`Konum: ${CIKTI}`);
