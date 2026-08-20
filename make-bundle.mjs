// www/ klasörünü düz dosya sunucusu olarak servis eder (APK'nın içindeki
// durumu taklit eder: oyun sunucusu YOK, sadece dosyalar).
// Çalıştır:  node scripts/serve-www.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'www');
const PORT = Number(process.argv[2] || process.env.PORT || 3100);
const TIP = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const dosya = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!dosya.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(dosya, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('yok'); return; }
    res.writeHead(200, { 'Content-Type': TIP[path.extname(dosya)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`www/ servis ediliyor: http://localhost:${PORT}`));
