// Görsel testler: yürüyüş animasyonu, adım izi, çimen zemin, bina duvarlar.
//
// Çalıştır:  node test/browser-visuals.mjs      (sunucu gerekmez, çevrimdışı)

import { botlariCikar } from './yardimci.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve('dist/savas-arenasi.html');
if (!fs.existsSync(FILE)) {
  console.error('dist/savas-arenasi.html yok — önce: node scripts/build-single.mjs');
  process.exit(1);
}
const OUT = '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
// Paketlenmiş sürüm açılışta sunucuya "yeni sürüm var mı" diye sorar.
// Testte internet yok; bu isteğin başarısız olması beklenen bir durumdur.
const SURUM_GURULTUSU = /surum\.json|ERR_TUNNEL|ERR_INTERNET|ERR_NAME_NOT_RESOLVED|Failed to load resource/i;

const errors = [];

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`sayfa hatası: ${e.message}`));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (SURUM_GURULTUSU.test(m.text())) return;
  errors.push(`konsol: ${m.text()}`);
});

await page.goto('file://' + FILE);
await page.waitForSelector('#screenMenu.active', { timeout: 10000 });

// Sprite setine oyun içinden ulaşacağız; önce maçı başlat.
await page.fill('#nameInput', 'Animasyon');
await page.dispatchEvent('#nameInput', 'change');
await page.locator('#modePicker .mode-card').nth(0).click();
await page.evaluate(() => {
  const b = document.getElementById('botCountInput');
  b.value = 1; b.dispatchEvent(new Event('input'));   // kural gereği en az bir rakip (maç başlayınca çıkarılıyor)
});
await page.click('#btnCreate');
await page.waitForSelector('#screenLobby.active', { timeout: 6000 });
await page.click('#btnReady');
await page.waitForSelector('#screenGame.active', { timeout: 25000 });
await botlariCikar(page);           // toz sayımı yalnız bize ait olsun
await page.waitForTimeout(1500);

// Karakter kartlarındaki tuvalden faydalanmak yerine doğrudan sprite üreticisini
// çağırıyoruz: lobi kartları zaten aynı fonksiyonu kullanıyor.
const frames = await page.evaluate(() => {
  const probe = window.__sprites;
  if (!probe) return null;
  const s = probe.getCharacterSprites({
    jacket: '#2f3a4a', hair: '#8a6a3f', skin: '#f0c8a0',
    accent: '#e8c15a', eye: '#7fb0d8', style: 'kabarik',
  });
  const sig = (cv) => {
    const c2 = document.createElement('canvas');
    c2.width = cv.width; c2.height = cv.height;
    const cx = c2.getContext('2d');
    cx.drawImage(cv, 0, 0);
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 11) >>> 0;
    return h;
  };
  const out = {};
  for (const dir of ['down', 'up', 'left', 'right']) {
    out[dir] = s[dir].map(sig);
  }
  out.count = s.down.length;
  out.expected = probe.WALK_FRAMES;
  return out;
});

if (!frames) {
  errors.push('sprite modülüne ulaşılamadı (window.__sprites yok)');
} else {
  console.log('yön başına kare sayısı:', frames.count, frames.count === frames.expected ? '✓' : '✗');
  if (frames.count !== frames.expected) errors.push(`${frames.expected} kare bekleniyordu, ${frames.count} bulundu`);
  if (frames.count < 6) errors.push(`akıcılık için en az 6 kare gerekli, ${frames.count} var`);
  for (const dir of ['down', 'up', 'left', 'right']) {
    const uniq = new Set(frames[dir]).size;
    console.log(`  ${dir}: ${uniq}/${frames[dir].length} farklı kare`);
    // Döngüdeki her karenin ayrı bir poz olması gerekiyor; yoksa animasyon
    // takılıyormuş gibi görünür.
    if (uniq < frames.count) errors.push(`${dir} yönünde ${frames.count - uniq} kare tekrar ediyor (${uniq}/${frames.count})`);
  }
}

