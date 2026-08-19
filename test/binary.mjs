// İkili durum paketi testi.
//
// Tek bir soruyu sorar ve acımasızca sorar:
//   Paketi ikili kodlayıp geri çözdüğümüzde, istemcinin JSON'la alacağı
//   nesnenin BİREBİR AYNISI çıkıyor mu?
//
// Karşılaştırma referansı bilerek JSON.parse(JSON.stringify(...)): istemci
// bugüne kadar tam olarak onu görüyordu. Bir bayt bile kayarsa bu test patlar.
//
// İki koldan sınıyoruz:
//   1) GERÇEK MAÇLAR — üç oyun modunda, botlarla, ateş ederek, ölerek.
//      Üretilen her paket sınanır (on binlerce paket).
//   2) UÇ DEĞERLER — elle kurulmuş, sınırları zorlayan paketler.
//
// Çalıştır:  node test/binary.mjs

import { encodeSnapshot, decodeSnapshot } from '../shared/binary.js';
import { Hub } from '../shared/sim/hub.js';
import { C } from '../shared/protocol.js';
import {
  TICK_MS, MODES, CLASS_IDS, CHAR_IDS, WEAPON_IDS,
  IN_UP, IN_DOWN, IN_LEFT, IN_RIGHT, IN_FIRE, IN_RELOAD,
} from '../shared/constants.js';

const hatalar = [];
let sinanan = 0;
let jsonBayt = 0, ikiliBayt = 0;

