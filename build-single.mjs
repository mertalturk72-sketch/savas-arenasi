// Oyunun "içerik damgası" — tek ve tek yerde tanımlı hâli.
//
// Neden tek yerde:
//   Damgayı üç yer üretiyor: sunucu (/surum.json), www paketi (APK'nın içi) ve
//   tek dosyalık sürüm. Üçü aynı sonucu vermezse paketlenmiş uygulama sunucuda
//   hep "yeni sürüm var" sanır ve kullanıcıyı boşuna güncellemeye çağırır.
//   Bu yüzden hesap burada, herkesin ortak kullandığı tek bir işlevde.
//
// Neyi hesaba katıyor: public/ ve shared/ altındaki tüm dosyaların içeriği.
// Neyi katmıyor: üretilmiş çıktılar. Bunlar damgadan türediği için damgaya
//   girerlerse kendi kendine besleme (her derlemede farklı damga) olur.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Üretilmiş dosyalar — damgaya girmezler.
const URETILMIS = new Set(['sw.js', 'savas-arenasi.html', 'surum.json']);

function hashTree(dir, hash) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return hash; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (URETILMIS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) hashTree(full, hash);
    else {
      try { hash.update(e.name).update(fs.readFileSync(full)); } catch { /* atla */ }
    }
  }
  return hash;
}

/**
 * @param {string} root proje kökü
 * @returns {string} 12 haneli içerik damgası
 */
export function contentStamp(root) {
  return hashTree(path.join(root, 'shared'),
    hashTree(path.join(root, 'public'), crypto.createHash('sha256')))
    .digest('hex').slice(0, 12);
}
