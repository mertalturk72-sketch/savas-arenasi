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

// Yön başına yürüyüş karesi sayısı. 3 → 8: adımlar arasındaki sıçrama kalmadı.
// Ayrıca gövdenin inip kalkması artık kareye gömülü DEĞİL; çizim sırasında
// sürekli bir sinüs olarak uygulanıyor (bkz. render.js), böylece geçişler
// kare sayısından bağımsız olarak yumuşak.
export const WALK_FRAMES = 8;

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

  // 8 kareli yürüyüş döngüsü. Bacak açısı sinüs eğrisinden türetiliyor:
  // uçlarda yavaşlayıp ortada hızlanıyor — gözün "yumuşak" dediği şey bu.
  //   kare:  0   1   2   3   4   5   6   7
  // LEG : hangi bacak önde (işaret) ve ne kadar açık (büyüklük)
  // LIFT: arkadaki ayağın yerden kalkması — böylece "kalkıyor" ve "iniyor"
  //       kareleri birbirinin aynısı olmuyor, döngü 8 ayrı poz üretiyor
  // Karaktere özgü yürüyüş: temel eğri karakterin walk profiliyle ölçekleniyor.
  // Böylece her karakter farklı adım genişliği / kol sallama / ayak kaldırma
  // gösteriyor. Yuvarlanıyor ki piksel keskin kalsın.
  const wk = o.walk || { leg: 1, arm: 1, lift: 1 };
  const LEG = Math.round(([1, 2, 3, 2, -1, -2, -3, -2][frame] || 0) * (wk.leg ?? 1));
  const ARM = Math.round(([-1, -2, -3, -2, 1, 2, 3, 2][frame] || 0) * (wk.arm ?? 1));
  const LIFT = Math.round(([0, 2, 1, 0, 0, 2, 1, 0][frame] || 0) * (wk.lift ?? 1));
  const BOB = 0;   // gövde inişi çizimde sürekli olarak uygulanıyor

  const legShift = LEG;
  const armSwing = ARM;

  const CX = 16;
  const bodyW = side ? 8 : 11;
  const bodyX = CX - bodyW / 2;

  // --- bacaklar + botlar ---------------------------------------------------
  const legY = 25;
  if (side) {
    // öndeki bacak yere basar, arkadaki LIFT kadar kalkar
    rectPx(ctx, CX - 3 + legShift, legY, 3, 6, jacketDark);
    rectPx(ctx, CX + 0 - legShift, legY - LIFT, 3, 6, shade(jacket, -52));
    rectPx(ctx, CX - 3 + legShift, legY + 6, 4, 3, boot);
    rectPx(ctx, CX + 0 - legShift, legY + 6 - LIFT, 4, 3, shade(boot, -6));
  } else {
    // Önden/arkadan bakışta adım, bacakların ileri geri kaymasıyla okunur.
    // Geride kalan bacak LIFT kadar kalkar — "kalkıyor" ve "iniyor" kareleri
    // böylece birbirinden ayrılıyor.
    const l = Math.max(0, legShift), r = Math.max(0, -legShift);
    const liftL = legShift < 0 ? LIFT : 0;      // sol bacak arkadaysa kalkar
    const liftR = legShift < 0 ? 0 : LIFT;      // sağ bacak arkadaysa kalkar
    rectPx(ctx, CX - 4, legY + l - liftL, 3, 6, jacketDark);
    rectPx(ctx, CX + 1, legY + r - liftR, 3, 6, jacketDark);
    rectPx(ctx, CX - 4, legY + 6 + l - liftL, 3, 3, boot);
    rectPx(ctx, CX + 1, legY + 6 + r - liftR, 3, 3, boot);
  }

  // Buradan sonrası gövde ve baş: adım çöküşünde hepsi birlikte 1 px iniyor.
  // Bacaklar/botlar yukarıda çizildi, onlar yere basılı kalıyor.
  ctx.save();
  ctx.translate(0, BOB);

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

  ctx.restore();
  return c;
}

/**
 * Bir karakterin tüm yön/kare setini üretir (ve önbelleğe alır).
 * @param {object} o { jacket, hair, skin, accent, eye, style }
 */
