// Gün döngüsü ve gölgeler GERÇEKTEN kaldırıldı mı?
//
// Eskiden her maç günün rastgele bir saatinde geçiyordu: sahneye çarpma ile
// renk bindiriliyor, binalar ve karakterler güneşin tersine gölge düşürüyordu.
// İstenmediği için tamamı çıkarıldı. Bu test kaldırmanın eksiksiz olduğunu
// doğruluyor — yarım kalmış bir kaldırma "bazı maçlar hâlâ karanlık başlıyor"
// diye geri gelir.
//
// Çalıştır:  node test/browser-nodaynight.mjs

import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3000';
const errors = [];

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});

async function macOyna(ctx, etiket) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${etiket}] sayfa hatası: ${e.message}`));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#screenMenu.active', { timeout: 15000 });
  await page.click('#tabLocal');
  await page.waitForTimeout(400);
  await page.fill('#nameInput', 'Isik');
  await page.dispatchEvent('#nameInput', 'change');
  await page.locator('#modePicker .mode-card').nth(0).click();
  await page.evaluate(() => {
    const b = document.getElementById('botCountInput');
    b.value = 2; b.dispatchEvent(new Event('input'));
  });
  await page.click('#btnCreate');
  await page.waitForSelector('#screenLobby.active', { timeout: 8000 });
  await page.click('#btnReady');
  await page.waitForSelector('#screenGame.active', { timeout: 25000 });
  await page.waitForTimeout(2500);
  return page;
}

// Ekranın ortalama parlaklığı: aydınlık/karanlık farkını ölçmenin en doğrudan
// yolu. Kenar bölgeden alıyoruz ki HUD ve karakter etkilemesin.
async function parlaklik(page) {
  return page.evaluate(() => {
    const c = document.getElementById('canvas');
    const g = c.getContext('2d', { willReadFrequently: true });
    const d = g.getImageData(0, Math.round(c.height * 0.25), Math.round(c.width * 0.22), Math.round(c.height * 0.5)).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return s / (d.length / 4);
  });
}

// ===== 1) Kod tarafı: gün döngüsü kalıntısı kalmamalı ====================
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const page = await macOyna(ctx, 'kod');
  const k = await page.evaluate(() => ({
    daylight: typeof window.__render?.daylight,
    matchHour: typeof window.__render?.matchHour,
    startHour: window.__game?.startHour,
    day: window.__game?.day,
    rendererDay: window.__game?.renderer?.day,
  }));
  console.log('1) kalıntı:', JSON.stringify(k));
  if (k.daylight !== 'undefined') errors.push('daylight() hâlâ dışa aktarılıyor');
  if (k.matchHour !== 'undefined') errors.push('matchHour() hâlâ dışa aktarılıyor');
  if (k.startHour !== undefined) errors.push('istemcide startHour hâlâ var');
  if (k.day !== undefined) errors.push('istemcide day nesnesi hâlâ var');
  if (k.rendererDay !== undefined) errors.push('renderer.day hâlâ var');
  await ctx.close();
}

// ===== 2) Her maç aynı aydınlıkta başlamalı ==============================
// Eskiden başlangıç saati rastgeleydi; biri kapkaranlık, biri gündüz
// başlıyordu. Beş maç açıp parlaklıkları karşılaştırıyoruz.
{
  const olculen = [];
  for (let i = 0; i < 4; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
    const page = await macOyna(ctx, `mac${i}`);
    olculen.push(Math.round(await parlaklik(page) * 10) / 10);
    await ctx.close();
  }
  const enAz = Math.min(...olculen), enCok = Math.max(...olculen);
  console.log('2) maç parlaklıkları:', olculen.join(' · '));
  console.log(`   en az ${enAz} · en çok ${enCok} · fark ${(enCok - enAz).toFixed(1)}`);
  // Harita her maç farklı üretildiği için küçük bir fark normal; gün döngüsü
  // varken fark kat kat oluyordu (gece ~19, öğlen ~39).
  if (enCok - enAz > 12) {
    errors.push(`maçlar arası parlaklık farkı çok büyük (${enAz} → ${enCok}) — gün döngüsü hâlâ etkili`);
  }
  if (enAz < 25) errors.push(`sahne çok karanlık (${enAz}) — renk bindirmesi hâlâ var`);
}

// ===== 3) Karakterin yönlü gölgesi olmamalı ==============================
//
// Zemin dokusunda rastgele lekeler var; tek bir maçta oyuncunun bir yanı
// diğerinden koyu çıkabiliyor ve bu "gölge var" gibi görünüyordu. Ayırt edici
// nokta şu: YÖNLÜ GÖLGE TUTARLIDIR — hep aynı tarafa düşer. Zemin lekesi ise
// maçtan maça yön değiştirir. O yüzden üç maç ölçüp işaretin tutarlı olup
// olmadığına bakıyoruz.
{
  const farklar = [];
  for (let i = 0; i < 5; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
    const page = await macOyna(ctx, `golge${i}`);
    const g = await page.evaluate(() => {
      const oyun = window.__game;
      const r = oyun.renderer;
      const c = document.getElementById('canvas');
      const x = c.getContext('2d', { willReadFrequently: true });
      const me = oyun.meRender;

      // Kamera harita kenarında SABİTLENİR, yani oyuncu her zaman ekranın
      // ortasında olmaz. Ekran kenarlarında vinyet (köşe karartması) var;
      // oyuncu ortada değilse bir taraftaki örnekler kenara daha yakın düşüp
      // sistematik olarak koyu çıkıyor ve gölge sanılıyordu. Oyuncu ortada
      // değilse bu maçı ölçmüyoruz.
      const sm = r.worldToScreen(me.x, me.y);
      const ortadaMi = Math.abs(sm.x - r.w / 2) < r.w * 0.08 && Math.abs(sm.y - r.h / 2) < r.h * 0.08;
      if (!ortadaMi) return { sol: [], sag: [], ortada: false };

      const kapali = (wx, wy) => {
        for (const o of oyun.map.obstacles) {
          if (wx > o.x - 30 && wx < o.x + o.w + 30 && wy > o.y - 30 && wy < o.y + o.h + 30) return true;
        }
        for (const b of (oyun.map.bushes || [])) {
          if (Math.hypot(wx - b.x, wy - b.y) < b.r + 24) return true;
        }
        // Başka oyuncular da zemini kapatır
        for (const p of oyun.playersRender || []) {
          if (p.id !== oyun.myId && Math.hypot(wx - p.x, wy - p.y) < 70) return true;
        }
        return wx < 40 || wy < 40 || wx > oyun.map.w - 40 || wy > oyun.map.h - 40;
      };

      const orneksle = (dx) => {
        const d2 = [];
        for (const uz of [60, 90, 120, 150]) {
          const wx = me.x + dx * uz, wy = me.y + 26;
          if (kapali(wx, wy)) continue;
          const sc = r.worldToScreen(wx, wy);
          const px = Math.round(sc.x * r.dpr), py = Math.round(sc.y * r.dpr);
          if (px < 2 || py < 2 || px > c.width - 2 || py > c.height - 2) continue;
          const d = x.getImageData(px, py, 1, 1).data;
          d2.push((d[0] + d[1] + d[2]) / 3);
        }
        return d2;
      };

      return { sol: orneksle(-1), sag: orneksle(1), ortada: true };
    });
    await ctx.close();

    if (!g.ortada) { console.log(`   maç ${i}: oyuncu ekranın ortasında değil, atlandı`); continue; }
    if (g.sol.length < 2 || g.sag.length < 2) { console.log(`   maç ${i}: yeterli açık zemin yok, atlandı`); continue; }
    const ort = (a) => a.reduce((t, v) => t + v, 0) / a.length;
    const f = ort(g.sol) - ort(g.sag);
    farklar.push(f);
    console.log(`   maç ${i}: sol ${ort(g.sol).toFixed(1)} · sağ ${ort(g.sag).toFixed(1)} · fark ${f.toFixed(1)}`);
  }

  console.log('3) sol-sağ farkları:', farklar.map((f) => f.toFixed(1)).join(' · '));
  if (farklar.length < 2) {
    console.log('   (yeterli ölçüm alınamadı — bu kontrol atlandı)');
  } else {
    const hepsiAyniYon = farklar.every((f) => f > 0) || farklar.every((f) => f < 0);
    const ortalama = Math.abs(farklar.reduce((t, v) => t + v, 0) / farklar.length);
    console.log(`   hepsi aynı yönde mi: ${hepsiAyniYon} · ortalama |fark| ${ortalama.toFixed(1)}`);
    if (hepsiAyniYon && ortalama > 18) {
      errors.push(`gölge tutarlı biçimde bir tarafa düşüyor (ortalama ${ortalama.toFixed(1)}) — yönlü gölge duruyor`);
    }
  }
}

await browser.close();

if (errors.length) {
  console.log('\nHATALAR:');
  for (const e of errors) console.log(' ', e);
}
console.log(errors.length ? '\nGÜN DÖNGÜSÜ KALDIRMA TESTİ BAŞARISIZ ✗' : '\nGÜN DÖNGÜSÜ KALDIRMA TESTİ GEÇTİ ✓');
process.exit(errors.length ? 1 : 0);
