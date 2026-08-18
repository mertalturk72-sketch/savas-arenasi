// Pixel-art karakter üretimi (RPG tarzı yürüyüş sayfası).
//
// Hazır görsel dosyası yok: her karakter küçük bir tuvale piksel piksel
// çizilip önbelleğe alınıyor. Böylece indirilecek dosya olmuyor ve yeni
// karakter eklemek sadece birkaç renk yazmak demek.
//
// Her karakter için 4 yön × 3 kare üretilir:
//   yönler: 'down' (bize bakar), 'up' (sırtı döner), 'left', 'right'
//   kareler: 0 sol ayak önde · 1 duruş · 2 sağ ayak önde
//
// Karakter DÖNDÜRÜLMEZ; nişan yönünü elindeki silah gösterir.

export const SPRITE_W = 32;
export const SPRITE_H = 36;

const cache = new Map();

// --- küçük çizim yardımcıları --------------------------------------------
function rectPx(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function disc(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) ctx.fillRect(x, y, 1, 1);
    }
  }
}

function shade(hex, amount) {
  if (!hex.startsWith('#')) return hex;
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, v + amount));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

// --- kafa ölçüleri --------------------------------------------------------
const HEAD_CX = 16;
const HEAD_CY = 11;
const HEAD_R = 5.4;
const FACE_TOP = 9;        // saç bu çizginin ÜSTÜNDE kalır, altı yüzdür

// --- saç biçimleri --------------------------------------------------------
// Her biçim kafanın üstünü kaplar; alt kenarı sonradan temizlenip düzgün bir
// saç çizgisi elde edilir (yoksa saç gözlerin üstüne düşüp yüzü bozuyor).
function drawHair(ctx, style, dir, colors) {
  const { hair, hairDark, hairLight } = colors;
  const CX = HEAD_CX;

  // ortak taban: kafayı saran kalotta
  disc(ctx, CX, HEAD_CY - 1.6, HEAD_R + 1.0, hairDark);
  disc(ctx, CX, HEAD_CY - 2.0, HEAD_R + 0.3, hair);

  if (style === 'kabarik') {
    // düzenli üç kabarıklık — dağınık değil, simetrik
    disc(ctx, CX - 4.4, HEAD_CY - 3.4, 2.9, hair);
    disc(ctx, CX + 4.4, HEAD_CY - 3.4, 2.9, hair);
    disc(ctx, CX, HEAD_CY - 6.2, 3.1, hair);
    disc(ctx, CX - 5.4, HEAD_CY - 0.6, 2.3, hair);
    disc(ctx, CX + 5.4, HEAD_CY - 0.6, 2.3, hair);
    disc(ctx, CX - 3.6, HEAD_CY - 4.4, 1.7, hairLight);
    disc(ctx, CX + 0.6, HEAD_CY - 6.0, 1.4, hairLight);
  } else if (style === 'dikenli') {
    for (let i = -2; i <= 2; i++) {
      const x = CX + i * 2.6;
      const hgt = i === 0 ? 7 : 5 - Math.abs(i);
      rectPx(ctx, x - 1, HEAD_CY - 5 - hgt, 2, hgt + 3, hair);
      rectPx(ctx, x - 1, HEAD_CY - 5 - hgt, 2, 1, hairLight);
    }
    disc(ctx, CX - 5.2, HEAD_CY - 1.4, 2.3, hair);
    disc(ctx, CX + 5.2, HEAD_CY - 1.4, 2.3, hair);
  } else if (style === 'uzun') {
    // yanlardan omuzlara inen iki tutam
    rectPx(ctx, CX - 7, HEAD_CY - 3, 3, 13, hairDark);
    rectPx(ctx, CX + 4, HEAD_CY - 3, 3, 13, hairDark);
    rectPx(ctx, CX - 7, HEAD_CY - 3, 3, 11, hair);
    rectPx(ctx, CX + 4, HEAD_CY - 3, 3, 11, hair);
    disc(ctx, CX, HEAD_CY - 5.4, 3.0, hair);
    disc(ctx, CX - 1.2, HEAD_CY - 5.6, 1.6, hairLight);
  } else if (style === 'kisa') {
    rectPx(ctx, CX - 6, HEAD_CY - 5, 12, 3, hair);
    rectPx(ctx, CX - 6, HEAD_CY - 5, 12, 1, hairLight);
    disc(ctx, CX - 5.0, HEAD_CY - 1.4, 2.2, hair);
    disc(ctx, CX + 5.0, HEAD_CY - 1.4, 2.2, hair);
  } else {                                   // 'kasket'
    disc(ctx, CX, HEAD_CY - 3.4, HEAD_R + 0.9, hairDark);
    disc(ctx, CX, HEAD_CY - 3.6, HEAD_R + 0.2, hair);
    rectPx(ctx, CX - 7, HEAD_CY - 2, 14, 2, hairDark);       // siperlik
    rectPx(ctx, CX - 7, HEAD_CY - 2, 14, 1, hairLight);
  }
}

