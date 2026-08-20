// Asist sayacı, sohbetin gizlenmesi ve geri sayım İPTAL düğmesi.
//
// Asist kuralı: bir oyuncuya son ASSIST_WINDOW_MS içinde hasar veren herkes —
// öldüren ve kurbanın kendisi hariç — o ölünce bir asist alır. Süre sınırı
// önemli: maçın başında bir kez değdirdiğin biri dakikalar sonra ölünce asist
// yazılmamalı.
//
// Çalıştır:  node test/browser-assist.mjs

import { botAyarla, modSec } from './yardimci.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs';
import { ASSIST_WINDOW_MS } from '../shared/constants.js';

const BASE = process.env.BASE || 'http://localhost:3000';
const errors = [];

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1200, height: 760 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`sayfa hatası: ${e.message}`));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#screenMenu.active', { timeout: 15000 });
await page.click('#tabLocal');
await page.waitForTimeout(400);
await page.fill('#nameInput', 'Asist');
await page.dispatchEvent('#nameInput', 'change');
await page.click('#btnCreate');
await page.waitForSelector('#screenLobby.active', { timeout: 8000 });
await modSec(page, 0);
await botAyarla(page, 3);

// ===== 1) Geri sayımda İPTAL düğmesi =====================================
await page.click('#btnReady');
await page.waitForSelector('#countdownOverlay:not(.hidden)', { timeout: 6000 });
const cd = await page.evaluate(() => {
  const b = document.getElementById('btnCancelStart');
  const st = b ? getComputedStyle(b) : null;
  return {
    var: !!b,
    yazi: b ? b.textContent.trim() : '',
    gorunur: !!(b && b.offsetParent !== null),
    kirmizi: st ? st.backgroundImage + st.backgroundColor : '',
    sayi: (document.getElementById('countdownNum').textContent || '').trim(),
  };
});
console.log('1) geri sayım:', JSON.stringify(cd));
if (!cd.var) errors.push('İPTAL düğmesi yok');
if (cd.yazi !== 'İPTAL') errors.push(`düğme yazısı "İPTAL" olmalı: "${cd.yazi}"`);
if (!cd.gorunur) errors.push('İPTAL düğmesi görünmüyor');
if (!/rgb\(232,\s*68,\s*60\)|#e8443c/i.test(cd.kirmizi)) {
  errors.push(`İPTAL düğmesi kırmızı değil: ${cd.kirmizi}`);
}

await page.click('#btnCancelStart');
await page.waitForTimeout(900);
const iptalSonrasi = await page.evaluate(() => ({
  geriSayim: !document.getElementById('countdownOverlay').classList.contains('hidden'),
  lobide: document.getElementById('screenLobby').classList.contains('active'),
  macta: document.getElementById('screenGame').classList.contains('active'),
  hazir: (document.getElementById('btnReady').textContent || '').trim(),
}));
console.log('   iptal sonrası:', JSON.stringify(iptalSonrasi));
if (iptalSonrasi.geriSayim) errors.push('iptal edildiği hâlde geri sayım sürüyor');
if (iptalSonrasi.macta) errors.push('iptal edildiği hâlde maç başladı');
if (!iptalSonrasi.lobide) errors.push('iptal sonrası lobide kalınmadı');

// Maç gerçekten başlamamalı: 7 saniye bekle
await page.waitForTimeout(7000);
const halaLobi = await page.evaluate(() => document.getElementById('screenLobby').classList.contains('active'));
console.log('   7 sn sonra hâlâ lobide:', halaLobi ? '✓' : '✗');
if (!halaLobi) errors.push('iptalden sonra maç yine de başladı');

// ===== 2) Asist ==========================================================
await page.click('#btnReady');
await page.waitForSelector('#screenGame.active', { timeout: 25000 });
await page.waitForTimeout(1500);

// Ben bir bota hasar vereyim, ÖLDÜRMEYİ başkası yapsın → bana asist yazılmalı.
const asistSonuc = await page.evaluate(() => {
  const hub = window.__net.impl.hub;
  const sim = [...hub.lobbies.values()][0].game;
  const benId = window.__net.impl.client.id;
  const ben = sim.players.get(benId);
  const botlar = [...sim.players.values()].filter((p) => p.bot);
  if (botlar.length < 2) return { hata: 'yeterli bot yok' };
  const kurban = botlar[0];
  const olduren = botlar[1];

  const oncekiAsist = ben.assists;
  const oncekiOldurme = ben.kills;

  kurban.hp = kurban.maxHp;
  kurban.alive = true;
  sim.damage(kurban, 30, ben, 'bullet', 'rifle');       // ben yaraladım
  sim.damage(kurban, 9999, olduren, 'bullet', 'rifle'); // başkası bitirdi

  return {
    asistArtti: ben.assists - oncekiAsist,
    oldurmeArtti: ben.kills - oncekiOldurme,
    oldurenOldurme: olduren.kills,
    kurbanOldu: !kurban.alive,
  };
});
console.log('2) asist:', JSON.stringify(asistSonuc));
if (asistSonuc.hata) errors.push(`test kurulumu: ${asistSonuc.hata}`);
if (asistSonuc.asistArtti !== 1) errors.push(`hasar verene 1 asist yazılmalı, ${asistSonuc.asistArtti} yazıldı`);
if (asistSonuc.oldurmeArtti !== 0) errors.push('asist, öldürme olarak da sayılmış');
if (!asistSonuc.kurbanOldu) errors.push('kurban ölmedi');

