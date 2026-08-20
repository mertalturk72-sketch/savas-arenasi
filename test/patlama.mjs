// Patlama kuralları.
//
// EN ÖNEMLİSİ: kendi bombandan zarar görmüyorsun.
//
// Şikâyet: "ben kendimi öldürebiliyorum." Bombacı dar koridorda ya da köşe
// dönerken kendi patlamasına yakalanıp ölüyordu. Kendi kendini öldüren bir
// sınıf oynanmıyor, o yüzden atan kişi kendi patlamasından tamamen muaf.
//
// Diğer kurallar bilerek DEĞİŞMEDİ ve burada kilitleniyor:
//   • takım arkadaşına hasar yok (takım modunda)
//   • duvarın arkası korur
//   • yeni doğan (koruma altındaki) oyuncu zarar görmez
//   • merkezde tam hasar, kenarda dörtte biri
//
// Çalıştır:  node test/patlama.mjs

import { Game } from '../shared/sim/game.js';
import { WEAPONS } from '../shared/constants.js';

const hatalar = [];
let sayac = 0;
function kontrol(baslik, ok, ek = '') {
  sayac++;
  console.log(`  ${ok ? '✓' : '✗'} ${baslik}${ek ? ' — ' + ek : ''}`);
  if (!ok) hatalar.push(baslik + (ek ? ' — ' + ek : ''));
}

const W = WEAPONS.bomba;

// Haritada, verilen yarıçap kadar çevresi tamamen boş bir nokta bul.
function acikNokta(g, pay = 220) {
  for (let i = 0; i < 8000; i++) {
    const x = 300 + Math.random() * (g.map.w - 600);
    const y = 300 + Math.random() * (g.map.h - 600);
    const bos = g.map.obstacles.every((o) =>
      !(x > o.x - pay && x < o.x + o.w + pay && y > o.y - pay && y < o.y + o.h + pay));
    if (bos) return { x, y };
  }
  return null;
}

function kur(modeId = 'ffa', oyuncular = null) {
  return new Game({
    modeId,
    players: oyuncular || [
      { id: 1, name: 'Bombaci', cls: 'bombaci' },
      { id: 2, name: 'Dusman', cls: 'komando' },
    ],
  });
}

// Sahte bomba: explode() yalnızca bu alanlara bakıyor.
const bomba = (sahip, takim = 0) => ({
  owner: sahip, team: takim, w: 'bomba',
  blastR: W.blastR, blastDmg: W.blastDmg,
});

console.log(`Patlama yarıçapı ${W.blastR} · merkez hasarı ${W.blastDmg}\n`);

// ===== 1) Kendi bomban sana zarar VERMEZ ================================
console.log('1) Kendi bomban');
{
  const g = kur();
  const yer = acikNokta(g);
  const a = g.players.get(1), d = g.players.get(2);
  a.x = yer.x; a.y = yer.y; a.hp = 100; a.protectUntil = -1;
  d.x = yer.x + 3000; d.y = yer.y;                 // düşman uzakta dursun
  // Bomba tam ayağının dibinde patlıyor — en kötü durum.
  g.explode(bomba(1), a.x, a.y);
  kontrol('ayağının dibinde patlayınca canı düşmedi', a.hp === 100, `can ${a.hp}`);
  kontrol('hayatta', a.alive === true);
  kontrol('ölüm sayısı artmadı', a.deaths === 0, `${a.deaths}`);
}
{
  // Yarıçapın hemen içindeki her mesafede de muaf olmalı
  const g = kur();
  const yer = acikNokta(g);
  const a = g.players.get(1);
  g.players.get(2).x = yer.x + 3000; g.players.get(2).y = yer.y;
  a.protectUntil = -1;
  let zararliMesafe = -1;
  for (let d = 0; d <= W.blastR; d += 10) {
    a.x = yer.x; a.y = yer.y; a.hp = 100; a.alive = true;
    g.explode(bomba(1), yer.x + d, yer.y);
    if (a.hp !== 100) { zararliMesafe = d; break; }
  }
  kontrol('yarıçap içindeki hiçbir mesafede zarar yok', zararliMesafe === -1,
    zararliMesafe === -1 ? 'hepsi 0 hasar' : `${zararliMesafe} px'te hasar aldı`);
}

