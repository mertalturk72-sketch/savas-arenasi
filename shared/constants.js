// Sunucu ve istemcinin ORTAK kullandığı sabitler.
// Bu dosya hem Node tarafında (import) hem tarayıcıda (<script type="module">) çalışır.

export const PROTOCOL_VERSION = 1;

// --- Ağ / zamanlama -------------------------------------------------------
export const TICK_RATE = 30;                 // sunucu simülasyon adımı (Hz)
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_RATE = 20;             // sunucudan gönderilen durum paketi (Hz)
export const SNAPSHOT_MS = 1000 / SNAPSHOT_RATE;
export const INPUT_RATE = 60;                // istemcinin girdi gönderme hızı (Hz)
export const INTERP_DELAY_MS = 110;          // diğer oyuncuları geçmişte gösterme gecikmesi
export const MAX_INPUT_DT_MS = 50;           // hile önleme: tek girdi paketinin üst sınırı
export const CLIENT_TIMEOUT_MS = 20000;      // ping cevabı gelmezse düşür

// --- Lobi -----------------------------------------------------------------
export const MAX_PLAYERS = 20;               // BİR LOBİDE EN FAZLA 20 KİŞİ
export const MIN_PLAYERS_TO_START = 1;       // lobide en az bir gerçek oyuncu
// Maça girecek TOPLAM kişi (oyuncular + botlar) en az bu kadar olmalı.
// Tek kişilik maç oynanabilir bir şey değil: rakip yok, skor tablosu boş.
// Bot eklemek ya da bir arkadaş çağırmak şart.
export const MIN_FIGHTERS = 2;
export const MAX_NAME_LEN = 16;
export const MAX_LOBBY_NAME_LEN = 24;
export const MAX_CHAT_LEN = 140;
export const LOBBY_CODE_LEN = 5;
// Geri sayım iki parçadan oluşur:
//   5 4 3 2 1   → sayı gösterilen kısım
//   BAŞLA!      → son COUNTDOWN_GO_MS kadarı
// Eskiden tek parçaydı: sayı sıfıra inince "BAŞLA!" yazılıyor, ama sunucu
// tam o anda maçı başlattığı için yazı göz kırpması kadar (bazen hiç)
// görünüyordu. Şimdi sunucunun geri sayımına bu bir saniye EKLENİYOR, yani
// "BAŞLA!" gerçekten bir saniye ekranda duruyor ve maç ondan sonra başlıyor.
export const COUNTDOWN_GO_MS = 1000;         // "BAŞLA!" yazısının süresi
export const COUNTDOWN_MS = 5000 + COUNTDOWN_GO_MS;
export const POST_MATCH_MS = 12000;          // maç sonu skor tablosu süresi

// --- Oyun modları ---------------------------------------------------------
// Bir maç 5 dakika sürer.
export const MATCH_MS = 5 * 60 * 1000;

