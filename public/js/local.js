// Çevrimdışı mod: oyun sunucusunu doğrudan tarayıcının içinde çalıştırır.
//
// Ayrı bir "tek kişilik oyun" kodu YAZMIYORUZ. Gerçek sunucudaki Hub/Lobby/Game
// sınıflarının aynısını burada da çalıştırıyoruz; sadece WebSocket yerine
// bellek içi bir boru kullanıyoruz. Böylece çevrimdışı oynanış, online oynanışla
// birebir aynı davranır ve oyun mantığı tek yerde kalır.

import { Hub } from '/shared/sim/hub.js';
import { TICK_MS } from '/shared/constants.js';

export class LocalTransport {
  constructor(net) {
    this.net = net;
    this.hub = null;
    this.client = null;
    this.connected = false;
    this.inbox = [];
    this.flushQueued = false;
    this.rafId = 0;
    this.acc = 0;
    this.last = 0;
    this.stopped = false;
    this.step = this.step.bind(this);
  }

  start() {
    this.stopped = false;
    this.hub = new Hub();

    // Sunucunun "soket" gördüğü nesne. Tek gereksinimi readyState ve send.
    const socket = {
      readyState: 1,
      send: (str) => {
        let msg;
        try { msg = JSON.parse(str); } catch { return; }
        // Ping'i burada kısa devre yapıyoruz: gecikme zaten sıfır.
        if (msg.ty === 'ping') {
          this.hub.handle(this.client, { ty: 'pong', t: msg.t });
          return;
        }
        this.inbox.push(msg);
        this.queueFlush();
      },
    };

    this.client = this.hub.addClient(socket, 'local');
    this.connected = true;

    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.step);
    // Uygulama kodu bağlantının açıldığını duysun
    queueMicrotask(() => { if (!this.stopped) this.net.emit('_open'); });
  }

  // Sunucudan gelen mesajları senkron değil, mikro görevde dağıtıyoruz:
  // hub bir mesajı işlerken istemcinin yeni mesaj göndermesi karışıklık yaratmasın.
  queueFlush() {
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      const q = this.inbox;
      this.inbox = [];
      for (const m of q) {
        if (this.stopped) return;
        this.net.emit(m.ty, m);
      }
    });
  }

  // Sabit adımlı simülasyon. Sekme arka plana alınınca rAF durur; oyun da
  // durur — tek kişilik oyunda istenen davranış bu.
  step(now) {
    if (this.stopped) return;
    this.rafId = requestAnimationFrame(this.step);

    let elapsed = now - this.last;
    this.last = now;
    if (elapsed > 250) elapsed = 250;    // uzun donmalarda ileri sarma yapma
    this.acc += elapsed;

    let steps = 0;
    while (this.acc >= TICK_MS && steps < 5) {
      this.acc -= TICK_MS;
      steps++;
      this.hub.tick(TICK_MS);
    }
    if (steps === 5) this.acc = 0;

    this.hub.flushLobbyList();
  }

  send(type, payload) {
    if (!this.hub || this.stopped) return;
    try {
      this.hub.handle(this.client, { ty: type, ...payload });
    } catch (err) {
      console.error('[çevrimdışı sunucu hatası]', type, err);
    }
  }

  stop() {
    this.stopped = true;
    this.connected = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.hub = null;
    this.client = null;
    this.inbox.length = 0;
  }
}
