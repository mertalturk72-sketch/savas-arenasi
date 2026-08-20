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
