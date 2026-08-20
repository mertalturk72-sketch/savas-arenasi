// Lobi kuralları, geri sayım ve maç sonu yazıları.
//
// Kapsanan istekler:
//   • Bot zorluğu lobi KURMA formundan kalktı, sadece lobinin içinde.
//   • Lobi açılır açılmaz 7 bot geliyordu → 0.
//   • Bot sayısı 0 iken zorluk menüsü gri ve tıklanamaz.
//   • Maça TEK BAŞINA girilemiyor; ekranın ortasında kırmızı uyarı çıkıyor.
//   • Geri sayımda "BAŞLA!" bir göz kırpması kadar duruyordu → tam 1 saniye,
//     ve alttaki "MAÇ BAŞLIYOR" yazısının üstüne binmiyor.
//   • Kaybedene kırmızı "KAYBETTİN" — KAZANDIN ile aynı punto, aynı süre,
//     skor tablosundan ÖNCE ve üstüne binmeden.
//   • Bütün sınıfların canı 100.
//
// Çalıştır:  node test/browser-lobikural.mjs

import { chromium } from 'playwright';
import fs from 'node:fs';
import { CLASSES, COUNTDOWN_MS, COUNTDOWN_GO_MS, MIN_FIGHTERS } from '../shared/constants.js';

const BASE = process.env.BASE || 'http://localhost:3000';
const errors = [];

// ===== 0) Sabitler ========================================================
console.log('0) can değerleri:', Object.values(CLASSES).map((c) => `${c.name}=${c.hp}`).join(' · '));
for (const c of Object.values(CLASSES)) {
  if (c.hp !== 100) errors.push(`${c.name} canı 100 olmalı, ${c.hp}`);
}
if (MIN_FIGHTERS < 2) errors.push(`MIN_FIGHTERS en az 2 olmalı, ${MIN_FIGHTERS}`);
if (COUNTDOWN_GO_MS !== 1000) errors.push(`BAŞLA! süresi 1000 ms olmalı, ${COUNTDOWN_GO_MS}`);
if (COUNTDOWN_MS - COUNTDOWN_GO_MS !== 5000) {
  errors.push(`sayılan kısım 5 sn olmalı, ${(COUNTDOWN_MS - COUNTDOWN_GO_MS) / 1000}`);
}

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`sayfa hatası: ${e.message}`));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#screenMenu.active', { timeout: 15000 });
await page.click('#tabLocal');
await page.waitForTimeout(400);
await page.fill('#nameInput', 'Kural');
await page.dispatchEvent('#nameInput', 'change');

// ===== 1) Lobi kurma formu ===============================================
const form = await page.evaluate(() => ({
  botDegeri: document.getElementById('botCountInput')?.value,
  botYazi: document.getElementById('botCountVal')?.textContent,
  zorlukVar: !!document.getElementById('botLevelPicker'),
}));
console.log('1) kurma formu:', JSON.stringify(form));
if (form.botDegeri !== '0') errors.push(`kurma formunda bot varsayılanı 0 olmalı, ${form.botDegeri}`);
if (form.botYazi !== '0') errors.push(`bot sayacı 0 yazmalı, ${form.botYazi}`);
if (form.zorlukVar) errors.push('bot zorluğu kurma formundan kaldırılmalıydı');

await page.locator('#modePicker .mode-card').nth(0).click();
await page.click('#btnCreate');
await page.waitForSelector('#screenLobby.active', { timeout: 8000 });
await page.waitForTimeout(400);

// ===== 2) Lobi: bot 0, zorluk menüsü gri =================================
const lobi0 = await page.evaluate(() => {
  const p = document.getElementById('lobbyLevelPicker');
  const sec = p.querySelector('.level-btn.sel');
  const st = sec ? getComputedStyle(sec.querySelector('.lv-name')) : null;
  return {
    bot: document.getElementById('lobbyBotInput').value,
    zorlukVar: !!p,
    gri: p.classList.contains('disabled'),
    tiklanabilir: p ? getComputedStyle(p).pointerEvents !== 'none' : true,
    seciliRenk: st ? st.color : null,
  };
});
console.log('2) bot 0 iken lobi:', JSON.stringify(lobi0));
if (lobi0.bot !== '0') errors.push(`lobide bot 0 olmalı, ${lobi0.bot}`);
if (!lobi0.zorlukVar) errors.push('bot zorluğu lobide olmalı');
if (!lobi0.gri) errors.push('bot 0 iken zorluk menüsü gri olmalı');
if (lobi0.tiklanabilir) errors.push('bot 0 iken zorluk menüsü tıklanabilir kalmış');

