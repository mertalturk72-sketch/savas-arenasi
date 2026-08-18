// Bağımlılıksız duman testi: simülasyonu botlarla hızlandırılmış çalıştırır,
// ardından gerçek WebSocket istemcileriyle 20 kişilik lobiyi doldurur.
// Çalıştır:  node test/smoke.js

import assert from 'node:assert/strict';
import { Game } from '../shared/sim/game.js';
import { createMap, analyzeWalkable } from '../shared/sim/map.js';
import { buildObstacleIndex, moveCircle, circleHitsRect, lineBlocked } from '../shared/physics.js';
import {
  MAX_PLAYERS, TICK_MS, CLASS_IDS, PLAYER_RADIUS, WEAPONS, MATCH_MS,
  BUSH_REVEAL_DIST, MAPS, SPAWN_EDGE_INSET,
} from '../shared/constants.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.message}`); }
}

console.log('\n— Harita —');
test('arena haritası üretiliyor ve spawn noktaları boş', () => {
  const { map, idx, spawns } = createMap('arena');
  assert.ok(spawns.all.length > 10, 'yeterli spawn yok');
  for (const s of spawns.all) {
    for (const o of map.obstacles) {
      assert.ok(!circleHitsRect(s.x, s.y, PLAYER_RADIUS + 2, o), 'spawn engelin içinde');
    }
  }
  assert.ok(spawns[1].length > 0 && spawns[2].length > 0, 'takım spawnları yok');
  void idx;
});

test('royale haritası üretiliyor', () => {
  const { map, spawns } = createMap('royale', 12345);
  assert.ok(map.obstacles.length > 60, 'engel sayısı düşük');
  assert.ok(map.bushes.length > 20, 'çalı yok');
  assert.ok(spawns.all.length > 20);
});

test('haritalar büyüdü', () => {
  const a = createMap('arena').map;
  assert.equal(a.w, MAPS.arena.w);
  assert.ok(a.w >= 3400 && a.h >= 2400, 'arena küçük kalmış');
  const r = createMap('royale', 7).map;
  assert.ok(r.w >= 4600 && r.h >= 3400, 'royale küçük kalmış');
});

// "Geçilmeyen boşluk" sorununun testi: haritanın yürünebilir alanı tek parça
// olmalı. Bir geçit oyuncunun sığamayacağı kadar darsa burası kopar ve test düşer.
test('haritada geçilemeyen kopuk bölge yok', () => {
  for (const id of ['arena', 'royale']) {
    for (let i = 0; i < 6; i++) {
      const { map, idx, walkable } = createMap(id, 500 + i * 977);
      const w = walkable || analyzeWalkable(map, idx);
      assert.ok(
        w.mainRatio >= 0.995,
        `${id} (tohum ${500 + i * 977}): yürünebilir alanın %${((1 - w.mainRatio) * 100).toFixed(1)}'i kopuk`,
      );
    }
  }
});

test('doğuş noktaları ana bölgede', () => {
  for (const id of ['arena', 'royale']) {
    const { spawns, walkable } = createMap(id, 4242);
    for (const s of spawns.all) {
      assert.ok(walkable.inMain(s.x, s.y), `${id}: doğuş noktası kopuk cepte`);
    }
  }
});

console.log('\n— Fizik —');
test('oyuncu duvarın içine giremez', () => {
  const map = { w: 1000, h: 1000, obstacles: [{ x: 400, y: 0, w: 40, h: 1000 }] };
  const idx = buildObstacleIndex(map);
  const pos = { x: 300, y: 500 };
  for (let i = 0; i < 200; i++) moveCircle(pos, PLAYER_RADIUS, 10, 0, idx);
  assert.ok(pos.x <= 400 - PLAYER_RADIUS + 0.01, `duvarı geçti: x=${pos.x}`);
});

test('harita sınırları dışına çıkılamaz', () => {
  const map = { w: 800, h: 600, obstacles: [] };
  const idx = buildObstacleIndex(map);
  const pos = { x: 100, y: 100 };
  for (let i = 0; i < 300; i++) moveCircle(pos, PLAYER_RADIUS, -20, -20, idx);
  assert.equal(pos.x, PLAYER_RADIUS);
  assert.equal(pos.y, PLAYER_RADIUS);
});

