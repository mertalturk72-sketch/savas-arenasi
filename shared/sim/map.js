// Harita üretimi. Üretilen harita maç başında istemciye olduğu gibi gönderilir,
// böylece iki taraf da birebir aynı geometriyle çalışır.
//
// İki tür örtü var:
//   • obstacles — duvar/kaya: içinden geçilmez, mermi geçmez, görüşü keser
//   • bushes    — çalı: İÇİNDEN GEÇİLİR, mermi geçer, ama içindeki oyuncu
//                 yakından bakılmadıkça görünmez (ateş edince açığa çıkar)
//
// Yerleşim oransal tanımlıdır: MAPS içindeki genişlik/yükseklik değişince
// her şey kendiliğinden ölçeklenir.

import { MAPS, PLAYER_RADIUS, MIN_CORRIDOR, SPAWN_EDGE_INSET } from '../constants.js';
import { buildObstacleIndex, circleHitsRect, queryObstacles } from '../physics.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rect(x, y, w, h, type = 'wall') {
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), type };
}

// --- Simetrik arena (FFA + Takım Savaşı) ---------------------------------
// Her maçta farklı ama hep AYNI TARZDA bir arena üretir: sol yarıya birkaç
// motif (L, T, U, düz duvar) yerleştirilir, sağ yarı aynalanır. Motifler kaba
// bir ızgaraya oturduğu için koridorlar hep geniş kalır; harita değişir ama
// tanıdık hissettirir.
function buildArena(seed, mapId = 'arena') {
  const { w, h } = MAPS[mapId] || MAPS.arena;
  const rnd = mulberry32(seed);
  const T = 0.013 * w;                     // duvar kalınlığı

  // Motiflerin yerleşeceği bölge (kenarlarda dolaşma koridoru kalsın)
  const X0 = 0.070 * w, X1 = 0.450 * w;
  const Y0 = 0.080 * h, Y1 = 0.920 * h;
  const COLS = 3, ROWS = 4;
  const cellW = (X1 - X0) / COLS;
  const cellH = (Y1 - Y0) / ROWS;

  // Motif, hücrenin ortasına oturur ve hücreyi taşmaz — böylece komşu
  // motifler arasında daima geniş boşluk kalır.
  const mw = Math.min(cellW * 0.62, 0.095 * w);
  const mh = Math.min(cellH * 0.62, 0.150 * h);

  const out = [];
  const motif = (kind, cx, cy, flipX, flipY) => {
    const sx = flipX ? -1 : 1, sy = flipY ? -1 : 1;
    const L = cx - mw / 2, R = cx + mw / 2;
    const U = cy - mh / 2, D = cy + mh / 2;
    switch (kind) {
      case 'wallH':
        out.push(rect(L, cy - T / 2, mw, T));
        break;
      case 'wallV':
        out.push(rect(cx - T / 2, U, T, mh));
        break;
      case 'L':
        out.push(rect(L, sy > 0 ? U : D - T, mw, T));
        out.push(rect(sx > 0 ? L : R - T, U, T, mh));
        break;
      case 'T':
        out.push(rect(L, cy - T / 2, mw, T));
        out.push(rect(cx - T / 2, sy > 0 ? cy : U, T, mh / 2));
        break;
      case 'U':
        out.push(rect(L, U, T, mh));
        out.push(rect(R - T, U, T, mh));
        out.push(rect(L, sy > 0 ? D - T : U, mw, T));
        break;
      case 'pillars':
        out.push(rect(L, U, T * 2.2, T * 2.2));
        out.push(rect(R - T * 2.2, D - T * 2.2, T * 2.2, T * 2.2));
        break;
      default:
        out.push(rect(L, cy - T / 2, mw, T));
    }
  };

  const KINDS = ['wallH', 'wallV', 'L', 'L', 'T', 'U', 'pillars'];

  // Hücreleri karıştır, bir kısmını doldur
  const cells = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cells.push([c, r]);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  const used = cells.slice(0, 7 + Math.floor(rnd() * 3));   // 7–9 motif

  for (const [c, r] of used) {
    const cx = X0 + (c + 0.5) * cellW + (rnd() - 0.5) * cellW * 0.16;
    const cy = Y0 + (r + 0.5) * cellH + (rnd() - 0.5) * cellH * 0.16;
    motif(KINDS[Math.floor(rnd() * KINDS.length)], cx, cy, rnd() < 0.5, rnd() < 0.5);
  }

  const obstacles = [];
  for (const o of out) {
    if (o.w < 4 || o.h < 4) continue;
    obstacles.push(o);
    obstacles.push(rect(w - o.x - o.w, o.y, o.w, o.h));      // yatay ayna
  }

  // Merkez yapı — her haritada var, arenanın çekirdeği
  const centerKind = rnd();
  if (centerKind < 0.5) {
    obstacles.push(rect(w / 2 - 0.009 * w, h / 2 - 0.135 * h, 0.018 * w, 0.080 * h));
    obstacles.push(rect(w / 2 - 0.009 * w, h / 2 + 0.055 * h, 0.018 * w, 0.080 * h));
  } else {
    obstacles.push(rect(w / 2 - 0.075 * w, h / 2 - 0.010 * h, 0.055 * w, 0.020 * h));
    obstacles.push(rect(w / 2 + 0.020 * w, h / 2 - 0.010 * h, 0.055 * w, 0.020 * h));
  }

  // --- Çalılar (bir tık küçük) --------------------------------------------
  const idxTmp = buildObstacleIndex({ w, h, obstacles });
  const bushes = [];
  const minR = 0.030 * Math.min(w, h);
  const maxR = 0.046 * Math.min(w, h);

  const fitsBush = (x, y, r) => {
    const buf = [];
    const list = queryObstacles(idxTmp, x - r, y - r, x + r, y + r, buf);
    for (let i = 0; i < list.length; i++) if (circleHitsRect(x, y, r * 0.75, list[i])) return false;
    return true;
  };

  // CTF haritasında çalı YOK (istek): duvarlar var, çalı yok.
  const wantBushes = mapId !== 'ctf';
  let placed = 0, guard = 0;
  while (wantBushes && placed < 9 && guard < 600) {
    guard++;
    const r = minR + rnd() * (maxR - minR);
    const x = 0.075 * w + rnd() * (0.400 * w);
    const y = 0.090 * h + rnd() * (0.820 * h);
    if (!fitsBush(x, y, r)) continue;
    if (bushes.some((b) => Math.hypot(b.x - x, b.y - y) < (b.r + r) * 0.85)) continue;
    bushes.push({ x: Math.round(x), y: Math.round(y), r: Math.round(r) });
    bushes.push({ x: Math.round(w - x), y: Math.round(y), r: Math.round(r) });
    placed++;
  }
  // merkez çalılığı
  const cr = Math.round(minR * 1.15);
  if (wantBushes && fitsBush(w / 2, h * 0.5, cr)) bushes.push({ x: Math.round(w / 2), y: Math.round(h * 0.5), r: cr });

  return { id: 'arena', w, h, obstacles, bushes };
}

