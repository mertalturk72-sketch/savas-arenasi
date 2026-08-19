// Bombacı: menzil kontrolü, değerler ve öldürme kuru kafası.
//
// Kullanıcının şikâyeti: "bombacıda menzili ayarlayamıyoruz, hep uzağa
// atıyor". Sebebi telefonda ortaya çıkıyordu: nişan çubuğunu tutmak aynı
// zamanda ateş tuşunu basılı tutmak demek, dolayısıyla menzil nişan alırken
// kendiliğinden doluyordu. Artık dokunmatikte menzili SÜRE değil, çubuğun
// ne kadar itildiği belirliyor.
//
// Çalıştır:  node test/browser-bomb.mjs

import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import { WEAPONS } from '../shared/constants.js';

const BASE = process.env.BASE || 'http://localhost:3000';
const errors = [];
const W = WEAPONS.bomba;

// ===== 0) Değerler: menzil/hasar/alan yarıya, hız 1,5 katına =============
console.log('0) Bomba değerleri:', JSON.stringify({
  minRange: W.minRange, maxRange: W.maxRange, speed: W.speed,
  blastR: W.blastR, blastDmg: W.blastDmg, mag: W.mag, reserve: W.reserve,
}));
if (W.reserve !== 15) errors.push(`yedek bomba 15 olmalı, ${W.reserve}`);
if (W.maxRange !== 450) errors.push(`azami menzil 450 olmalı, ${W.maxRange}`);
if (W.minRange !== 95) errors.push(`asgari menzil 95 olmalı, ${W.minRange}`);
if (W.speed !== 840) errors.push(`hız 840 olmalı, ${W.speed}`);
if (W.blastR !== 83) errors.push(`patlama yarıçapı 83 olmalı, ${W.blastR}`);
if (W.blastDmg !== 37) errors.push(`patlama hasarı 37 olmalı, ${W.blastDmg}`);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});

// Bombacı olarak çevrimdışı maça gir (telefon boyutunda, dokunmatik).
async function macaGir(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`sayfa hatası: ${e.message}`));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#screenMenu.active', { timeout: 15000 });
  await page.click('#tabLocal');
  await page.waitForTimeout(400);
  await page.fill('#nameInput', 'Bombaci');
  await page.dispatchEvent('#nameInput', 'change');
  await page.locator('#modePicker .mode-card').nth(0).click();
  await page.evaluate(() => {
    const b = document.getElementById('botCountInput');
    b.value = 0; b.dispatchEvent(new Event('input'));
  });
  await page.click('#btnCreate');
  await page.waitForSelector('#screenLobby.active', { timeout: 8000 });
  // Bombacı sınıfını seç
  const secildi = await page.evaluate(() => {
    const kartlar = [...document.querySelectorAll('#classPicker .class-card')];
    const i = kartlar.findIndex((k) => /bombac/i.test(k.textContent || ''));
    if (i < 0) return false;
    kartlar[i].click();
    return true;
  });
  if (!secildi) errors.push('lobide bombacı sınıfı bulunamadı');
  await page.waitForTimeout(500);
  await page.click('#btnReady');
  await page.waitForSelector('#screenGame.active', { timeout: 25000 });
  await page.waitForTimeout(1200);
  return page;
}

