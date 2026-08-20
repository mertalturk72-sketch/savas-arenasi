// Tüm oyunu TEK BİR HTML DOSYASINA gömer.
//
// Neden gerekli:
//   Telefonda çevrimdışı oynamak için service worker lazım, o da sadece
//   https:// adreslerde çalışıyor. Ev ağındaki http://192.168... adresinde
//   çalışmıyor; PC kapanınca sayfa ölü bir anlık görüntüye dönüyor.
//   Bu dosya o zinciri tamamen kesiyor: çıkan .html dosyasını telefona atıp
//   açtığında sunucu, internet, kurulum ve HTTPS gerekmeden oyun çalışır.
//
// Nasıl çalışıyor:
//   ES modülleri tarayıcıda file:// üzerinden import edilemez (CORS). Bu yüzden
//   modül grafiğini gezip her dosyayı küçük bir kayıt defterine sarıyoruz ve
//   tek bir satır içi <script> olarak gömüyoruz. Böylece hiçbir dış istek kalmıyor.
//
// Çalıştır:  node scripts/build-single.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentStamp } from '../server/stamp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist');
const ENTRY = '/js/main.js';

// --- modül yolu → disk yolu ----------------------------------------------
function toDisk(spec) {
  if (spec.startsWith('/shared/')) return path.join(ROOT, spec.slice(1));
  if (spec.startsWith('/js/')) return path.join(ROOT, 'public', spec.slice(1));
  throw new Error(`Beklenmeyen modül yolu: ${spec}`);
}

function resolveSpec(spec, fromId) {
  if (spec.startsWith('/')) return spec;
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const base = path.posix.dirname(fromId);
    return path.posix.normalize(path.posix.join(base, spec));
  }
  throw new Error(`Çözülemeyen import: ${spec} (${fromId} içinde)`);
}

// --- ES modül sözdizimini kayıt defteri çağrılarına çevir -----------------
function transform(code, id) {
  const deps = new Set();
  let out = code;

  // import ... from '...'  (tüm biçimler)
  out = out.replace(
    /^[ \t]*import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm,
    (m, clause, spec) => {
      const target = resolveSpec(spec, id);
      deps.add(target);
      const c = clause.trim();

      // import * as ns from 'x'
      const ns = c.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (ns) return `const ${ns[1]} = __req(${JSON.stringify(target)});`;

      // import def, { a, b } from 'x'  /  import { a } from 'x'  /  import def from 'x'
      const braced = c.match(/^(?:([A-Za-z_$][\w$]*)\s*,\s*)?\{([\s\S]*)\}$/);
      if (braced) {
        const [, def, names] = braced;
        const bindings = names.split(',').map((n) => n.trim()).filter(Boolean)
          .map((n) => n.replace(/\s+as\s+/, ': '))
          .join(', ');
        const lines = [];
        if (def) lines.push(`const ${def} = __req(${JSON.stringify(target)}).default;`);
        if (bindings) lines.push(`const { ${bindings} } = __req(${JSON.stringify(target)});`);
        return lines.join('\n');
      }

      // import def from 'x'
      if (/^[A-Za-z_$][\w$]*$/.test(c)) {
        return `const ${c} = __req(${JSON.stringify(target)}).default;`;
      }
      throw new Error(`Anlaşılmayan import biçimi: ${m} (${id})`);
    },
  );

  // yan etkili import: import 'x';
  out = out.replace(/^[ \t]*import\s+['"]([^'"]+)['"];?[ \t]*$/gm, (m, spec) => {
    const target = resolveSpec(spec, id);
    deps.add(target);
    return `__req(${JSON.stringify(target)});`;
  });

  // dinamik import('...') → zaten yüklü modülü döndür
  out = out.replace(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, (m, spec) => {
    const target = resolveSpec(spec, id);
    deps.add(target);
    return `Promise.resolve(__req(${JSON.stringify(target)}))`;
  });

  // export { a, b as c };
  const reexports = [];
  out = out.replace(/^[ \t]*export\s*\{([^}]*)\};?[ \t]*$/gm, (m, names) => {
    for (const raw of names.split(',')) {
      const n = raw.trim();
      if (!n) continue;
      const [local, exported = local] = n.split(/\s+as\s+/).map((x) => x.trim());
      reexports.push(`__exp.${exported} = ${local};`);
    }
    return '';
  });

  // export const/let/var/function/class/async function
  const named = [];
  out = out.replace(
    /^[ \t]*export\s+(const|let|var|function\*?|class|async\s+function\*?)\s+([A-Za-z_$][\w$]*)/gm,
    (m, kind, name) => {
      named.push(name);
      return m.replace(/^([ \t]*)export\s+/, '$1');
    },
  );

  // export default ...
  let hasDefault = false;
  out = out.replace(/^[ \t]*export\s+default\s+/gm, () => {
    hasDefault = true;
    return '__exp.default = ';
  });

  const tail = [
    ...named.map((n) => `__exp.${n} = ${n};`),
    ...reexports,
  ].join('\n');

  void hasDefault;
  return { code: `${out}\n${tail}\n`, deps: [...deps] };
}

