// Durum paketinin (snapshot) İKİLİ biçimi.
//
// NEDEN: Sunucudan çıkan verinin %100'ü durum paketleridir. JSON olarak
// gönderilince baytların çoğu oyun bilgisi değil AMBALAJ olur — alan adları,
// tırnaklar, virgüller, sayıların tek tek rakamları. `1450` yazmak metinde
// 4 bayt tutar, ikilide 2. 20 kişilik bir maçta bu fark saatte gigabaytlara
// çıkıyor ve doğrudan sunucu faturasına yazılıyor.
//
// TASARIM İLKESİ — bu dosya SADECE bir ambalajdır:
//   coz(kodla(x)) her zaman x ile BİREBİR AYNI nesneyi vermelidir.
// Hassasiyet düşürülmez, alan atılmaz, yuvarlama yapılmaz. Paket üreticisi
// (game.js snapshotFor) neyi hangi hassasiyette ürettiyse o korunur. Böylece
// oyun kodunun hiçbir yerinde "ikili mi geldi, JSON mu geldi" sorusu sorulmaz
// ve iki taşıma da tamamen aynı davranır. test/binary.mjs bu eşitliği rastgele
// üretilmiş on binlerce paketle sınar.
//
// GÜVENLİK AĞI: beklenmedik bir değer (menzil dışı sayı, tanınmayan olay tipi)
// gelirse kodlayıcı HATA FIRLATIR, sessizce bozuk paket üretmez. Çağıran taraf
// (hub.send) bunu yakalayıp o paketi JSON olarak gönderir. Yani en kötü ihtimal
// "bant kazancı olmadı", asla "oyuncular ışınlandı" değildir.

import { CLASS_IDS, WEAPON_IDS, CHAR_IDS, CLASSES, WEAPONS } from './constants.js';

export const BIN_VERSION = 1;
export const BIN_SNAPSHOT = 1;          // ilk bayt: bu paketin türü

// Paket içi bayrak bitleri
const HAS_EV = 1, HAS_ZN = 2, HAS_SC = 4, HAS_PE = 8, HAS_TEAM = 16;

// Olay tipleri — sıralama ASLA değişmemeli (istemciyle ortak sözlük).
// YENİ TİP SONA EKLENİR — sıra değişirse eski istemciler yanlış çözer.
const EV_IDS = ['join', 'spawn', 'shot', 'imp', 'kill', 'pk', 'zone', 'boom'];
const PE_IDS = ['dry', 'hit', 'hurt', 'pick'];

// kill.w alanı silah adı ya da 'zone' olabilir; 'zone' için ayrı numara.
const W_ZONE = 254;
// kill olayında konum gizlenmiş olabilir (uzaktaki oyuncuya sızmasın diye).
const KILL_HAS_POS = 1;

const enc = new TextEncoder();
const dec = new TextDecoder();

// --- Yazıcı ---------------------------------------------------------------
class Yazici {
  constructor(kapasite = 4096) {
    this.buf = new Uint8Array(kapasite);
    this.dv = new DataView(this.buf.buffer);
    this.p = 0;
  }

  yer(n) {
    if (this.p + n <= this.buf.length) return;
    let k = this.buf.length * 2;
    while (k < this.p + n) k *= 2;
    const yeni = new Uint8Array(k);
    yeni.set(this.buf);
    this.buf = yeni;
    this.dv = new DataView(yeni.buffer);
  }

  u8(x) { kontrol(x, 0, 255, 'u8'); this.yer(1); this.dv.setUint8(this.p, x); this.p += 1; }
  u16(x) { kontrol(x, 0, 65535, 'u16'); this.yer(2); this.dv.setUint16(this.p, x, true); this.p += 2; }
  i16(x) { kontrol(x, -32768, 32767, 'i16'); this.yer(2); this.dv.setInt16(this.p, x, true); this.p += 2; }
  i32(x) { kontrol(x, -2147483648, 2147483647, 'i32'); this.yer(4); this.dv.setInt32(this.p, x, true); this.p += 4; }

  // Değişken uzunluklu tam sayı (LEB128): küçük sayılar 1 bayt, büyükler 5.
  // Oyuncu/mermi numaraları maç boyunca büyüdüğü için üst sınır varsaymıyoruz.
  // NOT: bit kaydırma (>>>) 32 bitte taşar; zigzag farkları 32 biti aşabildiği
  // için bilerek bölme kullanıyoruz — 2^53'e kadar doğru çalışır.
  vu(x) {
    kontrol(x, 0, Number.MAX_SAFE_INTEGER, 'vu');
    let v = x;
    this.yer(8);
    do {
      let b = v % 128;
      v = Math.floor(v / 128);
      if (v) b |= 0x80;
      this.dv.setUint8(this.p++, b);
    } while (v);
  }