export const MODES = {
  ffa: {
    id: 'ffa',
    name: 'Herkes Herkese',
    short: 'FFA',
    desc: 'Tek başınasın. İlk hedef sayısına ulaşan kazanır.',
    teams: false,
    respawn: true,
    scoreLimit: 20,
    timeLimitMs: MATCH_MS,
    shrinkingZone: false,
    map: 'arena',
  },
  tdm: {
    id: 'tdm',
    name: 'Takım Savaşı',
    short: 'TDM',
    desc: 'İki takım. Takımının toplam öldürme sayısı hedefe ulaşsın.',
    teams: true,
    respawn: true,
    scoreLimit: 50,
    timeLimitMs: MATCH_MS,
    shrinkingZone: false,
    map: 'arena',
  },
  br: {
    id: 'br',
    name: 'Son Hayatta Kalan',
    short: 'BR',
    desc: 'Tek can. Güvenli alan daralır. Ayakta kalan son kişi kazanır.',
    teams: false,
    respawn: false,
    scoreLimit: 0,
    timeLimitMs: MATCH_MS,
    shrinkingZone: true,
    map: 'royale',
  },
  // Takım BR: Son Hayatta Kalan'ın TAKIMLI hâli. İki takım, tek can, daralan
  // alan. Ayakta kalan son TAKIM kazanır (skor değil, hayatta kalma).
  takim_br: {
    id: 'takim_br',
    name: 'Takımlı Son Hayatta Kalan',
    short: 'T.SHK',
    desc: 'İki takım, tek can, daralan alan. Ayakta kalan son takım kazanır.',
    teams: true,
    respawn: false,
    scoreLimit: 0,
    timeLimitMs: MATCH_MS,
    shrinkingZone: true,
    map: 'royale',
    minStart: 4,   // 2'ye 2 olsun: en az 4 savaşçı (çevrimdışı 1 oyuncu+3 bot,
                   // online 4 oyuncu). Yoksa takım modu anlamsız.
  },
  // Bayrak Çalma (CTF) — tek merkez bayrak sürümü. Ortadaki bayrağı kap,
  // DÜŞMAN üssüne götür = 1 sayı. Önce 3'e ulaşan takım kazanır. Taşıyıcı
  // ölünce bayrak düşer, 10 sn sonra merkeze döner (bkz. CTF).
  ctf: {
    id: 'ctf',
    name: 'Bayrak Çalma',
    short: 'CTF',
    desc: 'Ortadaki bayrağı kap, kendi üssüne götür. Önce 3 kapan takım kazanır.',
    teams: true,
    respawn: true,
    scoreLimit: 3,
    timeLimitMs: 3 * 60 * 1000,   // CTF maçı 3 dakika (istek)
    shrinkingZone: false,
    map: 'ctf',
    ctf: true,
  },
  // Zombi Kuşatması — takımlı ama rekabetçi DEĞİL: oyuncular (takım 1) dalga
  // dalga gelen zombilere (takım 2) karşı birlikte hayatta kalır. Takım
  // altyapısını olduğu gibi kullanıyoruz (dost ateşi kapalı, takım arkadaşı
  // hep görünür), tek fark karşı tarafın oynanmayan bir taraf olması.
  zombi: {
    id: 'zombi',
    name: 'Zombi Kuşatması',
    short: 'ZOMBİ',
    desc: 'Dalga dalga gelen zombilere karşı hayatta kal. Ölen dostun sonraki dalgada geri döner.',
    teams: true,
    coop: true,        // takım seçimi yok: herkes aynı taraftadır
    solo: true,        // tek kişi de başlatabilir (rakip zaten oyunun kendisi)
    respawn: false,    // ölünce beklersin; dalga başında dirilirsin
    scoreLimit: 0,
    timeLimitMs: 0,    // süre sınırı yok — dalgalar bitince maç biter
    shrinkingZone: false,
    map: 'arena',
    zombi: true,
  },
};

// Bayrak Çalma ayarları — tek yerde.
export const CTF = {
  flagReturnMs: 5000,   // yere düşen bayrak bu kadar sonra merkeze döner (istek: 5 sn)
  baseR: 48,            // üsse bu kadar yaklaşınca sayı (capture) olur
  pickR: 28,            // bayrağa bu kadar yaklaşınca alınır/geri döner
  carrierSpeed: 0.62,   // bayrağı taşırken hız çarpanı (~%38 yavaşlar).
                        // Tüm sınıf hızları yarıya indikten sonra 0.30 çok
                        // yavaştı (sürünme); 0.62 taşımayı yeniden akıcı yapar
                        // ama yine de kovalayan (tam hız) yetişebilir.
  repickMs: 1200,       // bayrağı BIRAKAN oyuncu bu kadar süre onu tekrar alamaz
                        // (yoksa "bırak" anında geri alınır; takıldığında da
                        //  elden çıkarabilmek için bu pencere lazım)
};
// Zombi Kuşatması ayarları — tek yerde.
export const ZOMBI = {
  dalgaSayisi: 10,          // bu kadar dalga temizlenince ZAFER
  ilkHazirlikMs: 7000,      // maç başındaki hazırlık
  hazirlikMs: 12000,        // dalgalar arası hazırlık (can/mermi dolar)
  // Bir dalgadaki zombi sayısı: (taban + dalga*artış) × savaşçı sayısı ölçeği.
  taban: 4,
  dalgaBasi: 2,
  oyuncuCarpani: 0.55,      // her EK savaşçı zombi sayısını bu oranda artırır
  ayniAndaEnFazla: 12,      // aynı anda haritada en fazla bu kadar zombi olur
  dogusAraligiMs: 700,      // zombiler topluca değil, tek tek gelir
  enYakinDogusUzakligi: 620,// en yakın oyuncuya bu kadar uzakta doğarlar
  havuz: 26,                // maç başında hazırlanan zombi yuvası (yeniden kullanılır)
  canCarpaniDalga: 0.12,    // her dalgada can +%12
  // Hız dalgayla ARTMIYOR — bilerek. Zombiler zaten oyuncudan hızlı
  // (bkz. ZOMBI_TIPLERI.hizCarpani); üstüne her dalgada bir de hızlansalardı
  // son dalgalarda oyuncunun hiçbir manevrası kalmazdı. Dalga zorluğu can
  // ve sayı üzerinden artıyor.
  kosucuDalga: 3,           // koşucular bu dalgadan itibaren çıkar
  iriDalga: 5,              // iriler bu dalgadan itibaren çıkar
};

