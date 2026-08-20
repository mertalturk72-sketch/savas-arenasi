// İstemci <-> sunucu mesaj tipleri. Tek kaynak: iki taraf da buradan okur.

// İstemci -> Sunucu
export const C = {
  HELLO: 'hello',              // { name, version }
  LOBBY_LIST: 'lobbyList',     // {}
  LOBBY_CREATE: 'lobbyCreate', // { name, mode, maxPlayers, private, botCount }
  LOBBY_JOIN: 'lobbyJoin',     // { id } veya { code }
  LOBBY_LEAVE: 'lobbyLeave',   // {}
  LOBBY_CHAT: 'lobbyChat',     // { text }
  SET_READY: 'setReady',       // { ready }
  SET_CLASS: 'setClass',       // { cls }
  SET_CHAR: 'setChar',         // { char }
  SET_TEAM: 'setTeam',         // { team }
  SET_SETTINGS: 'setSettings', // { mode?, maxPlayers?, botCount?, private? }  (sadece host)
  KICK: 'kick',                // { id }  (sadece host)
  START: 'start',              // {}      (sadece host)
  INPUT: 'i',                  // { s, d, k, a }  seq, dtMs, keys, aim
  PONG: 'pong',                // { t }
  RENAME: 'rename',            // { name }
};

// Sunucu -> İstemci
export const S = {
  WELCOME: 'welcome',          // { id, name, config }
  LOBBY_LIST: 'lobbyList',     // { lobbies: [...] }
  LOBBY_STATE: 'lobbyState',   // { lobby }
  LOBBY_LEFT: 'lobbyLeft',     // { reason }
  CHAT: 'chat',                // { from, text, sys }
  ERROR: 'error',              // { message }
  MATCH_START: 'matchStart',   // { map, mode, you, players }
  SNAPSHOT: 'snap',            // ana durum paketi
  EVENTS: 'ev',                // anlık olaylar (snapshot içinde de gelir)
  MATCH_END: 'matchEnd',       // { scoreboard, winner }
  PING: 'ping',                // { t }
};

// --- Durum paketi (snapshot) biçimi --------------------------------------
// Bant genişliğini düşürmek için varlıklar nesne değil DÜZ SAYI DİZİSİ olarak
// gönderilir. Alan sayıları aşağıda; sıralama iki tarafta da aynıdır.
//
// snap.ps : her oyuncu için PS_FIELDS adet sayı
//   [ id, x, y, aim*100, hp, maxHp, sınıfIndeksi, bayraklar ]
// snap.bs : her mermi için BS_FIELDS adet sayı
//   [ id, x, y, açı*100, silahIndeksi ]
// snap.sc.ps : her oyuncu için SC_FIELDS adet sayı
//   [ id, öldürme, ölüm, hasar, ayaktaMı, asist ]
//
// bayraklar: 1=hayatta, 2=doğuş koruması, 4=şarjör dolduruyor, 8=namlu alevi,
//            16=çalıda gizli
export const PS_FIELDS = 8;
export const BS_FIELDS = 5;
export const SC_FIELDS = 6;

export const F_ALIVE = 1;
export const F_PROTECTED = 2;
export const F_RELOADING = 4;
export const F_MUZZLE = 8;
export const F_HIDDEN = 16;