  // İşaretli fark (zigzag): -1 → 1, 1 → 2, -2 → 3 … Küçük farklar, negatif
  // olsalar bile, tek bayta sığar.
  vz(x) {
    if (!Number.isInteger(x)) throw new Error(`ikili: vz tam sayı değil: ${x}`);
    this.vu(x >= 0 ? x * 2 : -x * 2 - 1);
  }

  yazi(s) {
    const b = enc.encode(String(s == null ? '' : s));
    if (b.length > 255) throw new Error('yazı çok uzun');
    this.u8(b.length);
    this.yer(b.length);
    this.buf.set(b, this.p);
    this.p += b.length;
  }

  bitir() { return this.buf.subarray(0, this.p); }
}

// --- Okuyucu --------------------------------------------------------------
class Okuyucu {
  constructor(bytes) {
    this.buf = bytes;
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.p = 0;
  }

  u8() { return this.dv.getUint8(this.p++); }
  u16() { const v = this.dv.getUint16(this.p, true); this.p += 2; return v; }
  i16() { const v = this.dv.getInt16(this.p, true); this.p += 2; return v; }
  i32() { const v = this.dv.getInt32(this.p, true); this.p += 4; return v; }

  vu() {
    let v = 0, shift = 0, b;
    do {
      b = this.dv.getUint8(this.p++);
      v += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80);
    return v;
  }

  vz() {
    const v = this.vu();
    return (v % 2 === 0) ? v / 2 : -(v + 1) / 2;
  }

  yazi() {
    const n = this.u8();
    const s = dec.decode(this.buf.subarray(this.p, this.p + n));
    this.p += n;
    return s;
  }
}

function kontrol(x, min, max, tip) {
  if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max) {
    throw new Error(`ikili: ${tip} alanına uymayan değer: ${x}`);
  }
}

// 1/100 hassasiyetli ondalık: JSON'daki değerin birebir aynısını üretir.
// (Math.round(1234.56 * 100) = 123456 → 123456 / 100 = 1234.56)
function yuz(x) { return Math.round(x * 100); }

// "you" paketindeki türetilebilir alanlar tablodaki değerlerle aynı mı?
// Aynıysa gönderilmez, çözerken tablodan geri konur.
function tureyenlerUyuyor(y, cli, wpi) {
  const c = CLASSES[CLASS_IDS[cli]];
  const wp = WEAPONS[WEAPON_IDS[wpi]];
  if (!c || !wp) return false;
  return y.mx === c.hp && y.sp === c.speed
    && y.mg === wp.mag && y.mr === wp.reserve && y.rt === wp.reloadMs;
}

function dizinBul(liste, deger, ad) {
  const i = liste.indexOf(deger);
  if (i < 0) throw new Error(`ikili: tanınmayan ${ad}: ${deger}`);
  return i;
}

