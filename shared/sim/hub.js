// Bağlantı ve lobi yönetimi. Taşıma katmanından (WebSocket / tarayıcı içi)
// bağımsızdır: bir istemcinin tek gereksinimi `ws.readyState` ve `ws.send(str)`
// sunmasıdır. Bu sayede aynı kod hem sunucuda hem telefonun içinde çalışır.

import {
  MAX_PLAYERS, MODES, CLASSES, MAX_NAME_LEN, PROTOCOL_VERSION,
} from '../constants.js';
import { C, S } from '../protocol.js';
import { Lobby } from './lobby.js';
import { encodeSnapshot } from '../binary.js';

export class Hub {
  constructor() {
    this.clients = new Map();     // id -> client
    this.lobbies = new Map();     // id -> Lobby
    this.nextClientId = 1;
    this.nextBot = 100000;
    this.listDirty = false;
    this.lastListSent = 0;
  }

  nextBotId() { return ++this.nextBot; }

  // --- Bağlantı yaşam döngüsü ---------------------------------------------
  addClient(ws, ip) {
    const client = {
      id: this.nextClientId++,
      ws,
      ip,
      name: `Oyuncu${this.nextClientId - 1}`,
      lobbyId: null,
      alive: true,
      ping: 0,
      lastSeen: Date.now(),
      msgCount: 0,
      msgWindow: Date.now(),
    };
    this.clients.set(client.id, client);
    return client;
  }

  dropClient(client, reason = '') {
    if (!this.clients.has(client.id)) return;
    const lobby = client.lobbyId ? this.lobbies.get(client.lobbyId) : null;
    this.clients.delete(client.id);
    if (lobby) lobby.remove(client.id, reason);
    this.listDirty = true;
  }

  // Bir mesajı istemciye yollar.
  //
  // Durum paketleri (snapshot) sunucudan çıkan verinin neredeyse tamamıdır ve
  // saniyede 20 kez gider. İstemci "ben ikili anlıyorum" dediyse bunları JSON
  // yerine ikili gönderiyoruz — aynı bilgi, ~3,7 kat az bayt.
  //
  // Diyemeyen (eski) istemciler eskisi gibi JSON alır: kimsenin oyunu bozulmaz.
  // Kodlayıcı beklenmedik bir değerle karşılaşırsa hata fırlatır; o paketi
  // sessizce bozuk göndermek yerine JSON'a düşüyoruz.
  send(client, type, payload) {
    if (!client || !client.ws || client.ws.readyState !== 1) return;
    if (client.bin && type === S.SNAPSHOT) {
      try {
        client.ws.send(encodeSnapshot(payload));
        return;
      } catch (e) {
        if (!this._binUyarildi) {
          this._binUyarildi = true;
          console.warn('[ikili] paket kodlanamadı, JSON’a düşülüyor:', e && e.message);
        }
      }
    }
    try {
      client.ws.send(JSON.stringify({ ty: type, ...payload }));
    } catch { /* bağlantı kopmuş olabilir */ }
  }

  error(client, message) { this.send(client, S.ERROR, { message }); }

  // --- Lobiler ------------------------------------------------------------
  createLobby(client, opts) {
    if (this.lobbies.size > 200) return { error: 'Sunucuda çok fazla lobi var, biraz sonra dene.' };
    const lobby = new Lobby(this, client, opts);
    this.lobbies.set(lobby.id, lobby);
    const r = lobby.add(client);
    if (!r.ok) { this.lobbies.delete(lobby.id); return { error: r.error }; }
    this.listDirty = true;
    return { lobby };
  }

  destroyLobby(id) {
    this.lobbies.delete(id);
    this.listDirty = true;
  }

  lobbyList() {
    return [...this.lobbies.values()]
      .filter((l) => !l.private)
      .sort((a, b) => b.members.size - a.members.size || a.createdAt - b.createdAt)
      .slice(0, 60)
      .map((l) => l.summary());
  }

  broadcastLobbyList() { this.listDirty = true; }

  flushLobbyList() {
    if (!this.listDirty) return;
    this.listDirty = false;
    const list = this.lobbyList();
    for (const c of this.clients.values()) {
      if (!c.lobbyId) this.send(c, S.LOBBY_LIST, { lobbies: list });
    }
  }

