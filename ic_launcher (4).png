// Bağlantı katmanı.
//
// İki taşıma biçimi var ve ikisi de AYNI mesajları taşır:
//   • WsTransport    — uzaktaki sunucuya WebSocket ile
//   • LocalTransport — oyun sunucusunun tarayıcı içinde çalıştığı çevrimdışı mod
//
// Net sınıfı ikisinin önünde duran ince bir vekildir; oyun kodu hangi taşımanın
// kullanıldığını bilmez, bu yüzden çevrimdışı ve online oynanış birebir aynıdır.

import { C } from '/shared/protocol.js';
import { decodeSnapshot } from '/shared/binary.js';

export class Net {
  constructor() {
    this.handlers = new Map();
    this.impl = null;
    this.mode = null;          // 'local' | 'online'
    this.ping = 0;
    this.url = '';
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return this;
  }

  emit(type, data) {
    const list = this.handlers.get(type);
    if (list) for (const fn of list) fn(data);
  }

  get connected() { return !!(this.impl && this.impl.connected); }

  async connectLocal() {
    this.disconnect();
    // Simülasyon kodu yalnızca çevrimdışı oynanınca yüklenir.
    const { LocalTransport } = await import('./local.js');
    this.mode = 'local';
    this.url = '';
    this.ping = 0;
    this.impl = new LocalTransport(this);
    this.impl.start();
  }

  connectRemote(url) {
    this.disconnect();
    this.mode = 'online';
    this.url = url || '';
    this.impl = new WsTransport(this, url);
    this.impl.start();
  }

  disconnect() {
    if (this.impl) { try { this.impl.stop(); } catch { /* yok say */ } }
    this.impl = null;
    this.mode = null;
  }

  send(type, payload = {}) {
    if (this.impl) this.impl.send(type, payload);
  }
}

// --- Uzak sunucu (WebSocket) ---------------------------------------------
class WsTransport {
  constructor(net, url) {
    this.net = net;
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.retry = 0;
    this.retryTimer = null;
    this.queue = [];
    this.stopped = false;
  }

  // "sunucu.com" → "wss://sunucu.com" gibi kullanıcı dostu dönüşüm
  resolveUrl() {
    let u = (this.url || '').trim();
    if (!u) {
      // Sayfanın kendi sunucusu. file:// gibi sunucusuz bir yerden açıldıysa
      // location.host BOŞTUR; böyle bir adrese bağlanmak imkânsızdır, o yüzden
      // burada açıkça hata veriyoruz (sessizce sonsuz denemek yerine).
      if (!location.host) throw new Error('Sunucu adresi yok');
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${location.host}`;
    }
    if (u.startsWith('ws://') || u.startsWith('wss://')) return u;
    if (u.startsWith('https://')) return `wss://${u.slice(8)}`;
    if (u.startsWith('http://')) return `ws://${u.slice(7)}`;
    // Şema yoksa: yerel ağ adresleri ws, diğerleri wss
    const local = /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u);
    return `${local ? 'ws' : 'wss'}://${u.replace(/\/+$/, '')}`;
  }

  start() {
    this.stopped = false;
    let target;
    try {
      target = this.resolveUrl();
    } catch (e) {
      this.net.emit('_error', { message: e.message || 'Adres anlaşılamadı' });
      return;
    }

    try {
      this.ws = new WebSocket(target);
      // Durum paketleri ikili geliyor; varsayılan Blob yerine doğrudan
      // ArrayBuffer isteyelim ki senkron çözebilelim.
      this.ws.binaryType = 'arraybuffer';
    } catch {
      this.scheduleRetry();
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.retry = 0;
      this.net.emit('_open');
      for (const m of this.queue) this.ws.send(m);
      this.queue.length = 0;
    };

    this.ws.onmessage = (e) => {
      let msg;
      if (typeof e.data !== 'string') {
        // İkili durum paketi. Çözülemezse paketi atıyoruz: bir sonraki
        // paket 50 ms sonra geliyor, oyun kendini toparlar.
        try {
          msg = decodeSnapshot(new Uint8Array(e.data));
        } catch (err) {
          if (!this.binHata) { this.binHata = true; console.warn('ikili paket çözülemedi:', err); }
          return;
        }
        this.net.emit(msg.ty, msg);
        return;
      }
      try { msg = JSON.parse(e.data); } catch { return; }
      // Gecikme ölçümü sunucuda yapılır; sonucu durum paketiyle geri alıyoruz.
      if (msg.ty === 'ping') { this.send(C.PONG, { t: msg.t }); return; }
      this.net.emit(msg.ty, msg);
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.net.emit('_close');
      if (!this.stopped) this.scheduleRetry();
    };

    this.ws.onerror = () => { /* onclose zaten tetiklenecek */ };
  }

  scheduleRetry() {
    if (this.retryTimer || this.stopped) return;
    this.retry++;
    const delay = Math.min(8000, 500 * 2 ** Math.min(4, this.retry));
    this.net.emit('_retry', { in: delay, attempt: this.retry });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) this.start();
    }, delay);
  }

  send(type, payload) {
    // Sunucuya ikili paket çözebildiğimizi tanışma mesajında söylüyoruz.
    // Bu bir TAŞIMA yeteneğidir, oyun kuralı değil — o yüzden burada eklenir.
    if (type === C.HELLO) payload = { ...payload, bin: 1 };
    const data = JSON.stringify({ ty: type, ...payload });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
    else if (this.queue.length < 40) this.queue.push(data);
  }

  stop() {
    this.stopped = true;
    this.connected = false;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch { /* yok say */ } this.ws = null; }
  }
}