// --- Daralan alan haritası (Son Hayatta Kalan) ---------------------------
function buildRoyale(seed) {
  const { w, h } = MAPS.royale;
  const rnd = mulberry32(seed);
  const obstacles = [];
  const bushes = [];

  // İki engel arasında daima en az MIN_CORRIDOR boşluk kalsın.
  const overlaps = (r, pad) => obstacles.some((o) =>
    r.x < o.x + o.w + pad && r.x + r.w + pad > o.x &&
    r.y < o.y + o.h + pad && r.y + r.h + pad > o.y);

  const DOOR = 150;                    // kapı genişliği (oyuncu çapı 32)
  const T = 36;                        // duvar kalınlığı

  let tries = 0, buildings = 0;
  while (buildings < 16 && tries < 1400) {
    tries++;
    const bw = 280 + Math.floor(rnd() * 260);
    const bh = 240 + Math.floor(rnd() * 240);
    const x = 200 + rnd() * (w - bw - 400);
    const y = 200 + rnd() * (h - bh - 400);
    const box = rect(x, y, bw, bh);
    if (overlaps(box, MIN_CORRIDOR * 2.2)) continue;

    // Her binada iki kapı: içeride sıkışıp kalınmasın
    const sides = [0, 1, 2, 3].sort(() => rnd() - 0.5).slice(0, 2);
    const walls = [];

    const withDoor = (horizontal, fixed, from, to) => {
      const span = to - from;
      if (span < DOOR + 2 * T + 20) {
        walls.push(horizontal ? rect(from, fixed, span, T) : rect(fixed, from, T, span));
        return;
      }
      const d = from + T + rnd() * (span - 2 * T - DOOR);
      if (horizontal) {
        walls.push(rect(from, fixed, d - from, T));
        walls.push(rect(d + DOOR, fixed, to - d - DOOR, T));
      } else {
        walls.push(rect(fixed, from, T, d - from));
        walls.push(rect(fixed, d + DOOR, T, to - d - DOOR));
      }
    };

    // üst / alt / sol / sağ
    if (sides.includes(0)) withDoor(true, box.y, box.x, box.x + box.w);
    else walls.push(rect(box.x, box.y, box.w, T));
    if (sides.includes(1)) withDoor(true, box.y + box.h - T, box.x, box.x + box.w);
    else walls.push(rect(box.x, box.y + box.h - T, box.w, T));
    if (sides.includes(2)) withDoor(false, box.x, box.y, box.y + box.h);
    else walls.push(rect(box.x, box.y, T, box.h));
    if (sides.includes(3)) withDoor(false, box.x + box.w - T, box.y, box.y + box.h);
    else walls.push(rect(box.x + box.w - T, box.y, T, box.h));

    for (const wl of walls) if (wl.w > 6 && wl.h > 6) obstacles.push(wl);
    buildings++;
  }

  // Serbest duvar parçaları
  for (let i = 0; i < 30; i++) {
    for (let t = 0; t < 50; t++) {
      const horiz = rnd() < 0.5;
      const len = 180 + rnd() * 320;
      const r = horiz
        ? rect(160 + rnd() * (w - len - 320), 160 + rnd() * (h - 360), len, T)
        : rect(160 + rnd() * (w - 320), 160 + rnd() * (h - len - 320), T, len);
      if (overlaps(r, MIN_CORRIDOR * 1.6)) continue;
      obstacles.push(r); break;
    }
  }

  // Çalılıklar — engel değil, sadece saklanma
  for (let i = 0; i < 48; i++) {
    const r = 42 + rnd() * 36;
    bushes.push({
      x: Math.round(140 + rnd() * (w - 280)),
      y: Math.round(140 + rnd() * (h - 280)),
      r: Math.round(r),
    });
  }

  return { id: 'royale', w, h, obstacles, bushes };
}

