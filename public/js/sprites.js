import { CUSTOM_WEAPONS } from './custom-weapons.js';

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
    rectPx(ctx, CX - 3 + legShift, legY, 1, 5, shade(jacket, -22));   // pantolon ışığı
    rectPx(ctx, CX + 0 - legShift, legY - LIFT, 3, 6, shade(jacket, -52));
    rectPx(ctx, CX - 3 + legShift, legY + 6, 4, 3, boot);
    rectPx(ctx, CX - 3 + legShift, legY + 6, 4, 1, shade(boot, 22));  // bot burnu ışığı
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
    rectPx(ctx, CX - 4, legY + l - liftL, 1, 5, shade(jacket, -22));       // ışık
    rectPx(ctx, CX + 1, legY + r - liftR, 1, 5, shade(jacket, -22));
    rectPx(ctx, CX - 4, legY + 6 + l - liftL, 3, 3, boot);
    rectPx(ctx, CX + 1, legY + 6 + r - liftR, 3, 3, boot);
    rectPx(ctx, CX - 4, legY + 6 + l - liftL, 3, 1, shade(boot, 22));      // bot burnu ışığı
    rectPx(ctx, CX + 1, legY + 6 + r - liftR, 3, 1, shade(boot, 22));
  }

  // Buradan sonrası gövde ve baş: adım çöküşünde hepsi birlikte 1 px iniyor.
  // Bacaklar/botlar yukarıda çizildi, onlar yere basılı kalıyor.
  ctx.save();
  ctx.translate(0, BOB);

  // --- gövde (silah gibi: gölge tabanı → kumaş → omuz ışığı → bel gölgesi) --
  rectPx(ctx, bodyX - 1, 16, bodyW + 2, 10, jacketDark);   // dış hat / gölge
  rectPx(ctx, bodyX, 16, bodyW, 9, jacket);                // ana kumaş
  rectPx(ctx, bodyX, 16, bodyW, 2, jacketLight);           // omuz ışığı
  rectPx(ctx, bodyX, 22, bodyW, 3, shade(jacket, -18));    // bel gölgesi
  rectPx(ctx, bodyX, 17, 1, 6, jacketLight);               // sol kenar ışığı (ışık soldan)
  rectPx(ctx, bodyX + bodyW - 1, 17, 1, 6, shade(jacket, -30)); // sağ kenar gölgesi
  // omuz köşelerini yuvarla — sert kutu silueti kırılır (silah siluetleri gibi)
  ctx.clearRect(bodyX - 1, 16, 1, 1);
  ctx.clearRect(bodyX + bodyW, 16, 1, 1);
  rectPx(ctx, bodyX, 16, 1, 1, jacketDark);
  rectPx(ctx, bodyX + bodyW - 1, 16, 1, 1, jacketDark);
  // orta fermuar / dikiş
  if (!side) rectPx(ctx, CX - 1, 18, 2, 6, jacketDark);

  // --- kollar (ışıklı kenar + bilek manşeti) -------------------------------
  if (side) {
    rectPx(ctx, CX - 1, 17 + armSwing, 4, 7, jacketDark);
    rectPx(ctx, CX - 1, 17 + armSwing, 1, 6, jacketLight);   // kol ışığı
    rectPx(ctx, CX - 1, 22 + armSwing, 4, 1, o.accent);      // manşet
    rectPx(ctx, CX - 1, 23 + armSwing, 3, 3, skin);          // el
    rectPx(ctx, CX - 1, 23 + armSwing, 3, 1, shade(skin, 18));
  } else {
    rectPx(ctx, bodyX - 3, 17 + armSwing, 3, 7, jacketDark);
    rectPx(ctx, bodyX + bodyW, 17 - armSwing, 3, 7, jacketDark);
    rectPx(ctx, bodyX - 3, 17 + armSwing, 1, 6, jacketLight);          // sol kol ışığı
    rectPx(ctx, bodyX + bodyW + 2, 17 - armSwing, 1, 6, shade(jacket, -52)); // sağ kol gölgesi
    rectPx(ctx, bodyX - 3, 22 + armSwing, 3, 1, o.accent);            // manşetler
    rectPx(ctx, bodyX + bodyW, 22 - armSwing, 3, 1, o.accent);
    rectPx(ctx, bodyX - 3, 23 + armSwing, 3, 3, skin);
    rectPx(ctx, bodyX + bodyW, 23 - armSwing, 3, 3, skin);
    rectPx(ctx, bodyX - 3, 23 + armSwing, 3, 1, shade(skin, 18));
    rectPx(ctx, bodyX + bodyW, 23 - armSwing, 3, 1, shade(skin, 18));
  }

  // --- göğüs teçhizatı: çapraz askı + kemer (yelek hissi) ------------------
  if (dir === 'down') {
    rectPx(ctx, bodyX + 1, 17, 1, 7, o.accent);             // sol askı
    rectPx(ctx, bodyX + bodyW - 2, 17, 1, 7, o.accent);     // sağ askı
    rectPx(ctx, bodyX, 20, bodyW, 1, shade(o.accent, -30)); // kemer
  } else if (side) {
    rectPx(ctx, bodyX + 3, 17, 1, 7, o.accent);             // tek askı
    rectPx(ctx, bodyX, 20, bodyW, 1, shade(o.accent, -30)); // kemer
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
      // --- gözler: ak + renkli iris + koyu bebek + parıltı (catchlight) ---
      rectPx(ctx, HEAD_CX - 4, 10, 3, 3, '#f3efe6');   // sol göz akı
      rectPx(ctx, HEAD_CX + 1, 10, 3, 3, '#f3efe6');   // sağ göz akı
      rectPx(ctx, HEAD_CX - 3, 10, 2, 2, o.eye);       // sol iris (renk)
      rectPx(ctx, HEAD_CX + 1, 10, 2, 2, o.eye);       // sağ iris
      rectPx(ctx, HEAD_CX - 3, 11, 1, 1, '#20180f');   // sol bebek (koyu)
      rectPx(ctx, HEAD_CX + 2, 11, 1, 1, '#20180f');   // sağ bebek
      rectPx(ctx, HEAD_CX - 2, 10, 1, 1, '#ffffff');   // sol parıltı
      rectPx(ctx, HEAD_CX + 3, 10, 1, 1, '#ffffff');   // sağ parıltı
      // alt göz çizgisi — bakışı oturtur
      rectPx(ctx, HEAD_CX - 4, 12, 3, 1, shade(skin, -30));
      rectPx(ctx, HEAD_CX + 1, 12, 3, 1, shade(skin, -30));
      // kaşlar (ifade)
      rectPx(ctx, HEAD_CX - 4, 9, 3, 1, colors.hairDark);
      rectPx(ctx, HEAD_CX + 1, 9, 3, 1, colors.hairDark);
      // burun (küçük gölge)
      rectPx(ctx, HEAD_CX - 1, 12, 1, 2, shade(skin, -22));
      // ağız — yumuşak, hafif gülümseme
      rectPx(ctx, HEAD_CX - 1, 14, 3, 1, shade(skin, -46));
      rectPx(ctx, HEAD_CX + 2, 13, 1, 1, shade(skin, -24)); // sağ köşe yukarı
    } else {
      // --- yandan yüz: tek göz (iris+parıltı) + burun + ağız ---
      const rightF = dir === 'right';
      const ex = rightF ? HEAD_CX + 1 : HEAD_CX - 4;
      rectPx(ctx, ex, 10, 3, 3, '#f3efe6');            // göz akı
      const ix = rightF ? ex : ex + 1;
      rectPx(ctx, ix, 10, 2, 2, o.eye);                // iris
      rectPx(ctx, ix, 11, 1, 1, '#20180f');            // bebek
      rectPx(ctx, rightF ? ex + 2 : ex, 10, 1, 1, '#ffffff'); // parıltı
      rectPx(ctx, ex, 9, 3, 1, colors.hairDark);       // kaş
      // burun (yüz önünde çıkıntı)
      rectPx(ctx, rightF ? HEAD_CX + 4 : HEAD_CX - 5, 12, 1, 2, skinDark);
      // ağız (öne yakın küçük çizgi)
      rectPx(ctx, rightF ? HEAD_CX + 1 : HEAD_CX - 2, 14, 2, 1, shade(skin, -42));
    }
  }

  ctx.restore();
  return c;
}