console.log('\n— Simülasyon (20 bot) —');
for (const mode of ['ffa', 'tdm', 'br']) {
  const minutes = mode === 'br' ? 9 : 3;
  test(`${mode}: 20 botla ${minutes} dakika sorunsuz koşuyor`, () => {
    const players = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      players.push({
        id: i + 1, name: `Bot${i + 1}`, bot: true,
        team: (i % 2) + 1,
        cls: CLASS_IDS[i % CLASS_IDS.length],
      });
    }
    const g = new Game({ modeId: mode, players });
    assert.equal(g.players.size, 20, 'lobide 20 oyuncu olmalı');

    const ticks = Math.round((minutes * 60 * 1000) / TICK_MS);
    let totalKills = 0;
    let maxBullets = 0;
    for (let i = 0; i < ticks && !g.over; i++) {
      g.tick(TICK_MS);
      maxBullets = Math.max(maxBullets, g.bullets.length);
      // Anlık paketin serileştirilebildiğini de doğrula
      if (i % 200 === 0) { g.prepareSnapshot(); JSON.stringify(g.snapshotFor(g.players.values().next().value)); }
      g.clearEvents();
    }
    for (const p of g.players.values()) {
      totalKills += p.kills;
      assert.ok(p.x >= 0 && p.x <= g.map.w && p.y >= 0 && p.y <= g.map.h, 'oyuncu harita dışında');
      assert.ok(p.hp <= p.maxHp + 0.01, 'can üst sınırı aşıldı');
      for (const o of g.map.obstacles) {
        assert.ok(!circleHitsRect(p.x, p.y, PLAYER_RADIUS - 1.5, o), `oyuncu duvarın içinde (${p.name})`);
      }
    }
    assert.ok(totalKills > 5, `botlar birbirini vurmuyor (kill=${totalKills})`);
    assert.ok(maxBullets < 800, `mermi sayısı kontrolsüz büyüyor (${maxBullets})`);
    if (mode === 'br') assert.ok(g.over, 'BR maçı bitmeliydi');
    console.log(`     (${mode}: ${totalKills} öldürme, en fazla ${maxBullets} eşzamanlı mermi, bitti=${g.over})`);
  });
}

test('FFA skor limitine ulaşınca maç biter', () => {
  const players = [{ id: 1, name: 'A', bot: true, cls: 'komando' }, { id: 2, name: 'B', bot: true, cls: 'komando' }];
  const g = new Game({ modeId: 'ffa', players });
  g.players.get(1).kills = 24;
  g.kill(g.players.get(2), g.players.get(1), 0, 'rifle');
  g.checkEnd();
  assert.ok(g.over, 'maç bitmeliydi');
  assert.equal(g.winner.id, 1);
});

test('dost ateşi takım modunda geçmez', () => {
  const players = [
    { id: 1, name: 'A', bot: false, team: 1, cls: 'komando' },
    { id: 2, name: 'B', bot: false, team: 1, cls: 'komando' },
  ];
  const g = new Game({ modeId: 'tdm', players });
  const a = g.players.get(1), b = g.players.get(2);
  a.x = 500; a.y = 500; b.x = 560; b.y = 500;
  a.aim = 0;
  g.fire(a, WEAPONS.rifle);
  for (let i = 0; i < 10; i++) g.stepBullets(TICK_MS / 1000);
  assert.equal(b.hp, b.maxHp, 'takım arkadaşı hasar aldı');
});


// Çevresi açık bir çalı seç. Sadece düz bir çizgi değil, OYUNCU ÇAPININ
// sığdığı bir yol arıyoruz: iki duvar arasındaki 20 piksellik bir aralıktan
// çizgi geçer ama oyuncu geçemez, o yüzden daire ile kontrol ediyoruz.
function playerPathClear(g, x0, x1, y) {
  for (let x = x0; x <= x1; x += 6) {
    for (const o of g.map.obstacles) {
      if (circleHitsRect(x, y, PLAYER_RADIUS + 2, o)) return false;
    }
  }
  return true;
}

function pickOpenBush(g, dist = 200) {
  for (const b of g.bushes) {
    const left = b.x - b.r - dist, right = b.x + b.r + dist;
    if (left < 80 || right > g.map.w - 80) continue;
    if (b.y < 80 || b.y > g.map.h - 80) continue;
    if (!playerPathClear(g, left, right, b.y)) continue;
    return b;
  }
  return null;
}

