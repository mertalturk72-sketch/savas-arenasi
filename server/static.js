// Bağımlılıksız, güvenli statik dosya sunucusu (public/ ve shared/ için).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

// Yalnızca bu klasörler dışarıya açık.
const ALLOWED = ['public', 'shared'];

// --- Service worker sürüm damgası ---------------------------------------
// Oyun dosyalarından bir özet çıkarıp sw.js'e gömüyoruz. Böylece kodda bir
// şey değişince telefondaki kurulu uygulama eski sürümde takılı kalmaz;
// yeni service worker kendiliğinden devreye girer.
function hashTree(dir, hash) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return hash; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) hashTree(full, hash);
    else if (e.name !== 'sw.js') {
      try { hash.update(e.name).update(fs.readFileSync(full)); } catch { /* atla */ }
    }
  }
  return hash;
}

let swCache = null;
function buildServiceWorker() {
  if (swCache) return swCache;
  const stamp = hashTree(path.join(ROOT, 'shared'),
    hashTree(path.join(ROOT, 'public'), crypto.createHash('sha256'))).digest('hex').slice(0, 12);
  const src = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf-8');
  swCache = src.replace(/const VERSION = '[^']*';/, `const VERSION = '${stamp}';`);
  return swCache;
}

export function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400); res.end('Bad request'); return true;
  }

  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  // Service worker'ı sürüm damgasıyla üretip veriyoruz
  if (urlPath === '/sw.js') {
    let body;
    try { body = buildServiceWorker(); } catch { res.writeHead(500); res.end(''); return true; }
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-cache',
    });
    res.end(body);
    return true;
  }

  // /shared/... doğrudan; diğer her şey public/ altından
  const rel = urlPath.startsWith('/shared/')
    ? urlPath.slice(1)
    : path.join('public', urlPath);

  const filePath = path.resolve(ROOT, rel);

  // Dizin dışına çıkma (path traversal) koruması
  const okRoot = ALLOWED.some((dir) => {
    const base = path.resolve(ROOT, dir);
    return filePath === base || filePath.startsWith(base + path.sep);
  });
  if (!okRoot) { res.writeHead(403); res.end('Forbidden'); return true; }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bulunamadı');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
  return true;
}