// =========================================================================
//  LPC sprite entegrasyonu (OpenGameArt — Universal LPC, jrconway3)
//  --------------------------------------------------------------------
//  Karakterler artık kodla değil, LPC katman PNG'lerinden üretiliyor:
//  gövde(ten) + göz + pantolon + ceket + saç/kasket katmanları üst üste
//  bindirilip yürüyüş satırları dilimleniyor. Beyaz katmanlar karakterin
//  paletine göre "multiply" ile renklendirilir (gölge korunur). Yükleme
//  bitene kadar YUKARIDAKİ prosedürel çizim yedek olarak kullanılır.
//  Lisans: CC-BY-SA 3.0 / GPL 3.0 (bkz. textures/lpc/KREDILER.txt).
// =========================================================================
const LPC_BASE = new URL('../textures/lpc/_raw/', import.meta.url).href;
const LPC_FR = 64;                                   // LPC kare boyutu (px)
const LPC_WALK_ROW = { up: 8, left: 9, down: 10, right: 11 };  // yürüyüş satırları
const LPC_KEYS = [
  'body_light', 'body_tanned2', 'body_dark',
  'eyes_blue', 'eyes_brown', 'eyes_green', 'eyes_gray',
  'pants_white', 'shirt_white', 'cap_leather',
  'hair_messy1', 'hair_mohawk', 'hair_long', 'hair_plain', 'hair_jewfro', 'hair_parted',
];
const lpcImg = {};
let lpcReady = false;
let lpcPromise = null;

