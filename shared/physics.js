// Sunucu ile istemcinin AYNI şekilde çalıştırdığı hareket/çarpışma kodu.
// İstemci tarafı tahmin (client-side prediction) ile sunucunun sonucu birebir
// örtüşsün diye bu mantık tek yerde durur.

import {
  IN_UP, IN_DOWN, IN_LEFT, IN_RIGHT, PLAYER_RADIUS,
} from './constants.js';

// --- Engel indeksi (uniform grid) ----------------------------------------
// Her karede 20 oyuncu + yüzlerce mermi için tüm engelleri taramak israf.
// Haritayı hücrelere bölüp sadece ilgili hücredeki engellere bakıyoruz.
export function buildObstacleIndex(map) {
  const cell = 200;
  const cols = Math.ceil(map.w / cell);
  const rows = Math.ceil(map.h / cell);
  const cells = new Array(cols * rows);
  for (let i = 0; i < cells.length; i++) cells[i] = [];

  for (const o of map.obstacles) {
    const c0 = Math.max(0, Math.floor(o.x / cell));
    const c1 = Math.min(cols - 1, Math.floor((o.x + o.w) / cell));
    const r0 = Math.max(0, Math.floor(o.y / cell));
    const r1 = Math.min(rows - 1, Math.floor((o.y + o.h) / cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) cells[r * cols + c].push(o);
    }
  }
  return { cell, cols, rows, cells, w: map.w, h: map.h };
}

// Verilen kutuyla kesişen engelleri (tekrarsız) döndürür.
export function queryObstacles(idx, x0, y0, x1, y1, out) {
  const res = out || [];
  res.length = 0;
  if (!idx) return res;
  const c0 = Math.max(0, Math.floor(x0 / idx.cell));
  const c1 = Math.min(idx.cols - 1, Math.floor(x1 / idx.cell));
  const r0 = Math.max(0, Math.floor(y0 / idx.cell));
  const r1 = Math.min(idx.rows - 1, Math.floor(y1 / idx.cell));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const bucket = idx.cells[r * idx.cols + c];
      for (let i = 0; i < bucket.length; i++) {
        const o = bucket[i];
        if (res.indexOf(o) === -1) res.push(o);
      }
    }
  }
  return res;
}

// --- Daire / dikdörtgen ---------------------------------------------------
export function circleHitsRect(cx, cy, r, o) {
  const nx = cx < o.x ? o.x : (cx > o.x + o.w ? o.x + o.w : cx);
  const ny = cy < o.y ? o.y : (cy > o.y + o.h ? o.y + o.h : cy);
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

// Daireyi dikdörtgenden en kısa yönde dışarı iter.
function pushOut(pos, r, o) {
  const cx = pos.x, cy = pos.y;
  const nx = cx < o.x ? o.x : (cx > o.x + o.w ? o.x + o.w : cx);
  const ny = cy < o.y ? o.y : (cy > o.y + o.h ? o.y + o.h : cy);
  let dx = cx - nx, dy = cy - ny;
  let d2 = dx * dx + dy * dy;

  if (d2 > 1e-8) {
    if (d2 >= r * r) return false;
    const d = Math.sqrt(d2);
    const push = r - d;
    pos.x += (dx / d) * push;
    pos.y += (dy / d) * push;
    return true;
  }

  // Merkez tam kutunun içinde: en yakın kenardan çıkar.
  const left = cx - o.x, right = o.x + o.w - cx;
  const top = cy - o.y, bottom = o.y + o.h - cy;
  const m = Math.min(left, right, top, bottom);
  if (m === left) pos.x = o.x - r;
  else if (m === right) pos.x = o.x + o.w + r;
  else if (m === top) pos.y = o.y - r;
  else pos.y = o.y + o.h + r;
  return true;
}

const _scratch = [];

// Bir daireyi (dx,dy) kadar kaydırır, engellere ve harita sınırlarına göre düzeltir.
// Eksenleri ayrı ayrı çözmek duvar boyunca kaymayı (wall sliding) doğal kılar.
export function moveCircle(pos, radius, dx, dy, idx) {
  if (dx !== 0) {
    pos.x += dx;
    const list = queryObstacles(idx, pos.x - radius, pos.y - radius, pos.x + radius, pos.y + radius, _scratch);
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!circleHitsRect(pos.x, pos.y, radius, o)) continue;
      // Yalnızca X ekseninde geri it
      if (dx > 0) pos.x = Math.min(pos.x, o.x - radius);
      else pos.x = Math.max(pos.x, o.x + o.w + radius);
    }
  }
  if (dy !== 0) {
    pos.y += dy;
    const list = queryObstacles(idx, pos.x - radius, pos.y - radius, pos.x + radius, pos.y + radius, _scratch);
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!circleHitsRect(pos.x, pos.y, radius, o)) continue;
      if (dy > 0) pos.y = Math.min(pos.y, o.y - radius);
      else pos.y = Math.max(pos.y, o.y + o.h + radius);
    }
  }

  // Harita sınırları
  if (pos.x < radius) pos.x = radius;
  if (pos.y < radius) pos.y = radius;
  if (pos.x > idx.w - radius) pos.x = idx.w - radius;
  if (pos.y > idx.h - radius) pos.y = idx.h - radius;

  // Köşe durumlarında hâlâ içeride kalmışsa temizle
  const list = queryObstacles(idx, pos.x - radius, pos.y - radius, pos.x + radius, pos.y + radius, _scratch);
  for (let i = 0; i < list.length; i++) pushOut(pos, radius, list[i]);
}

