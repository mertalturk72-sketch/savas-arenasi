// Mermi NAMLUDAN çıkıyor mu?
//
// ŞİKÂYET: "mermi silahtan değil adamdan çıkıyor."
//
// KÖK NEDEN: iki ayrı hesap vardı.
//   • Sunucu mermiyi oyuncunun TAM MERKEZİNDEN, nişan yönünde 22 px ileriden
//     doğuruyordu (`PLAYER_RADIUS + 6`).
//   • İstemci silahı gövdenin 18,4 px YUKARISINA, 5 px YANINA, 32 px İLERİYE
//     çiziyordu.
// Aradaki fark gözle görülüyordu: mermi silahın ucundan değil, karakterin
// göbeğinden fırlıyor gibiydi.
//
// ÇÖZÜM: tek kaynak — `muzzleWorld()` (shared/constants.js). Hem çizim hem
// mermi aynı noktayı kullanıyor.
//
// Bu test ikisinin AYNI hesabı kullandığını ve merminin gerçekten oradan
// doğduğunu sınıyor. Ayrıca duvara dayanıp ateş edince merminin duvarın
// ötesine doğmadığını kontrol ediyor.
//
// Çalıştır:  node test/namlu.mjs

import { Game } from '../shared/sim/game.js';
import {
  muzzleWorld, WEAPON_VIEW, HAND_Y, HAND_SIDE, WEAPONS, CLASSES, PLAYER_RADIUS,
} from '../shared/constants.js';

const hatalar = [];
let sayac = 0;
const yakin = (a, b, tol = 0.001) => Math.abs(a - b) <= tol;

function kontrol(baslik, ok, ek = '') {
  sayac++;
  console.log(`  ${ok ? '✓' : '✗'} ${baslik}${ek ? ' — ' + ek : ''}`);
  if (!ok) hatalar.push(baslik + (ek ? ' — ' + ek : ''));
}

// ===== 1) Namlu noktası gövdenin İÇİNDE değil, ucunda ====================
console.log('1) Namlu noktası');
for (const id of Object.keys(WEAPON_VIEW)) {
  const m = muzzleWorld(0, 0, 0, id);          // sağa nişan
  const uzaklik = Math.hypot(m.x, m.y);
  const ileri = WEAPON_VIEW[id].tut + WEAPON_VIEW[id].boy;
  kontrol(`${id}: ileri ${ileri} px`, yakin(m.x, ileri) && yakin(m.y, HAND_Y + HAND_SIDE),
    `nokta (${m.x.toFixed(1)}, ${m.y.toFixed(1)})`);
  // Bomba hariç namlu, oyuncu dairesinin dışında olmalı
  if (id !== 'bomba') {
    kontrol(`${id}: namlu gövdenin dışında`, uzaklik > PLAYER_RADIUS,
      `${uzaklik.toFixed(1)} px > ${PLAYER_RADIUS}`);
  }
}

// ===== 2) Dönme doğru mu? ================================================
// Yukarı nişan alınca namlu YUKARIDA olmalı (y küçülmeli).
console.log('2) Yön');
{
  const yukari = muzzleWorld(1000, 1000, -Math.PI / 2, 'rifle');
  const asagi = muzzleWorld(1000, 1000, Math.PI / 2, 'rifle');
  const sol = muzzleWorld(1000, 1000, Math.PI, 'rifle');
  kontrol('yukarı nişanda namlu yukarıda', yukari.y < 1000 - 20, `y=${yukari.y.toFixed(1)}`);
  // Aşağı nişanda fark daha küçük: eller gövdenin 18 px YUKARISINDA, namlu
  // 32 px ileri gidiyor, ikisi birbirini kısmen götürüyor. Önemli olan işaret.
  kontrol('aşağı nişanda namlu aşağıda', asagi.y > 1000 + 8, `y=${asagi.y.toFixed(1)}`);
  kontrol('sola nişanda namlu solda', sol.x < 1000 - 20, `x=${sol.x.toFixed(1)}`);
}