function loadImg(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('yüklenemedi: ' + src));
    i.src = src;
  });
}

/** LPC katmanlarını önceden yükler. Tekrar çağrılırsa aynı sözü döndürür. */
export function preloadSprites() {
  if (lpcPromise) return lpcPromise;
  lpcPromise = Promise.all(LPC_KEYS.map(async (k) => {
    try { lpcImg[k] = await loadImg(LPC_BASE + k + '.png'); }
    catch { lpcImg[k] = null; }
  })).then(() => {
    lpcReady = LPC_KEYS.every((k) => lpcImg[k]);
    if (lpcReady) cache.clear();          // yedekle çizilmiş setleri at, LPC'yle yeniden kur
    return lpcReady;
  }).catch(() => { lpcReady = false; return false; });
  return lpcPromise;
}
/** LPC katmanları hazır mı? (hazır değilse getCharacterSprites yedeğe düşer) */
export function spritesReady() { return lpcReady; }

// modül yüklenince arka planda yüklemeyi başlat
preloadSprites();

function lumin(hex) {
  if (!hex || hex[0] !== '#') return 160;
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
}

// Karakterin ten hex'ine en yakın LPC gövde dosyası.
function pickBody(skin) {
  const L = lumin(skin);
  if (L >= 150) return 'body_light';
  if (L >= 105) return 'body_tanned2';
  return 'body_dark';
}

// Göz hex'inden en yakın LPC göz dosyası (küçük detay, kabaca yeter).
function pickEye(eye) {
  if (!eye || eye[0] !== '#') return 'eyes_brown';
  const n = parseInt(eye.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (b >= r && b >= g) return 'eyes_blue';
  if (g >= r && g > b) return 'eyes_green';
  if (r > g && g > b) return 'eyes_brown';
  return 'eyes_gray';
}

// Oyunun saç biçiminden LPC saç stili (esmer/koyu ten kabarık → afro).
function pickHair(style, skin) {
  switch (style) {
    case 'dikenli': return 'hair_mohawk';
    case 'uzun': return 'hair_long';
    case 'kisa': return 'hair_parted';
    case 'kasket': return 'CAP';
    case 'kabarik':
    default: return lumin(skin) < 120 ? 'hair_jewfro' : 'hair_messy1';
  }
}

// Bir katman sayfasını hedef renge boya (gölge korunur: multiply + alfa maskesi).
function tintSheet(img, color) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(img, 0, 0);
  return c;
}

function lpcFrame(layers, sx, sy) {
  const c = document.createElement('canvas');
  c.width = LPC_FR; c.height = LPC_FR;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  for (const layer of layers) {
    if (layer) x.drawImage(layer, sx, sy, LPC_FR, LPC_FR, 0, 0, LPC_FR, LPC_FR);
  }
  return c;
}

function buildLpcSet(o) {
  const body = lpcImg[pickBody(o.skin)];
  const eyes = lpcImg[pickEye(o.eye)];
  const pants = tintSheet(lpcImg.pants_white, '#2b2f36');   // koyu asker pantolonu
  const shirt = tintSheet(lpcImg.shirt_white, o.jacket);    // ceket = üniforma rengi
  const hairId = pickHair(o.style, o.skin);
  const hair = hairId === 'CAP'
    ? tintSheet(lpcImg.cap_leather, shade(o.jacket, -4))
    : tintSheet(lpcImg[hairId], o.hair);
  const layers = [body, eyes, pants, shirt, hair];

  const set = {};
  for (const dir of ['down', 'up', 'left', 'right']) {
    const sy = LPC_WALK_ROW[dir] * LPC_FR;
    const arr = [];
    for (let col = 1; col <= WALK_FRAMES; col++) arr.push(lpcFrame(layers, col * LPC_FR, sy));
    arr.stand = lpcFrame(layers, 0, sy);      // 0. sütun: nötr duruş
    set[dir] = arr;
  }
  return set;
}

/**
 * Bir karakterin tüm yön/kare setini üretir (ve önbelleğe alır).
 * LPC katmanları yüklüyse onlardan; değilse prosedürel çizimden.
 * @param {object} o { jacket, hair, skin, accent, eye, style }
 */
export function getCharacterSprites(o) {
  const wk = o.walk || { leg: 1, arm: 1, lift: 1 };
  // LPC'de yürüyüş profili sprite'a gömülü değil (bob/sway çizimde uygulanır),
  // o yüzden anahtarda walk yok; prosedürel yedekte de sorun değil.
  const key = `${lpcReady ? 'L' : 'P'}|${o.jacket}|${o.hair}|${o.skin}|${o.accent}|${o.eye}|${o.style}|${wk.leg},${wk.arm},${wk.lift}`;
  let set = cache.get(key);
  if (set) return set;

  if (lpcReady) {
    set = buildLpcSet(o);
  } else {
    set = {};
    for (const dir of ['down', 'up', 'left', 'right']) {
      set[dir] = [];
      for (let f = 0; f < WALK_FRAMES; f++) set[dir].push(drawFrame(o, dir, f));
    }
  }
  cache.set(key, set);
  return set;
}