// Öldüren kişi ayrıca asist ALMAMALI
const oldurenAsist = await page.evaluate(() => {
  const sim = [...window.__net.impl.hub.lobbies.values()][0].game;
  const botlar = [...sim.players.values()].filter((p) => p.bot);
  return botlar[1].assists;
});
console.log('   öldürenin asisti:', oldurenAsist);
if (oldurenAsist !== 0) errors.push(`öldüren kişiye de asist yazılmış (${oldurenAsist})`);

// Süre aşımı: eski hasar asist saymamalı
const eskiHasar = await page.evaluate((pencere) => {
  const sim = [...window.__net.impl.hub.lobbies.values()][0].game;
  const ben = sim.players.get(window.__net.impl.client.id);
  const botlar = [...sim.players.values()].filter((p) => p.bot);
  const kurban = botlar[0];
  const olduren = botlar[1];
  kurban.hp = kurban.maxHp; kurban.alive = true;
  const once = ben.assists;
  sim.damage(kurban, 20, ben, 'bullet', 'rifle');
  // Hasarı zamanda geriye it: pencerenin dışında kalsın
  kurban.hurtBy.set(ben.id, sim.time - pencere - 1000);
  sim.damage(kurban, 9999, olduren, 'bullet', 'rifle');
  return ben.assists - once;
}, ASSIST_WINDOW_MS);
console.log('   süresi geçmiş hasar asist verdi mi:', eskiHasar ? 'EVET ✗' : 'hayır ✓');
if (eskiHasar !== 0) errors.push('süresi geçmiş hasar için asist yazılıyor');

// ===== 3) Tab tablosunda asist sütunu ====================================
await page.waitForTimeout(1200);
// Tab artık AÇAR/KAPATIR: basılı tutmak gerekmiyor.
await page.keyboard.press('Tab');
await page.waitForTimeout(600);
const tab = await page.evaluate(() => {
  const el = document.getElementById('scoreboard');
  const basliklar = [...el.querySelectorAll('th')].map((t) => t.textContent.trim());
  const ilkSatir = [...(el.querySelectorAll('tr')[1]?.querySelectorAll('td') || [])].map((t) => t.textContent.trim());
  return { gizli: el.classList.contains('hidden'), basliklar, ilkSatir };
});
console.log('3) Tab başlıkları:', JSON.stringify(tab.basliklar));
console.log('   ilk satır:', JSON.stringify(tab.ilkSatir));
if (tab.gizli) errors.push('Tab tablosu açılmadı');

// Tuşu bıraktıktan sonra da AÇIK kalmalı ve kaydırılabilir olmalı
const kalici = await page.evaluate(() => {
  const el = document.getElementById('scoreboard');
  const kay = el.querySelector('.sb-scroll');
  return {
    acik: !el.classList.contains('hidden'),
    kaydirilabilir: !!kay && getComputedStyle(kay).overflowY === 'auto',
    yapiskanBaslik: !!kay && getComputedStyle(kay.querySelector('th')).position === 'sticky',
  };
});
console.log('   tuş bırakıldıktan sonra:', JSON.stringify(kalici));
if (!kalici.acik) errors.push('Tab bırakılınca tablo kapandı — açar/kapatır olmalı');
if (!kalici.kaydirilabilir) errors.push('oyuncu listesi kaydırılamıyor');
if (!kalici.yapiskanBaslik) errors.push('kaydırırken başlık satırı sabit kalmıyor');

// Tekrar Tab → kapanmalı
await page.keyboard.press('Tab');
await page.waitForTimeout(400);
const kapandi = await page.evaluate(() => document.getElementById('scoreboard').classList.contains('hidden'));
console.log('   tekrar Tab → kapandı mı:', kapandi ? '✓' : '✗');
if (!kapandi) errors.push('ikinci Tab tabloyu kapatmadı');
await page.keyboard.press('Tab');
await page.waitForTimeout(300);
const asistIdx = tab.basliklar.indexOf('Asist');
if (asistIdx < 0) errors.push('Tab tablosunda Asist sütunu yok');
else if (!/^\d+$/.test(tab.ilkSatir[asistIdx] || '')) {
  errors.push(`Asist sütununda sayı yok: "${tab.ilkSatir[asistIdx]}"`);
}

// ===== 4) Sohbet ekranda görünmemeli =====================================
const sohbet = await page.evaluate(() => {
  const g = window.__game;
  g.pushChat({ from: 'Biri', text: 'gorunmemeli', sys: false });
  const log = document.getElementById('gameChatLog');
  const kap = log.closest('.game-chat');
  return {
    satir: log.children.length,
    kapGizli: kap.classList.contains('hidden'),
    metinVar: /gorunmemeli/.test(document.body.innerText),
  };
});
console.log('4) sohbet:', JSON.stringify(sohbet));
if (sohbet.satir > 0) errors.push('sohbet mesajı ekrana basıldı');
if (!sohbet.kapGizli) errors.push('sohbet kutusu hâlâ görünür');
if (sohbet.metinVar) errors.push('sohbet metni ekranda görünüyor');

await page.screenshot({ path: '/tmp/shots/asist-tab.png' });
await browser.close();

if (errors.length) {
  console.log('\nHATALAR:');
  for (const e of errors) console.log(' ', e);
}
console.log(errors.length ? '\nASİST TESTİ BAŞARISIZ ✗' : '\nASİST TESTİ GEÇTİ ✓');
process.exit(errors.length ? 1 : 0);