  // --- Zaman ilerletme ----------------------------------------------------
  // Sabit adımlı döngü. Hem Node sunucusu hem tarayıcı içi mod bunu çağırır.
  tick(dtMs) {
    for (const lobby of [...this.lobbies.values()]) {
      try { lobby.tick(dtMs); } catch (err) { console.error('[hata] lobi tick:', lobby.id, err); }
    }
  }

  // --- Mesaj yönlendirme --------------------------------------------------
  handle(client, msg) {
    const lobby = client.lobbyId ? this.lobbies.get(client.lobbyId) : null;

    switch (msg.ty) {
      case C.HELLO: {
        const name = cleanName(msg.name) || client.name;
        client.name = name;
        // İstemci ikili durum paketi çözebiliyorsa bunu burada söyler.
        // Söylemeyen eski sürümler JSON almaya devam eder.
        client.bin = msg.bin === 1 || msg.bin === true;
        this.send(client, S.WELCOME, {
          id: client.id,
          name,
          config: {
            maxPlayers: MAX_PLAYERS,
            modes: MODES,
            classes: CLASSES,
            version: PROTOCOL_VERSION,
            bin: !!client.bin,
          },
        });
        this.send(client, S.LOBBY_LIST, { lobbies: this.lobbyList() });
        break;
      }

      case C.RENAME: {
        const name = cleanName(msg.name);
        if (!name) return;
        client.name = name;
        if (lobby) {
          const m = lobby.members.get(client.id);
          if (m) { m.name = name; lobby.broadcastState(); }
          const p = lobby.game?.players.get(client.id);
          if (p) p.name = name;
        }
        break;
      }

      case C.LOBBY_LIST:
        this.send(client, S.LOBBY_LIST, { lobbies: this.lobbyList() });
        break;

      case C.LOBBY_CREATE: {
        if (lobby) lobby.remove(client.id);
        const { lobby: created, error } = this.createLobby(client, {
          name: msg.name,
          mode: msg.mode,
          maxPlayers: msg.maxPlayers,
          private: msg.private,
          botCount: msg.botCount,
          botLevel: msg.botLevel,
        });
        if (error) this.error(client, error);
        else this.send(client, S.LOBBY_STATE, { lobby: created.full() });
        break;
      }

      case C.LOBBY_JOIN: {
        let target = null;
        if (msg.id) target = this.lobbies.get(msg.id);
        else if (msg.code) {
          const code = String(msg.code).toUpperCase().trim();
          target = [...this.lobbies.values()].find((l) => l.code === code) || null;
        }
        if (!target) { this.error(client, 'Lobi bulunamadı.'); break; }
        if (lobby && lobby !== target) lobby.remove(client.id);
        const r = target.add(client);
        if (!r.ok) { this.error(client, r.error); break; }
        this.send(client, S.LOBBY_STATE, { lobby: target.full() });
        break;
      }

      case C.LOBBY_LEAVE: {
        if (lobby) lobby.remove(client.id);
        client.lobbyId = null;
        this.send(client, S.LOBBY_LEFT, { reason: '' });
        this.send(client, S.LOBBY_LIST, { lobbies: this.lobbyList() });
        break;
      }

      case C.LOBBY_CHAT: if (lobby) lobby.chat(client.id, msg.text); break;
      case C.SET_READY: if (lobby) lobby.setReady(client.id, msg.ready); break;
      case C.SET_CLASS: if (lobby) lobby.setClass(client.id, msg.cls); break;
      case C.SET_CHAR: if (lobby) lobby.setChar(client.id, msg.char); break;
      case C.SET_TEAM: if (lobby) lobby.setTeam(client.id, msg.team); break;
      case C.KICK: if (lobby) lobby.kick(client.id, msg.id); break;

      case C.SET_SETTINGS: {
        if (!lobby) break;
        const err = lobby.setSettings(client.id, msg);
        if (err) this.error(client, err);
        break;
      }

      case C.START: {
        if (!lobby) break;
        const err = lobby.requestStart(client.id);
        if (err) this.error(client, err);
        break;
      }

      case C.INPUT: {
        const g = lobby?.game;
        if (!g) break;
        const p = g.players.get(client.id);
        if (p) g.queueInput(p, msg);
        break;
      }

      case C.PONG: {
        if (typeof msg.t === 'number') client.ping = Math.max(0, Date.now() - msg.t);
        client.lastSeen = Date.now();
        break;
      }

      default: break;
    }
  }
}

function cleanName(raw) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LEN);
}
