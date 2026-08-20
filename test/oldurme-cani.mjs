// Öldürme ödülü: birini öldüren oyuncu can kazanır — ama canı TAŞMAZ.
//
// Kullanıcının açık uyarısı: "mesela 90'sa 140 olmasın". Yani ödül sabit bir
// toplama değil, azamiyle sınırlı bir toplama. Bu test tam olarak o sınırı
// koruyor; ileride biri ödülü değiştirirse tavan yine yerinde kalsın.
//
// Tarayıcı gerekmiyor: kural doğrudan simülasyonda.
//
// Çalıştır:  node test/oldurme-cani.mjs

import { Game } from '../shared/sim/game.js';
import { KILL_HEAL, CLASSES } from '../shared/constants.js';

const hatalar = [];
let sayac = 0;

function kontrol(baslik, olan, beklenen) {
  sayac++;
  const ok = olan === beklenen;
  console.log(`  ${ok ? '✓' : '✗'} ${baslik}: ${olan}${ok ? '' : `  (beklenen ${beklenen})`}`);
  if (!ok) hatalar.push(`${baslik}: ${olan} — beklenen ${beklenen}`);
}

function kurulum() {
  const g = new Game({
    modeId: 'ffa',
    players: [
      { id: 1, name: 'Avci', cls: 'komando' },
      { id: 2, name: 'Kurban', cls: 'komando' },
    ],
  });
  return { g, a: g.players.get(1), k: g.players.get(2) };
}

console.log(`Öldürme ödülü: ${KILL_HEAL} can · azami can: ${CLASSES.komando.hp}\n`);

// 1) Tam can sınırı — asıl istenen davranış
{
  console.log('1) Canı taşırmıyor');
  const { g, a, k } = kurulum();
  a.hp = 90;
  g.kill(k, a, 'bullet', 'rifle');
  kontrol('90 canlıyken öldürdü', a.hp, a.maxHp);          // 140 DEĞİL
  kontrol('azami can', a.maxHp, 100);
}

// 2) Boşluk varken tam ödül
{
  console.log('2) Yer varsa ödülün tamamı verilir');
  const { g, a, k } = kurulum();
  a.hp = 30;
  g.kill(k, a, 'bullet', 'rifle');
  kontrol('30 + ödül', a.hp, 30 + KILL_HEAL);
}

// 3) Tam candayken hiç değişmez
{
  console.log('3) Zaten tam candaysa değişmez');
  const { g, a, k } = kurulum();
  a.hp = a.maxHp;
  g.kill(k, a, 'bullet', 'rifle');
  kontrol('tam candayken öldürdü', a.hp, a.maxHp);
}

// 4) Bir canla kalmışken
{
  console.log('4) Kıl payı hayattayken');
  const { g, a, k } = kurulum();
  a.hp = 1;
  g.kill(k, a, 'bullet', 'rifle');
  kontrol('1 + ödül', a.hp, Math.min(100, 1 + KILL_HEAL));
}

// 5) Ölmüş biri can kazanmaz (aynı anda ikisi de ölebilir)
{
  console.log('5) Ölü öldüren can kazanmaz');
  const { g, a, k } = kurulum();
  a.hp = 40;
  a.alive = false;
  g.kill(k, a, 'bullet', 'rifle');
  kontrol('ölüyken öldürdü', a.hp, 40);
}

// 6) Kendi kendine ölüm / alan hasarı ödül vermez
{
  console.log('6) Kendini öldüren ya da alan hasarı ödül vermez');
  const { g, k } = kurulum();
  k.hp = 20;
  g.kill(k, k, 'bullet', 'bomba');          // saldıran = kurban
  kontrol('kendi bombasıyla öldü', k.hp, 0);

  const { g: g2, k: k2 } = kurulum();
  k2.hp = 20;
  g2.kill(k2, null, 'zone', 'zone');        // saldıran yok
  kontrol('alan dışında öldü', k2.hp, 0);
}

// 7) Üst üste öldürmeler de taşmıyor
{
  console.log('7) Arka arkaya öldürmelerde de tavan korunuyor');
  const g = new Game({
    modeId: 'ffa',
    players: [
      { id: 1, name: 'Avci', cls: 'komando' },
      { id: 2, name: 'K1', cls: 'komando' },
      { id: 3, name: 'K2', cls: 'komando' },
      { id: 4, name: 'K3', cls: 'komando' },
    ],
  });
  const a = g.players.get(1);
  a.hp = 20;
  g.kill(g.players.get(2), a, 'bullet', 'rifle');
  const ilk = a.hp;
  g.kill(g.players.get(3), a, 'bullet', 'rifle');
  g.kill(g.players.get(4), a, 'bullet', 'rifle');
  kontrol('birinci öldürmeden sonra', ilk, 70);
  kontrol('üç öldürmeden sonra', a.hp, 100);
  kontrol('öldürme sayısı', a.kills, 3);
}

// 8) Bütün sınıflarda azami 100 (can eşitlendi)
{
  console.log('8) Her sınıfta tavan 100');
  for (const id of Object.keys(CLASSES)) {
    const g = new Game({
      modeId: 'ffa',
      players: [{ id: 1, name: 'A', cls: id }, { id: 2, name: 'B', cls: 'komando' }],
    });
    const a = g.players.get(1);
    a.hp = 80;
    g.kill(g.players.get(2), a, 'bullet', 'rifle');
    kontrol(`${CLASSES[id].name}`, a.hp, 100);
  }
}

console.log(`\n${sayac} kontrol · ${hatalar.length} hata`);
if (hatalar.length) {
  for (const h of hatalar) console.log('  ✗', h);
  console.log('\nÖLDÜRME ÖDÜLÜ TESTİ BAŞARISIZ ✗');
  process.exit(1);
}
console.log('\nÖLDÜRME ÖDÜLÜ TESTİ GEÇTİ ✓');