// ===== 3) Tek başına maç: engel + ekran ortası uyarı =====================
await page.click('#btnReady');
await page.waitForTimeout(500);
const uyari = await page.evaluate(() => {
  const el = document.getElementById('centerWarn');
  const kutu = el?.querySelector('.cw-box');
  const r = kutu ? kutu.getBoundingClientRect() : null;
  return {
    gorunur: el ? !el.classList.contains('hidden') : false,
    metin: document.getElementById('centerWarnText')?.textContent || '',
    // "ekranın ortası" iddiasını gerçekten ölçüyoruz
    yatayOrta: r ? Math.abs((r.left + r.right) / 2 - window.innerWidth / 2) < 8 : false,
    dikeyOrta: r ? Math.abs((r.top + r.bottom) / 2 - window.innerHeight / 2) < 8 : false,
    geriSayim: !document.getElementById('countdownOverlay').classList.contains('hidden'),
    hazirYazi: document.getElementById('btnReady')?.textContent?.trim(),
  };
});
console.log('3) tek başına HAZIRIM:', JSON.stringify(uyari));
if (!uyari.gorunur) errors.push('tek başına başlatmada ekran ortası uyarısı çıkmadı');
if (!/tek başına/i.test(uyari.metin)) errors.push(`uyarı metni beklenmedik: "${uyari.metin}"`);
if (!uyari.yatayOrta || !uyari.dikeyOrta) errors.push('uyarı ekranın ortasında değil');
if (uyari.geriSayim) errors.push('tek başına olmasına rağmen geri sayım başladı');

// 6 saniye sonra hâlâ lobide olmalıyız (sessizce maç başlamamalı)
await page.waitForTimeout(6000);
const hala = await page.evaluate(() => ({
  lobide: document.getElementById('screenLobby').classList.contains('active'),
  macta: document.getElementById('screenGame').classList.contains('active'),
}));
console.log('   6 sn sonra:', JSON.stringify(hala));
if (!hala.lobide || hala.macta) errors.push('tek başına maç yine de başladı');

