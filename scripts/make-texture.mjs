// Verilen çim fotoğraflarını oyuna uygun TEK, DÖŞENEBİLİR ve TEKDÜZE OLMAYAN
// bir zemin dokusuna çevirir.
//
// Neden böyle:
//   * Fotoğrafı olduğu gibi döşemek iki sorun çıkarır: kenarlar birleşmezse
//     haritada ızgara gibi dikişler görünür, ve tek kiremit sürekli tekrar
//     ettiği için göz deseni yakalar.
//   * Birden fazla görsel verilirse bunları YUMUŞAK maskelerle harmanlıyoruz;
//     böylece zemin bölge bölge değişiyor ama hiçbir yerde kesme izi yok.
//   * Maske periyodik (kenarları birbirine sarılan) bir gürültüden üretiliyor,
//     bu yüzden harmanlanmış sonuç da dikişsiz kalıyor.
//   * Oyun zaten üstüne gündüz/gece rengini bindiriyor, o yüzden doku
//     "gündüz" parlaklığında bırakılıyor.
//
// Çalıştır:  node scripts/make-texture.mjs <görsel1> [görsel2 ...]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'textures', 'grass.jpg');

// --mix : görselleri 4x4 hücreye bölüp karıştırır (daha çeşitli ama daha
//         "karışık" görünür). Varsayılan: sade, tek parça döşeme.
const MIX = process.argv.includes('--mix');
const inputs = process.argv.slice(2).filter((f) => f !== '--mix' && fs.existsSync(f));
if (!inputs.length) {
  console.error('Kullanım: node scripts/make-texture.mjs <görsel1> [görsel2 ...]');
  process.exit(1);
}