// =========================================================================
// KODLAMA
// =========================================================================
export function encodeSnapshot(s) {
  const w = new Yazici(4096);
  w.u8(BIN_VERSION);
  w.u8(BIN_SNAPSHOT);

  let bayrak = 0;
  if (s.ev && s.ev.length) bayrak |= HAS_EV;
  if (s.zn) bayrak |= HAS_ZN;
  if (s.sc) bayrak |= HAS_SC;
  if (s.pe && s.pe.length) bayrak |= HAS_PE;
  if (s.sc && s.sc.team) bayrak |= HAS_TEAM;
  w.u8(bayrak);

  w.vu(s.t);
  w.vu(s.ack || 0);

  // --- kendi durumun -----------------------------------------------------
  // mx/mg/mr/rt/sp alanları sınıf ve silah tablolarından TÜRETİLEBİLİR
  // (azami can = sınıfın canı, şarjör = silahın şarjörü…). Normalde hepsi
  // tabloyla birebir aynıdır, o yüzden hiç göndermiyoruz: tek bit yetiyor.
  // Bir gün bir güçlendirme bu değerleri değiştirirse bit sıfırlanır ve
  // değerler açıkça yazılır — yani tahmin yürütmüyoruz, doğruluk garanti.
  const y = s.you;
  const cli = dizinBul(CLASS_IDS, y.cl, 'sınıf');
  const wpi = dizinBul(WEAPON_IDS, y.wp, 'silah');
  const turetilmis = tureyenlerUyuyor(y, cli, wpi);
  w.u8(turetilmis ? 1 : 0);
  w.i32(yuz(y.x));
  w.i32(yuz(y.y));
  w.vu(y.hp); w.vu(y.am); w.vu(y.ar);
  w.vu(y.rl); w.vu(y.rs);
  w.u8(y.al); w.u8(y.hd);
  w.u8(cli); w.u8(wpi);
  w.vu(y.k); w.vu(y.d); w.vu(y.dm);
  w.u8(y.pl);
  if (!turetilmis) { w.vu(y.mx); w.vu(y.mg); w.vu(y.mr); w.vu(y.rt); w.vu(y.sp); }

  // --- görünen oyuncular -------------------------------------------------
  // id'ler bir önceki kaydın id'sine göre FARK olarak yazılır: aynı karede
  // görünen oyuncuların numaraları birbirine yakın olduğu için fark çoğu
  // zaman tek bayta sığar (bot numaraları 100000'den başlıyor, tam sayı
  // olarak yazsak her biri 3 bayt tutardı).
  const ps = s.ps || [];
  w.vu(ps.length / 8);
  let sonId = 0;
  for (let i = 0; i < ps.length; i += 8) {
    w.vz(ps[i] - sonId); sonId = ps[i];
    w.i16(ps[i + 1]);       // x
    w.i16(ps[i + 2]);       // y
    w.i16(ps[i + 3]);       // nişan * 100
    // Tek baytta: bayraklar (bit 0-4) + sınıf (bit 5-7, 8 sınıfa kadar).
    // "Azami can sınıfın varsayılanı mı" bilgisi için bayt kalmadı; onu CAN
    // sayısının en düşük bitine sıkıştırıyoruz (can zaten küçük bir sayı,
    // ikiye katlamak bir bayt bile büyütmüyor).
    const bayraklar = ps[i + 7];
    if (!Number.isInteger(bayraklar) || bayraklar < 0 || bayraklar > 31) {
      throw new Error(`ikili: oyuncu bayrağı 5 bite sığmıyor: ${bayraklar}`);
    }
    const sinif = ps[i + 6];
    if (!Number.isInteger(sinif) || sinif < 0 || sinif > 7) {
      throw new Error(`ikili: sınıf indeksi 3 bite sığmıyor: ${sinif}`);
    }
    const varsayilanCan = CLASSES[CLASS_IDS[sinif]] && CLASSES[CLASS_IDS[sinif]].hp;
    const canTuretilmis = ps[i + 5] === varsayilanCan;
    w.vu(ps[i + 4] * 2 + (canTuretilmis ? 0 : 1));   // can + "azami can ayrı mı" biti
    w.u8(bayraklar | (sinif << 5));
    if (!canTuretilmis) w.vu(ps[i + 5]);
  }

  // --- görünen mermiler --------------------------------------------------
  // Mermi numaraları da fark olarak yazılıyor; aynı anda uçan mermiler
  // ardışık numaralı olduğu için fark neredeyse hep 1-2.
  const bs = s.bs || [];
  w.vu(bs.length / 5);
  let sonB = 0;
  for (let i = 0; i < bs.length; i += 5) {
    w.vz(bs[i] - sonB); sonB = bs[i];
    w.i16(bs[i + 1]);
    w.i16(bs[i + 2]);
    w.i16(bs[i + 3]);
    w.u8(bs[i + 4]);
  }

  // --- olaylar -----------------------------------------------------------
  if (bayrak & HAS_EV) {
    w.vu(s.ev.length);
    for (const e of s.ev) olayYaz(w, e);
  }
  if (bayrak & HAS_PE) {
    w.vu(s.pe.length);
    for (const e of s.pe) ozelOlayYaz(w, e);
  }

  // --- daralan alan ------------------------------------------------------
  if (bayrak & HAS_ZN) {
    const z = s.zn;
    w.i16(z.x); w.i16(z.y); w.i16(z.r);
    w.i16(z.tx); w.i16(z.ty); w.i16(z.tr);
    w.u8(z.s); w.u16(z.w); w.u8(z.p);
  }

  // --- skor tablosu ------------------------------------------------------
  if (bayrak & HAS_SC) {
    const sc = s.sc;
    if (bayrak & HAS_TEAM) { w.vu(sc.team[1] || 0); w.vu(sc.team[2] || 0); }
    w.u16(sc.alive); w.u16(sc.total); w.u16(sc.left);
    const sp = sc.ps || [];
    w.vu(sp.length / 5);
    for (let i = 0; i < sp.length; i += 5) {
      w.vu(sp[i]);          // id
      w.vu(sp[i + 1]);      // öldürme
      w.vu(sp[i + 2]);      // ölüm
      w.vu(sp[i + 3]);      // hasar
      w.u8(sp[i + 4]);      // ayakta mı
    }
  }

  return w.bitir();
}