// ===== 1) TELEFON: menzil çubuğun itilme miktarına bağlı =================
{
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 900, height: 420 }, isMobile: true, hasTouch: true });
  const page = await macaGir(ctx);

  const dokunmatik = await page.evaluate(() => !document.getElementById('touchUI').classList.contains('hidden'));
  console.log('1) dokunmatik arayüz:', dokunmatik ? 'açık ✓' : 'kapalı ✗');
  if (!dokunmatik) errors.push('telefon boyutunda dokunmatik arayüz açılmadı');

  // Nişan çubuğunu belirli bir oranda it, bombayı at, nereye düştüğüne bak.
  async function at(oran) {
    const st = await page.locator('#stickAim').boundingBox();
    const cx = st.x + st.width / 2, cy = st.y + st.height / 2;
    const yari = Math.min(st.width, st.height) / 2;
    const bas = await page.evaluate(() => {
      const g = window.__game;
      return { x: g.me.x, y: g.me.y, mermi: g.you ? g.you.am : 0 };
    });
    await page.touchscreen.tap(cx, cy);                    // parmağı koy
    // Çubuğu sağa doğru `oran` kadar it ve NİŞAN ALMAK İÇİN uzun süre tut:
    // eski davranışta bu süre menzili doldururdu.
    await page.evaluate(({ x, y, r }) => {
      const el = document.getElementById('stickAim');
      const t = (tip, cx2, cy2) => el.dispatchEvent(new TouchEvent(tip, {
        bubbles: true, cancelable: true,
        touches: tip === 'touchend' ? [] : [new Touch({ identifier: 1, target: el, clientX: cx2, clientY: cy2 })],
        changedTouches: [new Touch({ identifier: 1, target: el, clientX: cx2, clientY: cy2 })],
      }));
      t('touchstart', x, y);
      t('touchmove', x + r, y);
      window.__bombaBirak = () => t('touchend', x + r, y);
    }, { x: cx, y: cy, r: yari * oran });

    await page.waitForTimeout(1600);        // bilerek UZUN nişan alma süresi
    const guc = await page.evaluate(() => Math.round((window.__game.charge || 0) * 100));
    await page.evaluate(() => window.__bombaBirak());

    // Bomba havadayken uçuş mesafesini ölç
    let enUzak = 0;
    for (let i = 0; i < 60; i++) {
      const d = await page.evaluate((b) => {
        const g = window.__game;
        const hub = window.__net.impl.hub;
        const sim = [...hub.lobbies.values()][0].game;
        let mx = 0;
        for (const bl of sim.bullets) {
          const dd = Math.hypot(bl.x - b.x, bl.y - b.y);
          if (dd > mx) mx = dd;
        }
        return mx;
      }, bas);
      if (d > enUzak) enUzak = d;
      if (d === 0 && enUzak > 0) break;
      await page.waitForTimeout(40);
    }
    return { guc, mesafe: Math.round(enUzak) };
  }

  const az = await at(0.35);
  await page.waitForTimeout(900);
  const cok = await at(1.0);

  console.log(`   az itince: güç %${az.guc} · uçuş ${az.mesafe} px`);
  console.log(`   tam itince: güç %${cok.guc} · uçuş ${cok.mesafe} px`);

  if (!(cok.guc > az.guc + 25)) {
    errors.push(`çubuğu itme miktarı menzili değiştirmiyor (%${az.guc} → %${cok.guc})`);
  }
  if (az.guc > 55) {
    errors.push(`az itilmiş çubukta menzil çok dolu (%${az.guc}) — uzun nişan alma süresi hâlâ menzili dolduruyor`);
  }
  if (!(cok.mesafe > az.mesafe + 40)) {
    errors.push(`bomba her iki durumda da aynı yere gidiyor (${az.mesafe} / ${cok.mesafe} px)`);
  }
  if (cok.mesafe > W.maxRange + 90) {
    errors.push(`bomba azami menzili aştı: ${cok.mesafe} px (sınır ${W.maxRange})`);
  }
  await page.screenshot({ path: '/tmp/shots/bomba-mobil.png' });
  await ctx.close();
}

