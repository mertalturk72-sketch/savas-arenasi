// Bağımlılıksız, güvenli statik dosya sunucusu (public/ ve shared/ için).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentStamp as buildStamp } from './stamp.js';

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
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

// Yalnızca bu klasörler dışarıya açık.
const ALLOWED = ['public', 'shared'];

// Damga hesabı server/stamp.js'de — sunucu, www paketi ve tek dosya sürümü
// aynı işlevi kullanıyor ki üçü de aynı sonucu versin.
let stampCache = null;
export function contentStamp() {
  if (!stampCache) stampCache = buildStamp(ROOT);
  return stampCache;
}

let swCache = null;
function buildServiceWorker() {
  if (swCache) return swCache;
  const src = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf-8');
  swCache = src.replace(/const VERSION = '[^']*';/, `const VERSION = '${contentStamp()}';`);
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

  // Sürüm bilgisi: paketlenmiş uygulama (APK / tek dosya) bunu okuyup
  // kendi damgasıyla karşılaştırır. Başka kaynaklardan da okunabilmesi
  // gerektiği için CORS açık — içinde sadece bir sürüm dizesi var.
  if (urlPath === '/surum.json') {
    const body = JSON.stringify({ surum: contentStamp(), oyun: 'savas-arenasi' });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
    return true;
  }

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