// Oyuncuyu etrafı açık bir noktaya taşı ve yürüyebileceği bir yön seç.
// Bunu birden çok kez çağırıyoruz: oyuncu yürüdükçe konumu değişiyor ve
// bir sonraki ölçümden önce yine açık bir yön gerekiyor.
// Harita her maçta yeniden üretildiği için körlemesine "sağa yürü" demek
// bazen duvara toslamak demekti; test o yüzden ara sıra düşüyordu.
const acikYon = () => page.evaluate(() => {
  const hub = window.__net.impl.hub;
  const sim = [...hub.lobbies.values()][0].game;
  const me = sim.players.get(window.__net.impl.client.id);
  const R = 18;
  const clear = (x, y, dx, dy, len) => {
    for (let t = 0; t <= len; t += 8) {
      const px = x + dx * t, py = y + dy * t;
      if (px < R || py < R || px > sim.map.w - R || py > sim.map.h - R) return false;
      for (const o of sim.map.obstacles) {
        const cx = Math.max(o.x, Math.min(px, o.x + o.w));
        const cy = Math.max(o.y, Math.min(py, o.y + o.h));
        if ((px - cx) ** 2 + (py - cy) ** 2 < (R + 4) ** 2) return false;
      }
    }
    return true;
  };
  const DIRS = [
    { key: 'd', dx: 1, dy: 0 }, { key: 'a', dx: -1, dy: 0 },
    { key: 's', dx: 0, dy: 1 }, { key: 'w', dx: 0, dy: -1 },
  ];
  for (const d of DIRS) if (clear(me.x, me.y, d.dx, d.dy, 260)) return d.key;
  // Hiçbiri açık değilse haritanın ortasına taşı ve tekrar dene
  me.x = sim.map.w / 2; me.y = sim.map.h / 2;
  for (const d of DIRS) if (clear(me.x, me.y, d.dx, d.dy, 260)) return d.key;
  return 'd';
});
const walkDir = await acikYon();
console.log('yürüme yönü:', walkDir);

// ===== 2) Adım izi (toz) =================================================
{
  const before = await page.evaluate(() => window.__game.fx.parts.length);
  await page.keyboard.down(walkDir);
  await page.waitForTimeout(1400);
  const during = await page.evaluate(() => window.__game.fx.parts.length);
  await page.keyboard.up(walkDir);
  console.log(`toz parçacığı: yürümeden önce ${before}, yürürken ${during}`, during > before ? '✓' : '✗');
  if (during <= before) errors.push('yürürken adım izi (toz) oluşmuyor');

  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => window.__game.fx.parts.length);
  console.log('durunca kalan parçacık:', after, after < during ? '✓ (sönüyor)' : '✗');
  if (after >= during && during > 0) errors.push('toz parçacıkları sönmüyor');
}

// ===== 2b) Geçişler yumuşak mı? =========================================
{
  // Yürüyüş fazı kesirli ilerlemeli (kareden kareye zıplamamalı) ve
  // durup kalkarken gövde salınımı yavaşça sönmeli/açılmalı.
  // ÖNEMLİ: faz yalnızca YÜRÜRKEN ilerler. Dururken sabit kalır ve tam sayıya
  // denk gelirse test haksız yere "geçiş sert" der. O yüzden ölçüm boyunca
  // tuşu basılı tutuyoruz.
  const yon2 = await acikYon();
  await page.keyboard.down(yon2);
  const phases = await page.evaluate(async () => {
    const out = [];
    const g = window.__game;
    for (let i = 0; i < 10; i++) {
      const me = g.playersRender.find((x) => x.id === g.myId);
      out.push(me ? (me.walkPhase || 0) : 0);
      await new Promise((r) => setTimeout(r, 60));
    }
    return out;
  });
  await page.keyboard.up(yon2);
  const ilerledi = phases[phases.length - 1] > phases[0];
  if (!ilerledi) errors.push(`yürürken faz ilerlemedi: ${phases[0]} → ${phases[phases.length - 1]}`);
  const fractional = phases.some((v) => Math.abs(v - Math.round(v)) > 0.05);
  console.log('yürüyüş fazı kesirli:', fractional ? '✓' : '✗', phases.slice(0, 4).map((v) => v.toFixed(2)).join(' '));
  if (!fractional) errors.push('yürüyüş fazı tam sayı adımlarla ilerliyor — geçiş sert');

  // Hareket başlarken salınım sıfırdan yavaşça açılmalı
  await page.waitForTimeout(700);           // önce tamamen dursun
  const gaits = await page.evaluate(async (k) => {
    const g = window.__game;
    const out = [];
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Key' + k.toUpperCase() }));
    for (let i = 0; i < 8; i++) {
      const me = g.playersRender.find((x) => x.id === g.myId);
      out.push(me && me._gait !== undefined ? me._gait : -1);
      await new Promise((r) => requestAnimationFrame(r));
    }
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Key' + k.toUpperCase() }));
    return out;
  }, walkDir);
  const eased = gaits.filter((v) => v > 0.02 && v < 0.98).length;
  console.log('salınım açılırken ara değerler:', eased, gaits.map((v) => v.toFixed(2)).join(' '));
  if (gaits[0] === -1) errors.push('gövde salınımı hiç hesaplanmıyor');
  else if (eased === 0 && gaits.some((v) => v > 0.5)) {
    errors.push('salınım bir anda tam açılıyor — yumuşak geçiş yok');
  }
}