// Zombi çeşitleri. Her çeşidin KENDİ GÖRÜNÜŞÜ var (char) — oyuncu uzaktan
// bakınca ne geldiğini anlasın diye. Oran: dalga kadrosundaki payı.
//
// hizCarpani: İNSAN HIZININ KATI (px/s değil). İstek: sıradan zombi insan
// hızının %115'i olsun (Koşucu üstünde, İri altında — tip karakteri korunsun
// diye aralarındaki oran aynı bırakıldı). Sabit bir px/s yazmak yerine kat olarak
// yazıyoruz ki sınıf hızları bir gün değişirse zombiler kendiliğinden uysun —
// aksi hâlde iki sayı birbirinden habersiz kayar. Karşılığı için zombiHizi().
export const ZOMBI_TIPLERI = {
  yurur:  { id: 'yurur',  ad: 'Yürüyen', char: 'zombi_yurur',  can: 70,  hizCarpani: 1.15, dmg: 14, oran: 0.62 },
  kosucu: { id: 'kosucu', ad: 'Koşucu',  char: 'zombi_kosucu', can: 44,  hizCarpani: 1.30, dmg: 10, oran: 0.26 },
  iri:    { id: 'iri',    ad: 'İri',     char: 'zombi_iri',    can: 260, hizCarpani: 0.92, dmg: 30, oran: 0.12 },
};
export const ZOMBI_TIP_IDS = Object.keys(ZOMBI_TIPLERI);

export const MODE_IDS = Object.keys(MODES);
export const DEFAULT_MODE = 'ffa';

// --- Takımlar -------------------------------------------------------------
export const TEAMS = {
  0: { id: 0, name: 'Yok', color: '#9aa4b2' },
  1: { id: 1, name: 'Kırmızı', color: '#ef4a4a', colorDim: '#7d2020' },
  2: { id: 2, name: 'Mavi', color: '#3f9bff', colorDim: '#1d4a7d' },
};

// --- Haritalar ------------------------------------------------------------
// Harita boyutları. Yerleşim oransal üretildiği için bu sayıları
// değiştirmek yeterli — engeller ve doğuş noktaları kendiliğinden uyar.
export const MAPS = {
  arena: { w: 3400, h: 2400 },
  royale: { w: 4600, h: 3400 },
  // Bayrak Çalma: UZUN, İNCE, YATAY arena. Üsler iki uçta; bayrağı kapan uzun
  // bir koridoru göğüsleyip düşman ucuna taşımak zorunda (kovalamaca).
  ctf: { w: 6000, h: 1400 },
};

// Geçitlerin en az bu kadar boşluğu olmalı (oyuncu çapı 32 px).
export const MIN_CORRIDOR = 96;

