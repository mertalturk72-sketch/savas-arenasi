// Canvas çizimi: dünya, oyuncular, mermiler, efektler, mini harita.

import {
  PLAYER_RADIUS, CLASSES, TEAMS, WEAPONS,
  WEAPON_VIEW, HAND_Y, HAND_SIDE, muzzleWorld,
} from '/shared/constants.js';
import { lineBlocked, rayHitDistance } from '/shared/physics.js';
import { getCharacterSprites, dirFromAngle, SPRITE_W, SPRITE_H, WALK_FRAMES } from './sprites.js';
import { CHARACTERS, DEFAULT_CHAR } from '/shared/constants.js';

// GÜN DÖNGÜSÜ VE GÖLGELER KALDIRILDI.
//
// Eskiden her maç günün rastgele bir saatinde geçiyor, sahneye çarpma
// (multiply) ile renk bindiriliyor, binalar ve karakterler güneşin tersine
// gölge düşürüyordu. İstenmediği için tamamı çıkarıldı: sahne her zaman düz
// gündüz ışığında. Bunun iki faydası da var — parça önbelleği artık güneş
// kaydıkça boşaltılmıyor ve gölge çizimi (bina başına bulanık gölge) tamamen
// kalktı.

// Duvar arkası ve çok uzaktaki düşmanlar çizilmez (wallhack yok).
const VIS_DIST = 1300;

// ---------------------------------------------------------------- efektler
// Zemin dokusunun bir kiremitinin kaç dünya pikselini kapladığı.
// Küçültmek çim tellerini inceltir (karaktere göre daha doğru orantı),
// büyütmek kabalaştırır. Oyuncu boyu ~63 px olduğu için 190 iyi oturuyor.
const GRASS_TILE_PX = 190;

// Sabit dünya katmanının parça boyutu ve önbellekte tutulacak parça sayısı.
// 512 px'lik parçalar 1280x720 ekranda ~12 parça eder; 48 parça hem yeterli
// hem de bellekte ~48 MB yerine ~48*512*512*4 ≈ 50 MB... değil: parçalar
// yalnızca ihtiyaç oldukça üretilir ve en eskisi atılır.
const TILE_PX = 512;
const MAX_TILES = 40;