// --- Oyuncu hareketi (tahmin + sunucu ortak) ------------------------------
// state: { x, y }  — yerinde güncellenir
export function applyMovement(state, keys, speed, dtSec, idx) {
  let mx = 0, my = 0;
  if (keys & IN_UP) my -= 1;
  if (keys & IN_DOWN) my += 1;
  if (keys & IN_LEFT) mx -= 1;
  if (keys & IN_RIGHT) mx += 1;
  if (mx === 0 && my === 0) return;
  const len = Math.hypot(mx, my);
  mx /= len; my /= len;
  moveCircle(state, PLAYER_RADIUS, mx * speed * dtSec, my * speed * dtSec, idx);
}

// --- Görüş hattı (botlar ve isabet doğrulaması için) ----------------------
export function lineBlocked(x0, y0, x1, y1, idx) {
  const dx = x1 - x0, dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return false;
  const steps = Math.min(160, Math.ceil(dist / 22));
  const sx = dx / steps, sy = dy / steps;
  let x = x0, y = y0;
  for (let i = 0; i < steps; i++) {
    x += sx; y += sy;
    const list = queryObstacles(idx, x - 1, y - 1, x + 1, y + 1, _scratch);
    for (let j = 0; j < list.length; j++) {
      const o = list[j];
      if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) return true;
    }
  }
  return false;
}

// Bir yön boyunca ilk duvara kadar olan mesafe. Keskin nişancının nişan
// çizgisinin duvarda kesilmesi için kullanılıyor.
export function rayHitDistance(x0, y0, angle, maxDist, idx) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const step = 14;
  const steps = Math.ceil(maxDist / step);
  let x = x0, y = y0;
  for (let i = 1; i <= steps; i++) {
    x = x0 + dx * step * i;
    y = y0 + dy * step * i;
    if (x < 0 || y < 0 || x > idx.w || y > idx.h) return step * (i - 1);
    const list = queryObstacles(idx, x - 1, y - 1, x + 1, y + 1, _scratch);
    for (let j = 0; j < list.length; j++) {
      const o = list[j];
      if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) return step * (i - 1);
    }
  }
  return maxDist;
}

export function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// Açıyı -PI..PI aralığına indirger (interpolasyonda sarma sorunu için).
export function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