// --- Yürünebilirlik denetimi ---------------------------------------------
// Haritayı ızgaraya bölüp oyuncunun sığdığı hücreleri işaretler, sonra en
// büyük bağlı bölgeyi bulur. Dar kalan bir geçit varsa o bölge ana bölgeden
// kopar ve burada yakalanır — "geçilmeyen boşluk" sorununun kökü budur.
export function analyzeWalkable(map, idx, clearance = PLAYER_RADIUS + 4, step = 26) {
  const cols = Math.max(1, Math.floor(map.w / step));
  const rows = Math.max(1, Math.floor(map.h / step));
  const walk = new Uint8Array(cols * rows);
  const buf = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * step, y = (r + 0.5) * step;
      if (x < clearance || y < clearance || x > map.w - clearance || y > map.h - clearance) continue;
      const list = queryObstacles(idx, x - clearance, y - clearance, x + clearance, y + clearance, buf);
      let ok = true;
      for (let i = 0; i < list.length; i++) {
        if (circleHitsRect(x, y, clearance, list[i])) { ok = false; break; }
      }
      if (ok) walk[r * cols + c] = 1;
    }
  }

  // Bağlı bileşenler (4 komşu)
  const comp = new Int32Array(cols * rows).fill(-1);
  const sizes = [];
  const stack = [];
  for (let i = 0; i < walk.length; i++) {
    if (!walk[i] || comp[i] !== -1) continue;
    const id = sizes.length;
    let n = 0;
    stack.length = 0;
    stack.push(i);
    comp[i] = id;
    while (stack.length) {
      const cur = stack.pop();
      n++;
      const cc = cur % cols, cr = (cur - cc) / cols;
      if (cc > 0 && walk[cur - 1] && comp[cur - 1] === -1) { comp[cur - 1] = id; stack.push(cur - 1); }
      if (cc < cols - 1 && walk[cur + 1] && comp[cur + 1] === -1) { comp[cur + 1] = id; stack.push(cur + 1); }
      if (cr > 0 && walk[cur - cols] && comp[cur - cols] === -1) { comp[cur - cols] = id; stack.push(cur - cols); }
      if (cr < rows - 1 && walk[cur + cols] && comp[cur + cols] === -1) { comp[cur + cols] = id; stack.push(cur + cols); }
    }
    sizes.push(n);
  }

  let main = -1, best = -1, total = 0;
  for (let i = 0; i < sizes.length; i++) {
    total += sizes[i];
    if (sizes[i] > best) { best = sizes[i]; main = i; }
  }

  return {
    cols, rows, step, walk, comp, main,
    totalCells: total,
    mainCells: Math.max(0, best),
    mainRatio: total ? best / total : 0,
    components: sizes.length,
    /** Bu nokta ana bölgede mi? (kopuk cepte doğmayı engeller) */
    inMain(x, y) {
      const c = Math.min(cols - 1, Math.max(0, Math.floor(x / step)));
      const r = Math.min(rows - 1, Math.max(0, Math.floor(y / step)));
      return comp[r * cols + c] === main;
    },
  };
}