// Haritanın "parmak izi". Sabit dünya katmanı (çim + binalar) parçalar hâlinde
// önbelleğe alınıyor; harita değişince bu önbelleğin ATILMASI şart. Kimliği
// en/boydan üretmek yetmiyordu: arena her maçta yeniden üretiliyor ama boyu
// hep aynı kalıyor. Bu yüzden engellerin kendisinden bir özet çıkarıyoruz —
// tek bir duvar bir piksel kaysa bile imza değişir.
export function mapSignature(map) {
  if (!map) return 'yok';
  let h = 2166136261 >>> 0;                       // FNV-1a
  const kat = (v) => { h ^= v | 0; h = Math.imul(h, 16777619) >>> 0; };
  kat(map.w); kat(map.h);
  const obs = map.obstacles || [];
  kat(obs.length);
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    kat(o.x); kat(o.y); kat(o.w); kat(o.h);
  }
  const bus = map.bushes || [];
  kat(bus.length);
  for (let i = 0; i < bus.length; i++) {
    const b = bus[i];
    kat(b.x); kat(b.y); kat(b.r);
  }
  return `${map.w}x${map.h}#${obs.length}#${h.toString(36)}`;
}

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
    // id -> yürüyüş salınımının açıklığı (0..1). Oyuncu nesneleri her karede
    // yeniden kurulduğu için bu değeri burada saklamak zorundayız.
    this.gait = new Map();
    // Sabit dünya parçaları (zemin + binalar). Bkz. drawWorld().
    this.tiles = new Map();
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
    // Küçük ekranlarda biraz uzaklaş, büyük ekranlarda yakınlaş.
    //
    // ALT SINIR 0.62 → 0.50: telefonda bombanın nereye düşeceği görünmüyordu.
    // Bombanın azami menzili 675 dünya pikseli; 0.62'de bu, 900 px genişliğinde
    // bir telefon ekranının tam kenarına denk geliyordu — hedef halkası ekranın
    // dışında kalıyor, oyuncu nişan alamıyordu. 0.50'de görüş alanı ~%38
    // genişliyor ve halka rahatça içeride kalıyor.
    //
    // Bilgisayarı ETKİLEMEZ: orada min(en,boy)/900 zaten 0.50'nin üstünde,
    // alt sınır hiç devreye girmiyor.
    this.zoom = Math.max(0.50, Math.min(1.15, Math.min(this.w, this.h) / 900));
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

    // Zemin + binalar tek seferde, önbellekten
    this.drawWorld(ctx, g.map, view);
    if (g.ctf) this.drawCtfBases(ctx, g, now);   // üsler zeminde, oyuncuların altında
    this.drawPickups(ctx, g, view);
    this.drawAimLaser(ctx, g);
    this.drawBullets(ctx, g, view);
    this.drawBlasts(ctx, g);
    g.fx.draw(ctx);
    this.drawPlayers(ctx, g, now);
    this.drawBushes(ctx, g, view);      // oyuncuların üstünde: içindekini örter
    // Kendini ve takım arkadaşlarını çalının üstünde soluk göster: nerede
    // olduğunu görebilmelisin, düşman yine de seni göremez.
    this.drawFriendliesOverBushes(ctx, g, now);
    if (g.ctf && g.flag) this.drawCtfFlag(ctx, g, now);   // bayrak en üstte
    if (g.zone) this.drawZone(ctx, g.zone, g.map);

    ctx.restore();

    this.drawVignette(ctx);
    this.drawCrosshair(ctx, g);
    if (g.ctf && g.flag) this.drawCtfFlagPointer(ctx, g, now);
    if (this.mctx) this.drawMinimap(g, now);
  }


  viewRect() {
    const hw = this.w / (2 * this.zoom) + 80;
    const hh = this.h / (2 * this.zoom) + 80;
    return { x0: this.camX - hw, y0: this.camY - hh, x1: this.camX + hw, y1: this.camY + hh };
  }

  // Çimen zemin dokusu.
  //
  // Amaç: yakından bakınca "gürültü" gibi durmayan, yumuşak bir çimen.
  // Nasıl:
  //   1) Doku 3x3 döşenmiş büyük bir tuvale çiziliyor,
  //   2) tamamına bulanıklık uygulanıyor,
  //   3) ortadaki kare kırpılıyor.
  // Bu üç adım olmadan bulanıklık kenarlarda saydamlığa karışır ve döşeme
  // yerlerinde dikiş izi çıkardı. Böylece kenarlar da yumuşak ve kusursuz
  // tekrar ediyor.
  // Zemin dokusu olarak kullanılacak görsel. Sunucudan servis edilen sürüm
  // dosyayı normal yolla yükler; tek dosyalık (internetsiz) sürümde ise
  // build-single.mjs görseli data URL olarak gömer ve bu değişkeni ayarlar.
  grassImage() {
    if (this._grassImg !== undefined) return this._grassImg;
    const url = (typeof window !== 'undefined' && window.__GRASS_URL) || '/textures/grass.jpg';
    const img = new Image();
    img.onload = () => {
      // KRİTİK: sadece deseni tazelemek YETMİYOR.
      //
      // Zemin, 512 px'lik parçalara bir kez çizilip önbelleğe alınıyor
      // (staticTile). Görsel geç yüklenirse ilk parçalar kodla üretilen YEDEK
      // çimenle pişiyor ve orada kalıyor — kullanıcı "çimen bazen yüklenmiyor"
      // diye görüyordu. Aslında yüklenmişti; ekrandaki parçalar eskiydi.
      //
      // O yüzden görsel gelince pişmiş parçaları da atıyoruz; bir sonraki
      // karede gerçek dokuyla yeniden çiziliyorlar.
      this._grass = null;
      this._grassFromImg = null;
      this.tiles.clear();
    };
    img.onerror = () => {
      // Görsel hiç gelmedi: kodla üretilen çimene düş ve parçaları tazele
      // (yarım kalmış bir görselle pişmiş parça kalmasın).
      this._grassImg = null;
      this._grassFromImg = null;
      this.tiles.clear();
    };
    img.src = url;
    this._grassImg = img;
    return img;
  }

  // Dokuyu maç başlamadan yüklemeye başla: ilk karelerde yedek çimen görünüp
  // sonra değişmesin. Yükleme bitmemişse yine de sorun değil — üstteki
  // onload parçaları tazeliyor.
  preloadTextures() { this.grassImage(); }

  grassPattern(ctx) {
    // Görsel hazırsa onu kullan.
    const img = this.grassImage();
    if (img && img.complete && img.naturalWidth > 0) {
      if (!this._grassFromImg) {
        // Ölçek meselesi: dokuyu 1:1 döşersen çim telleri karakter boyuna
        // yaklaşır ve orantı bozuk görünür. Bir kiremit GRASS_TILE_PX kadar
        // dünya pikseli kaplamalı.
        //
        // Bunu pattern.setTransform ile yapmak ÇALIŞIR ama pahalıdır: her
        // pikselde ek bir dönüşüm hesabı demek. Onun yerine görseli bir kez
        // hedef boyuta çizip deseni ondan üretiyoruz — desen artık 1:1,
        // örnekleme ucuz. (Ölçüm: zemin çizimi ~8 ms'den ~1 ms'ye indi.)
        const t = document.createElement('canvas');
        t.width = GRASS_TILE_PX;
        t.height = GRASS_TILE_PX;
        t.getContext('2d').drawImage(img, 0, 0, GRASS_TILE_PX, GRASS_TILE_PX);
        this._grassFromImg = ctx.createPattern(t, 'repeat');
      }
      if (this._grassFromImg) return this._grassFromImg;
    }

    // Görsel yoksa ya da henüz yüklenmediyse: kodla üretilen çimen.
    if (this._grass) return this._grass;

    const S = 256;

    // --- 1) ham doku ---
    const raw = document.createElement('canvas');
    raw.width = S; raw.height = S;
    const g = raw.getContext('2d');

    let seed = 20260819;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    g.fillStyle = '#1e2c1f';
    g.fillRect(0, 0, S, S);

    // Geniş, çok yumuşak lekeler — çimenin tekdüze görünmemesi için
    for (let i = 0; i < 22; i++) {
      const x = rnd() * S, y = rnd() * S, r = 30 + rnd() * 60;
      const light = rnd() > 0.5;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, light ? 'rgba(66,98,58,0.22)' : 'rgba(16,26,17,0.20)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }

    // Çim telleri: keskin çizgi yerine soluk, ince ve kısa. Bulanıklık sonrası
    // tek tek seçilmiyor, sadece yüzeye canlılık katıyor.
    g.lineCap = 'round';
    g.lineWidth = 1.4;
    for (let i = 0; i < 520; i++) {
      const x = rnd() * S, y = rnd() * S;
      const len = 3 + rnd() * 4;
      const lean = (rnd() - 0.5) * 2.4;
      const tone = rnd();
      g.strokeStyle = tone > 0.7 ? 'rgba(112,150,88,0.16)'
        : tone > 0.34 ? 'rgba(74,108,62,0.18)'
          : 'rgba(20,32,21,0.18)';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + lean, y - len);
      g.stroke();
    }

    // --- 2) 3x3 döşe, bulanıklaştır, ortayı kırp ---
    const big = document.createElement('canvas');
    big.width = S * 3; big.height = S * 3;
    const bg = big.getContext('2d');
    for (let ty = 0; ty < 3; ty++) {
      for (let tx = 0; tx < 3; tx++) bg.drawImage(raw, tx * S, ty * S);
    }

    const tile = document.createElement('canvas');
    tile.width = S; tile.height = S;
    const tg = tile.getContext('2d');
    tg.filter = 'blur(1.6px)';
    tg.drawImage(big, -S, -S);
    tg.filter = 'none';

    this._grass = ctx.createPattern(tile, 'repeat');
    return this._grass;
  }

  // Döşemenin tekrar ettiği gözle seçilmesin diye harita ölçeğinde birkaç çok
  // büyük, çok yumuşak leke. Konumları haritadan türetiliyor, sabit.
  grassBlotches(map) {
    if (this._blotch && this._blotchKey === `${map.w}x${map.h}`) return this._blotch;
    let seed = (map.w * 73856093) ^ (map.h * 19349663);
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const list = [];
    const n = Math.round((map.w * map.h) / 240000);
    for (let i = 0; i < n; i++) {
      list.push({
        x: rnd() * map.w,
        y: rnd() * map.h,
        r: 220 + rnd() * 360,
        light: rnd() > 0.5,
      });
    }
    this._blotchKey = `${map.w}x${map.h}`;
    this._blotch = list;
    return list;
  }

  // Harita ölçeğindeki yumuşak lekeler ve kenar kararması SABİTTİR. Her karede
  // 34 ayrı radyal gradyan çizmek yerine hepsini bir kez küçük bir tuvale
  // basıp o tuvali gerdirerek çiziyoruz: 34 gradyan yerine tek drawImage.
  // Lekeler zaten bulanık olduğu için düşük çözünürlük fark ettirmiyor.
  groundOverlay(map) {
    const key = `${map.w}x${map.h}`;
    if (this._overlay && this._overlayKey === key) return this._overlay;

    const S = 256;                       // küçük: bulanık lekeler için fazlasıyla yeter
    const c = document.createElement('canvas');
    c.width = S;
    c.height = Math.max(1, Math.round(S * map.h / map.w));
    const g = c.getContext('2d');
    const sx = c.width / map.w, sy = c.height / map.h;

    for (const b of this.grassBlotches(map)) {
      const x = b.x * sx, y = b.y * sy, r = b.r * sx;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, b.light ? 'rgba(84,116,70,0.16)' : 'rgba(10,20,12,0.18)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }

    // Kenarlara doğru yumuşak kararma
    const e = 90;
    const bands = [
      [0, 0, map.w, e, 0, 1], [0, map.h - e, map.w, e, 0, -1],
      [0, 0, e, map.h, 1, 0], [map.w - e, 0, e, map.h, -1, 0],
    ];
    for (const [bx, by, bw, bh, dx, dy] of bands) {
      const x0 = (dx > 0 ? bx : dx < 0 ? bx + bw : bx) * sx;
      const y0 = (dy > 0 ? by : dy < 0 ? by + bh : by) * sy;
      const x1 = (dx > 0 ? bx + bw : dx < 0 ? bx : bx) * sx;
      const y1 = (dy > 0 ? by + bh : dy < 0 ? by : by) * sy;
      const gr = g.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, 'rgba(0,0,0,0.30)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(bx * sx, by * sy, bw * sx, bh * sy);
    }

    this._overlayKey = key;
    this._overlay = c;
    return c;
  }

  // --- Sabit dünya katmanı (zemin + binalar) --------------------------------
  //
  // Zemin ve binalar maç boyunca değişmez, ama her karede yeniden çizmek
  // ölçülen kare süresinin yarısından fazlasını yiyordu (desen doldurma,
  // 34 radyal gradyan, bina başına bulanık gölge...).
  //
  // Bunun yerine dünyayı TILE x TILE'lik parçalara bölüp her parçayı bir kez
  // çiziyor ve saklıyoruz; her karede sadece görünen parçaları kopyalıyoruz.
  // Bellek sınırlı tutuluyor (en son kullanılanlar kalır).
  //
  // Tek istisna: güneş hareket ettikçe gölgelerin yönü değişir. Güneş konumu
  // gözle görülür şekilde değiştiğinde önbellek boşaltılıyor — maç boyunca
  // birkaç kez olur, fark edilmez.
  staticTile(map, tx, ty) {
    const key = `${tx},${ty}`;
    const cached = this.tiles.get(key);
    if (cached) {
      this.tiles.delete(key);          // en son kullanılan sona gitsin
      this.tiles.set(key, cached);
      return cached;
    }

    const S = TILE_PX;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    const ox = tx * S, oy = ty * S;
    g.translate(-ox, -oy);

    // harita dışı
    g.fillStyle = '#0b110c';
    g.fillRect(ox, oy, S, S);

    const gx0 = Math.max(0, ox), gy0 = Math.max(0, oy);
    const gx1 = Math.min(map.w, ox + S), gy1 = Math.min(map.h, oy + S);
    if (gx1 > gx0 && gy1 > gy0) {
      // çimen
      g.fillStyle = this.grassPattern(g);
      g.fillRect(gx0, gy0, gx1 - gx0, gy1 - gy0);

      // lekeler + kenar kararması (hazır küçük katmandan)
      const ov = this.groundOverlay(map);
      const sx = ov.width / map.w, sy = ov.height / map.h;
      g.drawImage(ov,
        gx0 * sx, gy0 * sy, (gx1 - gx0) * sx, (gy1 - gy0) * sy,
        gx0, gy0, gx1 - gx0, gy1 - gy0);

      // sınır duvarı
      g.strokeStyle = '#46523c';
      g.lineWidth = 6;
      g.strokeRect(0, 0, map.w, map.h);
    }

    // Binalar: parçanın biraz DIŞINDAKİLERİ de çiziyoruz, yoksa komşu binanın
    // bu parçaya düşen gölgesi kaybolur ve parça sınırlarında dikiş görünür.
    const pay = 140;
    this.paintObstacles(g, map, {
      x0: ox - pay, y0: oy - pay, x1: ox + S + pay, y1: oy + S + pay,
    });

    this.tiles.set(key, c);
    if (this.tiles.size > MAX_TILES) {
      const enEski = this.tiles.keys().next().value;
      this.tiles.delete(enEski);
    }
    return c;
  }

  drawWorld(ctx, map, view) {
    // Harita değiştiyse önbelleği tazele. (Güneş kalktığı için başka bir
    // tazeleme sebebi kalmadı: dünya katmanı maç boyunca sabit.)
    // "İÇİNDEN GEÇİLEN DUVAR" HATASININ KÖKÜ BURASIYDI.
    //
    // Anahtar eskiden sadece haritanın en/boyuydu. Arena her maçta yeniden
    // ÜRETİLİYOR ama boyutları hep aynı — yani anahtar değişmiyordu. Bir
    // sonraki maçta önbellekte duran eski kiremitler olduğu gibi ekrana
    // geliyordu: ekranda ÖNCEKİ haritanın duvarları görünüyor, çarpışma ise
    // YENİ haritaya göre işliyordu. Sonuç: "duvar var ama içinden geçiliyor"
    // (ve tersi: görünmeyen duvara çarpma). Kiremit önbelleği 40 taneyle
    // sınırlı olduğu için sadece bazı bölgelerde oluyordu — bu yüzden
    // "bazen" diye tarif ediliyordu.
    //
    // Artık anahtar haritanın GEOMETRİSİNDEN üretiliyor: engeller değişirse
    // anahtar da değişir, önbellek kendiliğinden sıfırlanır.
    const key = mapSignature(map);
    if (this._tileMapKey !== key) {
      this._tileMapKey = key;
      this.tiles.clear();
    }

    const S = TILE_PX;
    const tx0 = Math.floor(view.x0 / S), tx1 = Math.floor(view.x1 / S);
    const ty0 = Math.floor(view.y0 / S), ty1 = Math.floor(view.y1 / S);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        ctx.drawImage(this.staticTile(map, tx, ty), tx * S, ty * S);
      }
    }
  }

  paintObstacles(ctx, map, view) {
    for (const o of map.obstacles) {
      if (o.x > view.x1 || o.x + o.w < view.x0 || o.y > view.y1 || o.y + o.h < view.y0) continue;

      // Binanın kendine ait sabit rastgeleliği
      let h = ((o.x * 73856093) ^ (o.y * 19349663) ^ (o.w * 83492791)) >>> 0;
      const rnd = () => { h = (h * 1664525 + 1013904223) >>> 0; return h / 4294967296; };

      // --- yere düşen gölge: güneşin tam tersine, güneş alçaldıkça uzun ---
      ctx.save();
      ctx.fillStyle = '#1d242c';
      this.roundRect(ctx, o.x, o.y, o.w, o.h, 4);
      ctx.fill();
      ctx.restore();

      // --- çatı yüzeyi (biraz içeride: duvar kalınlığı hissi) ---
      const t = 5;
      const rx = o.x + t, ry = o.y + t;
      const rw = Math.max(2, o.w - t * 2), rh = Math.max(2, o.h - t * 2);
      const tone = 58 + Math.floor(rnd() * 12);
      ctx.fillStyle = `rgb(${tone},${tone + 5},${tone + 12})`;
      this.roundRect(ctx, rx, ry, rw, rh, 3);
      ctx.fill();

      // Çatı yüzeyine köşegen bir ışık geçişi: düz renk yerine hafif hacim
      const lit = ctx.createLinearGradient(o.x, o.y, o.x + o.w, o.y + o.h);
      lit.addColorStop(0, 'rgba(255,255,255,0.07)');
      lit.addColorStop(0.55, 'rgba(255,255,255,0)');
      lit.addColorStop(1, 'rgba(0,0,0,0.16)');
      ctx.fillStyle = lit;
      this.roundRect(ctx, rx, ry, rw, rh, 3);
      ctx.fill();

      // Çatı panelleri: soluk çizgiler
      ctx.strokeStyle = 'rgba(0,0,0,0.13)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = rx + 40; x < rx + rw; x += 40) { ctx.moveTo(x, ry); ctx.lineTo(x, ry + rh); }
      for (let y = ry + 40; y < ry + rh; y += 40) { ctx.moveTo(rx, y); ctx.lineTo(rx + rw, y); }
      ctx.stroke();

      // --- parapet: sert şerit yerine kenardan içeri sönen geçiş ---
      const band = (x, y, w, h, x0, y0, x1, y1, col) => {
        const gr = ctx.createLinearGradient(x0, y0, x1, y1);
        gr.addColorStop(0, col);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(x, y, w, h);
      };
      const T = t + 3;
      band(o.x, o.y, o.w, T, o.x, o.y, o.x, o.y + T, 'rgba(255,255,255,0.16)');
      band(o.x, o.y, T, o.h, o.x, o.y, o.x + T, o.y, 'rgba(255,255,255,0.16)');
      band(o.x, o.y + o.h - T, o.w, T, o.x, o.y + o.h, o.x, o.y + o.h - T, 'rgba(0,0,0,0.40)');
      band(o.x + o.w - T, o.y, T, o.h, o.x + o.w, o.y, o.x + o.w - T, o.y, 'rgba(0,0,0,0.40)');

      // --- çatı üstü detaylar (yeterince büyük binalarda) ---
      if (rw > 70 && rh > 70) {
        const n = 1 + Math.floor(rnd() * 3);
        for (let i = 0; i < n; i++) {
          const dw = 14 + rnd() * 16;
          const dh = 14 + rnd() * 16;
          const dx = rx + 8 + rnd() * Math.max(1, rw - dw - 16);
          const dy = ry + 8 + rnd() * Math.max(1, rh - dh - 16);
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,0.45)';
          ctx.shadowBlur = 7;
          ctx.shadowOffsetX = 2;
          ctx.shadowOffsetY = 3;
          if (rnd() > 0.45) {
            // havalandırma / makine dairesi
            ctx.fillStyle = '#4c5663';
            this.roundRect(ctx, dx, dy, dw, dh, 3);
            ctx.fill();
            ctx.restore();
            ctx.fillStyle = 'rgba(255,255,255,0.11)';
            this.roundRect(ctx, dx, dy, dw, Math.min(4, dh), 3);
            ctx.fill();
          } else {
            // çatı penceresi
            ctx.fillStyle = '#5d7488';
            this.roundRect(ctx, dx, dy, dw, dh, 3);
            ctx.fill();
            ctx.restore();
            ctx.fillStyle = 'rgba(190,220,255,0.18)';
            this.roundRect(ctx, dx + 2, dy + 2, dw - 4, dh - 4, 2);
            ctx.fill();
          }
        }
      }

      // --- dış hat: ince ve yumuşak ---
      ctx.strokeStyle = 'rgba(14,18,23,0.75)';
      ctx.lineWidth = 1.5;
      this.roundRect(ctx, o.x + 0.75, o.y + 0.75, o.w - 1.5, o.h - 1.5, 4);
      ctx.stroke();
    }
  }

  // Yuvarlatılmış dikdörtgen yolu (eski tarayıcılarda roundRect olmayabilir).
  roundRect(ctx, x, y, w, h, r) {
    const rad = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, rad); return; }
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
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

    // Bomba: tuşu tuttukça menzil doluyor. Nereye düşeceğini GÖSTERMEDEN
    // ayarlanabilir menzil işkence olurdu; o yüzden hedef noktayı ve patlama
    // yarıçapını canlı çiziyoruz.
    if (wep.throwable) {
      this.drawThrowArc(ctx, g, wep);
      return;
    }

    if (!wep.laser) {
      if (g.aiming && !wep.auto) this.drawSpreadCone(ctx, g, wep);
      return;
    }

    const me = g.meRender;
    const dist = rayHitDistance(me.x, me.y, g.aim, wep.range, g.idx);
    // Çizgi NAMLUDAN başlasın: mermi de oradan çıkıyor. Eskiden gövde
    // merkezinden başlıyordu ve nişan çizgisi silahla hizasızdı.
    const namlu = muzzleWorld(me.x, me.y, g.aim, wep.id);
    const sx = namlu.x;
    const sy = namlu.y;
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

  // Bomba menzil göstergesi: atış hattı, düşeceği nokta ve patlama alanı.
  // g.charge 0..1 arası (istemci kendi tuttuğu süreden hesaplıyor).
  drawThrowArc(ctx, g, wep) {
    const me = g.meRender;
    const t = Math.max(0, Math.min(1, g.charge || 0));
    const menzil = wep.minRange + t * (wep.maxRange - wep.minRange);
    // Duvar varsa bomba oraya kadar gider.
    const engel = rayHitDistance(me.x, me.y, g.aim, menzil, g.idx);
    const d = Math.min(menzil, engel);
    const hx = me.x + Math.cos(g.aim) * d;
    const hy = me.y + Math.sin(g.aim) * d;
    const tutuyor = !!g.aiming || t > 0.02;

    ctx.save();
    // atış hattı
    ctx.strokeStyle = tutuyor ? 'rgba(255,159,90,0.55)' : 'rgba(255,159,90,0.22)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -(performance.now() / 26) % 18;
    ctx.beginPath();
    ctx.moveTo(me.x + Math.cos(g.aim) * (PLAYER_RADIUS + 8), me.y + Math.sin(g.aim) * (PLAYER_RADIUS + 8));
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.setLineDash([]);

    // patlama alanı
    ctx.strokeStyle = tutuyor ? 'rgba(255,120,60,0.75)' : 'rgba(255,120,60,0.32)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hx, hy, wep.blastR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = tutuyor ? 'rgba(255,120,60,0.13)' : 'rgba(255,120,60,0.05)';
    ctx.fill();

    // menzil doluluk halkası (hedefin üstünde küçük bir yay)
    if (tutuyor) {
      ctx.strokeStyle = '#ffd479';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(hx, hy, wep.blastR + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
    ctx.restore();
  }

  // --- Bayrak Çalma (CTF) çizimi ------------------------------------------
  // Üsler: takım renginde, nabız atan halkalar. Bayrağı buraya götürünce sayı.
  drawCtfBases(ctx, g, now) {
    const R = 48;   // CTF.baseR ile aynı görünüm
    for (const t of [1, 2]) {
      const b = g.ctf.bases[t];
      if (!b) continue;
      const col = TEAMS[t]?.color || (t === 1 ? '#ff6b6b' : '#6b9bff');
      const pulse = 1 + Math.sin(now / 350) * 0.06;
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(b.x, b.y, R * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = col; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(b.x, b.y, R * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  // Bayrak: taşınıyorsa taşıyıcının üstünde, değilse yerdeki konumunda.
  drawCtfFlag(ctx, g, now) {
    const f = g.flag;
    let x = f.x, y = f.y;
    if (f.state === 1 && f.carrier) {                // taşınıyor
      const c = g.playersRender?.find((p) => p.id === f.carrier);
      if (c) { x = c.x; y = c.y - PLAYER_RADIUS - 30; }
    } else {
      y = f.y - 4;
    }
    const wave = Math.sin(now / 140) * 2.2;
    ctx.save();
    // yerdeyse hafif zemin gölgesi + parıltı
    if (f.state !== 1) {
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(f.x, f.y + 2, 8, 3.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // direk
    ctx.strokeStyle = '#d8d2c4'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 22); ctx.stroke();
    // bez (dalgalanan üçgen) — beyaz bayrak (istek)
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#b9bcc2'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - 22);
    ctx.lineTo(x + 15 + wave, y - 17);
    ctx.lineTo(x, y - 12);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // Bayrak yön oku: bayrak ekran dışındaysa kenarda ona doğru bir ok çizer.
  // Renk durumu anlatır: takımın taşıyor=yeşil, düşman taşıyor=kırmızı, boşta=sarı.
  drawCtfFlagPointer(ctx, g, now) {
    const f = g.flag;
    let fx = f.x, fy = f.y;
    if (f.state === 1 && f.carrier) {
      const c = g.playersRender?.find((p) => p.id === f.carrier);
      if (c) { fx = c.x; fy = c.y; }
    }
    // dünya → ekran
    const sx = (fx - this.camX) * this.zoom + this.w / 2;
    const sy = (fy - this.camY) * this.zoom + this.h / 2;
    const m = 52;
    if (sx >= m && sx <= this.w - m && sy >= m && sy <= this.h - m) return;  // görünüyor

    // Renk = durum: boşta/evde beyaz (bayrak beyaz); taşınıyorsa takıma göre yeşil/kırmızı.
    let col = '#ffffff';
    if (f.state === 1 && f.carrier) {
      const c = g.playersRender?.find((p) => p.id === f.carrier);
      col = (c && g.myTeam && c.team === g.myTeam) ? '#4fd18b' : '#ff5a52';
    }

    const cx = this.w / 2, cy = this.h / 2;
    const ang = Math.atan2(sy - cy, sx - cx);
    const px = Math.max(m, Math.min(this.w - m, sx));
    const py = Math.max(m, Math.min(this.h - m, sy));
    const pulse = 1 + Math.sin(now / 200) * 0.12;

    ctx.save();
    ctx.translate(px, py);
    // ok (üçgen), bayrağa doğru döner
    ctx.save();
    ctx.rotate(ang);
    ctx.fillStyle = col;
    ctx.shadowColor = col; ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(20 * pulse, 0);
    ctx.lineTo(2, -11);
    ctx.lineTo(2, 11);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // küçük bayrak simgesi
    ctx.shadowBlur = 0;
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🚩', 0, -18);
    ctx.restore();
  }

  // Patlama halkası: hızla büyüyüp sönen turuncu bir dalga. Oyuncuya patlamanın
  // NEREDE ve NE KADAR GENİŞ olduğunu gösteriyor — hasar alanıyla aynı yarıçap.
  drawBlasts(ctx, g) {
    if (!g.blasts || !g.blasts.length) return;
    const now = performance.now();
    const SURE = 620;   // patlama halkasının ömrü (ms)
    for (let i = g.blasts.length - 1; i >= 0; i--) {
      const b = g.blasts[i];
      const t = (now - b.t) / SURE;
      if (t >= 1) { g.blasts.splice(i, 1); continue; }
      const r = b.r * (0.25 + t * 0.85);
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.9;
      const gr = ctx.createRadialGradient(b.x, b.y, r * 0.2, b.x, b.y, r);
      gr.addColorStop(0, 'rgba(255,236,180,0.85)');
      gr.addColorStop(0.55, 'rgba(255,140,50,0.42)');
      gr.addColorStop(1, 'rgba(255,90,30,0)');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,190,110,${(1 - t) * 0.8})`;
      ctx.lineWidth = 3 * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (g.blasts.length > 24) g.blasts.splice(0, g.blasts.length - 24);
  }

  drawBullets(ctx, g, view) {
    for (const b of g.bulletsRender) {
      if (b.x < view.x0 || b.x > view.x1 || b.y < view.y0 || b.y > view.y1) continue;
      const wep = WEAPONS[b.w] || WEAPONS.rifle;

      // Bomba mermi gibi çizilmez: havada dönen koyu bir küre, fitili kıvılcım
      // saçıyor. Böylece oyuncu "bu bir bomba, kaçmam lazım" diye anlıyor.
      if (wep.throwable) {
        const t = (performance.now() / 1000) % 1;
        ctx.save();
        ctx.translate(b.x, b.y);
        // yere düşen gölge
        ctx.fillStyle = 'rgba(0,0,0,0.32)';
        ctx.beginPath();
        ctx.ellipse(3, 6, wep.bulletR * 1.05, wep.bulletR * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.rotate(t * Math.PI * 4);
        // gövde
        const gr = ctx.createRadialGradient(-2, -3, 1, 0, 0, wep.bulletR + 2);
        gr.addColorStop(0, '#5a6472');
        gr.addColorStop(1, '#1b2029');
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(0, 0, wep.bulletR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0d1117';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // fitil + kıvılcım
        ctx.strokeStyle = '#8a6a3f';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -wep.bulletR);
        ctx.lineTo(2, -wep.bulletR - 5);
        ctx.stroke();
        ctx.fillStyle = '#ffd479';
        ctx.shadowColor = '#ff9f43';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(2, -wep.bulletR - 5, 2 + Math.sin(t * Math.PI * 8) * 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
        continue;
      }

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
      // Ölen oyuncu çizilmez. Eskiden kendi ölü bedenimiz soluk olarak
      // ekranda kalıyordu ve yerde ceset varmış gibi görünüyordu.
      if (!p.alive) continue;

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
      eye: chr.eye, style: chr.style, walk: chr.walk,
    });
    const wk = chr.walk || { bob: 1, sway: 1 };

    const dir = dirFromAngle(p.aim);
    const frames = set[dir];
    // Dururken nötr duruş (0. kare), yürürken 8 kareli döngü.
    const frame = p.moving ? frames[p.walkFrame % WALK_FRAMES] : frames[0];

    // --- yumuşak geçiş -------------------------------------------------------
    // Kareler ayrık, ama gövdenin inip kalkması ve hafif yana salınımı SÜREKLİ:
    // kesirli yürüyüş fazından sinüsle hesaplanıyor. Böylece kareden kareye
    // atlama görünmüyor, hareket akıp gidiyor. Dururken de sıfıra doğru eriyor.
    // DİKKAT: playersRender listesi her karede sıfırdan kuruluyor, bu yüzden
    // yumuşatma değerini oyuncu nesnesinde tutamayız — kaybolur. Oyuncu
    // kimliğine göre çizicide saklıyoruz.
    const ph = p.walkPhase || 0;
    const target = p.moving ? 1 : 0;
    const prev = this.gait.get(p.id);
    const gait = (prev ?? target) + (target - (prev ?? target)) * 0.18;
    this.gait.set(p.id, gait);
    p._gait = gait;                     // testlerin ve hata ayıklamanın görmesi için
    // İki adımda bir tam iniş-çıkış (8 karelik döngüde 2 kez)
    const bob = Math.sin(ph * Math.PI / 2) * 2.2 * gait * (wk.bob ?? 1);
    const sway = Math.sin(ph * Math.PI / 4) * 0.9 * gait * (wk.sway ?? 1);

    const scale = 1.75;
    const w = SPRITE_W * scale, h = SPRITE_H * scale;
    // Ayaklar oyuncunun konumunda dursun, gövde yukarı doğru uzasın.
    const left = p.x - w / 2 + sway;
    const top = p.y + PLAYER_RADIUS * 0.55 - h - Math.abs(bob);

    // --- zemin izi -----------------------------------------------------------
    // Güneş ve gölgeler kaldırıldı. Karakterin zeminden kopuk durmaması için
    // altında yönü olmayan, hafif bir koyuluk bırakıyoruz.
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 5, PLAYER_RADIUS * 0.86, PLAYER_RADIUS * 0.40, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

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

    // Silah her zaman AYNI yerde duruyor (HAND_SIDE). Eskiden sırtı dönükken
    // gövdeden daha yana kaydırılıyordu ki görünsün; buna gerek yok — silah
    // karakterin ÜSTÜNE çiziliyor, zaten görünüyor. Sabit tutmak şart, çünkü
    // merminin doğduğu nokta aynı hesaptan geliyor: kayarsa mermi yine
    // "silahtan çıkmıyor" gibi görünür.
    this.drawWeapon(ctx, p, wep, chr);

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
  //
  // Ölçüler shared/constants.js'teki WEAPON_VIEW'dan geliyor — merminin doğduğu
  // nokta da oradan hesaplanıyor. İkisi tek kaynaktan beslenmezse mermi yine
  // silahın ucundan değil, başka bir yerden çıkıyormuş gibi görünür.
  drawWeapon(ctx, p, wep, chr) {
    const handY = p.y + HAND_Y;                    // ellerin yüksekliği
    ctx.save();
    ctx.translate(p.x, handY);
    ctx.rotate(p.aim);

    const oy = HAND_SIDE;
    const gorunum = WEAPON_VIEW[wep.id] || WEAPON_VIEW.rifle;
    const len = gorunum.boy;
    const gx = gorunum.tut;

    // BOMBACI: elinde tüfek değil BOMBA var. Ateşli silah çizmiyoruz.
    if (wep.throwable) {
      this.drawBombInHand(ctx, p, gx, oy, chr);
      ctx.restore();
      return;
    }

    // Her silahın KENDİNE ÖZGÜ görünümü. Namlu ucu HER ZAMAN (gx+len, oy)'de
    // biter — muzzleWorld ile birebir aynı nokta; yoksa mermi/alev silahtan
    // kayar. Alt çizim yordamları bu kurala uyar.
    // (Namlu alevi üçgeni istek üzerine kaldırıldı; ateş efekti artık yalnızca
    //  dünyadaki parçacık patlaması — game.js 'shot' olayı.)
    if (wep.id === 'shotgun') this.drawShotgun(ctx, gx, oy, len, chr);
    else if (wep.id === 'sniper') this.drawSniper(ctx, gx, oy, len, chr);
    else this.drawRifle(ctx, gx, oy, len, chr);

    ctx.restore();
  }

  // --- Silah siluetleri (yerel çerçeve: 0=eller, +x=nişan yönü) -----------
  // Ortak kural: NAMLU UCU (gx+len, oy)'de biter.

  drawRifle(ctx, gx, oy, len, chr) {
    const tip = gx + len;
    // dipçik (polimer) — taban + üst ışık + alt gölge
    ctx.fillStyle = '#2b2f36'; ctx.fillRect(gx - 10, oy - 2.6, 10, 5.4);
    ctx.fillStyle = '#3b424b'; ctx.fillRect(gx - 10, oy - 2.6, 10, 1.3);
    ctx.fillStyle = '#171b20'; ctx.fillRect(gx - 10, oy + 1.9, 10, 0.9);
    // tetik korkuluğu
    ctx.strokeStyle = '#12161b'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(gx + 4, oy + 4.4, 2.2, 0.15, Math.PI - 0.15); ctx.stroke();
    // gövde (receiver)
    ctx.fillStyle = '#232a32'; ctx.fillRect(gx - 1, oy - 3.3, 13, 6.6);
    ctx.fillStyle = '#333c46'; ctx.fillRect(gx - 1, oy - 3.3, 13, 1.2);
    ctx.fillStyle = '#151a1f'; ctx.fillRect(gx - 1, oy + 2.3, 13, 1);
    // üst ray + arka/ön nişangah
    ctx.fillStyle = '#11151a'; ctx.fillRect(gx + 1, oy - 4.6, 9, 1.3);
    ctx.fillRect(gx + 1.6, oy - 5.9, 1.6, 1.5);
    ctx.fillRect(gx + 8.2, oy - 5.9, 1.4, 1.5);
    // handguard (delikli) + namlu
    ctx.fillStyle = '#242c34'; ctx.fillRect(gx + 12, oy - 1.9, len - 12, 3.8);
    ctx.fillStyle = '#3a444f'; ctx.fillRect(gx + 12, oy - 1.9, len - 12, 1);
    ctx.fillStyle = '#10141a';
    ctx.fillRect(gx + 14, oy - 0.4, 1.4, 1.6);
    ctx.fillRect(gx + 17, oy - 0.4, 1.4, 1.6);
    // namlu freni (yarıklı) + ağız deliği
    ctx.fillStyle = '#0e1216'; ctx.fillRect(tip - 3.4, oy - 2, 3.4, 4);
    ctx.fillStyle = '#2c343d'; ctx.fillRect(tip - 2.4, oy - 1.2, 0.8, 2.4);
    ctx.fillStyle = '#000'; ctx.fillRect(tip - 1.2, oy - 0.7, 1.2, 1.4);
    // kavisli şarjör (gölgeli + ışık çizgisi)
    ctx.fillStyle = '#262e37';
    ctx.beginPath();
    ctx.moveTo(gx + 3, oy + 3); ctx.lineTo(gx + 9.5, oy + 3);
    ctx.lineTo(gx + 11, oy + 9.6); ctx.lineTo(gx + 4.4, oy + 10);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.09)'; ctx.fillRect(gx + 4.2, oy + 3.8, 1, 5.4);
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(gx + 9, oy + 3.6, 1.3, 5.6);
    // eller
    ctx.fillStyle = chr.skin;
    ctx.fillRect(gx + 1, oy - 3.6, 4, 7.2);
    ctx.fillRect(tip - 12, oy - 3.2, 4, 6.4);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(gx + 1, oy - 3.6, 4, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(gx + 1, oy + 2.4, 4, 1.2);
  }

  drawShotgun(ctx, gx, oy, len, chr) {
    const tip = gx + len;
    // ahşap dipçik — taban + damar ışığı + gölge
    ctx.fillStyle = '#3a2b1e'; ctx.fillRect(gx - 11, oy - 3, 11, 6);
    ctx.fillStyle = '#5a4128'; ctx.fillRect(gx - 11, oy - 3, 11, 1.5);
    ctx.fillStyle = '#4a3624'; ctx.fillRect(gx - 11, oy - 0.4, 11, 0.8);   // ahşap damarı
    ctx.fillStyle = '#241a12'; ctx.fillRect(gx - 11, oy + 2.2, 11, 0.8);
    // gövde + boşaltma yuvası
    ctx.fillStyle = '#282420'; ctx.fillRect(gx - 1, oy - 3.4, 10, 6.8);
    ctx.fillStyle = '#3a352d'; ctx.fillRect(gx - 1, oy - 3.4, 10, 1.1);
    ctx.fillStyle = '#0c0a08'; ctx.fillRect(gx + 2, oy - 2, 4, 1.8);       // ejection port
    // üst namlu (kalın) + ışık
    ctx.fillStyle = '#2c343d'; ctx.fillRect(gx + 8, oy - 3, len - 8, 3.4);
    ctx.fillStyle = '#41505d'; ctx.fillRect(gx + 8, oy - 3, len - 8, 1.1);
    // alt tüp şarjör + ışık
    ctx.fillStyle = '#20262d'; ctx.fillRect(gx + 8, oy + 0.7, len - 9, 2.6);
    ctx.fillStyle = '#333d47'; ctx.fillRect(gx + 8, oy + 0.7, len - 9, 0.8);
    // ahşap pompa (ön kabza) — oluklu
    ctx.fillStyle = '#5a4026'; ctx.fillRect(gx + 12, oy + 0.2, 7, 3.6);
    ctx.fillStyle = '#6e4f30'; ctx.fillRect(gx + 12, oy + 0.2, 7, 0.9);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(gx + 14, oy + 1, 0.8, 2.6); ctx.fillRect(gx + 16, oy + 1, 0.8, 2.6);
    // ön arpacık (bead) + geniş namlu ağzı
    ctx.fillStyle = '#11151a'; ctx.fillRect(tip - 5, oy - 3.6, 1.4, 1.2);
    ctx.fillStyle = '#0e1216'; ctx.fillRect(tip - 2.6, oy - 3.2, 2.6, 5);
    ctx.fillStyle = '#000'; ctx.fillRect(tip - 1.8, oy - 2, 1.4, 1.6);
    // eller
    ctx.fillStyle = chr.skin;
    ctx.fillRect(gx + 1, oy - 3.8, 4, 7.6);
    ctx.fillRect(gx + 13, oy, 4, 4.4);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(gx + 1, oy - 3.8, 4, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(gx + 1, oy + 2.6, 4, 1.2);
  }

  drawSniper(ctx, gx, oy, len, chr) {
    const tip = gx + len;
    // uzun dipçik + yanak dayama (ışık/gölge)
    ctx.fillStyle = '#242830'; ctx.fillRect(gx - 13, oy - 2.6, 13, 5.4);
    ctx.fillStyle = '#343b46'; ctx.fillRect(gx - 13, oy - 2.6, 13, 1.3);
    ctx.fillStyle = '#151920'; ctx.fillRect(gx - 13, oy + 1.9, 13, 0.9);
    ctx.fillStyle = '#2b303a'; ctx.fillRect(gx - 12, oy - 4.1, 7, 1.6);   // yanak dayama
    // gövde
    ctx.fillStyle = '#1c222a'; ctx.fillRect(gx - 1, oy - 2.9, 13, 5.8);
    ctx.fillStyle = '#2c3540'; ctx.fillRect(gx - 1, oy - 2.9, 13, 1.1);
    // sürgü kolu (topuzlu)
    ctx.fillStyle = '#39424d'; ctx.fillRect(gx + 9, oy + 1, 1.6, 3.4);
    ctx.beginPath(); ctx.arc(gx + 9.8, oy + 4.6, 1.4, 0, 7); ctx.fill();
    // ince uzun namlu + ışık
    ctx.fillStyle = '#2a323b'; ctx.fillRect(gx + 12, oy - 1.3, len - 12, 2.6);
    ctx.fillStyle = '#3d4854'; ctx.fillRect(gx + 12, oy - 1.3, len - 12, 0.8);
    // namlu freni (yarıklı) + ağız
    ctx.fillStyle = '#0e1216'; ctx.fillRect(tip - 5, oy - 1.9, 5, 3.8);
    ctx.fillStyle = '#2c343d';
    ctx.fillRect(tip - 3.8, oy - 1.1, 0.8, 2.2); ctx.fillRect(tip - 2.4, oy - 1.1, 0.8, 2.2);
    ctx.fillStyle = '#000'; ctx.fillRect(tip - 1.1, oy - 0.6, 1.1, 1.2);
    // BÜYÜK dürbün: tüp + ışık + iki mercek + ayar kulesi
    ctx.fillStyle = '#0e1217'; ctx.fillRect(gx + 1, oy - 7, 16, 3.4);
    ctx.fillStyle = '#20293480'; ctx.fillRect(gx + 1, oy - 7, 16, 1.1);
    ctx.fillStyle = '#39424d'; ctx.fillRect(gx + 7, oy - 8.2, 3, 1.4);     // ayar kulesi
    ctx.fillStyle = '#12161b'; ctx.fillRect(gx + 0.4, oy - 7, 1.4, 3.4);   // arka mercek çerçeve
    ctx.fillStyle = '#0a0d10'; ctx.fillRect(gx + 1.2, oy - 6.4, 1, 2.2);
    ctx.fillStyle = '#8fc4ec'; ctx.fillRect(gx + 15.4, oy - 6.6, 1.8, 2.6); // ön mercek parıltısı
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(gx + 15.6, oy - 6.4, 0.7, 1);
    // dürbün ayakları
    ctx.fillStyle = '#12161b';
    ctx.fillRect(gx + 3.5, oy - 3.8, 1.6, 2);
    ctx.fillRect(gx + 13, oy - 3.8, 1.6, 2);
    // eller
    ctx.fillStyle = chr.skin;
    ctx.fillRect(gx + 1, oy - 3.2, 4, 6.8);
    ctx.fillRect(tip - 14, oy - 2.6, 4, 5.6);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(tip - 14, oy - 2.6, 4, 0.9);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(gx + 1, oy + 2, 4, 1.2);
  }

  // Bombacının elindeki bomba. Yerel koordinatta çizilir: (0,0) eller,
  // +x nişan yönü. Namlu ucu hesabı (WEAPON_VIEW.bomba) buranın ucuna denk
  // gelir — bomba elden çıkar.
  // Bombacının elindeki EL BOMBASI (frag): zeytin yeşili ovoid gövde, pineapple
  // olukları, üstte fünye kapağı, emniyet kaşığı (kaşık) ve pim halkası.
  // Yerel çerçeve: +x nişan yönü, (gx,oy) el hizası. Fırlatma noktası
  // (WEAPON_VIEW.bomba) gövdenin merkezine denk gelir.
  drawBombInHand(ctx, p, gx, oy, chr) {
    const cx = gx + 2.6, cy = oy;
    const rx = 4.4, ry = 5.2;

    // el
    ctx.fillStyle = chr.skin;
    ctx.fillRect(gx - 4, oy - 3.2, 5, 6.4);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(gx - 4, oy + 2, 5, 1.2);

    // gövde (zeytin yeşili ovoid) + ışık/gölge
    ctx.fillStyle = '#3f4a2a';
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.beginPath(); ctx.ellipse(cx - 1.2, cy - 1.7, rx * 0.5, ry * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(cx + 0.9, cy + 2.1, rx * 0.66, ry * 0.36, 0, 0, Math.PI * 2); ctx.fill();

    // pineapple olukları (yatay + dikey çentikler)
    ctx.strokeStyle = 'rgba(0,0,0,0.34)'; ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(cx - rx + 1, cy - 2);   ctx.lineTo(cx + rx - 1, cy - 2);
    ctx.moveTo(cx - rx + 0.6, cy + 1); ctx.lineTo(cx + rx - 0.6, cy + 1);
    ctx.moveTo(cx - 1.4, cy - ry + 1.6); ctx.lineTo(cx - 1.4, cy + ry - 1.6);
    ctx.moveTo(cx + 1.4, cy - ry + 1.6); ctx.lineTo(cx + 1.4, cy + ry - 1.6);
    ctx.stroke();

    // fünye kapağı (metal, üstte)
    ctx.fillStyle = '#5a6472'; ctx.fillRect(cx - 1.9, cy - ry - 1.8, 3.8, 2.2);
    ctx.fillStyle = '#727d8c'; ctx.fillRect(cx - 1.9, cy - ry - 1.8, 3.8, 0.8);
    // emniyet kaşığı (spoon) — gövdenin yanında yukarı
    ctx.fillStyle = '#8a929c'; ctx.fillRect(cx + 1.5, cy - ry - 1.4, 1.4, ry + 1.4);
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(cx + 1.5, cy - ry - 1.4, 1.4, 0.7);
    // pim halkası (yan)
    ctx.strokeStyle = '#c9cdd3'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx + 4, cy - ry - 0.4, 1.6, 0, Math.PI * 2); ctx.stroke();

    // kıvılcım — tetik basılıyken (fırlatmaya hazırlanırken) parlar
    if (p.muzzle) {
      ctx.fillStyle = 'rgba(255,196,90,0.95)';
      ctx.shadowColor = '#ffb347'; ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(cx, cy - ry - 2.8, 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
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