// ===== 2) Öldürünce kuru kafa (ölünce DEĞİL) ============================
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const page = await macaGir(ctx);

  const bas = await page.evaluate(() => ({
    varMi: !!document.getElementById('killSkull'),
    gorunur: document.getElementById('killSkull')?.classList.contains('show'),
    olumEkraninda: /rm-skull/.test(document.getElementById('respawnMsg')?.innerHTML || ''),
  }));
  console.log('2) başlangıçta kuru kafa görünür mü:', bas.gorunur, '· eleman var mı:', bas.varMi);
  if (!bas.varMi) errors.push('killSkull elemanı yok');
  if (bas.gorunur) errors.push('maç başında kuru kafa görünüyor');

  // Ölünce ÇIKMAMALI
  await page.evaluate(() => {
    const hub = window.__net.impl.hub;
    const sim = [...hub.lobbies.values()][0].game;
    const me = sim.players.get(window.__net.impl.client.id);
    sim.damage(me, 9999, null, 'zone', 'zone');
  });
  await page.waitForTimeout(900);
  const olunce = await page.evaluate(() => ({
    olduMu: !window.__game.alive,
    kafatasi: document.getElementById('killSkull').classList.contains('show'),
    olumEkrani: !document.getElementById('respawnMsg').classList.contains('hidden'),
  }));
  console.log('   ölünce:', JSON.stringify(olunce));
  if (!olunce.olduMu) errors.push('test kurulumu: oyuncu ölmedi');
  if (olunce.kafatasi) errors.push('ÖLÜNCE kuru kafa çıkıyor — sadece öldürünce çıkmalı');
  if (!olunce.olumEkrani) errors.push('ölüm ekranı açılmadı');

  // Öldürünce ÇIKMALI
  await page.evaluate(() => {
    const g = window.__game;
    g.handleEvents([{ e: 'kill', k: g.myId, kn: 'Ben', kt: 0, v: 999, vn: 'Kurban', vt: 0, w: 'bomba', x: 0, y: 0 }]);
  });
  await page.waitForTimeout(250);
  const oldurunce = await page.evaluate(() => {
    const el = document.getElementById('killSkull');
    const st = getComputedStyle(el);
    return {
      gorunur: el.classList.contains('show'),
      opak: Number(st.opacity),
      beyazKare: [...el.querySelectorAll('rect')].filter((r) => (r.getAttribute('fill') || '').toLowerCase() === '#ffffff').length,
      konturKare: [...el.querySelectorAll('rect')].filter((r) => (r.getAttribute('fill') || '').toLowerCase() === '#1a1a1e').length,
      kare: el.querySelectorAll('rect').length,
      keskin: el.querySelector('svg')?.getAttribute('shape-rendering'),
    };
  });
  console.log('   öldürünce:', JSON.stringify(oldurunce));
  if (!oldurunce.gorunur) errors.push('ÖLDÜRÜNCE kuru kafa çıkmadı');
  if (!(oldurunce.opak > 0.3)) errors.push(`kuru kafa görünmüyor (opaklık ${oldurunce.opak})`);
  if (!(oldurunce.beyazKare > 15)) errors.push(`kuru kafa beyaz değil (${oldurunce.beyazKare} beyaz kare)`);
  if (!(oldurunce.konturKare > 15)) errors.push(`kuru kafanın konturu yok (${oldurunce.konturKare} kare)`);
  if (!(oldurunce.kare > 10)) errors.push(`kuru kafa piksel piksel değil (${oldurunce.kare} kare)`);
  if (oldurunce.keskin !== 'crispEdges') errors.push('kuru kafa keskin kenarlı çizilmiyor');

  await page.screenshot({ path: '/tmp/shots/bomba-kurukafa.png' });

  // Bir süre sonra kendiliğinden kaybolmalı
  await page.waitForTimeout(1900);
  const sonra = await page.evaluate(() => document.getElementById('killSkull').classList.contains('show'));
  console.log('   1,9 sn sonra hâlâ duruyor mu:', sonra);
  if (sonra) errors.push('kuru kafa ekranda kalıcı oldu');
  await ctx.close();
}

await browser.close();

if (errors.length) {
  console.log('\nHATALAR:');
  for (const e of errors) console.log(' ', e);
}
console.log(errors.length ? '\nBOMBA TESTİ BAŞARISIZ ✗' : '\nBOMBA TESTİ GEÇTİ ✓');
process.exit(errors.length ? 1 : 0);