function olayYaz(w, e) {
  const t = dizinBul(EV_IDS, e.e, 'olay');
  w.u8(t);
  switch (e.e) {
    case 'join':
      w.vu(e.i); w.yazi(e.n); w.u8(e.t);
      w.u8(dizinBul(CLASS_IDS, e.c, 'sınıf'));
      w.u8(dizinBul(CHAR_IDS, e.ch, 'karakter'));
      w.u8(e.b);
      break;
    case 'spawn':
      w.vu(e.i);
      break;
    case 'shot':
      w.vu(e.i); w.i16(e.x); w.i16(e.y); w.i16(yuz(e.a));
      w.u8(dizinBul(WEAPON_IDS, e.w, 'silah'));
      break;
    case 'imp':
      w.i16(e.x); w.i16(e.y); w.u8(e.t);
      break;
    case 'kill': {
      // Uzaktaki oyunculara konum gönderilmez; o yüzden x/y isteğe bağlı.
      const konum = (e.x !== undefined && e.y !== undefined) ? KILL_HAS_POS : 0;
      w.u8(konum);
      w.vu(e.k); w.yazi(e.kn); w.u8(e.kt);
      w.vu(e.v); w.yazi(e.vn); w.u8(e.vt);
      w.u8(e.w === 'zone' ? W_ZONE : dizinBul(WEAPON_IDS, e.w, 'silah'));
      if (konum) { w.i16(e.x); w.i16(e.y); }
      break;
    }
    case 'pk':
      w.vu(e.i); w.u8(e.a);
      break;
    case 'zone':
      w.u8(e.p); w.i16(e.x); w.i16(e.y); w.i16(e.r);
      break;
    case 'boom':
      w.i16(e.x); w.i16(e.y); w.i16(e.r);
      break;
    default:
      throw new Error(`ikili: olay yazılamadı: ${e.e}`);
  }
}

function ozelOlayYaz(w, e) {
  w.u8(dizinBul(PE_IDS, e.e, 'özel olay'));
  switch (e.e) {
    case 'dry': break;
    case 'hit': w.u16(e.d); w.u8(e.k); break;
    case 'hurt': w.u16(e.d); w.i16(yuz(e.a)); w.u8(e.z); break;
    case 'pick': w.yazi(e.k); break;
    default: throw new Error(`ikili: özel olay yazılamadı: ${e.e}`);
  }
}

