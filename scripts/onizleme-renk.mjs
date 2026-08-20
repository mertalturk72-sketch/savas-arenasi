// Renk kombinasyonu ÖNİZLEMESİ üretir.
//
// Üç ayrı paleti sırayla sayfaya uygulayıp lobi kurma ekranının ve lobi
// odasının ekran görüntüsünü alır. Kullanıcı bakıp seçsin diye; seçilen palet
// sonra style.css'e KALICI olarak yazılır.
//
// Çalıştır:  node scripts/onizleme-renk.mjs
// Çıktı:     dist/onizleme/renk-*.png

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = 'dist/onizleme';
fs.mkdirSync(OUT, { recursive: true });

export const PALETLER = {
  bakir: {
    ad: 'Bakır & Kömür',
    vars: {
      '--bg': '#0a0e13', '--bg2': '#10161e',
      '--panel': '#16202b', '--panel2': '#1e2937',
      '--line': '#2a3746', '--text': '#e4ebf2', '--muted': '#8e9cab',
      '--accent': '#ff8a3d', '--accent2': '#ffc48a',
    },
    govde: 'radial-gradient(1200px 600px at 20% -10%, #1c2a3a 0%, transparent 60%), radial-gradient(900px 500px at 110% 110%, #2c1d10 0%, transparent 55%)',
    baslikCizgi: 'linear-gradient(90deg, #ff8a3d, rgba(255,138,61,0))',
  },
  yesil: {
    ad: 'Asker Yeşili',
    vars: {
      '--bg': '#0b100c', '--bg2': '#111a13',
      '--panel': '#17211a', '--panel2': '#1f2c22',
      '--line': '#2b3a2d', '--text': '#e3ecdf', '--muted': '#93a58f',
      '--accent': '#8fc93a', '--accent2': '#d4e157',
    },
    govde: 'radial-gradient(1200px 600px at 20% -10%, #1b2c1d 0%, transparent 60%), radial-gradient(900px 500px at 110% 110%, #2a2a12 0%, transparent 55%)',
    baslikCizgi: 'linear-gradient(90deg, #8fc93a, rgba(143,201,58,0))',
  },
  mavi: {
    ad: 'Gece Mavisi',
    vars: {
      '--bg': '#080d16', '--bg2': '#0d1420',
      '--panel': '#141d2e', '--panel2': '#1c2739',
      '--line': '#24344d', '--text': '#e2ecf7', '--muted': '#8b9cb4',
      '--accent': '#4cc9f0', '--accent2': '#9fe6ff',
    },
    govde: 'radial-gradient(1200px 600px at 20% -10%, #14243c 0%, transparent 60%), radial-gradient(900px 500px at 110% 110%, #101c30 0%, transparent 55%)',
    baslikCizgi: 'linear-gradient(90deg, #4cc9f0, rgba(76,201,240,0))',
  },
};

// Palete ek olarak, "renklendirme" isteğinin görünür karşılığı:
// panel başlıklarının altına ince bir vurgu çizgisi ve panellere hafif bir
// üst ışık. Abartısız — sadece ekran tek düze gri kalmasın.
export function paletCss(p) {
  const vars = Object.entries(p.vars).map(([k, v]) => `  ${k}: ${v};`).join('\n');
  return `
:root {
${vars}
}
body { background-image: ${p.govde} !important; }
.panel {
  position: relative;
  background: linear-gradient(180deg, var(--panel) 0%, var(--bg2) 100%);
  border-color: var(--line);
}
.panel::before {
  content: ''; position: absolute; left: 18px; right: 18px; top: 0; height: 2px;
  background: ${p.baslikCizgi};
  border-radius: 2px; opacity: .85;
}
.panel-head h2 { color: var(--accent2); }
`;
}

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});

for (const [anahtar, p] of Object.entries(PALETLER)) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#screenMenu.active', { timeout: 15000 });
  await page.addStyleTag({ content: paletCss(p) });
  await page.click('#tabLocal');
  await page.waitForTimeout(300);
  await page.fill('#nameInput', 'Nuri');
  await page.dispatchEvent('#nameInput', 'change');
  await page.fill('#lobbyNameInput', 'Nuri’nin lobisi');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `renk-${anahtar}-1-menu.png`) });

  await page.click('#btnCreate');
  await page.waitForSelector('#screenLobby.active', { timeout: 8000 });
  await page.evaluate((n) => {
    const b = document.getElementById('lobbyBotInput');
    b.value = String(n);
    b.dispatchEvent(new Event('input', { bubbles: true }));
    b.dispatchEvent(new Event('change', { bubbles: true }));
  }, 5);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, `renk-${anahtar}-2-lobi.png`) });
  console.log(`${p.ad}: iki görüntü hazır`);
  await ctx.close();
}

await browser.close();
console.log(`Konum: ${OUT}`);