// ===== 4) Bot ekle → zorluk menüsü açılır, maç başlar ====================
await page.evaluate(() => {
  const b = document.getElementById('lobbyBotInput');
  b.value = 1; b.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(700);
const lobi1 = await page.evaluate(() => {
  const p = document.getElementById('lobbyLevelPicker');
  return {
    bot: document.getElementById('lobbyBotVal').textContent,
    gri: p.classList.contains('disabled'),
    engel: window.__state?.lobby ? window.__state.lobby.startBlock : 'lobi yok',
  };
});
console.log('4) bot 1 iken:', JSON.stringify(lobi1));
if (lobi1.bot !== '1') errors.push(`bot sayacı 1 olmalı, ${lobi1.bot}`);
if (lobi1.gri) errors.push('bot varken zorluk menüsü hâlâ gri');
if (lobi1.engel !== null) errors.push(`bot varken engel kalkmalıydı: ${lobi1.engel}`);

// ===== 5) Geri sayım: 5..1 sonra tam 1 sn "BAŞLA!" =======================
await page.click('#btnReady');
await page.waitForSelector('#countdownOverlay:not(.hidden)', { timeout: 6000 });

const gorulen = [];
let basSure = null;
{
  const t0 = Date.now();
  let basBas = 0;
  while (Date.now() - t0 < 12000) {
    const d = await page.evaluate(() => {
      const num = document.getElementById('countdownNum');
      const lbl = document.querySelector('.countdown-overlay .cd-label');
      const a = num.getBoundingClientRect(), b = lbl.getBoundingClientRect();
      return {
        yazi: num.textContent,
        kelime: num.classList.contains('word'),
        gizli: document.getElementById('countdownOverlay').classList.contains('hidden'),
        macta: document.getElementById('screenGame').classList.contains('active'),
        // "üstüne biniyor" şikâyeti: YERLEŞİM kutuları kesişiyor mu?
        // offsetTop/offsetHeight dönüşümlerden (pop animasyonundaki geçici
        // büyüme) etkilenmez — ölçmek istediğimiz kalıcı çakışma.
        binme: (num.offsetTop + num.offsetHeight) - lbl.offsetTop,
        // Vuruş (pop) animasyonu sırasındaki GERÇEK çakışma. Şikâyetin kökü
        // buydu: yazı bir anlığına büyüyüp alttaki satırı örtüyordu.
        cizimBinme: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
        tasma: num.scrollWidth - document.getElementById('countdownOverlay').clientWidth,
      };
    });
    if (d.gizli || d.macta) break;
    const son = gorulen[gorulen.length - 1];
    if (!son || son.yazi !== d.yazi) gorulen.push({ ...d, t: Date.now() });
    if (d.yazi === 'BAŞLA!') {
      if (!basBas) basBas = Date.now();
      if (d.binme > 0) errors.push(`BAŞLA! alttaki yazıyla ${Math.round(d.binme)} px çakışıyor`);
      if (d.cizimBinme > 1) errors.push(`BAŞLA! vuruş sırasında alttaki yazıyı ${Math.round(d.cizimBinme)} px örtüyor`);
      if (d.tasma > 0) errors.push(`BAŞLA! ekrandan ${Math.round(d.tasma)} px taşıyor`);
      if (!d.kelime) errors.push('BAŞLA! kelime kipine geçmemiş (rakam puntosu)');
    }
    await page.waitForTimeout(60);
  }
  if (basBas) basSure = Date.now() - basBas;
}
console.log('5) geri sayım:', gorulen.map((g) => g.yazi).join(' → '));
console.log('   BAŞLA! ekranda kalma süresi:', basSure, 'ms');
const sayilar = gorulen.map((g) => g.yazi);
if (!['5', '4', '3', '2', '1'].every((n) => sayilar.includes(n))) {
  errors.push(`geri sayım 5..1 saymadı: ${sayilar.join(',')}`);
}
if (!sayilar.includes('BAŞLA!')) errors.push('BAŞLA! hiç görünmedi');
// Ölçüm yoklamayla yapıldığı için pay bırakıyoruz; asıl mesele "göz kırpması
// kadar" olmaması.
if (basSure === null || basSure < 700) errors.push(`BAŞLA! çok kısa durdu: ${basSure} ms`);
if (basSure > 1600) errors.push(`BAŞLA! çok uzun durdu: ${basSure} ms`);

await page.waitForSelector('#screenGame.active', { timeout: 15000 });
await page.waitForTimeout(1200);
console.log('   maç başladı ✓');

// ===== 5b) Telefon eninde de sığmalı =====================================
// Asıl şikâyet telefondan geldi: rakam puntosu (22vw) kelimeyi ekrandan
// taşırıyor, satır yüksekliği 1 olduğu için Ş'nin çengeli alttaki yazıya
// biniyordu. Gerçek bir telefon eninde (380 px) ölçüyoruz.
{
  const kctx = await browser.newContext({ viewport: { width: 380, height: 780 }, isMobile: true, hasTouch: true });
  const kpage = await kctx.newPage();
  kpage.on('pageerror', (e) => errors.push(`[dar] sayfa hatası: ${e.message}`));
  await kpage.goto(BASE, { waitUntil: 'domcontentloaded' });
  await kpage.waitForSelector('#screenMenu.active', { timeout: 15000 });
  await kpage.click('#tabLocal');
  await kpage.waitForTimeout(400);
  await kpage.fill('#nameInput', 'Dar');
  await kpage.dispatchEvent('#nameInput', 'change');
  await kpage.locator('#modePicker .mode-card').nth(0).click();
  await kpage.click('#btnCreate');
  await kpage.waitForSelector('#screenLobby.active', { timeout: 8000 });

  const olc = (yazi, kelime) => kpage.evaluate(({ y, k }) => {
    const ov = document.getElementById('countdownOverlay');
    const num = document.getElementById('countdownNum');
    const lbl = document.querySelector('.countdown-overlay .cd-label');
    ov.classList.remove('hidden');
    num.textContent = y;
    num.classList.toggle('word', k);
    num.classList.remove('pop');
    void num.offsetWidth;
    const d = {
      binme: (num.offsetTop + num.offsetHeight) - lbl.offsetTop,
      tasma: num.scrollWidth - ov.clientWidth,
      punto: getComputedStyle(num).fontSize,
      satir: getComputedStyle(num).lineHeight,
    };
    ov.classList.add('hidden');
    return d;
  }, { y: yazi, k: kelime });

  const dar = await olc('BAŞLA!', true);
  const rakam = await olc('5', false);
  console.log('5b) 380 px ende BAŞLA!:', JSON.stringify(dar));
  console.log('    aynı ende rakam  :', JSON.stringify(rakam));
  if (dar.binme > 0) errors.push(`telefonda BAŞLA! alttaki yazıyla ${Math.round(dar.binme)} px çakışıyor`);
  if (dar.tasma > 0) errors.push(`telefonda BAŞLA! ekrandan ${Math.round(dar.tasma)} px taşıyor`);
  if (rakam.binme > 0) errors.push(`telefonda rakam alttaki yazıyla ${Math.round(rakam.binme)} px çakışıyor`);
  await kctx.close();
}

// ===== 6) KAYBETTİN =======================================================
// Puntonun KAZANDIN ile aynı olduğunu ölçüyoruz: iki yazı da aynı sınıftan
// besleniyor, ölçüm bunu doğruluyor.
const punto = await page.evaluate(() => {
  const oku = (id) => {
    const el = document.getElementById(id);
    const gizliydi = el.classList.contains('hidden');
    el.classList.remove('hidden');
    const t = el.querySelector('.win-text');
    const s = getComputedStyle(t);
    const d = { boyut: s.fontSize, kalinlik: s.fontWeight, aile: s.fontFamily, renk: s.color };
    if (gizliydi) el.classList.add('hidden');
    return d;
  };
  return { kazan: oku('winOverlay'), kaybet: oku('loseOverlay') };
});
console.log('6) punto:', JSON.stringify(punto));
if (punto.kazan.boyut !== punto.kaybet.boyut) errors.push(`punto farklı: ${punto.kazan.boyut} / ${punto.kaybet.boyut}`);
if (punto.kazan.kalinlik !== punto.kaybet.kalinlik) errors.push('yazı kalınlığı farklı');
if (punto.kazan.aile !== punto.kaybet.aile) errors.push('yazı tipi farklı');
if (!/^rgb\(255, 9[0-9], 8[0-9]\)$/.test(punto.kaybet.renk)) {
  // kırmızıya yakın olmalı: R belirgin şekilde en büyük bileşen
  const m = punto.kaybet.renk.match(/\d+/g).map(Number);
  if (!(m[0] > 200 && m[0] - m[1] > 80 && m[0] - m[2] > 80)) {
    errors.push(`KAYBETTİN kırmızı değil: ${punto.kaybet.renk}`);
  }
}

// Maçı kaybettir: botun skorunu tavana çek, sunucu maçı bitirsin.
const bitti = await page.evaluate(() => {
  const lobi = [...window.__net.impl.hub.lobbies.values()][0];
  const sim = lobi.game;
  const bot = [...sim.players.values()].find((p) => p.bot);
  if (!bot) return false;
  bot.kills = sim.mode.scoreLimit;
  sim.checkEnd();
  return true;
});
if (!bitti) errors.push('maçı bitirmek için bot bulunamadı');

await page.waitForTimeout(400);
const once = await page.evaluate(() => {
  const el = document.getElementById('loseOverlay');
  const t = el.querySelector('.win-text');
  const r = t.getBoundingClientRect();
  return {
    kaybettinGorunur: !el.classList.contains('hidden'),
    metin: t.textContent,
    tabloGorunur: !document.getElementById('matchEndOverlay').classList.contains('hidden'),
    ortada: Math.abs((r.top + r.bottom) / 2 - window.innerHeight / 2) < 40,
  };
});
console.log('   maç biter bitmez:', JSON.stringify(once));
if (!once.kaybettinGorunur) errors.push('KAYBETTİN görünmedi');
if (once.metin !== 'KAYBETTİN') errors.push(`yazı yanlış: ${once.metin}`);
if (once.tabloGorunur) errors.push('skor tablosu KAYBETTİN ile aynı anda açıldı (üst üste biner)');
if (!once.ortada) errors.push('KAYBETTİN ekranın ortasında değil');

await page.waitForTimeout(2200);
const sonra = await page.evaluate(() => ({
  kaybettinGorunur: !document.getElementById('loseOverlay').classList.contains('hidden'),
  tabloGorunur: !document.getElementById('matchEndOverlay').classList.contains('hidden'),
}));
console.log('   2,6 sn sonra:', JSON.stringify(sonra));
if (sonra.kaybettinGorunur) errors.push('KAYBETTİN kapanmadı (KAZANDIN ile aynı sürede kapanmalı)');
if (!sonra.tabloGorunur) errors.push('skor tablosu açılmadı');

await ctx.close();
await browser.close();

console.log('\n--- Hatalar ---');
if (errors.length) {
  for (const e of errors) console.log('  ✗', e);
  console.log('\nLOBİ KURALI TESTİ BAŞARISIZ ✗');
  process.exit(1);
}
console.log('yok ✓');
console.log('\nLOBİ KURALI TESTİ GEÇTİ ✓');
