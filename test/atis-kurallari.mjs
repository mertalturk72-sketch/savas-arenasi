// Ateş kuralları: tetik, ödül cephanesi ve botun bomba atışı.
//
// Kapsananlar:
//   1) Şarjör basılı tutarken boşalıp kendiliğinden dolduysa, tetiği BIRAKMADAN
//      ateşe devam edilemez. Eskiden edilebiliyordu: dolum ceza olmaktan
//      çıkıyor, oyuncu parmağını hiç kaldırmadan yağdırmaya devam ediyordu.
//   2) Öldürünce yarım şarjör cephane ödülü — yedek kapasitesini AŞMADAN.
//   3) Botlar bombayı gerçekten atıyor ve hedefe yakın düşürüyor.
//      (Eski hata: botun tutması her karede kesiliyordu, bomba hep en yakına
//      düşüyordu. Bkz. shared/sim/bot.js içindeki açıklama.)
//
// Çalıştır:  node test/atis-kurallari.mjs

import { Game } from '../shared/sim/game.js';
import { WEAPONS, TICK_MS, IN_FIRE } from '../shared/constants.js';

const hatalar = [];
let sayac = 0;
function kontrol(baslik, ok, ek = '') {
  sayac++;
  console.log(`  ${ok ? '✓' : '✗'} ${baslik}${ek ? ' — ' + ek : ''}`);
  if (!ok) hatalar.push(baslik + (ek ? ' — ' + ek : ''));
}

function kur(cls = 'komando') {
  const g = new Game({
    modeId: 'ffa',
    players: [{ id: 1, name: 'Ben', cls }, { id: 2, name: 'Hedef', cls: 'komando' }],
  });
  const p = g.players.get(1);
  g.players.get(2).x = p.x + 4000;      // kimseyi vurmayalım
  g.players.get(2).y = p.y + 4000;
  return { g, p };
}

// Bir tick boyunca verilen tuşlarla girdi gönder.
function tik(g, p, keys) {
  p.inputQueue.push({ s: 0, d: TICK_MS, k: keys, a: 0 });
  g.tick(TICK_MS);
}

// ===== 1) Şarjör boşalınca tetiği bırakmak şart ==========================
console.log('1) Boşalan şarjör → tetiği bırak');
{
  const { g, p } = kur('komando');
  const wep = WEAPONS.rifle;
  let atis = 0;
  const eski = g.fire.bind(g);
  g.fire = (pl, w, m) => { if (pl.id === 1) atis++; return eski(pl, w, m); };

  // Tetiği hiç bırakmadan uzun süre bas: şarjör bitecek, kendiliğinden dolacak.
  const sureTik = Math.ceil((wep.mag * wep.fireMs + wep.reloadMs + 1500) / TICK_MS);
  for (let i = 0; i < sureTik; i++) tik(g, p, IN_FIRE);

  const doldu = p.ammo === wep.mag;
  console.log(`   basılı tutarak ${atis} atış · şarjör=${p.ammo} · dolum bitti mi: ${doldu}`);
  kontrol('şarjör kendiliğinden doldu', doldu, `${p.ammo}/${wep.mag}`);
  kontrol('tam olarak bir şarjör atıldı', atis === wep.mag, `${atis} atış`);
  kontrol('tetik bırakılmadığı için yeni şarjörden atış yok',
    p.ammo === wep.mag, `kalan ${p.ammo}`);

  // Şimdi bırak ve tekrar bas: ateş etmeli.
  const oncekiAtis = atis;
  tik(g, p, 0);                       // bırak
  for (let i = 0; i < 6; i++) tik(g, p, IN_FIRE);
  kontrol('bırakıp tekrar basınca ateş ediyor', atis > oncekiAtis,
    `${atis - oncekiAtis} atış`);
}

// ===== 2) Elle şarjör (R) bu kuraldan etkilenmiyor =======================
console.log('2) Elle dolum');
{
  const { g, p } = kur('komando');
  const wep = WEAPONS.rifle;
  p.ammo = wep.mag - 3;
  let atis = 0;
  const eski = g.fire.bind(g);
  g.fire = (pl, w, m) => { if (pl.id === 1) atis++; return eski(pl, w, m); };
  // R'ye bas (IN_RELOAD = ayrı bit), sonra dolumu bekle, sonra basılı tut.
  const IN_RELOAD = 32;
  tik(g, p, IN_RELOAD);
  for (let i = 0; i < Math.ceil((wep.reloadMs + 200) / TICK_MS); i++) tik(g, p, 0);
  kontrol('elle dolum tamamlandı', p.ammo === wep.mag, `${p.ammo}/${wep.mag}`);
  for (let i = 0; i < 8; i++) tik(g, p, IN_FIRE);
  kontrol('elle dolumdan sonra basınca ateş ediyor', atis > 0, `${atis} atış`);
}

