// Güvensiz kaynak (http://192.168…) uyarısı + davet linki testi.
//
// Kullanıcının kök derdi: telefonda http://192.168.1.169:3000 açıyor, service
// worker kaydolmuyor, PC kapanınca sayfa ölüyor. Oyun bunu SESSİZCE geçmemeli;
// menüde açık bir uyarı çıkmalı. localhost'ta ise uyarı ÇIKMAMALI.
//
// Sunucu çalışıyor olmalı:  npm start
// Çalıştır:  node test/browser-origin.mjs

import { chromium } from 'playwright';
import fs from 'node:fs';

const PORT = process.env.PORT || 3000;
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const errors = [];

// Chrome'a "lan.test" adını 127.0.0.1'e çözdürüyoruz. Böylece gerçek bir
// http:// + localhost-olmayan alan adı elde edip ev ağı durumunu birebir taklit
// ediyoruz (Chrome bu adreste service worker'a izin vermez).
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--host-resolver-rules=MAP lan.test 127.0.0.1'],
});

async function open(url) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${url} → ${e.message}`));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#screenMenu.active', { timeout: 10000 });
  await page.waitForTimeout(500);
  return { ctx, page };
}

// ===== 1) http://lan.test — uyarı ÇIKMALI ================================
{
  const { ctx, page } = await open(`http://lan.test:${PORT}/`);
  const w = await page.evaluate(() => {
    const el = document.getElementById('insecureWarn');
    return { hidden: el.classList.contains('hidden'), text: (el.textContent || '').trim() };
  });
  const dl = await page.evaluate(() => {
    const b = document.getElementById('btnDownloadSingle');
    return { hidden: b.classList.contains('hidden'), href: b.getAttribute('href'), dl: b.getAttribute('download') };
  });
  console.log('İndirme düğmesi:', !dl.hidden ? 'görünür ✓' : 'GİZLİ ✗', dl.href, dl.dl);
  if (dl.hidden) errors.push('tek dosya indirme düğmesi görünmüyor');
  const head = await page.evaluate(() => fetch('/savas-arenasi.html').then((r) => r.ok && r.headers.get('content-type')));
  console.log('  sunucu dosyayı veriyor mu:', head, head ? '✓' : '✗');
  if (!head) errors.push('/savas-arenasi.html sunulmuyor');

  console.log('lan.test uyarısı görünür mü:', !w.hidden ? 'evet ✓' : 'HAYIR ✗');
  if (w.hidden) errors.push('http://lan.test üzerinde güvensiz kaynak uyarısı çıkmadı');
  if (!/savas-arenasi\.html/.test(w.text)) errors.push('uyarı tek dosya çözümünü göstermiyor');
  console.log('  metin:', w.text.slice(0, 110) + '…');

  // Service worker bu adreste kaydolmayı DENEMEMELİ (boşuna hata üretmesin).
  const regs = await page.evaluate(() =>
    navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then((r) => r.length) : -1);
  // -1 = tarayıcı bu kaynakta serviceWorker API'sini hiç vermiyor (beklenen).
  console.log('  service worker kaydı:', regs, regs <= 0 ? '✓ (kurulmadı)' : '✗');
  if (regs > 0) errors.push('güvensiz kaynakta service worker kaydedilmiş görünüyor');
  await ctx.close();
}

// ===== 2) http://localhost — uyarı ÇIKMAMALI =============================
{
  const { ctx, page } = await open(`http://localhost:${PORT}/`);
  const hidden = await page.evaluate(() =>
    document.getElementById('insecureWarn').classList.contains('hidden'));
  console.log('localhost uyarısı gizli mi:', hidden ? 'evet ✓' : 'HAYIR ✗');
  if (!hidden) errors.push('localhost güvenli sayılmalı, uyarı çıkmamalı');
  await ctx.close();
}

// ===== 3) Davet linki: kopyalanabilir ve tek tıkla lobiye sokuyor mu? ====
{
  const { ctx, page } = await open(`http://localhost:${PORT}/`);
  await page.click('#tabOnline');
  await page.waitForTimeout(800);
  await page.fill('#nameInput', 'Ev Sahibi');
  await page.dispatchEvent('#nameInput', 'change');
  await page.fill('#lobbyNameInput', 'Davet Testi');
  await page.click('#btnCreate');
  await page.waitForSelector('#screenLobby.active', { timeout: 8000 });

  const invite = await page.evaluate(() => ({
    visible: !document.getElementById('inviteRow').classList.contains('hidden'),
    link: document.getElementById('inviteLink').value,
    note: (document.getElementById('inviteNote').textContent || '').trim(),
    code: document.getElementById('lobbyCode').textContent.trim(),
  }));
  console.log('Davet linki:', invite.link, invite.visible ? '✓' : '✗');
  if (!invite.visible) errors.push('davet linki satırı görünmüyor');
  if (!invite.link.includes(`?lobi=${invite.code}`)) errors.push('davet linki lobi kodunu taşımıyor');
  if (!/aynı wifi/i.test(invite.note)) errors.push('yerel adres uyarısı eksik');

  // İkinci oyuncu linke tıklıyor → doğrudan aynı lobide olmalı.
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push(`davetli → ${e.message}`));
  await p2.goto(invite.link, { waitUntil: 'domcontentloaded' });
  await p2.waitForSelector('#screenLobby.active', { timeout: 15000 }).catch(() => {});
  const joined = await p2.evaluate(() => ({
    inLobby: document.getElementById('screenLobby').classList.contains('active'),
    code: document.getElementById('lobbyCode').textContent.trim(),
  }));
  console.log('Davetli lobide mi:', joined.inLobby, '· kod:', joined.code);
  if (!joined.inLobby || joined.code !== invite.code) {
    errors.push(`davet linkiyle lobiye girilemedi (${JSON.stringify(joined)})`);
  }

  const roster = await page.evaluate(() =>
    document.querySelectorAll('#roster .roster-item, #roster > div').length);
  console.log('Ev sahibinin listesinde oyuncu sayısı:', roster);
  if (roster < 2) errors.push('ev sahibi davetliyi listede görmüyor');

  await ctx2.close();
  await ctx.close();
}

await browser.close();

if (errors.length) {
  console.log('\nHATALAR:');
  for (const e of errors) console.log(' ', e);
}
console.log(errors.length ? '\nKAYNAK/DAVET TESTİ BAŞARISIZ ✗' : '\nKAYNAK/DAVET TESTİ GEÇTİ ✓');
process.exit(errors.length ? 1 : 0);