// --- modül grafiğini topla ------------------------------------------------
const modules = new Map();
function collect(id) {
  if (modules.has(id)) return;
  const disk = toDisk(id);
  const src = fs.readFileSync(disk, 'utf-8');
  const { code, deps } = transform(src, id);
  modules.set(id, code);
  for (const d of deps) collect(d);
}
collect(ENTRY);

// --- Zemin dokusunu data URL olarak göm -----------------------------------
// Tek dosya HİÇBİR dış istek yapmamalı; görsel de içeride olmak zorunda.
let grassDataUrl = '';
const grassPath = path.join(ROOT, 'public', 'textures', 'grass.jpg');
if (fs.existsSync(grassPath)) {
  grassDataUrl = `data:image/jpeg;base64,${fs.readFileSync(grassPath).toString('base64')}`;
}

// --- Bu paketin içerik damgası --------------------------------------------
// Sunucunun /surum.json için kullandığı işlevin AYNISI (server/stamp.js).
const buildStamp = contentStamp(ROOT);

// --- HTML'i hazırla -------------------------------------------------------
let html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf-8');
const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf-8');

// dış dosya bağlantılarını kaldır / gömme ile değiştir
html = html.replace(/<link rel="stylesheet"[^>]*>/, `<style>\n${css}\n</style>`);
html = html.replace(/<link rel="manifest"[^>]*>\s*/, '');
html = html.replace(/<link rel="icon"[^>]*>\s*/, '');
html = html.replace(/<link rel="apple-touch-icon"[^>]*>\s*/, '');
html = html.replace(/<script type="module" src="\/js\/main\.js"><\/script>/, '__BUNDLE__');

const registry = `<script>
(function () {
  'use strict';
  // Tek dosya sürümü: tüm modüller burada, hiçbir dış istek yok.
  var __defs = {};
  var __cache = {};
  function __req(id) {
    if (__cache[id]) return __cache[id].__exp;
    var m = __defs[id];
    if (!m) throw new Error('Modül bulunamadı: ' + id);
    var box = { __exp: {} };
    __cache[id] = box;
    m(box.__exp, __req);
    return box.__exp;
  }
  // Paketlenmiş sürüm: içinde sunucu yok, doğrudan çevrimdışı başlar.
  window.__SINGLE_FILE__ = true;
  window.__BUNDLED__ = true;
  // Bu paketin içerik damgası: sunucudaki sürümle karşılaştırmak için.
  window.__BUILD__ = ${JSON.stringify(buildStamp)};
  // Zemin dokusu dosyadan okunamaz (dış istek yok), gömülü hâlini veriyoruz.
  window.__GRASS_URL = ${JSON.stringify(grassDataUrl)};
${[...modules.entries()].map(([id, code]) => `
  __defs[${JSON.stringify(id)}] = function (__exp, __req) {
${code}
  };`).join('\n')}

  __req(${JSON.stringify(ENTRY)});
})();
</script>`;

html = html.replace('__BUNDLE__', registry);

fs.mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, 'savas-arenasi.html');
fs.writeFileSync(outFile, html);

// Aynı dosyayı sunucunun da servis etmesi için public/ altına kopyala.
// Böylece kullanıcı telefonu kabloya takmadan, sadece tarayıcıdan
// http://<sunucu>/indir adresine girip dosyayı indirebiliyor.
const publicCopy = path.join(ROOT, 'public', 'savas-arenasi.html');
fs.writeFileSync(publicCopy, html);
const kb = (fs.statSync(outFile).size / 1024).toFixed(0);
console.log(`Tek dosya hazır: ${outFile}`);
console.log(`Sunucu kopyası:  ${publicCopy}  (→ /savas-arenasi.html)`);
console.log(`${modules.size} modül gömüldü · ${kb} KB`);
console.log('Bu dosyayı telefona at ve aç — sunucu, internet ve kurulum gerekmez.');