// =========================================================================
// ÇÖZME
// =========================================================================
export function decodeSnapshot(bytes) {
  const r = new Okuyucu(bytes);
  const ver = r.u8();
  if (ver !== BIN_VERSION) throw new Error(`ikili: bilinmeyen sürüm ${ver}`);
  const tip = r.u8();
  if (tip !== BIN_SNAPSHOT) throw new Error(`ikili: bilinmeyen paket türü ${tip}`);
  const bayrak = r.u8();

  const out = { ty: 'snap' };
  out.t = r.vu();
  out.ack = r.vu();

  // Alan sırası kodlayıcıyla birebir aynı olmalı. `you` nesnesini de aynı
  // sırayla kuruyoruz ki JSON'dan gelenle anahtar sırası bile aynı olsun.
  const turetilmis = r.u8() === 1;
  const yx = r.i32() / 100;
  const yy = r.i32() / 100;
  const yhp = r.vu(), yam = r.vu(), yar = r.vu();
  const yrl = r.vu(), yrs = r.vu();
  const yal = r.u8(), yhd = r.u8();
  const ycl = CLASS_IDS[r.u8()], ywp = WEAPON_IDS[r.u8()];
  const yk = r.vu(), yd = r.vu(), ydm = r.vu();
  const ypl = r.u8();
  const sinif = CLASSES[ycl], silah = WEAPONS[ywp];
  const ymx = turetilmis ? sinif.hp : r.vu();
  const ymg = turetilmis ? silah.mag : r.vu();
  const ymr = turetilmis ? silah.reserve : r.vu();
  const yrt = turetilmis ? silah.reloadMs : r.vu();
  const ysp = turetilmis ? sinif.speed : r.vu();
  out.you = {
    x: yx, y: yy,
    hp: yhp, mx: ymx,
    am: yam, mg: ymg,
    ar: yar, mr: ymr,
    rl: yrl, rt: yrt,
    al: yal, hd: yhd,
    rs: yrs,
    cl: ycl, wp: ywp, sp: ysp,
    k: yk, d: yd, dm: ydm,
    pl: ypl,
  };

  const pn = r.vu();
  const ps = new Array(pn * 8);
  let sonId = 0;
  for (let i = 0, o = 0; i < pn; i++, o += 8) {
    sonId += r.vz();
    ps[o] = sonId;
    ps[o + 1] = r.i16();
    ps[o + 2] = r.i16();
    ps[o + 3] = r.i16();
    const canPaket = r.vu();
    ps[o + 4] = Math.floor(canPaket / 2);
    const canAyri = (canPaket % 2) === 1;
    const paket = r.u8();
    const cls = (paket >> 5) & 7;
    ps[o + 5] = canAyri ? r.vu() : CLASSES[CLASS_IDS[cls]].hp;
    ps[o + 6] = cls;
    ps[o + 7] = paket & 31;
  }
  out.ps = ps;

  const bn = r.vu();
  const bs = new Array(bn * 5);
  let sonB = 0;
  for (let i = 0, o = 0; i < bn; i++, o += 5) {
    sonB += r.vz();
    bs[o] = sonB;
    bs[o + 1] = r.i16();
    bs[o + 2] = r.i16();
    bs[o + 3] = r.i16();
    bs[o + 4] = r.u8();
  }
  out.bs = bs;

  if (bayrak & HAS_EV) {
    const n = r.vu();
    const ev = new Array(n);
    for (let i = 0; i < n; i++) ev[i] = olayOku(r);
    out.ev = ev;
  }
  if (bayrak & HAS_PE) {
    const n = r.vu();
    const pe = new Array(n);
    for (let i = 0; i < n; i++) pe[i] = ozelOlayOku(r);
    out.pe = pe;
  }
  if (bayrak & HAS_ZN) {
    out.zn = {
      x: r.i16(), y: r.i16(), r: r.i16(),
      tx: r.i16(), ty: r.i16(), tr: r.i16(),
      s: r.u8(), w: r.u16(), p: r.u8(),
    };
  }
  if (bayrak & HAS_SC) {
    const sc = {};
    sc.team = (bayrak & HAS_TEAM) ? { 1: r.vu(), 2: r.vu() } : null;
    sc.alive = r.u16(); sc.total = r.u16();
    const left = r.u16();
    const n = r.vu();
    const sp = new Array(n * 5);
    for (let i = 0, o = 0; i < n; i++, o += 5) {
      sp[o] = r.vu();
      sp[o + 1] = r.vu();
      sp[o + 2] = r.vu();
      sp[o + 3] = r.vu();
      sp[o + 4] = r.u8();
    }
    sc.ps = sp;
    sc.left = left;
    out.sc = sc;
  }
  return out;
}

function olayOku(r) {
  const t = EV_IDS[r.u8()];
  switch (t) {
    case 'join': return {
      e: 'join', i: r.vu(), n: r.yazi(), t: r.u8(),
      c: CLASS_IDS[r.u8()], ch: CHAR_IDS[r.u8()], b: r.u8(),
    };
    case 'spawn': return { e: 'spawn', i: r.vu() };
    case 'shot': return {
      e: 'shot', i: r.vu(), x: r.i16(), y: r.i16(),
      a: r.i16() / 100, w: WEAPON_IDS[r.u8()],
    };
    case 'imp': return { e: 'imp', x: r.i16(), y: r.i16(), t: r.u8() };
    case 'kill': {
      const konum = r.u8();
      const o = {
        e: 'kill',
        k: r.vu(), kn: r.yazi(), kt: r.u8(),
        v: r.vu(), vn: r.yazi(), vt: r.u8(),
      };
      const wi = r.u8();
      o.w = wi === W_ZONE ? 'zone' : WEAPON_IDS[wi];
      if (konum & KILL_HAS_POS) { o.x = r.i16(); o.y = r.i16(); }
      return o;
    }
    case 'pk': return { e: 'pk', i: r.vu(), a: r.u8() };
    case 'zone': return { e: 'zone', p: r.u8(), x: r.i16(), y: r.i16(), r: r.i16() };
    case 'boom': return { e: 'boom', x: r.i16(), y: r.i16(), r: r.i16() };
    default: throw new Error('ikili: tanınmayan olay numarası');
  }
}

function ozelOlayOku(r) {
  const t = PE_IDS[r.u8()];
  switch (t) {
    case 'dry': return { e: 'dry' };
    case 'hit': return { e: 'hit', d: r.u16(), k: r.u8() };
    case 'hurt': return { e: 'hurt', d: r.u16(), a: r.i16() / 100, z: r.u8() };
    case 'pick': return { e: 'pick', k: r.yazi() };
    default: throw new Error('ikili: tanınmayan özel olay numarası');
  }
}