// --- Oyuncu ---------------------------------------------------------------
export const PLAYER_RADIUS = 16;
export const RESPAWN_MS = 3500;
// Asist penceresi: bir oyuncuya vurduktan sonra bu süre içinde ölürse asist
// alırsın. Kısa tutuluyor ki maçın başında değdirdiğin biri dakikalar sonra
// ölünce asist yazılmasın.
export const ASSIST_WINDOW_MS = 9000;
export const SPAWN_PROTECT_MS = 1500;
// Öldürme ödülü: birini öldüren oyuncu bu kadar can kazanır.
// ASLA azamiyi aşmaz — 90 canlıyken öldüren 140 değil, 100 olur.
// (Tavan kontrolü shared/sim/game.js içindeki kill() fonksiyonunda.)
export const KILL_HEAL = 50;

// Öldürme ödülü (mermi): öldüren oyuncu yedek kapasitesinin bu kadarını geri
// kazanır. Can ödülü gibi bu da ASLA yedeğin azamisini aşmaz.
export const KILL_AMMO_FRACTION = 0.35;

// --- Doğuş noktaları ------------------------------------------------------
// Oyuncular haritanın dış çerçevesinde doğmasın: her kenardan haritanın bu
// kadarlık şeridi doğuşa kapalı. (Kutular hâlâ her yere dağılır.)
export const SPAWN_EDGE_INSET = 0.15;
// Doğuş seçilirken "düşmandan uzaklık" tek başına köşeleri kazandırıyordu.
// Merkeze yakınlığa da bu ağırlıkla puan veriyoruz (piksel cinsinden, 1'e
// yaklaştıkça oyuncular ortaya toplanır).
export const SPAWN_CENTER_BIAS = 0.6;
// Can kutusu yok: can kendiliğinden yenilenir (2 saniyede 1 can).
export const HP_REGEN_PER_SEC = 0.5;

// Cephane kutuları
export const PICKUP_RADIUS = 18;
export const AMMO_PACK_RESPAWN_MS = 16000;
export const AMMO_PACK_FRACTION = 0.5;   // yedek kapasitesinin yarısını doldurur

// --- Güncelleme -----------------------------------------------------------
// Paketlenmiş sürüm (APK / tek dosya) açılışta buradaki adresten sürüm
// bilgisini okur. Sunucuda daha yeni bir sürüm varsa kullanıcıya "Güncelle"
// çıkarır; bastığında uygulama sunucudaki güncel sürüme geçer ve bunu
// hatırlar. İnternet yoksa içindeki kopyayla sessizce açılmaya devam eder.
// Kendi sunucun varsa burayı değiştir.
export const UPDATE_SERVER = 'https://savas-arenasi.onrender.com';


// --- Sınıflar -------------------------------------------------------------
// CAN HERKESTE 100. Eskiden sınıflar farklı canlıydı (78–100); artık tek fark
// hız ve silah. Böylece "kim kaç vuruşta ölür" hesabı herkes için aynı ve
// sınıflar arasındaki denge sadece oynanışla kuruluyor.
export const CLASSES = {
  komando: {
    id: 'komando',
    name: 'Komando',
    desc: 'Dengeli. Otomatik tüfek. Her duruma uyar.',
    speed: 180,
    hp: 100,
    weapon: 'rifle',
    color: '#7ee787',
  },
  akinci: {
    id: 'akinci',
    name: 'Akıncı',
    desc: 'Çok hızlı. Pompalı ile yakın dövüş.',
    speed: 233,
    hp: 100,
    weapon: 'shotgun',
    color: '#ffd479',
  },
  nisanci: {
    id: 'nisanci',
    name: 'Keskin Nişancı',
    desc: 'Yavaş ama tek atışta yıkıcı. Uzun menzil.',
    speed: 145,
    hp: 100,
    weapon: 'sniper',
    color: '#c39bff',
  },
  bombaci: {
    id: 'bombaci',
    name: 'Bombacı',
    desc: 'Bomba atar. Basılı tut, menzili ayarla, bırak.',
    speed: 167,
    hp: 100,
    weapon: 'bomba',
    color: '#ff9f5a',
  },
  // Zombinin kendisi. Lobide SEÇİLEMEZ (gizli): yalnız Zombi Kuşatması
  // modunda, sunucunun ürettiği zombi yuvalarında kullanılır. Can ve hız
  // burada yazan değil, dalgaya göre hesaplanan değerdir (bkz. ZOMBI_TIPLERI).
  //
  // DİKKAT: sınıf indeksi ikili durum paketinde 3 BİTE sığıyor (bkz.
  // shared/binary.js) — en fazla 8 sınıf olabilir.
  zombi: {
    id: 'zombi',
    name: 'Zombi',
    desc: 'Silahı yok, pençesi var.',
    speed: 96,
    hp: 70,
    weapon: 'pence',
    color: '#8fbf6a',
    gizli: true,
  },
};
export const CLASS_IDS = Object.keys(CLASSES);
export const DEFAULT_CLASS = 'komando';

