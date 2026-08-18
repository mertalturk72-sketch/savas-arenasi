// Canvas çizimi: dünya, oyuncular, mermiler, efektler, mini harita.

import { PLAYER_RADIUS, CLASSES, TEAMS, WEAPONS } from '/shared/constants.js';
import { lineBlocked, rayHitDistance } from '/shared/physics.js';
import { getCharacterSprites, dirFromAngle, SPRITE_W, SPRITE_H } from './sprites.js';
import { CHARACTERS, DEFAULT_CHAR } from '/shared/constants.js';

// Duvar arkası ve çok uzaktaki düşmanlar çizilmez (wallhack yok).
const VIS_DIST = 1300;

// ---------------------------------------------------------------- efektler
export class FX {
  constructor() { this.parts = []; this.shake = 0; }

  spawn(x, y, opts = {}) {
    const n = opts.count ?? 8;
    for (let i = 0; i < n; i++) {
      const a = opts.angle !== undefined
        ? opts.angle + (Math.random() - 0.5) * (opts.spread ?? 1.2)
        : Math.random() * Math.PI * 2;
      const sp = (opts.speed ?? 120) * (0.4 + Math.random() * 0.9);
      this.parts.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: (opts.life ?? 0.4) * (0.6 + Math.random() * 0.8),
        maxLife: opts.life ?? 0.4,
        size: (opts.size ?? 3) * (0.6 + Math.random() * 0.8),
        color: opts.color ?? '#ffcc66',
        drag: opts.drag ?? 3.5,
        glow: opts.glow ?? false,
      });
    }
    if (this.parts.length > 900) this.parts.splice(0, this.parts.length - 900);
  }

  addShake(v) { this.shake = Math.min(16, this.shake + v); }

  update(dt) {
    this.shake *= Math.pow(0.0025, dt);
    if (this.shake < 0.05) this.shake = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      const d = Math.pow(0.5, dt * p.drag);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
  }

  draw(ctx) {
    for (const p of this.parts) {
      const a = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.glow) { ctx.shadowColor = p.color; ctx.shadowBlur = 10; }
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      if (p.glow) ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }
}