// =========================================================================
//  Paylaşılan silah çizimi — hem oyun içi (render.js) hem lobi burayı kullanır.
//  Yerel çerçeve: (0,0) gövde/pivot, +x namlu yönü, oy silah hattı.
//  Namlu ucu HER ZAMAN (gx+len, oy). Eller silahın üstüne (ten) çizilir.
// =========================================================================

// Silahı tutan İKİ KOL: gövdeden kabzalara uzanır. Böylece silah "havada"
// değil, elle tutuluyor görünür. Kollar tenden, arka kol biraz koyu.
export function drawHoldArms(ctx, gx, oy, len, chr) {
  const tip = gx + len;
  const skin = chr.skin || '#f0c8a0';
  const sleeve = chr.jacket || null;      // varsa ceket kolu (dirseke kadar)
  const foreGrip = tip - 11;              // ön elin silahı tuttuğu yer
  const rearGrip = gx + 2;               // arka elin (tetik) tuttuğu yer
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // Omuz çıkışları (gövde merkezine yakın). İki kol da buradan çıkıp
  // silahın İKİ kabzasına net uzanır — böylece silah "elle tam tutuluyor".
  const shBackX = -5, shBackY = oy - 3;   // arka omuz
  const shForeX = -3, shForeY = oy + 1;   // ön omuz

  // ceket kolu (üst kol) — omuzdan dirseğe, tenden kalın; kavrayışı gövdeye bağlar
  if (sleeve) {
    ctx.strokeStyle = shade(sleeve, -18); ctx.lineWidth = 5.4;
    ctx.beginPath(); ctx.moveTo(shBackX, shBackY); ctx.lineTo((shBackX + rearGrip) / 2, (shBackY + oy) / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(shForeX, shForeY); ctx.lineTo((shForeX + foreGrip) / 2, (shForeY + oy) / 2); ctx.stroke();
  }

  // arka kol (ten, koyu) — dirsekten tetiğe
  ctx.strokeStyle = shade(skin, -28); ctx.lineWidth = 4.4;
  ctx.beginPath(); ctx.moveTo(shBackX, shBackY); ctx.lineTo(rearGrip, oy); ctx.stroke();
  // ön kol (ten, açık) — dirsekten ön kabzaya (uzanır)
  ctx.strokeStyle = skin; ctx.lineWidth = 4.4;
  ctx.beginPath(); ctx.moveTo(shForeX, shForeY); ctx.lineTo(foreGrip, oy); ctx.stroke();
  // eller silahın ÜSTÜNE drawGun içinde çizilir (kabzaların üstünde görünür).
  ctx.restore();
}

// Silah siluetleri (yerel çerçeve). render.js'ten taşındı ki lobi de aynı
// kaliteli çizimi kullansın.
export function drawGun(ctx, wepId, gx, oy, len, chr) {
  if (wepId === 'shotgun') drawShotgunSil(ctx, gx, oy, len, chr);
  else if (wepId === 'sniper') drawSniperSil(ctx, gx, oy, len, chr);
  else drawRifleSil(ctx, gx, oy, len, chr);
}

function drawRifleSil(ctx, gx, oy, len, chr) {
  const tip = gx + len;
  ctx.fillStyle = '#2b2f36'; ctx.fillRect(gx - 10, oy - 2.6, 10, 5.4);
  ctx.fillStyle = '#3b424b'; ctx.fillRect(gx - 10, oy - 2.6, 10, 1.3);
  ctx.fillStyle = '#171b20'; ctx.fillRect(gx - 10, oy + 1.9, 10, 0.9);
  ctx.strokeStyle = '#12161b'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(gx + 4, oy + 4.4, 2.2, 0.15, Math.PI - 0.15); ctx.stroke();
  ctx.fillStyle = '#232a32'; ctx.fillRect(gx - 1, oy - 3.3, 13, 6.6);
  ctx.fillStyle = '#333c46'; ctx.fillRect(gx - 1, oy - 3.3, 13, 1.2);
  ctx.fillStyle = '#151a1f'; ctx.fillRect(gx - 1, oy + 2.3, 13, 1);
  ctx.fillStyle = '#11151a'; ctx.fillRect(gx + 1, oy - 4.6, 9, 1.3);
  ctx.fillRect(gx + 1.6, oy - 5.9, 1.6, 1.5);
  ctx.fillRect(gx + 8.2, oy - 5.9, 1.4, 1.5);
  ctx.fillStyle = '#242c34'; ctx.fillRect(gx + 12, oy - 1.9, len - 12, 3.8);
  ctx.fillStyle = '#3a444f'; ctx.fillRect(gx + 12, oy - 1.9, len - 12, 1);
  ctx.fillStyle = '#10141a';
  ctx.fillRect(gx + 14, oy - 0.4, 1.4, 1.6);
  ctx.fillRect(gx + 17, oy - 0.4, 1.4, 1.6);
  ctx.fillStyle = '#0e1216'; ctx.fillRect(tip - 3.4, oy - 2, 3.4, 4);
  ctx.fillStyle = '#2c343d'; ctx.fillRect(tip - 2.4, oy - 1.2, 0.8, 2.4);
  ctx.fillStyle = '#000'; ctx.fillRect(tip - 1.2, oy - 0.7, 1.2, 1.4);
  ctx.fillStyle = '#262e37';
  ctx.beginPath();
  ctx.moveTo(gx + 3, oy + 3); ctx.lineTo(gx + 9.5, oy + 3);
  ctx.lineTo(gx + 11, oy + 9.6); ctx.lineTo(gx + 4.4, oy + 10);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.09)'; ctx.fillRect(gx + 4.2, oy + 3.8, 1, 5.4);
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(gx + 9, oy + 3.6, 1.3, 5.6);
  ctx.fillStyle = chr.skin;
  ctx.fillRect(gx + 1, oy - 3.6, 4, 7.2);
  ctx.fillRect(tip - 12, oy - 3.2, 4, 6.4);
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(gx + 1, oy - 3.6, 4, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(gx + 1, oy + 2.4, 4, 1.2);
}

function drawShotgunSil(ctx, gx, oy, len, chr) {
  const tip = gx + len;
  ctx.fillStyle = '#3a2b1e'; ctx.fillRect(gx - 11, oy - 3, 11, 6);
  ctx.fillStyle = '#5a4128'; ctx.fillRect(gx - 11, oy - 3, 11, 1.5);
  ctx.fillStyle = '#4a3624'; ctx.fillRect(gx - 11, oy - 0.4, 11, 0.8);
  ctx.fillStyle = '#241a12'; ctx.fillRect(gx - 11, oy + 2.2, 11, 0.8);
  ctx.fillStyle = '#282420'; ctx.fillRect(gx - 1, oy - 3.4, 10, 6.8);
  ctx.fillStyle = '#3a352d'; ctx.fillRect(gx - 1, oy - 3.4, 10, 1.1);
  ctx.fillStyle = '#0c0a08'; ctx.fillRect(gx + 2, oy - 2, 4, 1.8);
  ctx.fillStyle = '#2c343d'; ctx.fillRect(gx + 8, oy - 3, len - 8, 3.4);
  ctx.fillStyle = '#41505d'; ctx.fillRect(gx + 8, oy - 3, len - 8, 1.1);
  ctx.fillStyle = '#20262d'; ctx.fillRect(gx + 8, oy + 0.7, len - 9, 2.6);
  ctx.fillStyle = '#333d47'; ctx.fillRect(gx + 8, oy + 0.7, len - 9, 0.8);
  ctx.fillStyle = '#5a4026'; ctx.fillRect(gx + 12, oy + 0.2, 7, 3.6);
  ctx.fillStyle = '#6e4f30'; ctx.fillRect(gx + 12, oy + 0.2, 7, 0.9);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(gx + 14, oy + 1, 0.8, 2.6); ctx.fillRect(gx + 16, oy + 1, 0.8, 2.6);
  ctx.fillStyle = '#11151a'; ctx.fillRect(tip - 5, oy - 3.6, 1.4, 1.2);
  ctx.fillStyle = '#0e1216'; ctx.fillRect(tip - 2.6, oy - 3.2, 2.6, 5);
  ctx.fillStyle = '#000'; ctx.fillRect(tip - 1.8, oy - 2, 1.4, 1.6);
  ctx.fillStyle = chr.skin;
  ctx.fillRect(gx + 1, oy - 3.8, 4, 7.6);
  ctx.fillRect(gx + 13, oy, 4, 4.4);
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(gx + 1, oy - 3.8, 4, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(gx + 1, oy + 2.6, 4, 1.2);
}

function drawSniperSil(ctx, gx, oy, len, chr) {
  const tip = gx + len;
  ctx.fillStyle = '#242830'; ctx.fillRect(gx - 13, oy - 2.6, 13, 5.4);
  ctx.fillStyle = '#343b46'; ctx.fillRect(gx - 13, oy - 2.6, 13, 1.3);
  ctx.fillStyle = '#151920'; ctx.fillRect(gx - 13, oy + 1.9, 13, 0.9);
  ctx.fillStyle = '#2b303a'; ctx.fillRect(gx - 12, oy - 4.1, 7, 1.6);
  ctx.fillStyle = '#1c222a'; ctx.fillRect(gx - 1, oy - 2.9, 13, 5.8);
  ctx.fillStyle = '#2c3540'; ctx.fillRect(gx - 1, oy - 2.9, 13, 1.1);
  ctx.fillStyle = '#39424d'; ctx.fillRect(gx + 9, oy + 1, 1.6, 3.4);
  ctx.beginPath(); ctx.arc(gx + 9.8, oy + 4.6, 1.4, 0, 7); ctx.fill();
  ctx.fillStyle = '#2a323b'; ctx.fillRect(gx + 12, oy - 1.3, len - 12, 2.6);
  ctx.fillStyle = '#3d4854'; ctx.fillRect(gx + 12, oy - 1.3, len - 12, 0.8);
  ctx.fillStyle = '#0e1216'; ctx.fillRect(tip - 5, oy - 1.9, 5, 3.8);
  ctx.fillStyle = '#2c343d';
  ctx.fillRect(tip - 3.8, oy - 1.1, 0.8, 2.2); ctx.fillRect(tip - 2.4, oy - 1.1, 0.8, 2.2);
  ctx.fillStyle = '#000'; ctx.fillRect(tip - 1.1, oy - 0.6, 1.1, 1.2);
  ctx.fillStyle = '#0e1217'; ctx.fillRect(gx + 1, oy - 7, 16, 3.4);
  ctx.fillStyle = '#20293480'; ctx.fillRect(gx + 1, oy - 7, 16, 1.1);
  ctx.fillStyle = '#39424d'; ctx.fillRect(gx + 7, oy - 8.2, 3, 1.4);
  ctx.fillStyle = '#12161b'; ctx.fillRect(gx + 0.4, oy - 7, 1.4, 3.4);
  ctx.fillStyle = '#0a0d10'; ctx.fillRect(gx + 1.2, oy - 6.4, 1, 2.2);
  ctx.fillStyle = '#8fc4ec'; ctx.fillRect(gx + 15.4, oy - 6.6, 1.8, 2.6);
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(gx + 15.6, oy - 6.4, 0.7, 1);
  ctx.fillStyle = '#12161b';
  ctx.fillRect(gx + 3.5, oy - 3.8, 1.6, 2);
  ctx.fillRect(gx + 13, oy - 3.8, 1.6, 2);
  ctx.fillStyle = chr.skin;
  ctx.fillRect(gx + 1, oy - 3.2, 4, 6.8);
  ctx.fillRect(tip - 14, oy - 2.6, 4, 5.6);
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(tip - 14, oy - 2.6, 4, 0.9);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(gx + 1, oy + 2, 4, 1.2);
}

// =========================================================================
//  PIXEL-ART silah (karakterlerle aynı çentikli görünüm)
//  --------------------------------------------------------------------
//  Silah + iki kol + eller, küçük bir tuvale TAM PİKSEL (tamsayı kare)
//  çizilir; oyun içinde/lobide nearest-neighbor ile büyütülüp döndürülür.
//  Böylece silah da LPC karakterler gibi iri, keskin piksellerden oluşur.
//  Ölçek karakterle aynıdır (×1.30) → piksel boyu birebir uyar.
// =========================================================================
const heldCache = new Map();

// Karakterin eline TUTTURULMUŞ silah sprite'ı (yerel çerçeve: +x namlu yönü).
// Dönüş: { canvas, ax, ay } — (ax,ay) gövde/omuz bağlantı noktası (pivot).
export function getHeldWeapon(wepId, chr) {
  const key = `${wepId}|${chr.skin}|${chr.jacket || ''}`;
  let h = heldCache.get(key);
  if (h) return h;
  h = buildHeldWeapon(wepId, chr);
  heldCache.set(key, h);
  return h;
}

// Kullanıcının çizdiği silahı (ciz.html) tutulan sprite'a çevirir; kollar/eller
// otomatik eklenir. Izgara koordinatları doğrudan sprite pikselleri olur.
function buildHeldFromDrawing(data, chr) {
  const { w, h, grip, muzzle, cells } = data;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const skin = chr.skin || '#e8b98f';
  const skinD = shade(skin, -26);
  const skinL = shade(skin, 20);
  const gy = grip.y;
  const rearGrip = grip.x;
  const foreGrip = Math.round((grip.x + muzzle.x) / 2);
  const ax = grip.x - 3, ay = gy - 4;      // pivot: kabzanın biraz gerisi/üstü
  g.lineCap = 'round';
  // arka kol (silahın ARKASINDA)
  g.strokeStyle = skinD; g.lineWidth = 3;
  g.beginPath(); g.moveTo(ax - 2, gy + 5); g.lineTo(rearGrip, gy); g.stroke();
  // KULLANICININ ÇİZDİĞİ SİLAH
  for (const p of cells) { g.fillStyle = p.c; g.fillRect(p.x | 0, p.y | 0, 1, 1); }
  // ön kol (silahın ÜSTÜNDE, ön kabzaya uzanır)
  g.strokeStyle = skin; g.lineWidth = 3.4;
  g.beginPath(); g.moveTo(ax - 1, gy + 5); g.lineTo(foreGrip, gy); g.stroke();
  // eller (kabzaların üstünde)
  g.fillStyle = skin;
  g.fillRect(rearGrip - 1, gy - 1, 3, 3);
  g.fillRect(foreGrip - 1, gy - 1, 3, 3);
  g.fillStyle = skinL;
  g.fillRect(rearGrip - 1, gy - 1, 3, 1);
  g.fillRect(foreGrip - 1, gy - 1, 3, 1);
  return { canvas: c, ax, ay };
}

function buildHeldWeapon(wepId, chr) {
  // Kullanıcı bu silahı çizdiyse onu kullan (kollar otomatik eklenir).
  const custom = CUSTOM_WEAPONS && CUSTOM_WEAPONS[wepId];
  if (custom && custom.cells && custom.cells.length) return buildHeldFromDrawing(custom, chr);

  const W = 46, H = 30;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const px = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x | 0, y | 0, w | 0, h | 0); };

  const skin = chr.skin || '#e8b98f';
  const skinD = shade(skin, -26);
  const skinL = shade(skin, 20);
  const sleeve = chr.jacket || '#2b3550';
  const sleeveD = shade(sleeve, -18);

  const ax = 14, ay = 13;          // pivot (omuz/gövde bağlantısı)
  const gy = ay + 4;               // silah hattı (HAND_SIDE kadar aşağı)
  const gripX = ax + 3;            // arka kabza (tetik)

  if (wepId === 'pence') {
    // Zombinin elinde silah yok: uzanmış ön kol + tırnaklar. Namlu ucu
    // (WEAPON_VIEW.pence) tırnakların hizasına denk gelir.
    const nail = '#d8d2b8';
    px(ax - 3, gy - 2, 7, 6, sleeve);            // omuz/kol
    px(ax + 2, gy - 2, 7, 5, skin);              // ön kol
    px(ax + 2, gy - 2, 7, 1, skinL);             // üst ışık
    px(ax + 2, gy + 2, 7, 1, skinD);             // alt gölge
    px(ax + 9, gy - 3, 2, 1, nail);              // tırnaklar
    px(ax + 9, gy, 2, 1, nail);
    px(ax + 9, gy + 2, 2, 1, nail);
    return { canvas: c, ax, ay };
  }

  if (wepId === 'bomba') {
    // el bombası: elde tutulan zeytin yeşili ovoid (pixel)
    const cx = ax + 6, cy = gy;
    px(ax - 3, gy - 2, 7, 6, sleeve);           // ceket kolu
    px(ax + 1, gy - 1, 6, 4, skin);             // ön kol
    px(cx - 3, cy - 4, 6, 9, '#3f4a2a');        // gövde
    px(cx - 4, cy - 2, 8, 5, '#3f4a2a');
    px(cx - 3, cy - 4, 6, 1, '#55643a');        // üst ışık
    px(cx - 4, cy + 2, 8, 1, '#28311a');        // alt gölge
    px(cx - 2, cy - 2, 1, 5, '#2c3520');        // dikey oluk
    px(cx + 1, cy - 2, 1, 5, '#2c3520');
    px(cx - 4, cy - 1, 8, 1, '#2c3520');        // yatay oluk
    px(cx - 2, cy - 6, 4, 2, '#5a6472');        // fünye kapağı
    px(cx + 2, cy - 6, 1, 5, '#8a929c');        // emniyet kaşığı
    px(cx - 4, cy - 1, 4, 4, skin);             // el (kavrar)
    px(cx - 4, cy - 1, 4, 1, skinL);
    const hh = { canvas: c, ax, ay };
    return hh;
  }

  const wood = wepId === 'shotgun';
  const body = wood ? '#3a2b1e' : (wepId === 'sniper' ? '#22262e' : '#272d35');
  const bodyHi = wood ? '#5a4128' : (wepId === 'sniper' ? '#333c47' : '#3a434e');
  const bodyDk = wood ? '#241a12' : '#11151b';
  const metal = '#2c343d';
  const metalHi = '#41505d';
  const dark = '#0e1216';

  // uzunluklar silaha göre
  const barrelLen = wepId === 'sniper' ? 15 : wepId === 'shotgun' ? 9 : 11;
  const hgX = gripX + 11;                 // ön kabza / handguard başlangıcı
  const muzzleX = hgX + barrelLen;        // namlu ucu
  const foreGripX = hgX + Math.min(5, (barrelLen / 2) | 0);  // ön elin yeri

  // --- KOLLAR (silahın altında; gövdeden kabzalara) ------------------------
  px(ax - 3, gy - 3, 6, 6, sleeve);       // omuz/üst kol (ceket)
  px(ax - 3, gy - 3, 6, 1, shade(sleeve, 18));
  px(ax - 1, gy + 1, gripX - (ax - 1) + 2, 3, skinD);          // arka ön kol → tetik
  px(ax, gy - 1, foreGripX - ax + 2, 3, skin);                 // ön kol → ön kabza
  px(ax, gy - 1, foreGripX - ax + 2, 1, skinL);

  // --- SİLAH GÖVDESİ -------------------------------------------------------
  if (wepId === 'sniper') px(gripX - 13, gy - 2, 12, 5, body); // uzun dipçik
  else px(gripX - 10, gy - 2, 9, 5, body);                     // dipçik
  px(gripX - (wepId === 'sniper' ? 13 : 10), gy - 2, wepId === 'sniper' ? 12 : 9, 1, bodyHi);
  px(gripX - (wepId === 'sniper' ? 13 : 10), gy + 2, wepId === 'sniper' ? 12 : 9, 1, bodyDk);

  px(gripX - 1, gy - 3, 13, 6, body);      // gövde (receiver)
  px(gripX - 1, gy - 3, 13, 1, bodyHi);
  px(gripX - 1, gy + 2, 13, 1, bodyDk);

  // pistol grip + tetik korkuluğu
  px(gripX - 1, gy + 3, 3, 5, bodyDk);
  px(gripX + 1, gy + 3, 5, 1, dark);

  if (wepId === 'sniper') {
    // üst dürbün
    px(gripX + 1, gy - 6, 11, 3, dark);
    px(gripX + 1, gy - 6, 11, 1, '#20293a');
    px(gripX + 10, gy - 5, 2, 2, '#8fc4ec');      // ön mercek parıltısı
    px(gripX + 2, gy - 4, 1, 1, '#0a0d10');
  } else {
    // üst ray + nişangah
    px(gripX + 1, gy - 4, 9, 1, dark);
    px(gripX + 1, gy - 5, 1, 1, dark);
    px(gripX + 8, gy - 5, 1, 1, dark);
  }

  if (wepId === 'shotgun') {
    // kavisli şarjör YOK; ahşap pompa + çift namlu hissi
    px(hgX, gy - 2, barrelLen, 3, metal);         // üst namlu
    px(hgX, gy - 2, barrelLen, 1, metalHi);
    px(hgX, gy + 1, barrelLen - 1, 2, '#20262d'); // alt tüp
    px(hgX + 1, gy + 1, 6, 2, '#5a4026');         // ahşap pompa
    px(hgX + 1, gy + 1, 6, 1, '#6e4f30');
  } else {
    // kavisli şarjör
    px(gripX + 2, gy + 3, 5, 3, metal);
    px(gripX + 3, gy + 6, 5, 3, metal);
    px(gripX + 3, gy + 3, 1, 6, metalHi);
    // handguard + namlu
    px(hgX, gy - 2, barrelLen, wepId === 'sniper' ? 3 : 4, wepId === 'sniper' ? metal : body);
    px(hgX, gy - 2, barrelLen, 1, wepId === 'sniper' ? metalHi : bodyHi);
    if (wepId !== 'sniper') { px(hgX + 2, gy, 1, 2, dark); px(hgX + 5, gy, 1, 2, dark); }
  }

  // namlu ucu (fren + delik)
  px(muzzleX - 2, gy - 2, 3, wepId === 'sniper' ? 3 : 4, dark);
  px(muzzleX, gy - 1, 1, wepId === 'sniper' ? 1 : 2, '#000');

  // --- ELLER (kabzaların ÜSTÜNDE) -----------------------------------------
  px(gripX - 1, gy - 1, 3, 4, skin);       // arka el (tetik)
  px(gripX - 1, gy - 1, 3, 1, skinL);
  px(foreGripX - 1, gy - 1, 3, 4, skin);   // ön el (kabza)
  px(foreGripX - 1, gy - 1, 3, 1, skinL);

  return { canvas: c, ax, ay };
}