// Oynanabilir sınıfların ortalama hızı. Zombi hızları bunun katı olarak
// hesaplanıyor (bkz. ZOMBI_TIPLERI.hizCarpani), yani bir sınıfın hızını
// değiştirmek zombileri de kendiliğinden dengeler.
export const INSAN_HIZI = (() => {
  const hizlar = Object.values(CLASSES).filter((c) => !c.gizli).map((c) => c.speed);
  return hizlar.reduce((t, v) => t + v, 0) / hizlar.length;
})();

/** Bir zombi tipinin px/s cinsinden hızı. */
export function zombiHizi(tipId) {
  const t = ZOMBI_TIPLERI[tipId] || ZOMBI_TIPLERI.yurur;
  return Math.round(INSAN_HIZI * t.hizCarpani);
}

// --- Bot zorluğu ----------------------------------------------------------
// Botların "yeteneği" tek bir sayı (0..1) ve şu üç şeyi birden belirliyor:
// nişan isabeti, hedefi ne kadar öngördüğü ve ateş etmeden önceki tepki
// gecikmesi. Bir de görüş menzili var: kolay botlar seni geç fark eder.
//
// Aralık veriyoruz, tek sayı değil: aynı zorlukta bile botlar birbirinin
// kopyası olmasın, aralarında biraz fark bulunsun.
export const BOT_LEVELS = {
  // Fark KASTEN çok açık: kolay gerçekten zayıf (geç görür, çok ıskalar, geç
  // ateşler), zor neredeyse kusursuz (uzağı görür, isabetli, anında ateşler).
  // Tepki farkı ~800 ms'den ~40 ms'ye: en güçsüzle en güçlü arasında uçurum var.
  kolay: {
    id: 'kolay',
    name: 'Kolay',
    desc: 'Çok geç fark eder, bol ıskalar',
    skill: [0.03, 0.15],
    view: 620,
    reactMs: 820,
  },
  orta: {
    id: 'orta',
    name: 'Orta',
    desc: 'Dengeli rakip',
    skill: [0.40, 0.62],
    view: 1080,
    reactMs: 260,
  },
  zor: {
    id: 'zor',
    name: 'Zor',
    desc: 'Anında görür, kusursuz nişan',
    skill: [0.90, 1.0],
    view: 1520,
    reactMs: 40,
  },
};
export const BOT_LEVEL_IDS = Object.keys(BOT_LEVELS);
export const DEFAULT_BOT_LEVEL = 'orta';

