// Lobi: oyuncuların toplandığı, ayarların yapıldığı ve maçın başlatıldığı yer.
// Bir lobide EN FAZLA 20 kişi bulunur (MAX_PLAYERS).

import {
  MAX_PLAYERS, MODES, DEFAULT_MODE, CLASSES, DEFAULT_CLASS, COUNTDOWN_MS,
  CHARACTERS, DEFAULT_CHAR, CHAR_IDS,
  POST_MATCH_MS, SNAPSHOT_MS, MIN_PLAYERS_TO_START, BOT_NAMES, CLASS_IDS,
  MAX_LOBBY_NAME_LEN, MAX_CHAT_LEN,
  BOT_LEVELS, DEFAULT_BOT_LEVEL,
} from '../constants.js';
import { S } from '../protocol.js';
import { Game } from './game.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode(len = 5) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

function sanitize(str, max) {
  return String(str ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// Yeni gelen oyuncuya lobide kullanılmayan bir karakter ver (herkes aynı
// görünmesin); hepsi doluysa rastgele seç.
function pickFreeChar(lobby) {
  const used = new Set([...lobby.members.values()].map((m) => m.char));
  const free = CHAR_IDS.filter((id) => !used.has(id));
  if (free.length) return free[0];
  return CHAR_IDS[Math.floor(Math.random() * CHAR_IDS.length)] || DEFAULT_CHAR;
}

let lobbySeq = 0;

export class Lobby {
  constructor(hub, host, opts = {}) {
    this.hub = hub;
    this.id = `L${++lobbySeq}`;
    this.code = makeCode();
    this.name = sanitize(opts.name, MAX_LOBBY_NAME_LEN) || `${host.name} lobisi`;
    this.modeId = MODES[opts.mode] ? opts.mode : DEFAULT_MODE;
    this.maxPlayers = Math.min(MAX_PLAYERS, Math.max(2, opts.maxPlayers | 0 || MAX_PLAYERS));
    this.private = !!opts.private;
    this.botCount = Math.min(MAX_PLAYERS - 1, Math.max(0, opts.botCount | 0));
    this.botLevel = BOT_LEVELS[opts.botLevel] ? opts.botLevel : DEFAULT_BOT_LEVEL;
    this.hostId = host.id;
    this.members = new Map();     // clientId -> member
    this.state = 'waiting';       // waiting | countdown | playing | post
    this.countdownEnd = 0;
    this.postEnd = 0;
    this.game = null;
    this.snapAccum = 0;
    this.createdAt = Date.now();
    this.chatLog = [];
  }

  // --- Üyeler -------------------------------------------------------------
  get humanCount() { return this.members.size; }

  isFull() { return this.members.size >= this.maxPlayers; }

  add(client) {
    if (this.isFull()) return { ok: false, error: 'Lobi dolu (en fazla 20 kişi).' };
    if (this.members.has(client.id)) return { ok: true };

    const member = {
      id: client.id,
      name: client.name,
      ready: false,
      cls: DEFAULT_CLASS,
      char: pickFreeChar(this),
      team: this.modeId === 'tdm' ? this.pickBalancedTeam() : 0,
      spectating: false,
    };
    this.members.set(client.id, member);
    client.lobbyId = this.id;
    if (!this.members.has(this.hostId)) this.hostId = client.id;

    this.sysChat(`${client.name} lobiye katıldı.`);

    // Devam eden maça geç katılma: yeniden doğuşlu modlarda hemen oyuna al.
    if (this.state === 'playing' && this.game) {
      if (MODES[this.modeId].respawn) {
        const p = this.game.addPlayer({
          id: client.id, name: client.name, bot: false,
          team: member.team, cls: member.cls, char: member.char, conn: client.ws,
        });
        this.hub.send(client, S.MATCH_START, this.game.matchStartPayload(p));
      } else {
        member.spectating = true;
        this.hub.send(client, S.CHAT, { sys: true, text: 'Maç sürüyor. Bir sonraki turda oyuna gireceksin.' });
      }
    }
    this.broadcastState();
    return { ok: true };
  }

  remove(clientId, reason = 'left') {
    const m = this.members.get(clientId);
    if (!m) return;
    this.members.delete(clientId);
    if (this.game) this.game.removePlayer(clientId);
    this.sysChat(`${m.name} ayrıldı.`);

    if (this.hostId === clientId) {
      const next = this.members.keys().next();
      this.hostId = next.done ? null : next.value;
      if (this.hostId) this.sysChat(`${this.members.get(this.hostId).name} artık lobi sahibi.`);
    }
    if (this.members.size === 0) {
      this.hub.destroyLobby(this.id);
      return;
    }
    if (this.state === 'countdown' && !this.canStart()) {
      this.state = 'waiting';
      this.sysChat('Geri sayım iptal edildi.');
    }
    this.broadcastState();
  }

  pickBalancedTeam() {
    let t1 = 0, t2 = 0;
    for (const m of this.members.values()) {
      if (m.team === 1) t1++; else if (m.team === 2) t2++;
    }
    return t1 <= t2 ? 1 : 2;
  }

  // --- Ayarlar ------------------------------------------------------------
  setSettings(clientId, s) {
    if (clientId !== this.hostId) return 'Sadece lobi sahibi ayarları değiştirebilir.';
    if (this.state === 'playing' || this.state === 'countdown') return 'Maç sırasında ayar değiştirilemez.';

    if (s.mode && MODES[s.mode] && s.mode !== this.modeId) {
      this.modeId = s.mode;
      // Takım moduna geçişte takımları dengele
      if (MODES[this.modeId].teams) {
        let i = 0;
        for (const m of this.members.values()) m.team = (i++ % 2) + 1;
      } else {
        for (const m of this.members.values()) m.team = 0;
      }
      for (const m of this.members.values()) m.ready = false;
      this.sysChat(`Mod değişti: ${MODES[this.modeId].name}`);
    }
    if (s.name !== undefined) {
      const n = sanitize(s.name, MAX_LOBBY_NAME_LEN);
      if (n) this.name = n;
    }
    if (s.maxPlayers !== undefined) {
      const v = Math.min(MAX_PLAYERS, Math.max(2, s.maxPlayers | 0));
      if (v < this.members.size) return 'Lobide zaten daha fazla oyuncu var.';
      this.maxPlayers = v;
    }
    if (s.botCount !== undefined) {
      this.botCount = Math.min(MAX_PLAYERS - 1, Math.max(0, s.botCount | 0));
    }
    if (s.botLevel !== undefined && BOT_LEVELS[s.botLevel]) this.botLevel = s.botLevel;
    if (s.private !== undefined) this.private = !!s.private;

    this.broadcastState();
    return null;
  }

  setReady(clientId, ready) {
    const m = this.members.get(clientId);
    if (!m) return;
    m.ready = !!ready;
    if (this.state === 'waiting' && this.allReady() && this.canStart()) this.beginCountdown();
    else if (this.state === 'countdown' && !this.allReady()) {
      this.state = 'waiting';
      this.sysChat('Geri sayım iptal edildi.');
    }
    this.broadcastState();
  }

  setClass(clientId, cls) {
    const m = this.members.get(clientId);
    if (!m || !CLASSES[cls]) return;
    m.cls = cls;
    // Maç sırasında sınıf değişimi bir sonraki doğuşta geçerli olur.
    if (this.game) {
      const p = this.game.players.get(clientId);
      if (p) p.pendingCls = cls;
    }
    this.broadcastState();
  }

  setChar(clientId, char) {
    const m = this.members.get(clientId);
    if (!m || !CHARACTERS[char]) return;
    m.char = char;
    // Maç sürüyorsa görünüş hemen değişsin
    const p = this.game?.players.get(clientId);
    if (p) p.char = char;
    this.broadcastState();
  }

  setTeam(clientId, team) {
    const m = this.members.get(clientId);
    if (!m || !MODES[this.modeId].teams) return;
    const t = team === 2 ? 2 : 1;
    let count = 0;
    for (const o of this.members.values()) if (o.team === t) count++;
    if (count >= Math.ceil(this.maxPlayers / 2)) return;
    m.team = t;
    m.ready = false;
    this.broadcastState();
  }

  kick(hostId, targetId) {
    if (hostId !== this.hostId || hostId === targetId) return;
    const target = this.members.get(targetId);
    if (!target) return;
    const client = this.hub.clients.get(targetId);
    this.remove(targetId, 'kicked');
    if (client) {
      client.lobbyId = null;
      this.hub.send(client, S.LOBBY_LEFT, { reason: 'Lobi sahibi tarafından atıldın.' });
    }
  }

  chat(clientId, text) {
    const m = this.members.get(clientId);
    if (!m) return;
    const t = sanitize(text, MAX_CHAT_LEN);
    if (!t) return;
    const now = Date.now();
    m.lastChat = m.lastChat || 0;
    if (now - m.lastChat < 400) return;   // basit spam koruması
    m.lastChat = now;
    this.pushChat({ from: m.name, text: t, team: m.team, sys: false });
  }

  sysChat(text) { this.pushChat({ from: '', text, sys: true }); }

  pushChat(msg) {
    msg.t = Date.now();
    this.chatLog.push(msg);
    if (this.chatLog.length > 60) this.chatLog.shift();
    this.broadcast(S.CHAT, msg);
  }

  // --- Başlatma -----------------------------------------------------------
  canStart() {
    return this.members.size >= MIN_PLAYERS_TO_START;
  }

  // Lobi sahibi de dahil HERKES hazır olmadan maç başlamaz.
  allReady() {
    if (this.members.size === 0) return false;
    for (const m of this.members.values()) if (!m.ready) return false;
    return true;
  }

  readyCount() {
    let n = 0;
    for (const m of this.members.values()) if (m.ready) n++;
    return n;
  }

  requestStart(clientId) {
    if (clientId !== this.hostId) return 'Maçı sadece lobi sahibi başlatabilir.';
    if (this.state === 'playing') return 'Maç zaten sürüyor.';
    if (this.state === 'countdown') return null;
    if (!this.canStart()) return 'Başlamak için en az 1 oyuncu gerekli.';
    this.beginCountdown();
    return null;
  }

  beginCountdown() {
    this.state = 'countdown';
    this.countdownEnd = Date.now() + COUNTDOWN_MS;
    this.sysChat(`Herkes hazır — maç ${Math.round(COUNTDOWN_MS / 1000)} saniye içinde başlıyor!`);
    this.broadcastState();
  }

  startMatch() {
    this.matchNo = (this.matchNo || 0) + 1;
    const mode = MODES[this.modeId];
    const roster = [];

    for (const m of this.members.values()) {
      m.spectating = false;
      const client = this.hub.clients.get(m.id);
      roster.push({
        id: m.id, name: m.name, bot: false,
        team: mode.teams ? (m.team || 1) : 0,
        cls: m.cls, char: m.char, conn: client ? client.ws : null,
      });
    }

    // Botlarla doldur
    const slots = Math.min(this.maxPlayers, roster.length + this.botCount);
    let botIdx = 0;
    const usedNames = new Set(roster.map((r) => r.name));
    // Sınıflar dengeli dağılsın (hepsi keskin nişancı olmasın)
    const clsPool = CLASS_IDS.slice().sort(() => Math.random() - 0.5);
    while (roster.length < slots) {
      let name = BOT_NAMES[botIdx % BOT_NAMES.length];
      if (usedNames.has(name)) name = `${name}${Math.floor(botIdx / BOT_NAMES.length) + 2}`;
      usedNames.add(name);
      botIdx++;
      let team = 0;
      if (mode.teams) {
        let t1 = 0, t2 = 0;
        for (const r of roster) { if (r.team === 1) t1++; else if (r.team === 2) t2++; }
        team = t1 <= t2 ? 1 : 2;
      }
      roster.push({
        id: this.hub.nextBotId(),
        name, bot: true, team,
        botLevel: this.botLevel,
        cls: clsPool[(botIdx - 1) % clsPool.length],
        char: CHAR_IDS[(botIdx - 1) % CHAR_IDS.length],
        conn: null,
      });
    }

    this.game = new Game({ modeId: this.modeId, players: roster });
    this.state = 'playing';
    this.snapAccum = 0;

    for (const m of this.members.values()) {
      const client = this.hub.clients.get(m.id);
      const p = this.game.players.get(m.id);
      if (client && p) this.hub.send(client, S.MATCH_START, this.game.matchStartPayload(p));
    }
    this.broadcastState();
    this.hub.broadcastLobbyList();
  }


  // --- Tick ---------------------------------------------------------------
  tick(dtMs) {
    const now = Date.now();

    if (this.state === 'countdown' && now >= this.countdownEnd) {
      this.startMatch();
      return;
    }

    if (this.state === 'playing' && this.game) {
      const g = this.game;
      g.tick(dtMs);

      this.snapAccum += dtMs;
      if (this.snapAccum >= SNAPSHOT_MS) {
        this.snapAccum -= SNAPSHOT_MS;
        if (this.snapAccum > SNAPSHOT_MS * 3) this.snapAccum = 0;
        g.prepareSnapshot();
        for (const m of this.members.values()) {
          const client = this.hub.clients.get(m.id);
          const p = g.players.get(m.id);
          if (!client || !p) continue;
          const snap = g.snapshotFor(p);
          snap.you.pg = Math.round(client.ping || 0);   // ölçülen gecikme (ms)
          this.hub.send(client, S.SNAPSHOT, snap);
        }
        g.clearEvents();
      }

      if (g.over) {
        this.game = null;
        this._lastScoreboard = g.scoreboard();
        // Her maça bir numara: istemci 'bu tabloyu zaten gördüm' diyebilsin.
        this._lastScoreboard.matchId = `${this.id}-${this.matchNo || 1}`;
        this.state = 'post';
        this.postEnd = now + POST_MATCH_MS;
        this.broadcast(S.MATCH_END, { scoreboard: this._lastScoreboard, nextIn: POST_MATCH_MS });
        for (const m of this.members.values()) m.ready = false;
        this.broadcastState();
        this.hub.broadcastLobbyList();
      }
      return;
    }

    if (this.state === 'post' && now >= this.postEnd) {
      this.state = 'waiting';
      this.broadcastState();
      this.hub.broadcastLobbyList();
    }
  }

  // --- Serileştirme -------------------------------------------------------
  summary() {
    return {
      id: this.id,
      name: this.name,
      mode: this.modeId,
      players: this.members.size,
      max: this.maxPlayers,
      bots: this.botCount,
      botLevel: this.botLevel,
      state: this.state,
      private: this.private,
    };
  }

  full() {
    return {
      id: this.id,
      code: this.code,
      name: this.name,
      mode: this.modeId,
      maxPlayers: this.maxPlayers,
      botCount: this.botCount,
      botLevel: this.botLevel,
      private: this.private,
      hostId: this.hostId,
      state: this.state,
      readyCount: this.readyCount(),
      countdownLeft: this.state === 'countdown' ? Math.max(0, this.countdownEnd - Date.now()) : 0,
      postLeft: this.state === 'post' ? Math.max(0, this.postEnd - Date.now()) : 0,
      members: [...this.members.values()].map((m) => ({
        id: m.id, name: m.name, ready: m.ready, cls: m.cls, char: m.char, team: m.team,
        host: m.id === this.hostId, spectating: m.spectating,
      })),
      chat: this.chatLog.slice(-25),
      lastScoreboard: this._lastScoreboard || null,
    };
  }

  broadcast(type, payload) {
    for (const m of this.members.values()) {
      const client = this.hub.clients.get(m.id);
      if (client) this.hub.send(client, type, payload);
    }
  }

  broadcastState() {
    const data = this.full();
    for (const m of this.members.values()) {
      const client = this.hub.clients.get(m.id);
      if (client) this.hub.send(client, S.LOBBY_STATE, { lobby: data });
    }
    this.hub.broadcastLobbyList();
  }
}
