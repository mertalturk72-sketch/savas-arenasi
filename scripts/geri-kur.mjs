// TUM-KOD.txt dosyasından bütün projeyi geri kurar.
//
// Kullanımı:  node geri-kur.mjs TUM-KOD.txt
//
// TUM-KOD.txt, scripts/make-source-dump.mjs tarafından üretilir ve projenin
// bütün metin kaynaklarını tek dosyada taşır. Tur atışı sınandı: geri kurulan
// dosyalar orijinalleriyle BİREBİR aynı çıkıyor.
//
// İkili dosyalar (simge, çim dokusu) bu metinde yoktur; onlar zip paketinde.
// Olmasalar bile oyun çalışır — yedek doku ve varsayılan simge devreye girer.

import fs from 'node:fs';
import path from 'node:path';
const metin = fs.readFileSync(process.argv[2] || 'TUM-KOD.txt', 'utf-8');
const parcalar = metin.split(/^={78}\n>>> DOSYA: (.+)\n={78}\n/m);
let n = 0;
for (let i = 1; i < parcalar.length; i += 2) {
  const yol = parcalar[i].trim();
  fs.mkdirSync(path.dirname(yol), { recursive: true });
  fs.writeFileSync(yol, parcalar[i + 1]);
  n++;
}
console.log('geri kurulan dosya:', n);
