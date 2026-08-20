// İkili durum paketinin AĞ ÜZERİNDE gerçekten çalıştığını doğrular.
//
// test/binary.mjs kodlayıcıyı tek başına sınıyor. Burada sorduğumuz iki soru
// farklı ve daha önemli:
//
//   1) Tarayıcı gerçekten İKİLİ çerçeve alıyor mu, yoksa sessizce JSON'a mı
//      düşülüyor? (Kazanç raporlanıp da uygulanmıyorsa fark edilmez.)
//   2) ESKİ istemciler bozuldu mu? Sunucu artık ikili konuşuyor; "ben ikili
//      anlıyorum" demeyen bir istemciye hâlâ JSON gitmeli ve maç oynanmalı.
//      Bu, arkadaşındaki eski APK'nın çalışmaya devam etmesi demek.
//
// Çalıştır:  node test/binary-net.mjs        (sunucu: ws://localhost:3000)

import { botAyarla, modSec } from './yardimci.mjs';
import { chromium } from 'playwright';
import WebSocket from 'ws';
import fs from 'node:fs';
import { C, S } from '../shared/protocol.js';

const HTTP = process.env.BASE || 'http://localhost:3000';
const WS = HTTP.replace(/^http/, 'ws');
const errors = [];

// =========================================================================
// 1) YENİ İSTEMCİ (tarayıcı) → ikili çerçeve almalı
// =========================================================================
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });

// Sayfa açılmadan ÖNCE WebSocket'i sarmalayıp gelen çerçeveleri sayıyoruz.
// Oyun koduna dokunmuyoruz: ölçüm tamamen dışarıdan.
await ctx.addInitScript(() => {
  window.__cerceve = { ikili: 0, metin: 0, ikiliBayt: 0, metinBayt: 0 };
  const Asil = window.WebSocket;
  function Sarmal(...a) {
    const ws = new Asil(...a);
    ws.addEventListener('message', (e) => {
      if (typeof e.data === 'string') {
        window.__cerceve.metin++;
        window.__cerceve.metinBayt += e.data.length;
      } else {
        window.__cerceve.ikili++;
        window.__cerceve.ikiliBayt += e.data.byteLength || 0;
      }
    });
    return ws;
  }
  Sarmal.prototype = Asil.prototype;
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Sarmal[k] = Asil[k];
  window.WebSocket = Sarmal;
});

const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`[tarayıcı] ${e.message}`));
await page.goto(HTTP);
await page.waitForSelector('#screenMenu.active', { timeout: 15000 });
await page.click('#tabOnline');
await page.waitForFunction(() => window.__net && window.__net.connected, { timeout: 15000 })
  .catch(() => errors.push('tarayıcı sunucuya bağlanamadı'));

await page.fill('#nameInput', 'İkili');
await page.dispatchEvent('#nameInput', 'change');
await page.click('#btnCreate');
await page.waitForSelector('#screenLobby.active', { timeout: 8000 });
await modSec(page, 0);
await botAyarla(page, 5);
await page.click('#btnReady');
await page.waitForSelector('#screenGame.active', { timeout: 25000 });
await page.waitForTimeout(4000);

const c = await page.evaluate(() => window.__cerceve);
const oran = c.ikili / Math.max(1, c.ikili + c.metin);
console.log(`1) Tarayıcı çerçeveleri: ikili ${c.ikili} · metin ${c.metin}`);
console.log(`   ikili ortalama ${Math.round(c.ikiliBayt / Math.max(1, c.ikili))} bayt`);
if (c.ikili < 30) errors.push(`tarayıcıya ikili paket gelmiyor (ikili=${c.ikili})`);
if (oran < 0.8) errors.push(`çerçevelerin çoğu hâlâ metin (ikili oranı %${Math.round(oran * 100)})`);

// Oyun gerçekten ilerliyor mu? (İkili çözülemeseydi sim donardı.)
const t1 = await page.evaluate(() => Math.round(window.__game.snaps.at(-1)?.t || 0));
await page.waitForTimeout(1500);
const t2 = await page.evaluate(() => Math.round(window.__game.snaps.at(-1)?.t || 0));
console.log(`   sim zamanı: ${t1} → ${t2} ${t2 > t1 ? '✓' : '✗'}`);
if (!(t2 > t1)) errors.push('ikili paketlerle simülasyon ilerlemiyor');