// Saç çizgisini düzelt: kafanın FACE_TOP altındaki kısmını yeniden ten yap.
// Kenarlardaki tutamlara dokunmaz, sadece yüz alanını açar.
function carveFace(ctx, skin, skinDark) {
  const CX = HEAD_CX;
  for (let y = FACE_TOP; y <= HEAD_CY + HEAD_R; y++) {
    for (let x = CX - 4; x <= CX + 3; x++) {
      const dx = x + 0.5 - CX, dy = y + 0.5 - HEAD_CY;
      if (dx * dx + dy * dy > HEAD_R * HEAD_R) continue;
      ctx.fillStyle = (y >= HEAD_CY + HEAD_R - 1.6) ? skinDark : skin;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

// --- tek bir kare ---------------------------------------------------------
function drawFrame(o, dir, frame) {
  const c = document.createElement('canvas');
  c.width = SPRITE_W; c.height = SPRITE_H;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const colors = {
    hair: o.hair,
    hairDark: shade(o.hair, -45),
    hairLight: shade(o.hair, 36),
  };
  const jacket = o.jacket;
  const jacketDark = shade(jacket, -38);
  const jacketLight = shade(jacket, 26);
  const skin = o.skin;
  const skinDark = shade(skin, -36);
  const boot = '#221a13';
  const side = dir === 'left' || dir === 'right';

  const legShift = frame === 0 ? -1 : frame === 2 ? 1 : 0;
  const armSwing = frame === 0 ? 1 : frame === 2 ? -1 : 0;

  const CX = 16;
  const bodyW = side ? 8 : 11;
  const bodyX = CX - bodyW / 2;

  // --- bacaklar + botlar ---------------------------------------------------
  const legY = 25;
  if (side) {
    rectPx(ctx, CX - 3 + legShift, legY, 3, 6, jacketDark);
    rectPx(ctx, CX + 0 - legShift, legY, 3, 6, shade(jacket, -52));
    rectPx(ctx, CX - 3 + legShift, legY + 6, 4, 3, boot);
    rectPx(ctx, CX + 0 - legShift, legY + 6, 4, 3, shade(boot, -6));
  } else {
    rectPx(ctx, CX - 4, legY + Math.max(0, legShift), 3, 6, jacketDark);
    rectPx(ctx, CX + 1, legY + Math.max(0, -legShift), 3, 6, jacketDark);
    rectPx(ctx, CX - 4, legY + 6 + Math.max(0, legShift), 3, 3, boot);
    rectPx(ctx, CX + 1, legY + 6 + Math.max(0, -legShift), 3, 3, boot);
  }

  // --- gövde ---------------------------------------------------------------
  rectPx(ctx, bodyX - 1, 16, bodyW + 2, 10, jacketDark);
  rectPx(ctx, bodyX, 16, bodyW, 9, jacket);
  rectPx(ctx, bodyX, 16, bodyW, 1, jacketLight);
  if (!side) rectPx(ctx, CX - 1, 18, 2, 7, jacketDark);

  // --- kollar --------------------------------------------------------------
  if (side) {
    rectPx(ctx, CX - 1, 17 + armSwing, 4, 7, jacketDark);
    rectPx(ctx, CX - 1, 23 + armSwing, 3, 3, skin);
  } else {
    rectPx(ctx, bodyX - 3, 17 + armSwing, 3, 7, jacketDark);
    rectPx(ctx, bodyX + bodyW, 17 - armSwing, 3, 7, jacketDark);
    rectPx(ctx, bodyX - 3, 23 + armSwing, 3, 3, skin);
    rectPx(ctx, bodyX + bodyW, 23 - armSwing, 3, 3, skin);
  }

  // --- yaka detayı ---------------------------------------------------------
  if (dir !== 'up') {
    rectPx(ctx, CX - 3, 15, 6, 2, o.accent);
    rectPx(ctx, CX - 3, 15, 6, 1, shade(o.accent, 45));
  }

  // --- kafa ----------------------------------------------------------------
  rectPx(ctx, CX - 2, 14, 4, 2, skinDark);                 // boyun
  disc(ctx, HEAD_CX, HEAD_CY, HEAD_R + 0.6, skinDark);
  disc(ctx, HEAD_CX, HEAD_CY, HEAD_R, skin);

  // --- saç -----------------------------------------------------------------
  drawHair(ctx, o.style, dir, colors);

  if (dir === 'up') {
    // Sırtı dönük: yüz yok, saç kafayı tümüyle kaplar
    disc(ctx, HEAD_CX, HEAD_CY, HEAD_R + 0.4, colors.hair);
    disc(ctx, HEAD_CX, HEAD_CY - 1.2, HEAD_R - 1.4, colors.hairLight);
  } else {
    // Saç çizgisini temizle: gözler ve yüz açıkta kalsın
    carveFace(ctx, skin, skinDark);

    if (dir === 'down') {
      // gözler: beyaz + koyu bebek — küçük boyutta net okunur
      rectPx(ctx, HEAD_CX - 4, 10, 3, 3, '#f3efe6');
      rectPx(ctx, HEAD_CX + 1, 10, 3, 3, '#f3efe6');
      rectPx(ctx, HEAD_CX - 3, 11, 2, 2, '#2b2119');
      rectPx(ctx, HEAD_CX + 2, 11, 2, 2, '#2b2119');
      rectPx(ctx, HEAD_CX - 3, 11, 1, 1, o.eye);
      rectPx(ctx, HEAD_CX + 2, 11, 1, 1, o.eye);
      // kaşlar
      rectPx(ctx, HEAD_CX - 4, 9, 3, 1, colors.hairDark);
      rectPx(ctx, HEAD_CX + 1, 9, 3, 1, colors.hairDark);
      // ağız
      rectPx(ctx, HEAD_CX - 1, 14, 2, 1, skinDark);
    } else {
      // yandan tek göz
      const ex = dir === 'right' ? HEAD_CX + 1 : HEAD_CX - 4;
      rectPx(ctx, ex, 10, 3, 3, '#f3efe6');
      rectPx(ctx, dir === 'right' ? ex + 1 : ex, 11, 2, 2, '#2b2119');
      rectPx(ctx, dir === 'right' ? ex + 1 : ex, 11, 1, 1, o.eye);
      rectPx(ctx, ex, 9, 3, 1, colors.hairDark);
      // burun
      rectPx(ctx, dir === 'right' ? HEAD_CX + 4 : HEAD_CX - 5, 12, 1, 1, skinDark);
    }
  }

  return c;
}

/**
 * Bir karakterin tüm yön/kare setini üretir (ve önbelleğe alır).
 * @param {object} o { jacket, hair, skin, accent, eye, style }
 */
export function getCharacterSprites(o) {
  const key = `${o.jacket}|${o.hair}|${o.skin}|${o.accent}|${o.eye}|${o.style}`;
  let set = cache.get(key);
  if (set) return set;

  set = {};
  for (const dir of ['down', 'up', 'left', 'right']) {
    set[dir] = [drawFrame(o, dir, 0), drawFrame(o, dir, 1), drawFrame(o, dir, 2)];
  }
  cache.set(key, set);
  return set;
}

/**
 * Karakterin eline silah çizer (önizleme ve lobi kartları için).
 * Oyun içinde silah nişan açısına göre döndürülerek ayrıca çizilir; burada
 * yana bakan sabit bir duruş yeterli.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x sol üst köşe (karakter kutusunun)
 * @param {number} y sol üst köşe
 * @param {number} scale karakterin çizim ölçeği (1 = 32x36 piksel)
 * @param {string} wepId 'rifle' | 'shotgun' | 'sniper'
 * @param {string} skin el rengi
 */
export function drawWeaponOnPreview(ctx, x, y, scale, wepId, skin) {
  const S = scale;
  // eller gövdenin önünde, bel hizasında
  const hx = x + 19 * S;
  const hy = y + 21 * S;
  const len = wepId === 'sniper' ? 15 : wepId === 'shotgun' ? 11 : 12;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // dipçik
  ctx.fillStyle = '#3a2b1e';
  ctx.fillRect(hx - 5 * S, hy - 1 * S, 5 * S, 3 * S);
  // namlu
  ctx.fillStyle = '#20272f';
  ctx.fillRect(hx, hy - 1.5 * S, len * S, 3 * S);
  ctx.fillStyle = '#3d4854';
  ctx.fillRect(hx, hy - 1.5 * S, len * S, 1 * S);
  // şarjör
  ctx.fillStyle = '#2a323b';
  ctx.fillRect(hx + 2 * S, hy + 1.5 * S, 3 * S, 3 * S);
  if (wepId === 'sniper') {
    ctx.fillStyle = '#151a20';
    ctx.fillRect(hx + 4 * S, hy - 3.5 * S, 5 * S, 2 * S);
  }
  // eller
  ctx.fillStyle = skin;
  ctx.fillRect(hx, hy - 2 * S, 2 * S, 4 * S);
  ctx.fillRect(hx + (len - 4) * S, hy - 2 * S, 2 * S, 4 * S);
  ctx.restore();
}

/** Nişan açısından bakış yönünü seçer (RPG sayfasındaki 4 yön). */
export function dirFromAngle(a) {
  const cos = Math.cos(a), sin = Math.sin(a);
  if (Math.abs(cos) >= Math.abs(sin)) return cos >= 0 ? 'right' : 'left';
  return sin >= 0 ? 'down' : 'up';
}