// ===== 3) Mermi gerçekten namludan doğuyor mu? ===========================
console.log('3) Merminin doğduğu yer');
for (const clsId of Object.keys(CLASSES)) {
  const g = new Game({
    modeId: 'ffa',
    players: [{ id: 1, name: 'A', cls: clsId }, { id: 2, name: 'B', cls: 'komando' }],
  });
  const p = g.players.get(1);
  const wep = WEAPONS[CLASSES[clsId].weapon];
  // Haritanın ortasında açık bir yere koy (duvar güvenliği devreye girmesin)
  p.x = g.map.w / 2; p.y = g.map.h / 2;
  // Etrafı boş bir nokta bul
  for (let i = 0; i < 4000; i++) {
    const x = 200 + Math.random() * (g.map.w - 400);
    const y = 200 + Math.random() * (g.map.h - 400);
    const bos = g.map.obstacles.every((o) =>
      !(x > o.x - 90 && x < o.x + o.w + 90 && y > o.y - 90 && y < o.y + o.h + 90));
    if (bos) { p.x = x; p.y = y; break; }
  }
  p.aim = 0.7;
  g.bullets.length = 0;
  g.fire(p, wep, wep.throwable ? wep.maxRange : 0);

  const b = g.bullets[0];
  const bek = muzzleWorld(p.x, p.y, p.aim, wep.id);
  const sapma = b ? Math.hypot(b.x - bek.x, b.y - bek.y) : Infinity;
  kontrol(`${CLASSES[clsId].name} (${wep.id}) mermisi namludan doğuyor`, sapma < 0.5,
    `sapma ${sapma.toFixed(2)} px`);

  // Eski hatalı davranışın geri gelmediğini de açıkça sınıyoruz:
  const eskiX = p.x + Math.cos(p.aim) * (PLAYER_RADIUS + 6);
  const eskiY = p.y + Math.sin(p.aim) * (PLAYER_RADIUS + 6);
  const eskiyeUzaklik = b ? Math.hypot(b.x - eskiX, b.y - eskiY) : 0;
  kontrol(`${CLASSES[clsId].name}: gövde merkezinden doğmuyor`, eskiyeUzaklik > 4,
    `eski noktaya ${eskiyeUzaklik.toFixed(1)} px uzak`);
}

// ===== 4) Duvara dayanıp ateş edince mermi duvarı geçmemeli ==============
console.log('4) Duvar güvenliği');
{
  const g = new Game({
    modeId: 'ffa',
    players: [{ id: 1, name: 'A', cls: 'komando' }, { id: 2, name: 'B', cls: 'komando' }],
  });
  const p = g.players.get(1);
  const wep = WEAPONS.rifle;
  let denendi = 0, ihlal = 0;
  for (const o of g.map.obstacles) {
    // Duvarın sol tarafına, burnu duvara değecek kadar yakın dur; sağa ateş et.
    p.x = o.x - PLAYER_RADIUS - 1;
    p.y = o.y + o.h / 2;
    p.aim = 0;
    g.bullets.length = 0;
    g.fire(p, wep);
    const b = g.bullets[0];
    denendi++;
    if (b && b.x > o.x) ihlal++;
    // Diğer yön: duvarın sağında, sola ateş
    p.x = o.x + o.w + PLAYER_RADIUS + 1;
    p.aim = Math.PI;
    g.bullets.length = 0;
    g.fire(p, wep);
    const b2 = g.bullets[0];
    denendi++;
    if (b2 && b2.x < o.x + o.w) ihlal++;
  }
  kontrol(`duvara dayalı ${denendi} atışta mermi duvarın içine doğmadı`, ihlal === 0,
    `${ihlal} ihlal`);
}

// ===== 5) Bombacının şarjörü 6 ===========================================
console.log('5) Bombacı cephanesi');
kontrol('şarjör 6', WEAPONS.bomba.mag === 6, `${WEAPONS.bomba.mag}`);
kontrol('yedek 15', WEAPONS.bomba.reserve === 15, `${WEAPONS.bomba.reserve}`);
kontrol('bomba atılabilir (elde tüfek değil bomba var)', WEAPONS.bomba.throwable === true);

console.log(`\n${sayac} kontrol · ${hatalar.length} hata`);
if (hatalar.length) {
  for (const h of hatalar) console.log('  ✗', h);
  console.log('\nNAMLU TESTİ BAŞARISIZ ✗');
  process.exit(1);
}
console.log('\nNAMLU TESTİ GEÇTİ ✓');