// --- Derin karşılaştırma (anahtar sırası önemsiz) -------------------------
function fark(a, b, yol = '') {
  if (a === b) return null;
  if (typeof a !== typeof b) return `${yol}: tip ${typeof a} ≠ ${typeof b}`;
  if (a === null || b === null) return `${yol}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
  if (typeof a === 'number') {
    return Object.is(a, b) ? null : `${yol}: ${a} ≠ ${b}`;
  }
  if (typeof a !== 'object') return `${yol}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${yol}: biri dizi biri değil`;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${yol}: dizi uzunluğu ${a.length} ≠ ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const f = fark(a[i], b[i], `${yol}[${i}]`);
      if (f) return f;
    }
    return null;
  }
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join(',') !== kb.join(',')) return `${yol}: alanlar farklı → [${ka}] ≠ [${kb}]`;
  for (const k of ka) {
    const f = fark(a[k], b[k], `${yol}.${k}`);
    if (f) return f;
  }
  return null;
}

// Bir paketi sına: ikili tur atışı, JSON'un verdiğiyle aynı mı?
function sina(snap, etiket) {
  sinanan++;
  const beklenen = JSON.parse(JSON.stringify({ ty: 'snap', ...snap }));
  let cikan;
  try {
    const bytes = encodeSnapshot(snap);
    ikiliBayt += bytes.length;
    jsonBayt += Buffer.byteLength(JSON.stringify({ ty: 'snap', ...snap }));
    cikan = decodeSnapshot(bytes);
  } catch (e) {
    if (hatalar.length < 8) hatalar.push(`${etiket}: kodlama/çözme hatası → ${e.message}`);
    return false;
  }
  const f = fark(beklenen, cikan);
  if (f) {
    if (hatalar.length < 8) hatalar.push(`${etiket}: ${f}`);
    return false;
  }
  return true;
}

// =========================================================================
// 1) GERÇEK MAÇLAR
// =========================================================================
const YON = [IN_UP, IN_RIGHT, IN_DOWN, IN_LEFT, IN_UP | IN_RIGHT, IN_DOWN | IN_LEFT];

function macOynat(modId, oyuncu, bot) {
  const hub = new Hub();
  // Sunucunun gönderdiği her paketi yakala; JSON'a çevrilmeden önce elimize
  // geçsin diye ham nesneyi saklıyoruz.
  const yakalanan = [];
  const ws = () => ({
    readyState: 1,
    send() { /* JSON yolu bizi ilgilendirmiyor */ },
  });

  const kurucu = hub.addClient(ws(), '1.1.1.1');
  const r = hub.createLobby(kurucu, { name: 'T', mode: modId, botCount: bot });
  if (r.error) throw new Error(r.error);
  const lobi = r.lobby;
  for (let i = 1; i < oyuncu; i++) lobi.add(hub.addClient(ws(), '1.1.1.1'));
  for (const id of [...lobi.members.keys()]) lobi.setReady(id, true);

  // Geri sayımı atlatmak için maçı elle başlat.
  const t0 = Date.now();
  let seq = 0;
  const adim = () => {
    seq++;
    if (lobi.game) {
      for (const c of hub.clients.values()) {
        const k = YON[(Math.floor(seq / 12) + c.id) % YON.length]
          | (seq % 4 === 0 ? IN_FIRE : 0)
          | (seq % 400 === 0 ? IN_RELOAD : 0);
        hub.handle(c, { ty: C.INPUT, s: seq, d: TICK_MS, k, a: (c.id + seq / 25) % 6.283 });
      }
    }
    hub.tick(TICK_MS);
    // Her tick'te bir izleyici için paket üret ve sına.
    const g = lobi.game;
    if (g) {
      for (const p of g.players.values()) {
        if (p.bot) continue;
        yakalanan.push(g.snapshotFor(p));
      }
    }
  };
  return { hub, lobi, adim, yakalanan, t0 };
}

console.log('1) Gerçek maçlardan üretilen paketler\n');

for (const mod of Object.keys(MODES)) {
  const { lobi, adim, yakalanan } = macOynat(mod, 6, 14);
  // Geri sayım gerçek saate bağlı; bekleyip sonra oynatıyoruz.
  const bitis = Date.now() + 18000;
  await new Promise((res) => {
    const iv = setInterval(() => {
      adim();
      if (Date.now() > bitis) { clearInterval(iv); res(); }
    }, TICK_MS);
  });

  let ok = 0;
  for (const s of yakalanan) if (sina(s, `mod:${mod}`)) ok++;
  const durum = ok === yakalanan.length ? '✓' : '✗';
  console.log(`  ${MODES[mod].name.padEnd(22)} ${yakalanan.length.toString().padStart(6)} paket  ${durum}`);
  if (!lobi.game && yakalanan.length === 0) hatalar.push(`mod ${mod}: hiç paket üretilmedi (maç başlamadı)`);
}

// =========================================================================
// 2) UÇ DEĞERLER
// =========================================================================
console.log('\n2) Uç değerler');

const bos = {
  t: 0, ack: 0, ps: [], bs: [],
  you: {
    x: 0, y: 0, hp: 0, mx: 100, am: 0, mg: 30, ar: 0, mr: 60, rl: 0, rt: 1700,
    al: 0, hd: 0, rs: 0, cl: CLASS_IDS[0], wp: WEAPON_IDS[0], sp: 218,
    k: 0, d: 0, dm: 0, pl: 0,
  },
};
sina(bos, 'bomboş paket');

// Negatif ve azami değerler
sina({
  ...bos,
  t: 4294967295 - 1,
  ack: 999999,
  you: { ...bos.you, x: -4600.99, y: 3400.01, k: 65535, d: 70000, dm: 1234567, pl: 20 },
  ps: [100001, 4599, 3399, -314, 88, 88, 2, 31, 1, 0, 0, 314, 100, 100, 0, 1],
  bs: [4294967295, 0, 0, -314, 2, 1, 4599, 3399, 314, 0],
}, 'azami değerler');

// Tüm olay tipleri tek pakette
sina({
  ...bos,
  ev: [
    { e: 'join', i: 5, n: 'Şükrü Öztürk ğüşiöç', t: 2, c: CLASS_IDS[1], ch: CHAR_IDS[3], b: 1 },
    { e: 'spawn', i: 7 },
    { e: 'shot', i: 100002, x: 1200, y: 800, a: -3.14, w: WEAPON_IDS[2] },
    { e: 'imp', x: 0, y: 0, t: 1 },
    { e: 'imp', x: 4600, y: 3400, t: 0 },
    { e: 'kill', k: 3, kn: 'Avcı', kt: 1, v: 9, vn: 'Kurban', vt: 2, w: 'rifle', x: 500, y: 600 },
    { e: 'kill', k: 0, kn: '', kt: 0, v: 9, vn: 'Kurban', vt: 2, w: 'zone' },  // konumsuz
    { e: 'pk', i: 2, a: 1 },
    { e: 'zone', p: 3, x: 2300, y: 1700, r: 900 },
  ],
  pe: [
    { e: 'dry' },
    { e: 'hit', d: 82, k: 1 },
    { e: 'hurt', d: 15, a: -0.01, z: 0 },
    { e: 'hurt', d: 15, a: 3.14, z: 1 },
    { e: 'pick', k: 'ammo' },
  ],
  zn: { x: 2300, y: 1700, r: 1200, tx: 2000, ty: 1500, tr: 600, s: 1, w: 22, p: 2 },
  sc: {
    team: { 1: 13, 2: 7 }, alive: 12, total: 20, left: 300,
    ps: [1, 3, 2, 450, 1, 100001, 0, 5, 0, 0],
  },
}, 'tüm olay tipleri');

// Takımsız mod: sc.team null olmalı
sina({
  ...bos,
  sc: { team: null, alive: 1, total: 20, left: 0, ps: [1, 0, 0, 0, 1] },
}, 'takımsız skor');

// Türkçe karakterli uzun isim (UTF-8 çok baytlı)
sina({
  ...bos,
  ev: [{ e: 'kill', k: 1, kn: 'ĞÜŞİÖÇğüşıöç'.repeat(4), kt: 0, v: 2, vn: 'x', vt: 0, w: 'sniper', x: 1, y: 2 }],
}, 'türkçe isim');

console.log('  elle kurulmuş uç paketler sınandı');

// =========================================================================
// 3) BOZUK GİRDİ REDDEDİLMELİ (sessizce bozuk paket üretmemeli)
// =========================================================================
console.log('\n3) Bozuk girdi reddi');
const bozuklar = [
  ['menzil dışı x', { ...bos, ps: [1, 99999, 0, 0, 100, 100, 0, 1] }],
  ['tanınmayan sınıf', { ...bos, you: { ...bos.you, cl: 'yokboyle' } }],
  ['tanınmayan olay', { ...bos, ev: [{ e: 'uyduruk', i: 1 }] }],
  ['negatif can', { ...bos, you: { ...bos.you, hp: -5 } }],
];
for (const [ad, s] of bozuklar) {
  let firlatti = false;
  try { encodeSnapshot(s); } catch { firlatti = true; }
  console.log(`  ${ad.padEnd(20)} ${firlatti ? 'reddedildi ✓' : 'KABUL ETTİ ✗'}`);
  if (!firlatti) hatalar.push(`bozuk paket sessizce kabul edildi: ${ad}`);
}

// =========================================================================
console.log(`\nSınanan paket: ${sinanan}`);
if (jsonBayt) {
  console.log(`JSON toplam : ${(jsonBayt / 1e6).toFixed(2)} MB`);
  console.log(`İkili toplam: ${(ikiliBayt / 1e6).toFixed(2)} MB`);
  console.log(`KAZANÇ      : ${(jsonBayt / ikiliBayt).toFixed(2)}× küçülme (%${(100 - ikiliBayt / jsonBayt * 100).toFixed(1)} tasarruf)`);
}
if (hatalar.length) {
  console.log('\nHATALAR:');
  for (const h of hatalar) console.log(' ', h);
}
console.log(hatalar.length ? '\nİKİLİ PAKET TESTİ BAŞARISIZ ✗' : '\nİKİLİ PAKET TESTİ GEÇTİ ✓');
process.exit(hatalar.length ? 1 : 0);
