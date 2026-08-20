// Bot yapay zekası. Botlar gerçek oyuncularla aynı girdi kanalını kullanır
// (tuş maskesi + nişan açısı), böylece simülasyon tarafında ayrıcalıkları yoktur.

import {
  IN_UP, IN_DOWN, IN_LEFT, IN_RIGHT, IN_FIRE, IN_RELOAD,
  WEAPONS, PLAYER_RADIUS,
  BUSH_REVEAL_DIST,
  BOT_LEVELS, DEFAULT_BOT_LEVEL,
} from '../constants.js';
import { lineBlocked, clamp } from '../physics.js';

// Botun zorluk ayarları. Seviye oyuncuya ait (lobide seçiliyor); tanınmayan
// bir değer gelirse sessizce ortaya düşüyoruz.
function level(p) {
  return BOT_LEVELS[p.botLevel] || BOT_LEVELS[DEFAULT_BOT_LEVEL];
}

export function resetBot(p) {
  p.brain = {
    targetId: 0,
    retargetAt: 0,
    wander: null,
    strafe: Math.random() < 0.5 ? 1 : -1,
    strafeUntil: 0,
    detourUntil: 0,
    detourDir: 1,
    lastX: p.x, lastY: p.y, progressAt: 0,
    aim: p.aim,
    // Yetenek seviyenin aralığından çekiliyor: aynı zorluktaki botlar
    // birbirinin kopyası olmasın diye aralık, tek sayı değil.
    skill: p.brain?.skill ?? (() => {
      const [lo, hi] = level(p).skill;
      return lo + Math.random() * (hi - lo);
    })(),
    fireHold: 0,
    throwStart: 0,
    fireReadyAt: 0,
    seq: p.brain?.seq || 0,
  };
}

function keysFromDir(dx, dy) {
  let k = 0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len, ny = dy / len;
  if (nx > 0.38) k |= IN_RIGHT; else if (nx < -0.38) k |= IN_LEFT;
  if (ny > 0.38) k |= IN_DOWN; else if (ny < -0.38) k |= IN_UP;
  return k;
}

function angDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function botThink(p, game, dtMs) {
  if (!p.brain) resetBot(p);
  const b = p.brain;
  b.seq++;

  if (!p.alive) {
    p.inputQueue.push({ s: b.seq, d: dtMs, k: 0, a: p.aim });
    return;
  }

  const wep = WEAPONS[p.weapon];
  const gorus = level(p).view;
  const now = game.time;
  let keys = 0;

  // --- Hedef seçimi -------------------------------------------------------
  if (now >= b.retargetAt) {
    b.retargetAt = now + 350 + Math.random() * 350;
    let best = null, bestD = Infinity;
    for (const o of game.players.values()) {
      if (o === p || !o.alive) continue;
      if (game.mode.teams && o.team === p.team) continue;
      if (o.protectUntil > now) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d > gorus) continue;
      // Çalıda saklanan hedefi bot da uzaktan göremez
      if (o.hidden && d > BUSH_REVEAL_DIST) continue;
      if (lineBlocked(p.x, p.y, o.x, o.y, game.idx)) continue;
      // Yakın ve düşük canlı hedefi tercih et
      const score = d * (0.6 + o.hp / (o.maxHp * 2.5));
      if (score < bestD) { bestD = score; best = o; }
    }
    const newId = best ? best.id : 0;
    if (newId !== b.targetId) {
      // Tepki süresi: bot yeni gördüğü hedefe anında ateş açmasın
      b.fireReadyAt = now + level(p).reactMs + (1 - b.skill) * 620 + (wep.id === 'sniper' ? 260 : 0);
      b.targetId = newId;
    }
  }

  let target = b.targetId ? game.players.get(b.targetId) : null;
  if (target && (!target.alive || Math.hypot(target.x - p.x, target.y - p.y) > gorus * 1.15)) target = null;
  const hasLos = target ? !lineBlocked(p.x, p.y, target.x, target.y, game.idx) : false;

  // --- Amaç noktası -------------------------------------------------------
  let goalX, goalY;
  const lowHp = p.hp < p.maxHp * 0.32;
  const lowAmmo = p.reserve < wep.reserve * 0.3 && p.ammo < wep.mag * 0.5;

  const zone = game.zone;
  const outsideZone = zone && Math.hypot(p.x - zone.cx, p.y - zone.cy) > zone.r * 0.88;

  if (outsideZone) {
    // Her şeyden önce güvenli alana dön
    const ang = Math.atan2(zone.cy - p.y, zone.cx - p.x);
    goalX = zone.cx - Math.cos(ang) * zone.r * 0.55;
    goalY = zone.cy - Math.sin(ang) * zone.r * 0.55;
  } else if (lowAmmo) {
    // Cephane sınırlı: en yakın kutuya git
    let pack = null, pd = 1600;
    for (const k of game.pickups) {
      if (!k.active) continue;
      const d = Math.hypot(k.x - p.x, k.y - p.y);
      if (d < pd) { pd = d; pack = k; }
    }
    if (pack) { goalX = pack.x; goalY = pack.y; }
  } else if (lowHp && target) {
    // Can kutusu yok, can zamanla dolar — geri çekilip beklemek mantıklı
    const ang = Math.atan2(target.y - p.y, target.x - p.x);
    goalX = p.x - Math.cos(ang) * 420;
    goalY = p.y - Math.sin(ang) * 420;
  }

  if (goalX === undefined) {
    if (target && hasLos) {
      // İdeal mesafeyi koru
      const ideal = wep.id === 'shotgun' ? 150 : wep.id === 'sniper' ? 620 : 340;
      const d = Math.hypot(target.x - p.x, target.y - p.y);
      const ang = Math.atan2(target.y - p.y, target.x - p.x);
      const approach = clamp((d - ideal) / 160, -1, 1);
      if (now >= b.strafeUntil) {
        b.strafe = Math.random() < 0.5 ? 1 : -1;
        b.strafeUntil = now + 500 + Math.random() * 900;
      }
      const sx = Math.cos(ang + Math.PI / 2) * b.strafe;
      const sy = Math.sin(ang + Math.PI / 2) * b.strafe;
      goalX = p.x + (Math.cos(ang) * approach + sx * 0.85) * 200;
      goalY = p.y + (Math.sin(ang) * approach + sy * 0.85) * 200;
    } else {
      if (!b.wander || Math.hypot(b.wander.x - p.x, b.wander.y - p.y) < 90 || now > b.wanderUntil) {
        const pool = game.spawns.all;
        let pick = pool[Math.floor(Math.random() * pool.length)];
        if (zone) {
          const inside = pool.filter((s) => Math.hypot(s.x - zone.cx, s.y - zone.cy) < zone.r * 0.7);
          if (inside.length) pick = inside[Math.floor(Math.random() * inside.length)];
        }
        b.wander = pick;
        b.wanderUntil = now + 12000;
      }
      goalX = b.wander.x; goalY = b.wander.y;
    }
  }

  // --- Engelden kaçınma (bıyık ışınları) ----------------------------------
  let dx = goalX - p.x, dy = goalY - p.y;
  const dLen = Math.hypot(dx, dy) || 1;
  dx /= dLen; dy /= dLen;

  const probe = 78;
  const fwdBlocked = lineBlocked(p.x, p.y, p.x + dx * probe, p.y + dy * probe, game.idx);
  if (fwdBlocked || now < b.detourUntil) {
    if (now >= b.detourUntil) {
      const lx = -dy, ly = dx;
      const leftBlocked = lineBlocked(p.x, p.y, p.x + lx * probe * 1.3, p.y + ly * probe * 1.3, game.idx);
      const rightBlocked = lineBlocked(p.x, p.y, p.x - lx * probe * 1.3, p.y - ly * probe * 1.3, game.idx);
      b.detourDir = leftBlocked && !rightBlocked ? -1 : (rightBlocked && !leftBlocked ? 1 : (Math.random() < 0.5 ? 1 : -1));
      b.detourUntil = now + 450 + Math.random() * 400;
    }
    const lx = -dy * b.detourDir, ly = dx * b.detourDir;
    dx = dx * 0.25 + lx; dy = dy * 0.25 + ly;
  }

  // Takılma tespiti: 900 ms boyunca ilerleme yoksa rastgele yön dene
  if (now - b.progressAt > 900) {
    b.progressAt = now;
    if (Math.hypot(p.x - b.lastX, p.y - b.lastY) < 26) {
      b.detourDir = -b.detourDir;
      b.detourUntil = now + 600;
      b.wander = null;
    }
    b.lastX = p.x; b.lastY = p.y;
  }

  keys |= keysFromDir(dx, dy);

  // --- Nişan --------------------------------------------------------------
  let desiredAim = b.aim;
  if (target) {
    const d = Math.hypot(target.x - p.x, target.y - p.y);
    const flight = d / wep.speed;
    // Hedefin hareketini kabaca tahmin et (son konum farkından)
    const lead = 0.85 * b.skill;
    const px = target.x + (target.vxEst || 0) * flight * lead;
    const py = target.y + (target.vyEst || 0) * flight * lead;
    desiredAim = Math.atan2(py - p.y, px - p.x);
    const err = (1 - b.skill) * 0.22 * (d / 380 + 0.4);
    desiredAim += (Math.random() - 0.5) * 2 * err;
  } else {
    desiredAim = Math.atan2(dy, dx);
  }
  const turnRate = (3.2 + b.skill * 5.5) * (dtMs / 1000);
  const diff = angDiff(b.aim, desiredAim);
  b.aim += clamp(diff, -turnRate, turnRate);

  // --- Ateş / şarjör ------------------------------------------------------
  const canShoot = target && hasLos
    && now >= (b.fireReadyAt || 0)
    && Math.hypot(target.x - p.x, target.y - p.y) < wep.range * 0.92
    && Math.abs(angDiff(b.aim, Math.atan2(target.y - p.y, target.x - p.x))) < (wep.id === 'shotgun' ? 0.26 : 0.1);

  if (canShoot && p.ammo > 0 && !p.reloadUntil) {
    if (wep.throwable) {
      // Bomba: tuşu BASILI TUTARAK menzili doldurup BIRAKARAK atıyoruz —
      // oyuncuyla tamamen aynı mekanik, botun ayrıcalığı yok.
      // Ne kadar tutacağımızı hedefin uzaklığından hesaplıyoruz; yetenek
      // düştükçe biraz şaşırıyor, yani kolay botlar bombayı ıskalıyor.
      const d = Math.hypot(target.x - p.x, target.y - p.y);
      const oran = clamp((d - wep.minRange) / (wep.maxRange - wep.minRange), 0, 1);
      const sapma = (1 - b.skill) * 0.35 * (Math.random() - 0.5) * 2;
      const hedefTut = clamp(oran + sapma, 0, 1) * wep.chargeMs;
      if (!b.throwStart) b.throwStart = now;
      if (now - b.throwStart < hedefTut) keys |= IN_FIRE;    // tut
      else b.throwStart = 0;                                  // bırak → atılır
    } else if (wep.auto) {
      keys |= IN_FIRE;
    } else {
      // Tek atışlılarda tetiği bırakıp basma (kenar tetikleme gerekiyor)
      b.fireHold = (b.fireHold + 1) % 2;
      if (b.fireHold === 0) keys |= IN_FIRE;
    }
  } else if (b.throwStart) {
    // Hedef kayboldu: elinde bombayla kalma, bırak gitsin.
    b.throwStart = 0;
  }
  if (!p.reloadUntil && p.reserve > 0
    && (p.ammo === 0 || (!target && p.ammo < wep.mag * 0.4))) keys |= IN_RELOAD;

  p.inputQueue.push({ s: b.seq, d: dtMs, k: keys, a: Math.round(b.aim * 1000) / 1000 });
}

// Hedeflerin hız tahminini güncelle (nişan öngörüsü için).
export function updateVelocityEstimates(game, dtMs) {
  const dt = dtMs / 1000;
  for (const p of game.players.values()) {
    if (p._px === undefined) { p._px = p.x; p._py = p.y; }
    p.vxEst = (p.x - p._px) / dt;
    p.vyEst = (p.y - p._py) / dt;
    p._px = p.x; p._py = p.y;
  }
}

export const BOT_PROBE_RADIUS = PLAYER_RADIUS;