console.log('\n— Çalılar —');
test('çalı engel değil: içinden geçilir', () => {
  const g = new Game({ modeId: 'ffa', players: [{ id: 1, name: 'A', bot: false, cls: 'komando' }] });
  const b = pickOpenBush(g, 200);
  assert.ok(b, 'çevresi açık çalı bulunamadı');
  const p = g.players.get(1);

  const startX = b.x - b.r - 60;
  p.x = startX; p.y = b.y;

  // Çalının içinden geçip öbür tarafa çıkabilmeli: hem içine girmeli
  // (engel gibi durdurmamalı) hem de karşıya varabilmeli.
  let wasInside = false;
  for (let i = 0; i < 200; i++) {
    g.applyInput(p, { s: i, d: 16, k: 8 /* IN_RIGHT */, a: 0 });
    if (Math.hypot(p.x - b.x, p.y - b.y) < b.r) wasInside = true;
    if (p.x > b.x + b.r + 40) break;
  }

  assert.ok(wasInside, 'oyuncu çalının içine hiç girmedi');
  assert.ok(p.x > b.x + b.r + 30,
    `çalı yolu kesti: x=${Math.round(p.x)}, çalının sağ kenarı ${Math.round(b.x + b.r)}`);
  assert.ok(Math.abs(p.y - b.y) < 4, 'çalı oyuncuyu yana itti');
});

test('çalıdaki oyuncu uzaktan görünmez, yakından görünür', () => {
  const g = new Game({
    modeId: 'ffa',
    players: [
      { id: 1, name: 'Bakan', bot: false, cls: 'komando' },
      { id: 2, name: 'Saklanan', bot: false, cls: 'komando' },
    ],
  });
  const b = pickOpenBush(g, BUSH_REVEAL_DIST + 150);
  assert.ok(b, 'görüş hattı açık çalı bulunamadı');
  const seer = g.players.get(1), hider = g.players.get(2);
  hider.x = b.x; hider.y = b.y;

  // Uzaktan: görünmemeli
  seer.x = b.x + BUSH_REVEAL_DIST + 150; seer.y = b.y;
  g.updateHidden();
  assert.equal(hider.hidden, true, 'çalıdaki oyuncu gizli sayılmadı');
  assert.equal(g.canSee(seer, hider), false, 'çalıdaki oyuncu uzaktan görünüyor');

  // Yakından: görünmeli
  seer.x = b.x + BUSH_REVEAL_DIST - 60;
  assert.equal(g.canSee(seer, hider), true, 'çalıdaki oyuncu yakından görünmüyor');
});

test('ateş eden oyuncu çalıda saklanamaz', () => {
  const g = new Game({
    modeId: 'ffa',
    players: [
      { id: 1, name: 'Bakan', bot: false, cls: 'komando' },
      { id: 2, name: 'Saklanan', bot: false, cls: 'komando' },
    ],
  });
  const b = pickOpenBush(g, BUSH_REVEAL_DIST + 200);
  assert.ok(b, 'görüş hattı açık çalı bulunamadı');
  const seer = g.players.get(1), hider = g.players.get(2);
  hider.x = b.x; hider.y = b.y;
  seer.x = b.x + BUSH_REVEAL_DIST + 200; seer.y = b.y;

  hider.muzzle = g.time;            // az önce ateş etti
  g.updateHidden();
  assert.equal(hider.hidden, false, 'ateş eden oyuncu hâlâ gizli');
  assert.equal(g.canSee(seer, hider), true, 'ateş eden oyuncu açığa çıkmadı');
});

test('mermi çalıdan geçer', () => {
  const g = new Game({
    modeId: 'ffa',
    players: [
      { id: 1, name: 'A', bot: false, cls: 'komando' },
      { id: 2, name: 'B', bot: false, cls: 'komando' },
    ],
  });
  const b = pickOpenBush(g, 120);
  assert.ok(b, 'çevresi açık çalı bulunamadı');
  const a = g.players.get(1), t = g.players.get(2);
  a.x = b.x - b.r - 60; a.y = b.y; a.aim = 0; a.protectUntil = 0;
  t.x = b.x + b.r + 60; t.y = b.y; t.protectUntil = 0;
  g.fire(a, WEAPONS.sniper);
  for (let i = 0; i < 20; i++) g.stepBullets(TICK_MS / 1000);
  assert.ok(t.hp < t.maxHp, 'mermi çalıda takıldı');
});

test('maç başında kimse ateş etmiş sayılmaz', () => {
  const g = new Game({ modeId: 'ffa', players: [{ id: 1, name: 'A', bot: false, cls: 'komando' }] });
  const p = g.players.get(1);
  assert.ok(g.time - p.muzzle > 1000, 'yeni doğan oyuncu "az önce ateş etti" sayılıyor');
  const b = g.bushes[0];
  assert.ok(b, 'harita çalısız');
  p.x = b.x; p.y = b.y;
  g.updateHidden();
  assert.equal(p.hidden, true, 'maç başında çalı gizlemiyor');
});