// --- Boş (spawn'a uygun) noktaların hesabı -------------------------------
function computeFreePoints(map, idx, walkable, step = 80, clearance = PLAYER_RADIUS + 18) {
  const pts = [];
  const margin = 110;
  const buf = [];
  for (let y = margin; y < map.h - margin; y += step) {
    for (let x = margin; x < map.w - margin; x += step) {
      const list = queryObstacles(idx, x - clearance, y - clearance, x + clearance, y + clearance, buf);
      let ok = true;
      for (let i = 0; i < list.length; i++) {
        if (circleHitsRect(x, y, clearance, list[i])) { ok = false; break; }
      }
      // Kopuk bir cebe doğmasın
      if (ok && walkable.inMain(x, y)) pts.push({ x, y });
    }
  }
  return pts;
}

// Haritanın dış çerçevesindeki noktaları eler. Oyuncunun köşede sıkışıp
// doğmasını, arkasını kollamak zorunda kalmadan oyuna girmesini sağlar.
export function insetPoints(points, map, frac) {
  const mx = map.w * frac;
  const my = map.h * frac;
  return points.filter((p) => p.x >= mx && p.x <= map.w - mx
    && p.y >= my && p.y <= map.h - my);
}

// Birbirinden olabildiğince uzak k nokta seç (farthest-point sampling).
function spreadPick(points, k, rnd) {
  if (points.length === 0) return [];
  const chosen = [points[Math.floor(rnd() * points.length)]];
  while (chosen.length < k && chosen.length < points.length) {
    let best = null, bestD = -1;
    for (const p of points) {
      let d = Infinity;
      for (const c of chosen) {
        const dd = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
        if (dd < d) d = dd;
      }
      if (d > bestD) { bestD = d; best = p; }
    }
    if (!best) break;
    chosen.push(best);
  }
  return chosen;
}

/**
 * Mod için harita üretir.
 * @returns {{map, idx, spawns, pickups, walkable}}
 */
export function createMap(mapId, seed = Math.floor(Math.random() * 1e9)) {
  const isRoyale = mapId === 'royale';

  // Royale rastgele üretildiği için, bağlantısı kötü çıkarsa yeni tohumla dene.
  let map, idx, walkable;
  for (let attempt = 0; attempt < 12; attempt++) {
    const s = (seed + attempt * 7919) >>> 0;
    map = isRoyale ? buildRoyale(s) : buildArena(s, mapId);
    idx = buildObstacleIndex(map);
    walkable = analyzeWalkable(map, idx);
    if (walkable.mainRatio >= 0.999) break;
  }

  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const free = computeFreePoints(map, idx, walkable);
  if (free.length < 10) throw new Error('Harita üretimi başarısız: yeterli boş alan yok');

  // Doğuş havuzunu haritanın iç bölgesiyle sınırla. Eskiden tüm boş noktalar
  // havuzdaydı ve "birbirinden en uzak noktaları seç" mantığı doğal olarak
  // köşeleri kazandırıyordu — herkes kenarda doğuyordu.
  const inset = insetPoints(free, map, SPAWN_EDGE_INSET);
  const core = inset.length >= 12 ? inset : free;

  const teamBand = (side) => {
    const band = side === 1
      ? core.filter((p) => p.x < map.w * 0.34)
      : core.filter((p) => p.x > map.w * 0.66);
    return band.length >= 4 ? band : core;
  };

  const spawns = {
    all: spreadPick(core, Math.min(56, core.length), rnd),
    1: spreadPick(teamBand(1), 16, rnd),
    2: spreadPick(teamBand(2), 16, rnd),
  };
  if (spawns[1].length === 0) spawns[1] = spawns.all;
  if (spawns[2].length === 0) spawns[2] = spawns.all;

  // Can kutusu yok (can kendiliğinden yenileniyor); haritadaki kutular cephane.
  const packCount = isRoyale ? 22 : 12;
  const packPts = spreadPick(free, Math.min(packCount, free.length), rnd);
  const pickups = packPts.map((p, i) => ({
    id: i + 1,
    x: p.x, y: p.y,
    kind: 'ammo',
    active: true,
    respawnAt: 0,
  }));

  return { map, idx, spawns, pickups, walkable };
}