// --------------------------------------------------------------- renderer
export class Renderer {
  constructor(canvas, minimap) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mini = minimap;
    this.mctx = minimap ? minimap.getContext('2d') : null;
    this.dpr = 1;
    this.w = 0; this.h = 0;
    this.camX = 0; this.camY = 0;
    this.zoom = 1;
    this.seen = new Map();       // id -> son görülme zamanı (ms)
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    if (this.mini) {
      const mw = this.mini.clientWidth || 200, mh = this.mini.clientHeight || 150;
      this.mini.width = Math.floor(mw * this.dpr);
      this.mini.height = Math.floor(mh * this.dpr);
    }
    // Küçük ekranlarda biraz uzaklaş, büyük ekranlarda yakınlaş
    this.zoom = Math.max(0.62, Math.min(1.15, Math.min(this.w, this.h) / 900));
  }

  worldToScreen(x, y) {
    return {
      x: (x - this.camX) * this.zoom + this.w / 2,
      y: (y - this.camY) * this.zoom + this.h / 2,
    };
  }

  setCamera(x, y, map) {
    // Kamera hedefe yumuşak takip eder ve harita dışına taşmaz
    const halfW = this.w / (2 * this.zoom);
    const halfH = this.h / (2 * this.zoom);
    let cx = x, cy = y;
    if (map.w > halfW * 2) cx = Math.max(halfW, Math.min(map.w - halfW, cx));
    else cx = map.w / 2;
    if (map.h > halfH * 2) cy = Math.max(halfH, Math.min(map.h - halfH, cy));
    else cy = map.h / 2;
    this.camX = cx; this.camY = cy;
  }

  /**
   * @param {object} g  istemci oyun durumu
   */
  draw(g) {
    const ctx = this.ctx;
    const now = performance.now();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    const me = g.meRender;
    this.setCamera(me.x, me.y, g.map);

    // Ekran sarsıntısı
    let shx = 0, shy = 0;
    if (g.fx.shake > 0.05) {
      shx = (Math.random() - 0.5) * g.fx.shake;
      shy = (Math.random() - 0.5) * g.fx.shake;
    }

    ctx.save();
    ctx.translate(this.w / 2 + shx, this.h / 2 + shy);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camX, -this.camY);

    const view = this.viewRect();

    this.drawGround(ctx, g.map, view);
    this.drawPickups(ctx, g, view);
    this.drawObstacles(ctx, g.map, view);
    this.drawAimLaser(ctx, g);
    this.drawBullets(ctx, g, view);
    g.fx.draw(ctx);
    this.drawPlayers(ctx, g, now);
    this.drawBushes(ctx, g, view);      // oyuncuların üstünde: içindekini örter
    // Kendini ve takım arkadaşlarını çalının üstünde soluk göster: nerede
    // olduğunu görebilmelisin, düşman yine de seni göremez.
    this.drawFriendliesOverBushes(ctx, g, now);
    if (g.zone) this.drawZone(ctx, g.zone, g.map);

    ctx.restore();

    this.drawVignette(ctx);
    this.drawCrosshair(ctx, g);
    if (this.mctx) this.drawMinimap(g, now);
  }

  viewRect() {
    const hw = this.w / (2 * this.zoom) + 80;
    const hh = this.h / (2 * this.zoom) + 80;
    return { x0: this.camX - hw, y0: this.camY - hh, x1: this.camX + hw, y1: this.camY + hh };
  }

  drawGround(ctx, map, view) {
    ctx.fillStyle = '#141a21';
    ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);

    // Harita alanı biraz daha açık
    ctx.fillStyle = '#182029';
    ctx.fillRect(0, 0, map.w, map.h);

    // Izgara
    const step = 100;
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const gx0 = Math.max(0, Math.floor(view.x0 / step) * step);
    const gx1 = Math.min(map.w, view.x1);
    for (let x = gx0; x <= gx1; x += step) {
      ctx.moveTo(x, Math.max(0, view.y0));
      ctx.lineTo(x, Math.min(map.h, view.y1));
    }
    const gy0 = Math.max(0, Math.floor(view.y0 / step) * step);
    const gy1 = Math.min(map.h, view.y1);
    for (let y = gy0; y <= gy1; y += step) {
      ctx.moveTo(Math.max(0, view.x0), y);
      ctx.lineTo(Math.min(map.w, view.x1), y);
    }
    ctx.stroke();

    // Sınır
    ctx.strokeStyle = '#3a4757';
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, map.w, map.h);
  }

  drawObstacles(ctx, map, view) {
    for (const o of map.obstacles) {
      if (o.x > view.x1 || o.x + o.w < view.x0 || o.y > view.y1 || o.y + o.h < view.y0) continue;

      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(o.x + 5, o.y + 6, o.w, o.h);

      ctx.fillStyle = '#2b3745';
      ctx.fillRect(o.x, o.y, o.w, o.h);

      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.fillRect(o.x, o.y, o.w, Math.min(6, o.h));
      ctx.fillRect(o.x, o.y, Math.min(6, o.w), o.h);

      ctx.strokeStyle = '#3b4a5c';
      ctx.lineWidth = 2;
      ctx.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
    }
  }

  // Çalılar: engel değil, örtü. Oyuncuların üstüne çizilir ki içindeki gizlensin.
  drawBushes(ctx, g, view) {
    const bushes = g.map.bushes;
    if (!bushes || !bushes.length) return;
    const t = performance.now() / 1000;
    const me = g.meRender;

    for (let i = 0; i < bushes.length; i++) {
      const b = bushes[i];
      if (b.x + b.r < view.x0 || b.x - b.r > view.x1 || b.y + b.r < view.y0 || b.y - b.r > view.y1) continue;

      // İçinde durduğun çalı saydamlaşır: dışarıyı görebilmelisin.
      const inside = Math.hypot(me.x - b.x, me.y - b.y) < b.r;
      const cover = inside ? 0.30 : 1;

      // Hafif rüzgar salınımı (çalıya göre sabit faz)
      const sway = Math.sin(t * 0.9 + i * 1.7) * 2.2;

      // zemin gölgesi
      ctx.globalAlpha = 0.45 * cover;
      ctx.fillStyle = '#0b1410';
      ctx.beginPath();
      ctx.ellipse(b.x + 4, b.y + 6, b.r * 0.98, b.r * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();

      // yaprak kümeleri — üç katman, gitgide açılan yeşil
      const layers = [
        { s: 1.00, c: '#1e3d24', a: 0.94 },
        { s: 0.78, c: '#2b5730', a: 0.94 },
        { s: 0.50, c: '#3a7040', a: 0.90 },
      ];
      for (const L of layers) {
        ctx.globalAlpha = L.a * cover;
        ctx.fillStyle = L.c;
        ctx.beginPath();
        const blobs = 6;
        for (let k = 0; k < blobs; k++) {
          const ang = (k / blobs) * Math.PI * 2 + i * 0.9;
          const rr = b.r * L.s * 0.62;
          const cx = b.x + Math.cos(ang) * b.r * L.s * 0.42 + sway * L.s;
          const cy = b.y + Math.sin(ang) * b.r * L.s * 0.42;
          ctx.moveTo(cx + rr, cy);
          ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      if (inside) {
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = '#5aa564';
        ctx.setLineDash([10, 8]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    }
  }

  // Nereye ateş edileceğini gösteren yardım:
  //   • keskin tüfek → uzun kesikli çizgi (her zaman)
  //   • pompalı      → saçılma konisi (dokunmatikte nişan alınırken)
  drawAimLaser(ctx, g) {
    if (!g.alive) return;
    const wep = WEAPONS[g.weapon];
    if (!wep) return;

    if (!wep.laser) {
      if (g.aiming && !wep.auto) this.drawSpreadCone(ctx, g, wep);
      return;
    }

    const me = g.meRender;
    const dist = rayHitDistance(me.x, me.y, g.aim, wep.range, g.idx);
    const sx = me.x + Math.cos(g.aim) * (PLAYER_RADIUS + 10);
    const sy = me.y + Math.sin(g.aim) * (PLAYER_RADIUS + 10);
    const ex = me.x + Math.cos(g.aim) * Math.max(dist, PLAYER_RADIUS + 12);
    const ey = me.y + Math.sin(g.aim) * Math.max(dist, PLAYER_RADIUS + 12);

    ctx.save();
    const grad = ctx.createLinearGradient(sx, sy, ex, ey);
    grad.addColorStop(0, 'rgba(255,90,90,0.70)');
    grad.addColorStop(1, 'rgba(255,90,90,0.12)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.7;
    ctx.setLineDash([16, 10]);
    ctx.lineDashOffset = -(performance.now() / 22) % 26;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);

    // çarpma noktası
    ctx.fillStyle = 'rgba(255,110,110,0.9)';
    ctx.beginPath();
    ctx.arc(ex, ey, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Pompalının saçılma konisi: parmağını kaldırınca merminin gideceği alan.
  drawSpreadCone(ctx, g, wep) {
    const me = g.meRender;
    const half = wep.spread;
    const start = PLAYER_RADIUS + 8;

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#ffcf7a';
    ctx.beginPath();
    ctx.moveTo(me.x + Math.cos(g.aim) * start, me.y + Math.sin(g.aim) * start);
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const a = g.aim - half + (2 * half * i) / steps;
      const d = rayHitDistance(me.x, me.y, a, wep.range, g.idx);
      ctx.lineTo(me.x + Math.cos(a) * d, me.y + Math.sin(a) * d);
    }
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = '#ffd79a';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }

  drawPickups(ctx, g, view) {
    const t = performance.now() / 1000;
    for (const k of g.pickups) {
      if (!k.active) continue;
      if (k.x < view.x0 || k.x > view.x1 || k.y < view.y0 || k.y > view.y1) continue;
      const bob = Math.sin(t * 2.4 + k.id) * 3;
      const col = '#ffc14d';

      ctx.save();
      ctx.translate(k.x, k.y + bob);
      ctx.shadowColor = col; ctx.shadowBlur = 14;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(-13, -13, 26, 26);
      ctx.strokeStyle = col; ctx.lineWidth = 2.5;
      ctx.strokeRect(-13, -13, 26, 26);
      ctx.shadowBlur = 0;
      ctx.fillStyle = col;
      ctx.fillRect(-6, -7, 4, 14); ctx.fillRect(-1, -7, 4, 14); ctx.fillRect(4, -7, 4, 14);
      ctx.restore();
    }
  }

  drawBullets(ctx, g, view) {
    for (const b of g.bulletsRender) {
      if (b.x < view.x0 || b.x > view.x1 || b.y < view.y0 || b.y > view.y1) continue;
      const wep = WEAPONS[b.w] || WEAPONS.rifle;
      const len = wep.id === 'sniper' ? 34 : wep.id === 'shotgun' ? 12 : 20;
      const tailX = b.x - Math.cos(b.a) * len;
      const tailY = b.y - Math.sin(b.a) * len;

      const grad = ctx.createLinearGradient(tailX, tailY, b.x, b.y);
      grad.addColorStop(0, 'rgba(255,190,90,0)');
      grad.addColorStop(1, 'rgba(255,225,150,0.95)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = wep.bulletR * 0.9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.fillStyle = '#fff3d0';
      ctx.shadowColor = '#ffb347'; ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(b.x, b.y, wep.bulletR * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  drawPlayers(ctx, g, now) {
    const me = g.meRender;
    const myTeam = g.myTeam;

    for (const p of g.playersRender) {
      if (!p.alive && p.id !== g.myId) continue;

      const isMe = p.id === g.myId;
      const friendly = myTeam !== 0 && p.team === myTeam;

      // Görüş hattı: duvar arkasındaki düşmanlar görünmez (kısa süre soluklaşır)
      let alpha = 1;
      if (g.spectating) {
        // Elendikten sonra izleme modunda her şey görünür
      } else if (!isMe && !friendly) {
        const far = Math.hypot(p.x - me.x, p.y - me.y) > VIS_DIST;
        const visible = !far && !lineBlocked(me.x, me.y, p.x, p.y, g.idx);
        if (visible) this.seen.set(p.id, now);
        const last = this.seen.get(p.id) || 0;
        const age = now - last;
        if (age > 500) continue;
        alpha = visible ? 1 : Math.max(0, 1 - age / 500);
      } else if (!isMe && friendly) {
        alpha = lineBlocked(me.x, me.y, p.x, p.y, g.idx) ? 0.45 : 1;
      }

      if (!p.alive && isMe) alpha = 0.35;
      if (p.hidden) alpha *= 0.55;        // çalıdaysa siluet gibi görünsün

      ctx.globalAlpha = alpha;
      this.drawPlayer(ctx, p, g, isMe, friendly, now);
      ctx.globalAlpha = 1;
    }
  }

  drawPlayer(ctx, p, g, isMe, friendly, now) {
    const chr = CHARACTERS[p.char] || CHARACTERS[DEFAULT_CHAR];
    const cls = CLASSES[p.cls] || CLASSES.komando;

    // Takım modunda üniforma takım rengini alır; serbest modda karakterin kendi rengi.
    const jacket = g.teams ? (TEAMS[p.team]?.color || chr.jacket) : chr.jacket;
    const set = getCharacterSprites({
      jacket, hair: chr.hair, skin: chr.skin, accent: chr.accent,
      eye: chr.eye, style: chr.style,
    });

    const dir = dirFromAngle(p.aim);
    const frames = set[dir];
    const frame = p.moving ? frames[p.walkFrame % 3] : frames[1];

    const scale = 1.75;
    const w = SPRITE_W * scale, h = SPRITE_H * scale;
    // Ayaklar oyuncunun konumunda dursun, gövde yukarı doğru uzasın.
    const left = p.x - w / 2;
    const top = p.y + PLAYER_RADIUS * 0.55 - h;

    // --- zemin gölgesi -------------------------------------------------------
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 4, PLAYER_RADIUS * 0.95, PLAYER_RADIUS * 0.48, 0, 0, Math.PI * 2);
    ctx.fill();

    // --- doğuş koruması ------------------------------------------------------
    if (p.protected) {
      ctx.strokeStyle = 'rgba(140,200,255,0.75)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 3, PLAYER_RADIUS + 6 + Math.sin(now / 130) * 1.6,
        PLAYER_RADIUS * 0.6 + 4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // --- kim kim: ayak altı halkası -----------------------------------------
    if (isMe || friendly) {
      ctx.strokeStyle = isMe ? 'rgba(255,255,255,0.65)' : 'rgba(79,209,139,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 4, PLAYER_RADIUS * 1.05, PLAYER_RADIUS * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    const wep = WEAPONS[cls.weapon];
    const facingUp = dir === 'up';

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frame, left, top, w, h);
    ctx.imageSmoothingEnabled = true;

    // Sırtı dönükken silah gövdenin daha yanında dursun ki görünsün
    this.drawWeapon(ctx, p, wep, chr, facingUp ? 10 : 5);

    // --- can çubuğu + isim ---------------------------------------------------
    if (!isMe) {
      const bw = 40, bh = 5;
      const ratio = Math.max(0, Math.min(1, p.hp / (p.maxHp || 100)));
      const bx = p.x - bw / 2, by = top - 9;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = friendly ? '#4fd18b' : (ratio > 0.5 ? '#e0e6ec' : ratio > 0.25 ? '#ffb84d' : '#ff5f5f');
      ctx.fillRect(bx, by, bw * ratio, bh);

      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillText(p.name, p.x + 1, by - 4);
      ctx.fillStyle = friendly ? '#9fe8c0' : '#dfe7ef';
      ctx.fillText(p.name, p.x, by - 5);
      ctx.textAlign = 'left';
    }
  }

  // Silah elde durur ve nişan yönünü gösterir.
  drawWeapon(ctx, p, wep, chr, sideOffset = 5) {
    const handY = p.y - PLAYER_RADIUS * 1.15;      // ellerin yüksekliği
    ctx.save();
    ctx.translate(p.x, handY);
    ctx.rotate(p.aim);

    // Silahı gövdenin biraz yanına al: yukarı/aşağı nişan alırken de
    // siluetin arkasında kaybolmasın (sağ elini kullanan bir asker gibi).
    const oy = sideOffset;
    const len = wep.id === 'sniper' ? 34 : wep.id === 'shotgun' ? 25 : 28;
    const gx = 4;

    // dipçik
    ctx.fillStyle = '#3a2b1e';
    ctx.fillRect(gx - 8, oy - 2.4, 8, 4.8);
    // namlu
    ctx.fillStyle = '#20272f';
    ctx.fillRect(gx, oy - 2.8, len, 5.6);
    ctx.fillStyle = '#3d4854';
    ctx.fillRect(gx, oy - 2.8, len, 1.8);
    // şarjör
    ctx.fillStyle = '#2a323b';
    ctx.fillRect(gx + 5, oy + 2.4, 5, 5);
    if (wep.id === 'sniper') {
      ctx.fillStyle = '#151a20';
      ctx.fillRect(gx + 9, oy - 6.4, 10, 3.6);       // dürbün
    }

    // eller silahın üstünde
    ctx.fillStyle = chr.skin;
    ctx.fillRect(gx + 1, oy - 3.6, 4, 7.2);
    ctx.fillRect(gx + len - 10, oy - 3.4, 4, 6.8);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(gx + 1, oy + 2.2, 4, 1.4);

    // namlu alevi
    if (p.muzzle) {
      ctx.fillStyle = 'rgba(255,220,140,0.95)';
      ctx.shadowColor = '#ffb347'; ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.moveTo(gx + len, oy - 6);
      ctx.lineTo(gx + len + 15, oy);
      ctx.lineTo(gx + len, oy + 6);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  drawFriendliesOverBushes(ctx, g, now) {
    for (const p of g.playersRender) {
      if (!p.alive || !p.hidden) continue;
      const isMe = p.id === g.myId;
      const friendly = g.myTeam !== 0 && p.team === g.myTeam;
      if (!isMe && !friendly) continue;
      ctx.globalAlpha = isMe ? 0.72 : 0.5;
      this.drawPlayer(ctx, p, g, isMe, friendly, now);
      ctx.globalAlpha = 1;
    }
  }

  drawZone(ctx, z, map) {
    ctx.save();
    // Alan dışını karart
    ctx.beginPath();
    ctx.rect(-500, -500, map.w + 1000, map.h + 1000);
    ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(140,20,40,0.30)';
    ctx.fill('evenodd');

    // Sınır
    ctx.strokeStyle = 'rgba(255,90,110,0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
    ctx.stroke();

    // Hedef çember
    if (z.tr && (z.tr !== z.r)) {
      ctx.strokeStyle = 'rgba(120,220,255,0.65)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([16, 12]);
      ctx.beginPath();
      ctx.arc(z.tx, z.ty, z.tr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  drawVignette(ctx) {
    const g = ctx.createRadialGradient(
      this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.34,
      this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.78,
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  drawCrosshair(ctx, g) {
    if (!g.alive) return;
    // Dokunmatikte fare imleci yok; nişan çubuğu yönü zaten oyuncu üzerinde görünüyor.
    if (g.input.touch.active) return;
    const x = g.input.mouseX, y = g.input.mouseY;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.6;
    const gap = 5, len = 9;
    ctx.beginPath();
    ctx.moveTo(x - gap - len, y); ctx.lineTo(x - gap, y);
    ctx.moveTo(x + gap, y); ctx.lineTo(x + gap + len, y);
    ctx.moveTo(x, y - gap - len); ctx.lineTo(x, y - gap);
    ctx.moveTo(x, y + gap); ctx.lineTo(x, y + gap + len);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }

  drawMinimap(g, now) {
    const ctx = this.mctx;
    const W = this.mini.width, H = this.mini.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const pad = 4 * this.dpr;
    const s = Math.min((W - pad * 2) / g.map.w, (H - pad * 2) / g.map.h);
    const ox = (W - g.map.w * s) / 2;
    const oy = (H - g.map.h * s) / 2;
    const X = (x) => ox + x * s;
    const Y = (y) => oy + y * s;

    ctx.fillStyle = 'rgba(20,28,36,0.9)';
    ctx.fillRect(X(0), Y(0), g.map.w * s, g.map.h * s);

    // çalılar önce (duvarların altında kalsın)
    if (g.map.bushes) {
      ctx.fillStyle = 'rgba(46,92,52,0.85)';
      for (const b of g.map.bushes) {
        ctx.beginPath();
        ctx.arc(X(b.x), Y(b.y), Math.max(1.5, b.r * s), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.fillStyle = '#38485a';
    for (const o of g.map.obstacles) {
      ctx.fillRect(X(o.x), Y(o.y), Math.max(1, o.w * s), Math.max(1, o.h * s));
    }

    if (g.zone) {
      ctx.strokeStyle = 'rgba(255,90,110,0.9)';
      ctx.lineWidth = 1.5 * this.dpr;
      ctx.beginPath(); ctx.arc(X(g.zone.x), Y(g.zone.y), g.zone.r * s, 0, Math.PI * 2); ctx.stroke();
      if (g.zone.tr !== g.zone.r) {
        ctx.strokeStyle = 'rgba(120,220,255,0.8)';
        ctx.setLineDash([4 * this.dpr, 3 * this.dpr]);
        ctx.beginPath(); ctx.arc(X(g.zone.tx), Y(g.zone.ty), g.zone.tr * s, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    for (const k of g.pickups) {
      if (!k.active) continue;
      ctx.fillStyle = '#ffc14d';
      ctx.fillRect(X(k.x) - 1.5 * this.dpr, Y(k.y) - 1.5 * this.dpr, 3 * this.dpr, 3 * this.dpr);
    }

    const me = g.meRender;
    for (const p of g.playersRender) {
      if (!p.alive) continue;
      const isMe = p.id === g.myId;
      const friendly = g.myTeam !== 0 && p.team === g.myTeam;
      if (!isMe && !friendly && !g.spectating) {
        const last = this.seen.get(p.id) || 0;
        if (now - last > 900) continue;         // sadece yakın zamanda görülen düşmanlar
      }
      ctx.fillStyle = isMe ? '#ffffff' : friendly ? '#4fd18b' : '#ff5f5f';
      ctx.beginPath();
      ctx.arc(X(p.x), Y(p.y), (isMe ? 3.2 : 2.4) * this.dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // görüş konisi
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1 * this.dpr;
    ctx.beginPath();
    ctx.moveTo(X(me.x), Y(me.y));
    ctx.lineTo(X(me.x + Math.cos(g.aim) * 260), Y(me.y + Math.sin(g.aim) * 260));
    ctx.stroke();
  }
}