// --- Karakterler ----------------------------------------------------------
// Görünüş seçimi; oynanışı etkilemez. Renkler kodla piksel piksel çizilir
// (public/js/sprites.js), hazır görsel dosyası yok.
// walk: her karaktere ÖZGÜ yürüyüş kişiliği. leg=adım genişliği, arm=kol
// sallama, lift=arka ayağın kalkışı (bunlar sprite karesine gömülür); bob=dikey
// sekme, sway=yana salınım (çizimde sürekli), cad=adım temposu (mesafeye göre
// kare ilerleme hızı). 1 = temel. Değerler kasten belirgin ki fark görünsün.
export const CHARACTERS = {
  kivircik:  { id: 'kivircik',  name: 'Kıvırcık',   style: 'kabarik', hair: '#8a6a3f', skin: '#f0c8a0', jacket: '#2f3a4a', accent: '#e8c15a', eye: '#7fb0d8', walk: { leg: 1.0,  arm: 1.0, lift: 1.0, bob: 1.0, sway: 1.0, cad: 1.0  } },
  diken:     { id: 'diken',     name: 'Diken',      style: 'dikenli', hair: '#4e8f6d', skin: '#f2d0aa', jacket: '#23262e', accent: '#9fd8b4', eye: '#8fe0b0', walk: { leg: 1.15, arm: 1.4, lift: 1.3, bob: 1.5, sway: 1.1, cad: 1.2  } },
  uzunsac:   { id: 'uzunsac',   name: 'Yele',       style: 'uzun',    hair: '#7a5a3a', skin: '#f4d3ae', jacket: '#2b3550', accent: '#cfd8e8', eye: '#6fa8d8', walk: { leg: 0.85, arm: 0.8, lift: 0.7, bob: 0.7, sway: 1.5, cad: 0.95 } },
  kasketli:  { id: 'kasketli',  name: 'Kasketli',   style: 'kasket',  hair: '#3b3f5c', skin: '#e9c39c', jacket: '#20242c', accent: '#c8b26a', eye: '#9aa8e0', walk: { leg: 1.4,  arm: 0.5, lift: 0.9, bob: 0.6, sway: 0.5, cad: 1.05 } },
  karasac:   { id: 'karasac',   name: 'Karasaç',    style: 'uzun',    hair: '#2a2730', skin: '#a9714b', jacket: '#26282f', accent: '#d8b552', eye: '#c8a0d8', walk: { leg: 0.7,  arm: 0.7, lift: 0.5, bob: 0.5, sway: 0.8, cad: 0.85 } },
  gumus:     { id: 'gumus',     name: 'Gümüş',      style: 'kisa',    hair: '#c9c6bd', skin: '#eec9a6', jacket: '#33383f', accent: '#d9d3c0', eye: '#a8c8e0', walk: { leg: 0.95, arm: 1.1, lift: 0.9, bob: 0.9, sway: 1.6, cad: 0.9  } },
  mavipercem:{ id: 'mavipercem',name: 'Mavi Perçem',style: 'kisa',    hair: '#5f7fc4', skin: '#f2d2b2', jacket: '#242a38', accent: '#b8cbe8', eye: '#7fc8e8', walk: { leg: 1.0,  arm: 1.2, lift: 1.5, bob: 1.3, sway: 1.1, cad: 1.25 } },
  esmer:     { id: 'esmer',     name: 'Esmer',      style: 'kabarik', hair: '#402e20', skin: '#8a5a3a', jacket: '#2c3630', accent: '#e0bb55', eye: '#d8b98f', walk: { leg: 1.3,  arm: 1.1, lift: 1.2, bob: 1.4, sway: 0.7, cad: 0.8  } },
  // --- Zombiler ---
  // Lobide SEÇİLEMEZ (gizli). Üç zombi tipinin üç ayrı görünüşü: oyuncu
  // uzaktan silüete bakınca yavaş mı, koşucu mu, iri mi olduğunu anlasın.
  zombi_yurur:  { id: 'zombi_yurur',  name: 'Yürüyen Zombi', style: 'uzun',    hair: '#3f4a35', skin: '#8fae6d', jacket: '#414a38', accent: '#66753f', eye: '#e2f06a', gizli: true, walk: { leg: 0.7, arm: 0.45, lift: 0.4, bob: 0.5, sway: 1.8, cad: 0.7  } },
  zombi_kosucu: { id: 'zombi_kosucu', name: 'Koşucu Zombi',  style: 'dikenli', hair: '#5a3a2e', skin: '#b8c48a', jacket: '#5a4630', accent: '#8a9a52', eye: '#ff7a4a', gizli: true, walk: { leg: 1.5, arm: 1.7, lift: 1.5, bob: 1.6, sway: 0.9, cad: 1.55 } },
  zombi_iri:    { id: 'zombi_iri',    name: 'İri Zombi',     style: 'kabarik', hair: '#2b3326', skin: '#6f8a52', jacket: '#2f3a2a', accent: '#4e5c33', eye: '#d8f06a', gizli: true, walk: { leg: 1.1, arm: 0.6, lift: 0.6, bob: 1.8, sway: 1.3, cad: 0.5  } },
};
export const DEFAULT_WALK = { leg: 1, arm: 1, lift: 1, bob: 1, sway: 1, cad: 1 };
export const CHAR_IDS = Object.keys(CHARACTERS);
export const DEFAULT_CHAR = 'kivircik';