console.log('\n— Can ve cephane —');
test('can 2 saniyede 1 dolar', () => {
  const g = new Game({ modeId: 'ffa', players: [{ id: 1, name: 'A', bot: false, cls: 'komando' }] });
  const p = g.players.get(1);
  p.hp = 50;
  for (let i = 0; i < 10 * 30; i++) g.regenerate(TICK_MS / 1000);   // 10 saniye
  assert.ok(Math.abs(p.hp - 55) < 0.6, `10 saniyede 5 can beklenirdi, ${p.hp.toFixed(1)} oldu`);
});

test('can üst sınırı aşmaz', () => {
  const g = new Game({ modeId: 'ffa', players: [{ id: 1, name: 'A', bot: false, cls: 'agir' }] });
  const p = g.players.get(1);
  p.hp = p.maxHp - 1;
  for (let i = 0; i < 300; i++) g.regenerate(TICK_MS / 1000);
  assert.equal(p.hp, p.maxHp);
});

test('haritada can kutusu yok, hepsi cephane', () => {
  for (const id of ['arena', 'royale']) {
    const { pickups } = createMap(id, 99);
    assert.ok(pickups.length > 5, 'kutu yok');
    assert.ok(pickups.every((k) => k.kind === 'ammo'), `${id}: can kutusu kalmış`);
  }
});

test('cephane sınırlı: yedek bitince ateş edilemez', () => {
  const g = new Game({ modeId: 'ffa', players: [{ id: 1, name: 'A', bot: false, cls: 'komando' }] });
  const p = g.players.get(1);
  const wep = WEAPONS[p.weapon];
  assert.equal(p.reserve, wep.reserve, 'yedek dolu başlamalı');

  const total = wep.mag + wep.reserve;
  let shots = 0;
  for (let i = 0; i < 4000 && shots <= total + 5; i++) {
    g.time += 200;                       // atış bekleme süresini geç
    if (p.reloadUntil && g.time >= p.reloadUntil) g.finishReload(p, wep);
    if (p.reloadUntil) continue;
    if (p.ammo > 0) { g.fire(p, wep); shots++; }
    else if (p.reserve > 0) p.reloadUntil = g.time + wep.reloadMs;
    else break;
  }
  assert.equal(shots, total, `toplam ${total} mermi atılmalıydı, ${shots} atıldı`);
  assert.equal(p.ammo, 0);
  assert.equal(p.reserve, 0);
});

test('cephane kutusu yedeği doldurur', () => {
  const g = new Game({ modeId: 'ffa', players: [{ id: 1, name: 'A', bot: false, cls: 'komando' }] });
  const p = g.players.get(1);
  const wep = WEAPONS[p.weapon];
  p.reserve = 0;
  const k = g.pickups[0];
  p.x = k.x; p.y = k.y;
  g.stepPickups();
  assert.ok(p.reserve > 0, 'kutu yedeği doldurmadı');
  assert.ok(p.reserve <= wep.reserve, 'yedek kapasiteyi aştı');
  assert.equal(k.active, false, 'kutu harcanmadı');
});

test('doğuşta cephane tazelenir', () => {
  const g = new Game({ modeId: 'ffa', players: [{ id: 1, name: 'A', bot: false, cls: 'nisanci' }] });
  const p = g.players.get(1);
  p.ammo = 0; p.reserve = 0;
  g.respawn(p);
  assert.equal(p.ammo, WEAPONS.sniper.mag);
  assert.equal(p.reserve, WEAPONS.sniper.reserve);
});

console.log('\n— Harita çeşitliliği —');
test('her maçta farklı ama aynı tarz arena', () => {
  const sigs = new Set();
  for (let i = 0; i < 8; i++) {
    const { map } = createMap('arena', 3000 + i * 613);
    sigs.add(map.obstacles.map((o) => `${o.x},${o.y},${o.w},${o.h}`).join('|'));
    // Aynı aile: hep simetrik ve makul sayıda engel
    assert.ok(map.obstacles.length >= 20 && map.obstacles.length <= 60,
      `engel sayısı ailenin dışında: ${map.obstacles.length}`);
    for (const o of map.obstacles) {
      const mirrored = map.obstacles.some((m) =>
        Math.abs(m.x - (map.w - o.x - o.w)) <= 1 && m.y === o.y && m.w === o.w && m.h === o.h);
      assert.ok(mirrored, 'arena simetrik değil');
    }
  }
  assert.ok(sigs.size >= 6, `haritalar yeterince çeşitlenmiyor (${sigs.size}/8 farklı)`);
});