export function getCharacterSprites(o) {
  const wk = o.walk || { leg: 1, arm: 1, lift: 1 };
  const key = `${o.jacket}|${o.hair}|${o.skin}|${o.accent}|${o.eye}|${o.style}|${wk.leg},${wk.arm},${wk.lift}`;
  let set = cache.get(key);
  if (set) return set;

  set = {};
  for (const dir of ['down', 'up', 'left', 'right']) {
    set[dir] = [];
    for (let f = 0; f < WALK_FRAMES; f++) set[dir].push(drawFrame(o, dir, f));
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
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  // NİŞAN ALMA duruşu (karakter sağa bakar): silah GÖZ/OMUZ hizasında sağa
  // doğru, iki el üstünde; ÖN KOL uzanmış (silahı gerçekten tutuyor). Yan
  // yürüyüş karesi bacakları zaten açık verir (biri önde). Böylece "bir eli/
  // ayağı daha uzun ve nişan alıyor gibi" görünür.
  const gy = y + 20 * S;             // silah hattı — BEL/KALÇA hizasında rahat
                                     // ileri tutuş (istek: biraz aşağı).
  const shX = x + 14 * S, shY = y + 17 * S;   // omuz (kolların çıktığı yer)
  const skinDark = shade(skin, -30);

  // --- BOMBACI: el bombasını omzuna çekmiş, fırlatmaya hazır ----------------
  if (wepId === 'bomba') {
    const cx = x + 11 * S, cy = y + 9 * S;     // omuz üstü, geride
    const rx = 3.6 * S, ry = 4.3 * S;
    // fırlatma kolu (omuzdan yukarı-geri uzanır)
    ctx.strokeStyle = skin; ctx.lineWidth = 2.4 * S; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(shX, shY); ctx.lineTo(cx + 0.5 * S, cy + 1 * S); ctx.stroke();
    // bomba gövdesi
    ctx.fillStyle = '#3f4a2a';
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.beginPath(); ctx.ellipse(cx - 0.9 * S, cy - 1.3 * S, rx * 0.5, ry * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.34)'; ctx.lineWidth = Math.max(1, 0.7 * S);
    ctx.beginPath();
    ctx.moveTo(cx - rx + 1 * S, cy - 1.4 * S); ctx.lineTo(cx + rx - 1 * S, cy - 1.4 * S);
    ctx.moveTo(cx - 1.1 * S, cy - ry + 1.2 * S); ctx.lineTo(cx - 1.1 * S, cy + ry - 1.2 * S);
    ctx.moveTo(cx + 1.1 * S, cy - ry + 1.2 * S); ctx.lineTo(cx + 1.1 * S, cy + ry - 1.2 * S);
    ctx.stroke();
    ctx.fillStyle = '#5a6472'; ctx.fillRect(cx - 1.5 * S, cy - ry - 1.4 * S, 3 * S, 1.8 * S);
    ctx.fillStyle = '#8a929c'; ctx.fillRect(cx + 1.2 * S, cy - ry - 1 * S, 1.2 * S, ry + 1 * S);
    // el (bombayı kavrar)
    ctx.fillStyle = skin; ctx.fillRect(cx - 1.5 * S, cy - 1 * S, 2.8 * S, 3 * S);
    ctx.restore();
    return;
  }

  const grip = x + 16 * S;                     // arka el / tetik — GÖVDEDEN İLERİDE
                                               // (istek: biraz ileride tutsun)
  // Tüfek %10 daha büyük (istek); diğer silahlar aynı.
  const len = (wepId === 'sniper' ? 15 : wepId === 'shotgun' ? 12 : 14.3) * S;
  const tip = grip + len;
  const foreX = tip - 4.5 * S;                  // ön el (uzatılmış)

  // İKİ KOL da ten renginde, ikisi de silaha uzanır ("iki eliyle de tutsun").
  // Arka el tetikte, ön el namlu altında — ikisi de belirgin.
  ctx.lineCap = 'round';
  ctx.strokeStyle = skinDark; ctx.lineWidth = 2.3 * S;   // arka kol (biraz koyu, arkada)
  ctx.beginPath(); ctx.moveTo(shX, shY); ctx.lineTo(grip + 1 * S, gy + 1 * S); ctx.stroke();
  ctx.strokeStyle = skin; ctx.lineWidth = 2.5 * S;       // ön kol (uzanır)
  ctx.beginPath(); ctx.moveTo(shX + 1 * S, shY); ctx.lineTo(foreX, gy + 0.5 * S); ctx.stroke();

  // --- silah (yatay, sağa; dipçik yanak/omuzda) ----------------------------
  if (wepId === 'shotgun') {
    ctx.fillStyle = '#3a2b1e'; ctx.fillRect(grip - 5 * S, gy - 1.4 * S, 5 * S, 3 * S);
    ctx.fillStyle = '#5a4128'; ctx.fillRect(grip - 5 * S, gy - 1.4 * S, 5 * S, 0.9 * S);
    ctx.fillStyle = '#2c343d'; ctx.fillRect(grip, gy - 1.6 * S, len, 2 * S);
    ctx.fillStyle = '#41505d'; ctx.fillRect(grip, gy - 1.6 * S, len, 0.6 * S);
    ctx.fillStyle = '#20262d'; ctx.fillRect(grip, gy + 0.5 * S, len - 1 * S, 1.4 * S);
    ctx.fillStyle = '#5a4026'; ctx.fillRect(grip + 5 * S, gy + 0.3 * S, 4 * S, 2 * S);
    ctx.fillStyle = '#0e1216'; ctx.fillRect(tip - 1.4 * S, gy - 1.6 * S, 1.4 * S, 2.8 * S);
  } else if (wepId === 'sniper') {
    ctx.fillStyle = '#242830'; ctx.fillRect(grip - 5 * S, gy - 1.3 * S, 5 * S, 2.8 * S);
    ctx.fillStyle = '#343b46'; ctx.fillRect(grip - 5 * S, gy - 1.3 * S, 5 * S, 0.9 * S);
    ctx.fillStyle = '#2a323b'; ctx.fillRect(grip, gy - 0.8 * S, len, 1.7 * S);
    ctx.fillStyle = '#3d4854'; ctx.fillRect(grip, gy - 0.8 * S, len, 0.5 * S);
    ctx.fillStyle = '#0e1216'; ctx.fillRect(tip - 1.6 * S, gy - 1.1 * S, 1.6 * S, 2.3 * S);
    ctx.fillStyle = '#0e1217'; ctx.fillRect(grip + 0.5 * S, gy - 3.4 * S, 7 * S, 1.9 * S);
    ctx.fillStyle = '#8fc4ec'; ctx.fillRect(grip + 7 * S, gy - 3.2 * S, 1.1 * S, 1.5 * S);
  } else {
    // %10 büyütülmüş ölçüler
    ctx.fillStyle = '#2b2f36'; ctx.fillRect(grip - 5.5 * S, gy - 1.45 * S, 5.5 * S, 3.3 * S);
    ctx.fillStyle = '#3b424b'; ctx.fillRect(grip - 5.5 * S, gy - 1.45 * S, 5.5 * S, 1 * S);
    ctx.fillStyle = '#232a32'; ctx.fillRect(grip - 0.5 * S, gy - 1.85 * S, 6.6 * S, 3.75 * S);
    ctx.fillStyle = '#242c34'; ctx.fillRect(grip + 5.5 * S, gy - 1 * S, len - 5.5 * S, 2.1 * S);
    ctx.fillStyle = '#3a444f'; ctx.fillRect(grip + 5.5 * S, gy - 1 * S, len - 5.5 * S, 0.66 * S);
    ctx.fillStyle = '#0e1216'; ctx.fillRect(tip - 1.65 * S, gy - 1.45 * S, 1.65 * S, 2.9 * S);
    ctx.fillStyle = '#262e37'; ctx.fillRect(grip + 0.5 * S, gy + 1.75 * S, 2.9 * S, 3.3 * S);
  }

  // eller (silahın üstünde) — arka (tetik) + ön (uzanmış)
  ctx.fillStyle = skin;
  ctx.fillRect(grip - 0.6 * S, gy - 1.6 * S, 2.2 * S, 3.4 * S);
  ctx.fillRect(foreX - 1 * S, gy - 1.4 * S, 2.4 * S, 3 * S);
  ctx.restore();
}

/** Nişan açısından bakış yönünü seçer (RPG sayfasındaki 4 yön). */
export function dirFromAngle(a) {
  const cos = Math.cos(a), sin = Math.sin(a);
  if (Math.abs(cos) >= Math.abs(sin)) return cos >= 0 ? 'right' : 'left';
  return sin >= 0 ? 'down' : 'up';
}