// ===== 2) Düşman ZARAR GÖRÜR (muafiyet herkese yayılmadı) ===============
console.log('2) Düşman');
{
  const g = kur();
  const yer = acikNokta(g);
  const a = g.players.get(1), d = g.players.get(2);
  a.x = yer.x - 3000; a.y = yer.y;
  d.x = yer.x; d.y = yer.y; d.hp = 100; d.protectUntil = -1;
  g.explode(bomba(1), yer.x, yer.y);
  kontrol('merkezde tam hasar', Math.abs((100 - d.hp) - W.blastDmg) < 0.01, `${(100 - d.hp).toFixed(1)} hasar`);

  d.hp = 100; d.alive = true;
  g.explode(bomba(1), yer.x + W.blastR - 1, yer.y);      // kenara yakın
  const kenar = 100 - d.hp;
  kontrol('kenarda hasar azalıyor (~dörtte bir)', kenar > 0 && kenar < W.blastDmg * 0.45,
    `${kenar.toFixed(1)} hasar`);

  d.hp = 100; d.alive = true;
  g.explode(bomba(1), yer.x + W.blastR + 20, yer.y);     // yarıçapın dışı
  kontrol('yarıçapın dışında hasar yok', d.hp === 100, `can ${d.hp}`);
}

// ===== 3) Takım arkadaşı korunuyor, düşman görüyor ======================
console.log('3) Takım modu');
{
  const g = kur('tdm', [
    { id: 1, name: 'Ben', cls: 'bombaci', team: 1 },
    { id: 2, name: 'Dost', cls: 'komando', team: 1 },
    { id: 3, name: 'Dusman', cls: 'komando', team: 2 },
  ]);
  const yer = acikNokta(g);
  const ben = g.players.get(1), dost = g.players.get(2), dus = g.players.get(3);
  ben.x = yer.x - 3000; ben.y = yer.y;
  dost.x = yer.x; dost.y = yer.y; dost.hp = 100; dost.protectUntil = -1;
  dus.x = yer.x + 12; dus.y = yer.y; dus.hp = 100; dus.protectUntil = -1;
  g.explode(bomba(1, 1), yer.x, yer.y);
  kontrol('takım arkadaşı zarar görmedi', dost.hp === 100, `can ${dost.hp}`);
  kontrol('düşman zarar gördü', dus.hp < 100, `can ${dus.hp.toFixed(1)}`);
}

// ===== 4) Duvar arkası korur ===========================================
console.log('4) Duvar');
{
  const g = kur();
  const d = g.players.get(2);
  g.players.get(1).x = -5000; g.players.get(1).y = -5000;
  const o = g.map.obstacles[0];
  // Patlama duvarın bir yanında, oyuncu öbür yanında — mesafe yarıçap içinde.
  const px = o.x - 20, py = o.y + o.h / 2;
  const bx = o.x + o.w + 20;
  d.x = px; d.y = py; d.hp = 100; d.protectUntil = -1;
  const mesafe = Math.hypot(bx - px, 0);
  g.explode({ owner: 1, team: 0, w: 'bomba', blastR: Math.max(W.blastR, mesafe + 30), blastDmg: W.blastDmg }, bx, py);
  kontrol('duvarın arkasındaki oyuncu korundu', d.hp === 100,
    `duvar kalınlığı ${o.w} px · mesafe ${mesafe.toFixed(0)} px · can ${d.hp}`);
}

// ===== 5) Doğuş koruması ================================================
console.log('5) Doğuş koruması');
{
  const g = kur();
  const yer = acikNokta(g);
  const d = g.players.get(2);
  g.players.get(1).x = -5000; g.players.get(1).y = -5000;
  d.x = yer.x; d.y = yer.y; d.hp = 100;
  d.protectUntil = g.time + 1000;                 // yeni doğmuş
  g.explode(bomba(1), yer.x, yer.y);
  kontrol('koruma altındaki oyuncu zarar görmedi', d.hp === 100, `can ${d.hp}`);
}

// ===== 6) Alan %20 küçüldü ==============================================
console.log('6) Değerler');
kontrol('patlama yarıçapı 100', W.blastR === 100, `${W.blastR}`);
kontrol('merkez hasarı 56 (değişmedi)', W.blastDmg === 56, `${W.blastDmg}`);
kontrol('bomba hep kendinden uzağa düşüyor (asgari menzil > yarıçap)',
  W.minRange > W.blastR, `${W.minRange} > ${W.blastR}`);

console.log(`\n${sayac} kontrol · ${hatalar.length} hata`);
if (hatalar.length) {
  for (const h of hatalar) console.log('  ✗', h);
  console.log('\nPATLAMA TESTİ BAŞARISIZ ✗');
  process.exit(1);
}
console.log('\nPATLAMA TESTİ GEÇTİ ✓');
