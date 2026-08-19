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
export const MIN_PLAYERS_TO_START = 1;       // botlarla tek başına da başlanabilsin
export const MAX_NAME_LEN = 16;
export const MAX_LOBBY_NAME_LEN = 24;
export const MAX_CHAT_LEN = 140;
export const LOBBY_CODE_LEN = 5;
export const COUNTDOWN_MS = 5000;            // "başlıyor" geri sayımı
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
};
export const MODE_IDS = Object.keys(MODES);
export const DEFAULT_MODE = 'ffa';

// --- Takımlar -------------------------------------------------------------
export const TEAMS = {
  0: { id: 0, name: 'Yok', color: '#9aa4b2' },
  1: { id: 1, name: 'Kızıl Tugay', color: '#ef4a4a', colorDim: '#7d2020' },
  2: { id: 2, name: 'Mavi Filo', color: '#3f9bff', colorDim: '#1d4a7d' },
};

// --- Haritalar ------------------------------------------------------------
// Harita boyutları. Yerleşim oransal üretildiği için bu sayıları
// değiştirmek yeterli — engeller ve doğuş noktaları kendiliğinden uyar.
export const MAPS = {
  arena: { w: 3400, h: 2400 },
  royale: { w: 4600, h: 3400 },
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
export const CLASSES = {
  komando: {
    id: 'komando',
    name: 'Komando',
    desc: 'Dengeli. Otomatik tüfek. Her duruma uyar.',
    speed: 218,
    hp: 100,
    weapon: 'rifle',
    color: '#7ee787',
  },
  akinci: {
    id: 'akinci',
    name: 'Akıncı',
    desc: 'Çok hızlı, az canlı. Pompalı ile yakın dövüş.',
    speed: 282,
    hp: 78,
    weapon: 'shotgun',
    color: '#ffd479',
  },
  nisanci: {
    id: 'nisanci',
    name: 'Keskin Nişancı',
    desc: 'Yavaş ama tek atışta yıkıcı. Uzun menzil.',
    speed: 176,
    hp: 88,
    weapon: 'sniper',
    color: '#c39bff',
  },
  bombaci: {
    id: 'bombaci',
    name: 'Bombacı',
    desc: 'Bomba atar. Basılı tut, menzili ayarla, bırak.',
    speed: 202,
    hp: 94,
    weapon: 'bomba',
    color: '#ff9f5a',
  },
};
export const CLASS_IDS = Object.keys(CLASSES);
export const DEFAULT_CLASS = 'komando';

// --- Bot zorluğu ----------------------------------------------------------
// Botların "yeteneği" tek bir sayı (0..1) ve şu üç şeyi birden belirliyor:
// nişan isabeti, hedefi ne kadar öngördüğü ve ateş etmeden önceki tepki
// gecikmesi. Bir de görüş menzili var: kolay botlar seni geç fark eder.
//
// Aralık veriyoruz, tek sayı değil: aynı zorlukta bile botlar birbirinin
// kopyası olmasın, aralarında biraz fark bulunsun.
export const BOT_LEVELS = {
  kolay: {
    id: 'kolay',
    name: 'Kolay',
    desc: 'Geç fark eder, ıskalar',
    skill: [0.12, 0.34],
    view: 780,
    reactMs: 520,
  },
  orta: {
    id: 'orta',
    name: 'Orta',
    desc: 'Dengeli rakip',
    skill: [0.42, 0.68],
    view: 1150,
    reactMs: 220,
  },
  zor: {
    id: 'zor',
    name: 'Zor',
    desc: 'Çabuk görür, isabetli',
    skill: [0.78, 0.98],
    view: 1400,
    reactMs: 90,
  },
};
export const BOT_LEVEL_IDS = Object.keys(BOT_LEVELS);
export const DEFAULT_BOT_LEVEL = 'orta';

// --- Karakterler ----------------------------------------------------------
// Görünüş seçimi; oynanışı etkilemez. Renkler kodla piksel piksel çizilir
// (public/js/sprites.js), hazır görsel dosyası yok.
export const CHARACTERS = {
  kivircik:  { id: 'kivircik',  name: 'Kıvırcık',   style: 'kabarik', hair: '#8a6a3f', skin: '#f0c8a0', jacket: '#2f3a4a', accent: '#e8c15a', eye: '#7fb0d8' },
  diken:     { id: 'diken',     name: 'Diken',      style: 'dikenli', hair: '#4e8f6d', skin: '#f2d0aa', jacket: '#23262e', accent: '#9fd8b4', eye: '#8fe0b0' },
  uzunsac:   { id: 'uzunsac',   name: 'Yele',       style: 'uzun',    hair: '#7a5a3a', skin: '#f4d3ae', jacket: '#2b3550', accent: '#cfd8e8', eye: '#6fa8d8' },
  kasketli:  { id: 'kasketli',  name: 'Kasketli',   style: 'kasket',  hair: '#3b3f5c', skin: '#e9c39c', jacket: '#20242c', accent: '#c8b26a', eye: '#9aa8e0' },
  karasac:   { id: 'karasac',   name: 'Karasaç',    style: 'uzun',    hair: '#2a2730', skin: '#a9714b', jacket: '#26282f', accent: '#d8b552', eye: '#c8a0d8' },
  gumus:     { id: 'gumus',     name: 'Gümüş',      style: 'kisa',    hair: '#c9c6bd', skin: '#eec9a6', jacket: '#33383f', accent: '#d9d3c0', eye: '#a8c8e0' },
  mavipercem:{ id: 'mavipercem',name: 'Mavi Perçem',style: 'kisa',    hair: '#5f7fc4', skin: '#f2d2b2', jacket: '#242a38', accent: '#b8cbe8', eye: '#7fc8e8' },
  esmer:     { id: 'esmer',     name: 'Esmer',      style: 'kabarik', hair: '#402e20', skin: '#8a5a3a', jacket: '#2c3630', accent: '#e0bb55', eye: '#d8b98f' },
};
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
    // Menzil, hasar ve patlama alanı yarıya indirildi; buna karşılık bomba
    // %50 daha hızlı gidiyor. Böylece bombacı "uzaktan tarla süpüren" değil,
    // yakın mesafede hızlı iş gören bir sınıf oluyor.
    dmg: 0, fireMs: 620, speed: 840, spread: 0.02, pellets: 1,
    mag: 3, reserve: 15, reloadMs: 2400, range: 450, bulletR: 8, auto: false,
    throwable: true,
    minRange: 95,         // hiç beklemeden bırakınca bu kadar gider
    maxRange: 450,        // tam dolunca bu kadar gider
    chargeMs: 850,        // menzilin dolması bu kadar sürer (bilgisayarda)
    blastR: 83,           // patlama yarıçapı
    blastDmg: 37,         // merkezdeki hasar (kenarda %25'e iner)
  },
};
export const WEAPON_IDS = Object.keys(WEAPONS);

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

// --- Ölüm sebepleri -------------------------------------------------------
export const DEATH_BULLET = 0;
export const DEATH_ZONE = 1;

export const BOT_NAMES = [
  'Bozkurt', 'Kartal', 'Şahin', 'Yıldırım', 'Fırtına', 'Tunç', 'Demir', 'Alp',
  'Kılıç', 'Poyraz', 'Batur', 'Serdar', 'Korkut', 'Toygar', 'Atmaca', 'Ejder',
  'Gökmen', 'Sancak', 'Barbaros', 'Kayra',
];
