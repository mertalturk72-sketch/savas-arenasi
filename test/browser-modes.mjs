// İkinci tarayıcı testi: Takım Savaşı ve Son Hayatta Kalan modları,
// maç sonu ekranı ve lobiye dönüş akışı.
// Çalıştır:  node test/browser-modes.mjs

import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
const errors = [];

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});

function attach(page, tag) {
  page.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] ${m.text()}`); });
}

async function playMode(mode, bots, label) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
  const page = await ctx.newPage();
  attach(page, mode);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('#nameInput', `Test${label}`);
  await page.dispatchEvent('#nameInput', 'change');
  await page.fill('#lobbyNameInput', `${label} lobisi`);

  const idx = { ffa: 0, tdm: 1, br: 2 }[mode];
  await page.locator('#modePicker .mode-card').nth(idx).click();
  await page.evaluate((n) => {
    const b = document.getElementById('botCountInput');
    b.value = n; b.dispatchEvent(new Event('input'));
  }, bots);
  await page.check('#privateInput');
  await page.click('#btnCreate');
  await page.waitForSelector('#screenLobby.active');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/10-${mode}-lobby.png` });

  await page.click('#btnReady');       // herkes hazır olunca geri sayım başlar
  await page.waitForSelector('#screenGame.active', { timeout: 25000 });
  await page.waitForTimeout(2000);

  // Biraz oyna
  await page.mouse.move(1000, 400);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(600);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(1200);

  const st = await page.evaluate(() => {
    const g = window.__game;
    return {
      mode: g.mode.id,
      teams: g.teams,
      myTeam: g.myTeam,
      zone: g.zone ? { r: Math.round(g.zone.r), phase: g.zone.p } : null,
      units: g.playersRender.length,
      scoreRows: (g.scores?.ps || []).length / 5,
    };
  });
  console.log(`${label}:`, st);
  if (st.mode !== mode) errors.push(`${label}: mod uyuşmuyor`);
  if (mode === 'tdm' && (!st.teams || !st.myTeam)) errors.push('TDM: takım atanmadı');
  if (mode === 'br' && !st.zone) errors.push('BR: daralan alan yok');
  if (st.scoreRows !== bots + 1) errors.push(`${label}: skor listesinde ${st.scoreRows} kayıt (beklenen ${bots + 1})`);

  await page.screenshot({ path: `${OUT}/11-${mode}-game.png` });
  return { ctx, page };
}

const tdm = await playMode('tdm', 9, 'TDM');
await tdm.ctx.close();

const br = await playMode('br', 11, 'BR');

// --- Maç sonu ekranı: sunucudan gelen mesajı taklit et ---------------------
await br.page.evaluate(() => {
  const g = window.__game;
  const rows = [...g.roster.entries()].map(([id, r], i) => ({
    id, name: r.name, bot: r.bot, team: r.team, cls: r.cls,
    kills: 12 - i, deaths: i, damage: 900 - i * 40, place: i + 1,
  }));
  window.__net.emit('matchEnd', {
    ty: 'matchEnd',
    scoreboard: { mode: 'br', rows, teamScore: null, winner: { id: rows[0].id, name: rows[0].name }, reason: 'lastman' },
    nextIn: 6000,
  });
});
await br.page.waitForSelector('#matchEndOverlay:not(.hidden)', { timeout: 3000 });
await br.page.waitForTimeout(400);
await br.page.screenshot({ path: `${OUT}/12-match-end.png` });

const endRows = await br.page.locator('#matchEndOverlay .sb-table tr').count();
console.log('Maç sonu tablosu satır sayısı:', endRows - 1);
if (endRows - 1 !== 12) errors.push(`Maç sonu tablosunda 12 satır bekleniyordu, ${endRows - 1} var`);

await br.page.click('#btnBackLobby');
await br.page.waitForSelector('#screenLobby.active', { timeout: 4000 });
await br.page.waitForTimeout(300);
await br.page.screenshot({ path: `${OUT}/13-back-to-lobby.png` });
console.log('Lobiye dönüş ✓');

await browser.close();

console.log('\n--- Hatalar ---');
if (!errors.length) console.log('yok ✓');
else errors.forEach((e) => console.log(e));
process.exit(errors.length ? 1 : 0);