/**
 * Karakterin eline silah çizer (lobi kartları için) — ÖNDEN duran karaktere
 * göğüs önünde ÇAPRAZ tutuş (port arms). İki göz görünür, silah elle tutulur.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x sol üst köşe (karakter kutusunun)
 * @param {number} y sol üst köşe
 * @param {number} scale karakterin çizim ölçeği (1 = 32x36 piksel)
 * @param {string} wepId 'rifle' | 'shotgun' | 'sniper'
 * @param {string} skin el rengi
 */
export function drawWeaponOnPreview(ctx, x, y, scale, wepId, skin, jacket) {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  // ÖNDEN duran karaktere göğüs önünde ÇAPRAZ (port arms) tutuş. Oyun içiyle
  // AYNI pixel-art silah sprite'ı (karakterle aynı piksel boyu, çentikli).
  const held = getHeldWeapon(wepId, { skin, jacket });
  ctx.translate(x + 32, y + 44);            // kartta gövde orta-alt (64×72 kart)
  ctx.rotate(-0.6);                          // sol-alttan sağ-üste çapraz
  ctx.scale(1.18, 1.18);                     // karakterle uyumlu piksel boyu
  ctx.drawImage(held.canvas, -held.ax, -held.ay);
  ctx.restore();
}

/** Nişan açısından bakış yönünü seçer (RPG sayfasındaki 4 yön). */
export function dirFromAngle(a) {
  const cos = Math.cos(a), sin = Math.sin(a);
  if (Math.abs(cos) >= Math.abs(sin)) return cos >= 0 ? 'right' : 'left';
  return sin >= 0 ? 'down' : 'up';
}