// HUD ikili veriden doğru doluyor mu?
const hud = await page.evaluate(() => ({
  hp: (document.getElementById('hpText').textContent || '').trim(),
  am: (document.getElementById('ammoText').textContent || '').trim(),
  ar: (document.getElementById('reserveText').textContent || '').trim(),
}));
console.log(`   HUD: can ${hud.hp} · mermi ${hud.am}/${hud.ar}`);
if (!/^\d+$/.test(hud.hp) || !/^\d+$/.test(hud.am)) errors.push(`HUD ikili veriden dolmadı: ${JSON.stringify(hud)}`);

await page.screenshot({ path: '/tmp/shots/ikili-mac.png' });
await ctx.close();
await browser.close();

// =========================================================================
// 2) ESKİ İSTEMCİ (bin demeyen) → JSON almalı ve oynayabilmeli
// =========================================================================
console.log('\n2) Eski istemci uyumluluğu (bin bayrağı GÖNDERMEDEN)');

const eski = await new Promise((resolve, reject) => {
  const ws = new WebSocket(WS);
  const durum = { metin: 0, ikili: 0, snap: 0, welcome: null, macBasladi: false, lobi: null };
  const zaman = setTimeout(() => reject(new Error('eski istemci zaman aşımı')), 40000);

  ws.on('open', () => ws.send(JSON.stringify({ ty: C.HELLO, name: 'EskiSurum' })));  // bin YOK
  ws.on('message', (data, isBinary) => {
    if (isBinary) { durum.ikili++; return; }
    durum.metin++;
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.ty === S.WELCOME) {
      durum.welcome = m.config;
      ws.send(JSON.stringify({
        ty: C.LOBBY_CREATE, name: 'Eski', mode: 'ffa', maxPlayers: 4, botCount: 3, private: true,
      }));
    } else if (m.ty === S.LOBBY_STATE && !durum.lobi) {
      durum.lobi = m.lobby.id;
      ws.send(JSON.stringify({ ty: C.SET_READY, ready: true }));
    } else if (m.ty === S.MATCH_START) {
      durum.macBasladi = true;
    } else if (m.ty === S.SNAPSHOT) {
      durum.snap++;
      // JSON paketinin içeriği eskisi gibi mi?
      if (durum.snap === 20) {
        if (!m.you || typeof m.you.hp !== 'number' || !Array.isArray(m.ps)) {
          errors.push('eski istemciye giden JSON paketinin biçimi bozulmuş');
        }
        clearTimeout(zaman);
        ws.close();
        resolve(durum);
      }
    } else if (m.ty === S.PING) {
      ws.send(JSON.stringify({ ty: C.PONG, t: m.t }));
    }
  });
  ws.on('error', reject);
}).catch((e) => { errors.push(`eski istemci: ${e.message}`); return null; });

if (eski) {
  console.log(`   sunucu "bin" yeteneği: ${eski.welcome && eski.welcome.bin}`);
  console.log(`   metin paketi ${eski.metin} · ikili paket ${eski.ikili} · durum paketi ${eski.snap}`);
  console.log(`   maç başladı: ${eski.macBasladi ? '✓' : '✗'}`);
  if (eski.ikili > 0) errors.push(`eski istemciye ${eski.ikili} ikili çerçeve gitti — bozulurdu`);
  if (eski.welcome && eski.welcome.bin !== false) errors.push('sunucu eski istemciyi ikili sanıyor');
  if (!eski.macBasladi) errors.push('eski istemci maça giremedi');
  if (eski.snap < 20) errors.push('eski istemciye JSON durum paketi gelmedi');
}

// =========================================================================
if (errors.length) {
  console.log('\nHATALAR:');
  for (const e of errors) console.log(' ', e);
}
console.log(errors.length ? '\nİKİLİ AĞ TESTİ BAŞARISIZ ✗' : '\nİKİLİ AĞ TESTİ GEÇTİ ✓');
process.exit(errors.length ? 1 : 0);