// ===== 2c) Ölünce yerde ceset kalmıyor mu? ==============================
{
  // Eskiden kendi ölü bedenimiz soluk hâlde ekranda kalıyordu; "yerde ceset
  // var" şikâyeti buydu. Ölen hiçbir oyuncu çizilmemeli.
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const hub = window.__net.impl.hub;
    const sim = [...hub.lobbies.values()][0].game;
    const me = sim.players.get(window.__net.impl.client.id);
    // Kendimizi öldür
    me.hp = 0; me.alive = false; me.deadUntil = sim.time + 5000;
    await new Promise((r2) => setTimeout(r2, 600));
    const mine = g.playersRender.find((p) => p.id === g.myId);
    return {
      olduMu: !g.alive,
      cizimListesinde: !!mine && mine.alive,
      olenSayisi: g.playersRender.filter((p) => !p.alive).length,
    };
  });
  console.log('öldükten sonra:', JSON.stringify(r));
  if (!r.olduMu) errors.push('test kurulumu: oyuncu ölmedi');
  if (r.cizimListesinde) errors.push('ölü oyuncu hâlâ canlı gibi çiziliyor');

  // Ekranda gerçekten karakter kalmadığını doğrula: ölü oyuncu çizen kod
  // tamamen atlanmalı.
  const drawn = await page.evaluate(() => {
    const g = window.__game;
    let count = 0;
    const real = g.renderer.drawPlayer.bind(g.renderer);
    g.renderer.drawPlayer = (...a) => { count++; return real(...a); };
    return new Promise((res) => setTimeout(() => {
      const dead = g.playersRender.filter((p) => !p.alive).length;
      res({ drawCalls: count, deadInList: dead });
    }, 400));
  });
  console.log('  çizim çağrısı:', drawn.drawCalls, '· listede ölü:', drawn.deadInList);
  if (drawn.deadInList > 0 && drawn.drawCalls > 0) {
    // Ölü varken hiç çizim olmamalı (tek oyuncu, botsuz maç)
    errors.push('ölü oyuncu için hâlâ çizim yapılıyor');
  }
}

// ===== 3) Zemin çimen mi? ================================================
{
  // Oyuncunun olmadığı bir noktadan piksel örnekle: yeşil baskın olmalı.
  const px = await page.evaluate(() => {
    const cv = document.getElementById('canvas');
    const c2 = document.createElement('canvas');
    c2.width = cv.width; c2.height = cv.height;
    c2.getContext('2d').drawImage(cv, 0, 0);
    const cx = c2.getContext('2d');
    // Ekranın sol üst çeyreğinden 400 örnek al, ortalamasını çıkar
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < 400; i++) {
      const x = 40 + ((i * 37) % 300);
      const y = 200 + ((i * 53) % 300);
      const d = cx.getImageData(x, y, 1, 1).data;
      r += d[0]; g += d[1]; b += d[2]; n++;
    }
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
  });
  console.log('zemin ortalama rengi:', JSON.stringify(px), px.g > px.r && px.g > px.b ? '✓ yeşil' : '✗');
  if (!(px.g > px.r && px.g > px.b)) errors.push(`zemin yeşil değil: ${JSON.stringify(px)}`);
}

// ===== 4) Duvarlar bina gibi mi? =========================================
{
  // Bina çizimi çatı paneli/parapet içerdiği için tek düz renk OLMAMALI.
  const variety = await page.evaluate(() => {
    const g = window.__game;
    const o = g.map.obstacles.find((x) => x.w > 90 && x.h > 90) || g.map.obstacles[0];
    // Binayı ekranda ortalamak yerine, çizim fonksiyonunu ayrı bir tuvale çağır
    const c = document.createElement('canvas');
    c.width = Math.ceil(o.w + 40); c.height = Math.ceil(o.h + 40);
    const cx = c.getContext('2d');
    cx.translate(20 - o.x, 20 - o.y);
    g.renderer.paintObstacles(cx, { obstacles: [o] },
      { x0: o.x - 50, y0: o.y - 50, x1: o.x + o.w + 50, y1: o.y + o.h + 50 },
      g.day || { shadowX: 0.5, shadowY: 0.9, shadowAlpha: 0.4, elev: 0.6 });
    const d = cx.getImageData(0, 0, c.width, c.height).data;
    const tones = new Set();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      tones.add(`${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`);
    }
    return { tones: tones.size, w: Math.round(o.w), h: Math.round(o.h) };
  });
  console.log(`bina (${variety.w}x${variety.h}) farklı ton sayısı:`, variety.tones,
    variety.tones >= 5 ? '✓' : '✗');
  if (variety.tones < 5) errors.push(`duvar hâlâ düz blok görünüyor (${variety.tones} ton)`);
}

await page.screenshot({ path: `${OUT}/visuals.png` });
await browser.close();

if (errors.length) {
  console.log('\nHATALAR:');
  for (const e of errors) console.log(' ', e);
}
console.log(errors.length ? '\nGÖRSEL TESTLER BAŞARISIZ ✗' : '\nGÖRSEL TESTLER GEÇTİ ✓');
process.exit(errors.length ? 1 : 0);