console.log('\n— Doğuş noktaları —');
test('kimse haritanın kenarında doğmuyor', () => {
  // Eskiden doğuş noktaları "birbirinden en uzak" mantığıyla seçildiği için
  // oyuncular hep köşelere düşüyordu. Artık dış çerçeve doğuşa kapalı.
  for (const mapId of ['arena', 'royale']) {
    for (let i = 0; i < 4; i++) {
      const { map, spawns } = createMap(mapId, 7000 + i * 977);
      const limitX = map.w * SPAWN_EDGE_INSET;
      const limitY = map.h * SPAWN_EDGE_INSET;
      for (const key of ['all', 1, 2]) {
        for (const s of spawns[key]) {
          assert.ok(s.x >= limitX - 1 && s.x <= map.w - limitX + 1,
            `${mapId} doğuş noktası kenara çok yakın: x=${Math.round(s.x)} (sınır ${Math.round(limitX)})`);
          assert.ok(s.y >= limitY - 1 && s.y <= map.h - limitY + 1,
            `${mapId} doğuş noktası kenara çok yakın: y=${Math.round(s.y)} (sınır ${Math.round(limitY)})`);
        }
      }
    }
  }
});

test('gerçek maçta oyuncular ortaya doğru doğuyor', () => {
  // Havuzun iç bölgede olması yetmez: "düşmandan en uzak noktayı seç" kuralı
  // yine iç bölgenin köşelerini seçebilir. Gerçek doğuşları ölçüyoruz.
  const players = [];
  for (let i = 1; i <= 16; i++) players.push({ id: i, name: 'O' + i, bot: true, cls: 'komando' });
  const g = new Game({ modeId: 'ffa', players, seed: 4242 });

  let sum = 0, n = 0, worst = Infinity;
  const half = Math.min(g.map.w, g.map.h) / 2;
  for (let round = 0; round < 6; round++) {
    for (const p of g.players.values()) {
      g.respawn(p);
      const edge = Math.min(p.x, g.map.w - p.x, p.y, g.map.h - p.y);
      sum += edge; n++;
      if (edge < worst) worst = edge;
    }
  }
  const avg = sum / n;
  // Hiçbir doğuş kenardan %12'den yakın olmamalı...
  assert.ok(worst >= Math.min(g.map.w, g.map.h) * 0.12,
    `en kötü doğuş kenara çok yakın: ${Math.round(worst)} px`);
  // ...ve ortalama, kenar-merkez mesafesinin en az yarısı kadar içeride olmalı.
  assert.ok(avg >= half * 0.5,
    `doğuşlar ortalamada hâlâ kenarda: ${Math.round(avg)} px (beklenen ≥ ${Math.round(half * 0.5)})`);
});

test('takım modunda taraflar hâlâ ayrı ama köşede değil', () => {
  const { map, spawns } = createMap('arena', 555);
  for (const s of spawns[1]) assert.ok(s.x < map.w * 0.5, 'kızıl takım karşı yarıda doğuyor');
  for (const s of spawns[2]) assert.ok(s.x > map.w * 0.5, 'mavi takım karşı yarıda doğuyor');
});

console.log('\n— Maç süresi —');
test('tüm modlarda maç 5 dakika', () => {
  for (const mode of ['ffa', 'tdm', 'br']) {
    const g = new Game({ modeId: mode, players: [{ id: 1, name: 'A', bot: true, cls: 'komando' }] });
    assert.equal(g.mode.timeLimitMs, MATCH_MS, `${mode} süre sınırı yanlış`);
    assert.equal(MATCH_MS, 5 * 60 * 1000);
  }
});

test('süre dolunca maç biter', () => {
  const g = new Game({
    modeId: 'ffa',
    players: [{ id: 1, name: 'A', bot: true, cls: 'komando' }, { id: 2, name: 'B', bot: true, cls: 'komando' }],
  });
  g.time = MATCH_MS - 1;
  g.checkEnd();
  assert.ok(!g.over, 'erken bitti');
  g.time = MATCH_MS;
  g.checkEnd();
  assert.ok(g.over, 'süre dolduğu halde bitmedi');
  assert.equal(g.endReason, 'time');
});

console.log(failed === 0 ? '\n✅ Tüm testler geçti\n' : `\n❌ ${failed} test başarısız\n`);
process.exit(failed === 0 ? 0 : 1);