// --- Çalılar --------------------------------------------------------------
// Çalı bir engel DEĞİLDİR: içinden geçilir, mermi geçer. Ama içindeki oyuncu
// bu mesafeden uzaktan görünmez. Ateş edince yeri belli olur.
export const BUSH_REVEAL_DIST = 190;
export const BUSH_FIRE_REVEAL_MS = 900;

// Görüş menzili: bu mesafenin ötesindeki düşmanlar sunucudan hiç gönderilmez.
export const VIS_DIST = 1250;
export const VIS_GRACE_MS = 600;     // görüşten çıkan hedef kısa süre daha gönderilir
export const BULLET_VIS = 1500;
export const EVENT_AUDIO_DIST = 1500;   // atış sesinin duyulduğu mesafe

// --- Silahlar -------------------------------------------------------------
// dmg: mermi başına hasar, fireMs: atışlar arası bekleme, speed: mermi hızı px/s
// spread: radyan cinsinden rastgele sapma, pellets: tek atıştaki mermi sayısı
export const WEAPONS = {
  rifle: {
    id: 'rifle', name: 'Tüfek',
    dmg: 15, fireMs: 115, speed: 950, spread: 0.045, pellets: 1,
    mag: 30, reserve: 60, reloadMs: 1700, range: 950, bulletR: 4, auto: true,
  },
  shotgun: {
    id: 'shotgun', name: 'Pompalı',
    dmg: 12, fireMs: 720, speed: 800, spread: 0.155, pellets: 7,
    mag: 5, reserve: 15, reloadMs: 2200, range: 430, bulletR: 3, auto: false,
  },
  sniper: {
    id: 'sniper', name: 'Keskin Tüfek',
    dmg: 82, fireMs: 1250, speed: 1900, spread: 0.004, pellets: 1,
    mag: 5, reserve: 15, reloadMs: 2500, range: 1700, bulletR: 3, auto: false,
    laser: true,                      // nereye ateş edeceğini gösteren çizgi
  },
  // Bomba diğer silahlardan farklı çalışır: ATEŞ TUŞUNU BASILI TUTARSIN,
  // menzil dolar, BIRAKINCA atılır. Çarptığı yerde patlar; hasar merkeze
  // yakınlıkla azalır. Doğrudan isabet hasarı yoktur (dmg: 0) — bütün iş
  // patlamada.
  bomba: {
    id: 'bomba', name: 'Bomba',
    // Bombacı güçlendirildi: menzil +%50, hız +%25, patlama hasarı +%50.
    // Patlama alanı önce +%50 yapıldı (83 → 125), sonra istek üzerine %20
    // küçültüldü: 125 → 100.
    //
    // Kendi bombandan artık zarar görmüyorsun (bkz. Game.explode), yani
    // yarıçapın alt menzilden küçük kalması bir zorunluluk değil — ama yine de
    // öyle (100 < 143), atılan bomba hep kendinden uzağa düşüyor.
    dmg: 0, fireMs: 620, speed: 1050, spread: 0.02, pellets: 1,
    mag: 6, reserve: 15, reloadMs: 2400, range: 560, bulletR: 8, auto: false,
    throwable: true,
    minRange: 143,        // hiç beklemeden bırakınca bu kadar gider
    maxRange: 560,        // tam dolunca bu kadar gider (istek üzerine 675'ten kısıldı)
    chargeMs: 850,        // menzilin dolması bu kadar sürer (bilgisayarda)
    blastR: 100,          // patlama yarıçapı (125'ten %20 küçültüldü)
    blastDmg: 56,         // merkezdeki hasar (kenarda %25'e iner)
  },
  // Pençe — YAKIN DÖVÜŞ. Mermi üretmez: ateşleyince önündeki dar koni
  // içindeki ilk düşmana anında hasar verir (bkz. Game.meleeSwing).
  // Mermi harcamaz, şarjörü bitmez; bu yüzden mag 1 / reserve 0 yeterli.
  pence: {
    id: 'pence', name: 'Pençe',
    dmg: 14, fireMs: 780, speed: 1, spread: 0, pellets: 1,
    mag: 1, reserve: 0, reloadMs: 0, range: 56, bulletR: 0, auto: true,
    melee: true,
    koni: 1.1,        // pençenin taradığı yay (radyan, toplam açı)
  },
};
export const WEAPON_IDS = Object.keys(WEAPONS);

