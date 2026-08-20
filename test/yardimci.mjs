// Testler için ortak küçük yardımcılar.
//
// NEDEN VAR: Artık maça TEK BAŞINA girilemiyor (en az iki savaşçı gerekiyor —
// oyuncu + bot ya da iki oyuncu). Bu kural oyunun kendisinde, sunucuda duruyor.
// Ama bazı testlerin ölçümü "sahnede benden başka kimse olmasın" istiyor:
// çim dokusunun rengini okumak, bombanın kaç piksel gittiğini ölçmek gibi.
//
// Çözüm: lobide bir bot açıp kuralı sağlıyoruz, maç başladıktan SONRA botu
// simülasyondan çıkarıyoruz. Böylece hem kural gerçekten sınanmış oluyor
// (test onu atlatmak için özel bir kapı kullanmıyor), hem de ölçüm temiz.

/**
 * Lobide bot sayısını ayarlar.
 *
 * NEDEN BU YARDIMCI VAR: bot sayısı eskiden "Lobi Kur" formundaydı ve testler
 * lobiyi kurmadan ÖNCE `#botCountInput`u dolduruyordu. O ayar kullanıcı isteğiyle
 * kurma ekranından kaldırıldı; artık tek yeri lobinin içi. Testler de kullanıcı
 * gibi davranmalı: lobiye gir, sonra ayarla.
 *
 * Sunucuya SET_SETTINGS gidip lobi durumu geri gelene kadar bekliyor, yoksa
 * hemen ardından basılan HAZIRIM eski bot sayısıyla değerlendirilebilir.
 *
 * @param {import('playwright').Page} page
 * @param {number} n bot sayısı
 */
export async function botAyarla(page, n) {
  await page.waitForSelector('#screenLobby.active', { timeout: 10000 });
  await page.evaluate((sayi) => {
    const b = document.getElementById('lobbyBotInput');
    if (!b) throw new Error('lobide bot ayarı bulunamadı (#lobbyBotInput)');
    b.value = String(sayi);
    b.dispatchEvent(new Event('input', { bubbles: true }));
    b.dispatchEvent(new Event('change', { bubbles: true }));
  }, n);
  // Sunucudan gelen lobi durumunda değer görünene kadar bekle
  await page.waitForFunction(
    (sayi) => window.__state?.lobby?.botCount === sayi,
    n,
    { timeout: 8000 },
  );
}

/**
 * Lobide oyun modunu seçer (0 = ilk kart).
 *
 * Mod seçimi de "Lobi Kur" formundan lobinin içine taşındı; testler de oradan
 * seçmeli. Sunucu modu onaylayana kadar bekliyor.
 *
 * @param {import('playwright').Page} page
 * @param {number|string} mod kart sırası (0,1,2) ya da mod kimliği ('ffa','tdm','br')
 */
export async function modSec(page, mod) {
  await page.waitForSelector('#screenLobby.active', { timeout: 10000 });
  await page.waitForSelector('#lobbyModePicker .mode-card', { timeout: 8000 });
  const beklenen = await page.evaluate((m) => {
    const kartlar = [...document.querySelectorAll('#lobbyModePicker .mode-card')];
    if (!kartlar.length) throw new Error('lobide mod seçici bulunamadı');
    const i = typeof m === 'number' ? m : 0;
    kartlar[i].click();
    return i;
  }, mod);
  // Kaçıncı kart seçildi? Sunucudan gelen lobi durumunda görünmesini bekle.
  await page.waitForFunction((i) => {
    const kartlar = [...document.querySelectorAll('#lobbyModePicker .mode-card')];
    return kartlar[i] && kartlar[i].classList.contains('sel');
  }, beklenen, { timeout: 8000 });
}

/**
 * Lobide kapasiteyi (en fazla oyuncu) ayarlar. Bot sayısıyla aynı sebep.
 */
export async function kapasiteAyarla(page, n) {
  await page.waitForSelector('#screenLobby.active', { timeout: 10000 });
  await page.evaluate((sayi) => {
    const b = document.getElementById('lobbyMaxInput');
    if (!b) throw new Error('lobide kapasite ayarı bulunamadı (#lobbyMaxInput)');
    b.value = String(sayi);
    b.dispatchEvent(new Event('input', { bubbles: true }));
    b.dispatchEvent(new Event('change', { bubbles: true }));
  }, n);
  await page.waitForFunction(
    (sayi) => window.__state?.lobby?.maxPlayers === sayi,
    n,
    { timeout: 8000 },
  );
}

/**
 * Çevrimdışı (yerel) maçta çalışan botları simülasyondan çıkarır.
 * @returns {Promise<number>} çıkarılan bot sayısı
 */
export async function botlariCikar(page) {
  return page.evaluate(() => {
    const lobiler = window.__net?.impl?.hub?.lobbies;
    if (!lobiler) return -1;
    const lobi = [...lobiler.values()][0];
    const sim = lobi && lobi.game;
    if (!sim) return -1;
    let n = 0;
    for (const [id, p] of [...sim.players]) {
      if (!p.bot) continue;
      sim.removePlayer(id);
      n++;
    }
    return n;
  });
}