// ===== 3) Öldürme cephane ödülü ==========================================
console.log('3) Cephane ödülü');
for (const cls of ['komando', 'akinci', 'nisanci', 'bombaci']) {
  const g = new Game({
    modeId: 'ffa',
    players: [{ id: 1, name: 'A', cls }, { id: 2, name: 'B', cls: 'komando' }],
  });
  const a = g.players.get(1);
  const wep = WEAPONS[a.weapon];
  const odul = Math.ceil(wep.mag / 2);

  a.reserve = 0;
  g.kill(g.players.get(2), a, 'bullet', wep.id);
  kontrol(`${cls}: boş yedeğe +${odul}`, a.reserve === odul, `${a.reserve}`);

  a.reserve = wep.reserve;                    // yedek dolu
  a.alive = true;
  g.kill(g.players.get(2), a, 'bullet', wep.id);
  kontrol(`${cls}: dolu yedek taşmıyor`, a.reserve === wep.reserve, `${a.reserve}`);
}

// ===== 4) Botlar bombayı atıyor ve yakına düşürüyor ======================
console.log('4) Bot bomba atışı');
{
  const g = new Game({
    modeId: 'ffa',
    players: [
      { id: 1, name: 'Bombaci', cls: 'bombaci', bot: true, botLevel: 'zor' },
      { id: 2, name: 'Kurban', cls: 'komando', bot: true, botLevel: 'orta' },
      { id: 3, name: 'Kurban2', cls: 'akinci', bot: true, botLevel: 'orta' },
    ],
  });
  const W = WEAPONS.bomba;
  let atis = 0, isabet = 0;
  const mesafeler = [];
  const tutmalar = [];
  const bot = g.players.get(1);

  const eskiFire = g.fire.bind(g);
  g.fire = (p, w, m) => { if (p.id === 1) atis++; return eskiFire(p, w, m); };
  const eskiBoom = g.explode.bind(g);
  g.explode = (b, x, y) => {
    if (b.owner === 1) {
      let en = Infinity;
      for (const o of g.players.values()) {
        if (o.id !== 1 && o.alive) en = Math.min(en, Math.hypot(o.x - x, o.y - y));
      }
      mesafeler.push(en);
      if (en <= W.blastR) isabet++;
    }
    return eskiBoom(b, x, y);
  };

  // Tetiğin ne kadar basılı kaldığını ölç
  let basBas = null;
  const N = Math.round(180000 / TICK_MS);
  for (let i = 0; i < N; i++) {
    g.tick(TICK_MS);
    const basili = !!(bot.prevKeys & IN_FIRE);
    if (basili && basBas === null) basBas = g.time;
    if (!basili && basBas !== null) { tutmalar.push(g.time - basBas); basBas = null; }
  }

  const enUzunTutma = tutmalar.length ? Math.max(...tutmalar) : 0;
  const oran = atis ? isabet / atis : 0;
  const ortanca = mesafeler.length
    ? mesafeler.slice().sort((a, b) => a - b)[Math.floor(mesafeler.length / 2)] : Infinity;
  console.log(`   3 dakikada ${atis} atış · patlama alanına isabet ${isabet} (%${Math.round(oran * 100)})`);
  console.log(`   patlama-düşman ortanca mesafe: ${Math.round(ortanca)} px · en uzun tetik tutma: ${Math.round(enUzunTutma)} ms`);

  kontrol('bot bomba atıyor', atis >= 10, `${atis} atış`);
  // KÖK HATANIN İMZASI: tutmaların hepsi bir kare (≈33 ms) ise menzil hep en
  // düşükte kalmış demektir. Bir karelik tutma bu testin ASIL yakaladığı şey.
  kontrol('tetik gerçekten basılı tutuluyor (tek kare değil)',
    enUzunTutma > TICK_MS * 4, `en uzun ${Math.round(enUzunTutma)} ms`);
  kontrol('bombalar hedefe yakın düşüyor', ortanca < W.blastR * 1.6,
    `ortanca ${Math.round(ortanca)} px`);
  kontrol('isabet oranı makul', oran >= 0.35, `%${Math.round(oran * 100)}`);
}

console.log(`\n${sayac} kontrol · ${hatalar.length} hata`);
if (hatalar.length) {
  for (const h of hatalar) console.log('  ✗', h);
  console.log('\nATIŞ KURALLARI TESTİ BAŞARISIZ ✗');
  process.exit(1);
}
console.log('\nATIŞ KURALLARI TESTİ GEÇTİ ✓');