// --- Silahın elde durduğu yer (namlu ucu) --------------------------------
// TEK KAYNAK. Burası hem çizimi hem de merminin doğduğu noktayı belirliyor.
//
// NEDEN TEK YERDE: mermi sunucuda oyuncunun TAM MERKEZİNDEN, 22 piksel ileriden
// doğuyordu; silah ise ekranda gövdenin 18 piksel yukarısına, 32 piksel ileriye
// çizilmişti. İkisi aynı yeri göstermediği için mermi "silahtan değil adamdan"
// çıkıyor gibi görünüyordu. Artık iki taraf da aşağıdaki tek hesabı kullanıyor.
//
// Ölçüler çizim biriminde (dünya pikseli):
//   tut  — namlunun kabzadan ileri başladığı yer
//   boy  — namlu uzunluğu
export const WEAPON_VIEW = {
  rifle:   { tut: 4, boy: 28 },
  shotgun: { tut: 4, boy: 25 },
  sniper:  { tut: 4, boy: 34 },
  // Bombacının elinde namlu YOK, bomba var: mermi doğrudan elden çıkar.
  bomba:   { tut: 4, boy: 3 },
  // Pençede namlu yok: "namlu ucu" avucun biraz ilerisi.
  pence:   { tut: 2, boy: 8 },
};
// Ellerin gövde merkezine göre yüksekliği (yukarısı eksi) ve yana kaçıklığı.
export const HAND_Y = -PLAYER_RADIUS * 1.15;
export const HAND_SIDE = 5;

/**
 * Namlu ucunun dünya koordinatı. Mermi buradan doğar, namlu alevi burada çakar.
 * @returns {{x:number,y:number}}
 */
export function muzzleWorld(x, y, aim, wepId) {
  const v = WEAPON_VIEW[wepId] || WEAPON_VIEW.rifle;
  const ileri = v.tut + v.boy;
  const c = Math.cos(aim), s = Math.sin(aim);
  return {
    x: x + c * ileri - s * HAND_SIDE,
    y: y + HAND_Y + s * ileri + c * HAND_SIDE,
  };
}

// --- Daralan alan (Son Hayatta Kalan) ------------------------------------
export const ZONE = {
  startDelayMs: 18000,   // ilk daralmaya kadar bekleme
  shrinkMs: 22000,       // bir daralma evresinin süresi
  holdMs: 8000,          // evreler arası bekleme
  phases: 6,             // toplam ~3,5 dakikada merkeze iner (maç 5 dk)
  minRadius: 260,
  dpsBase: 3,            // alan dışı saniyelik hasar
  dpsPerPhase: 2.5,
};

// --- Girdi bit maskesi ----------------------------------------------------
export const IN_UP = 1 << 0;
export const IN_DOWN = 1 << 1;
export const IN_LEFT = 1 << 2;
export const IN_RIGHT = 1 << 3;
export const IN_FIRE = 1 << 4;
export const IN_RELOAD = 1 << 5;
export const IN_DROP = 1 << 6;   // CTF: taşınan bayrağı elden bırak

// --- Ölüm sebepleri -------------------------------------------------------
export const DEATH_BULLET = 0;
export const DEATH_ZONE = 1;

// Zombilerin skor akışında görünen adları. Tip adı + numara ("Yürüyen 3")
// olarak üretilir; havuzdaki her yuvaya maç başında bir kez verilir.
export const ZOMBI_ADLARI = ['Yürüyen', 'Koşucu', 'İri'];

export const BOT_NAMES = [
  'Bozkurt', 'Kartal', 'Şahin', 'Yıldırım', 'Fırtına', 'Tunç', 'Demir', 'Alp',
  'Kılıç', 'Poyraz', 'Batur', 'Serdar', 'Korkut', 'Toygar', 'Atmaca', 'Ejder',
  'Gökmen', 'Sancak', 'Barbaros', 'Kayra',
];