const py = `
import sys
from PIL import Image, ImageEnhance
import numpy as np

dst = sys.argv[1]
MIX = sys.argv[2] == '1'
srcs = sys.argv[3:]
# Kiremit dünyada ~190 piksele sığdırıldığı için 512 fazlasıyla yeterli;
# mozaik modunda 4x4 hücre olduğu için 1024 gerekiyor.
SIZE = 1024 if MIX else 512
FEATHER = 48

def load(p):
    im = Image.open(p).convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)
    return np.asarray(im).astype(np.float32)

def mad(x, y):
    return float(np.abs(x - y).mean())

def seam_ratio(a):
    edge = (mad(a[:, 0, :], a[:, -1, :]) + mad(a[0, :, :], a[-1, :, :])) / 2
    inner = (mad(a[:, :-1, :], a[:, 1:, :]) + mad(a[:-1, :, :], a[1:, :, :])) / 2
    return edge / max(1e-3, inner)

def make_seamless(a):
    r = seam_ratio(a)
    if r < 2.0:
        return a, r, False
    rolled = np.roll(np.roll(a, SIZE // 2, axis=0), SIZE // 2, axis=1)
    ramp = np.linspace(0.0, 1.0, FEATHER * 2, dtype=np.float32)
    ramp = ramp * ramp * (3 - 2 * ramp)
    mid = SIZE // 2
    for i, t in enumerate(ramp):
        idx = mid - FEATHER + i
        w = 1.0 - abs(t * 2 - 1.0)
        rolled[idx, :, :] = rolled[idx, :, :] * (1 - w) + a[idx, :, :] * w
        rolled[:, idx, :] = rolled[:, idx, :] * (1 - w) + a[:, idx, :] * w
    return rolled, r, True

# --- periyodik yumuşak gürültü (harmanlama maskesi) -------------------------
# Kaba bir ızgarada rastgele değerler üretip kosinüs ile yumuşatarak büyütüyoruz.
# Izgara sarmalı (wrap) olduğu için maske de kenarlarda birbirine oturuyor —
# harmanlanan doku dikişsiz kalıyor.
def periodic_noise(cells, seed):
    rng = np.random.default_rng(seed)
    g = rng.random((cells, cells)).astype(np.float32)
    ys = np.linspace(0, cells, SIZE, endpoint=False, dtype=np.float32)
    xs = ys
    y0 = np.floor(ys).astype(int) % cells
    x0 = np.floor(xs).astype(int) % cells
    y1 = (y0 + 1) % cells
    x1 = (x0 + 1) % cells
    ty = ys - np.floor(ys)
    tx = xs - np.floor(xs)
    # smoothstep: köşeli geçiş yerine yumuşak
    ty = (ty * ty * (3 - 2 * ty))[:, None]
    tx = (tx * tx * (3 - 2 * tx))[None, :]
    a00 = g[np.ix_(y0, x0)]
    a01 = g[np.ix_(y0, x1)]
    a10 = g[np.ix_(y1, x0)]
    a11 = g[np.ix_(y1, x1)]
    top = a00 * (1 - tx) + a01 * tx
    bot = a10 * (1 - tx) + a11 * tx
    return top * (1 - ty) + bot * ty

def fbm(seed):
    # birkaç ölçeği üst üste koy: hem geniş bölgeler hem küçük yamalar
    n = periodic_noise(3, seed) * 0.55 + periodic_noise(6, seed + 1) * 0.30 \\
        + periodic_noise(12, seed + 2) * 0.15
    n -= n.min()
    n /= max(1e-6, n.max())
    return n

# --- yükle, dikişsizleştir --------------------------------------------------
imgs = []
for p in srcs:
    a, r, fixed = make_seamless(load(p))
    print('%-28s kenar/ic orani %.2f %s' % (p.split('/')[-1][:28], r, '(dikis kapatildi)' if fixed else '(zaten dikissiz)'))
    imgs.append(a)

# --- 4x4 döşe: çim teli boyutu doğru kalsın, tekrar periyodu 4 kat uzasın ---
# Çim tellerinin karaktere göre doğru boyutta görünmesi için bir kiremitin
# ~190 dünya pikselini kaplaması gerekiyor. Ama o zaman zemin her 190 pikselde
# bir tekrar ederdi ve göz bunu hemen yakalar. Çözüm: kiremiti 4x4 hücreye
# bölüp her hücreye kaynaklardan birini rastgele döndürerek/çevirerek koymak.
# Dikişsiz bir dokunun çevrilmişi/döndürülmüşü de dikişsiz olduğu için sonuç
# yine kusursuz döşeniyor — ama artık tekrar periyodu 760 piksel.
CELLS = 4
CELL = SIZE // CELLS
rng_t = np.random.default_rng(31337)
small = [np.asarray(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
                    .resize((CELL, CELL), Image.LANCZOS)).astype(np.float32) for a in imgs]

tiled = []
for _ in range(len(imgs) if MIX else 0):
    canvas = np.zeros((SIZE, SIZE, 3), dtype=np.float32)
    for cy in range(CELLS):
        for cx in range(CELLS):
            cell = small[int(rng_t.integers(0, len(small)))]
            k = int(rng_t.integers(0, 4))
            cell = np.rot90(cell, k)
            if rng_t.random() > 0.5:
                cell = cell[:, ::-1, :]
            if rng_t.random() > 0.5:
                cell = cell[::-1, :, :]
            canvas[cy * CELL:(cy + 1) * CELL, cx * CELL:(cx + 1) * CELL, :] = cell
    tiled.append(canvas)
if MIX:
    imgs = tiled
    print('%dx%d hucreye bolundu, her hucre rastgele cevrildi' % (CELLS, CELLS))
else:
    print('sade dosem: mozaik yok (--mix ile acilir)')

# --- harmanla ---------------------------------------------------------------
base = imgs[0]
for i, other in enumerate(imgs[1:] if MIX else [], start=1):
    m = fbm(1000 + i * 77)[:, :, None]
    # maskeyi biraz sertleştir: geçişler yine yumuşak ama bölgeler belirgin
    m = np.clip((m - 0.35) / 0.30, 0.0, 1.0)
    m = m * m * (3 - 2 * m)
    base = base * (1 - m) + other * m
print('%d gorsel harmanlandi' % len(imgs))

# --- bölgesel açıklık/koyuluk: aynı görsel bile olsa tekdüzelik kırılır ------
shade = fbm(4242)
shade = (0.93 + shade * 0.14) if not MIX else (0.86 + shade * 0.28)
base = base * shade[:, :, None]

out = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))

# --- oyunun paletine oturt --------------------------------------------------
# Gündüz parlaklığında bırakıyoruz; gece karartmasını oyun kendi yapıyor.
# Gündüz parlaklığı: gece karartmasını oyun çarpma (multiply) ile kendisi
# yapıyor, o yüzden doku burada bastırılmıyor. Bastırırsak gece ile gündüz
# arasındaki fark kaybolur.
out = ImageEnhance.Brightness(out).enhance(0.95)
out = ImageEnhance.Color(out).enhance(0.86)
out = ImageEnhance.Contrast(out).enhance(0.92)

# Dosya boyutu önemli: bu görsel internetsiz sürüme gömülüyor. Kabul edilebilir
# görüntüyü koruyan en küçük kaliteyi arıyoruz (hedef ~150 KB).
import io
for q in (78, 72, 66, 60, 54, 48, 42, 36):
    buf = io.BytesIO()
    out.save(buf, 'JPEG', quality=q, optimize=True, progressive=False)
    if buf.tell() <= 150 * 1024 or q == 36:
        open(dst, 'wb').write(buf.getvalue())
        print('kalite %d -> %d KB' % (q, buf.tell() // 1024))
        break
print(out.size)
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
execFileSync('python3', ['-c', py, OUT, MIX ? '1' : '0', ...inputs], { stdio: 'inherit' });

const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`Doku hazır: ${OUT}  (${kb} KB)`);
