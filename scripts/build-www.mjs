// Tarayıcıya giden her şeyi tek bir klasörde toplar: www/
//
// Neden gerekli: oyun `/shared/...` ve `/css/...` gibi kök yollar kullanıyor.
// Sunucuda bu iki klasör ayrı ayrı servis ediliyor; ama Android uygulamasında
// (ya da herhangi bir statik hostta) tek bir kök klasör olmalı. Bu betik
// public/ içeriğini www/ köküne, shared/ klasörünü de www/shared/ altına kopyalar.
//
// Çalıştır:  node scripts/build-www.mjs

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WWW = path.join(ROOT, 'www');

// Tek dosyalık sürüm sadece indirilmek için public/ altında duruyor.
// Uygulamanın (APK) içine girmesinin anlamı yok — 235 KB'lık kopyayı atla.
const SKIP = new Set(['savas-arenasi.html']);

function copyDir(src, dest, root = true) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (root && SKIP.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d, false);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  }
  return n;
}

fs.rmSync(WWW, { recursive: true, force: true });
copyDir(path.join(ROOT, 'public'), WWW);
copyDir(path.join(ROOT, 'shared'), path.join(WWW, 'shared'));

// Paketlenmiş sürümde uygulamanın içinde sunucu yoktur; oyun çevrimdışı
// başlasın diye index.html'e bir işaret koyuyoruz.
const indexPath = path.join(WWW, 'index.html');
let html = fs.readFileSync(indexPath, 'utf-8');
html = html.replace(
  '<script type="module" src="/js/main.js"></script>',
  '<script>window.__BUNDLED__ = true;</script>\n<script type="module" src="/js/main.js"></script>',
);
fs.writeFileSync(indexPath, html);

// Service worker sürümünü içerik özetinden üret: dosyalardan biri değiştiyse
// damga değişir, telefondaki eski önbellek otomatik atılır.
function hashDir(dir, hash) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) hashDir(full, hash);
    else if (e.name !== 'sw.js') hash.update(e.name).update(fs.readFileSync(full));
  }
  return hash;
}
const stamp = hashDir(WWW, crypto.createHash('sha256')).digest('hex').slice(0, 12);
const swPath = path.join(WWW, 'sw.js');
const sw = fs.readFileSync(swPath, 'utf-8').replace(/const VERSION = '[^']*';/, `const VERSION = '${stamp}';`);
fs.writeFileSync(swPath, sw);

console.log(`Service worker sürümü: ${stamp}`);
console.log(`www/ hazır — ${countFiles(WWW)} dosya`);
console.log(`Konum: ${WWW}`);
