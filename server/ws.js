// Sıfır bağımlılıklı WebSocket sunucusu (RFC 6455, sunucu tarafı).
//
// Neden kendimiz yazdık:
//   Oyunun çalışması için tek dış paket `ws` idi. Bu da her yeni kopyada
//   "npm install" zorunluluğu, internet gereksinimi ve yeni başlayan biri için
//   anlaşılmaz bir `ERR_MODULE_NOT_FOUND` hatası demekti. Protokolün ihtiyaç
//   duyduğumuz kısmı birkaç yüz satır; onu buraya koyunca oyun `npm install`
//   olmadan, sadece Node ile çalışıyor.
//
// Kapsam: metin/ikili çerçeveler, parçalı mesaj birleştirme, ping/pong,
//   kapanış el sıkışması, maksimum yük sınırı, geri basınç koruması.
// Kapsam dışı: permessage-deflate (pazarlığa hiç girmiyoruz; tarayıcılar
//   sıkıştırma olmadan sorunsuz çalışır) ve alt protokoller.

import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export const CONNECTING = 0;
export const OPEN = 1;
export const CLOSING = 2;
export const CLOSED = 3;

const OP_CONT = 0x0;
const OP_TEXT = 0x1;
const OP_BIN = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

// Yazma kuyruğu bu kadar şişerse istemci bizi yiyemiyor demektir; bağlantıyı
// kapatıyoruz. Aksi halde tek yavaş istemci sunucunun belleğini şişirir.
const MAX_BACKLOG = 4 * 1024 * 1024;

function accept(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

/** Sunucudan istemciye çerçeve (maskesiz). */
function frame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.allocUnsafe(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  header[0] = 0x80 | opcode;   // FIN + opcode
  return Buffer.concat([header, payload], header.length + len);
}

export class WebSocket extends EventEmitter {
  constructor(socket, maxPayload) {
    super();
    this.socket = socket;
    this.maxPayload = maxPayload;
    this.readyState = OPEN;

    this._buf = Buffer.alloc(0);
    this._fragOp = 0;
    this._fragChunks = [];
    this._fragLen = 0;
    this._closeSent = false;

    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('error', (err) => { this._finish(1006, ''); this.emit('error', err); });
    socket.on('close', () => this._finish(1006, ''));

    // Karşı taraf TCP'yi yarım kapattı (FIN). Kapanış el sıkışmasını
    // tamamlayacak kimse kalmadı: kendi kapanış çerçevemizi yazıp soketi
    // biz bitiriyoruz. Bunu yapmazsak soket yarı açık kalır, 'close' hiç
    // gelmez ve oyuncu sunucunun listesinde asılı kalır — tarayıcısını
    // kapatan oyuncu lobide hayalet olarak görünürdü.
    socket.on('end', () => {
      if (this.readyState === OPEN) this._sendClose(1001, '');
      try { socket.end(); } catch { /* zaten kapalı */ }
      this._finish(1006, '');
    });
  }

  // --- dışa açık API (ws paketinin kullandığımız alt kümesi) --------------

  // Metin ya da ikili gönderir. İkili taraf sadece Buffer değil, herhangi bir
  // TypedArray/ArrayBuffer kabul eder: durum paketlerini üreten kod tarayıcıda
  // da çalıştığı için Buffer değil Uint8Array döndürüyor.
  send(data) {
    if (this.readyState !== OPEN) return;
    if (ArrayBuffer.isView(data)) {
      // subarray ile üretilmiş görünümlerde byteOffset sıfır olmayabilir;
      // Buffer.from(view.buffer) demek tüm havuzu göndermek olurdu.
      const payload = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      this._write(frame(OP_BIN, payload));
      return;
    }
    if (data instanceof ArrayBuffer) {
      this._write(frame(OP_BIN, Buffer.from(data)));
      return;
    }
    this._write(frame(OP_TEXT, Buffer.from(String(data), 'utf-8')));
  }

  ping(data = Buffer.alloc(0)) {
    if (this.readyState !== OPEN) return;
    this._write(frame(OP_PING, Buffer.isBuffer(data) ? data : Buffer.from(String(data))));
  }

  pong(data = Buffer.alloc(0)) {
    if (this.readyState !== OPEN) return;
    this._write(frame(OP_PONG, Buffer.isBuffer(data) ? data : Buffer.from(String(data))));
  }

  close(code = 1000, reason = '') {
    if (this.readyState !== OPEN) return;
    this.readyState = CLOSING;
    this._sendClose(code, reason);
    // Kapanış çerçevesinden sonra başka veri göndermeyeceğiz; yazma yönünü
    // hemen kapatıyoruz ki karşı taraf da soketi bıraksın. Okuma yönü açık
    // kalır, karşı tarafın kapanış cevabını hâlâ alabiliriz.
    try { this.socket.end(); } catch { /* zaten kapalı */ }
    // Karşı taraf hiç yanıtlamazsa sonsuza kadar bekleme.
    this._closeTimer = setTimeout(() => this.terminate(), 5000);
    if (this._closeTimer.unref) this._closeTimer.unref();
  }

  terminate() {
    this._finish(1006, '');
    try { this.socket.destroy(); } catch { /* zaten kapalı */ }
  }

  // --- iç işleyiş ---------------------------------------------------------

  _write(buf) {
    try {
      this.socket.write(buf);
      if (this.socket.writableLength > MAX_BACKLOG) this.terminate();
    } catch { this.terminate(); }
  }

  _sendClose(code, reason) {
    if (this._closeSent) return;
    this._closeSent = true;
    const r = Buffer.from(String(reason), 'utf-8').subarray(0, 123);
    const payload = Buffer.allocUnsafe(2 + r.length);
    payload.writeUInt16BE(code, 0);
    r.copy(payload, 2);
    try { this.socket.write(frame(OP_CLOSE, payload)); } catch { /* yok say */ }
  }

  _finish(code, reason) {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    if (this._closeTimer) clearTimeout(this._closeTimer);
    this._buf = Buffer.alloc(0);
    this._fragChunks = [];
    this.emit('close', code, reason);
  }

  _fail(code, why) {
    if (this.readyState === OPEN) {
      this.readyState = CLOSING;
      this._sendClose(code, why);
    }
    try { this.socket.end(); } catch { /* yok say */ }
    this._finish(code, why);
  }

  _onData(chunk) {
    if (this.readyState === CLOSED) return;
    this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : chunk;

    // Tek TCP paketinde birden çok çerçeve gelebilir; hepsini tüket.
    for (;;) {
      const b = this._buf;
      if (b.length < 2) return;

      const fin = (b[0] & 0x80) !== 0;
      const rsv = b[0] & 0x70;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;

      // Sıkıştırma pazarlığı yapmadığımız için RSV bitleri sıfır olmalı.
      if (rsv !== 0) { this._fail(1002, 'RSV'); return; }

      if (len === 126) {
        if (b.length < off + 2) return;
        len = b.readUInt16BE(off); off += 2;
      } else if (len === 127) {
        if (b.length < off + 8) return;
        const big = b.readBigUInt64BE(off); off += 8;
        if (big > BigInt(this.maxPayload)) { this._fail(1009, 'çok büyük'); return; }
        len = Number(big);
      }

      if (len > this.maxPayload) { this._fail(1009, 'çok büyük'); return; }

      // İstemciden gelen her çerçeve maskeli olmak ZORUNDA (RFC 6455 §5.1).
      if (!masked) { this._fail(1002, 'maskesiz'); return; }
      if (b.length < off + 4) return;
      const mask = b.subarray(off, off + 4); off += 4;

      if (b.length < off + len) return;      // gövde henüz tam gelmedi
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = b[off + i] ^ mask[i & 3];
      off += len;

      this._buf = b.subarray(off);

      const isControl = (opcode & 0x8) !== 0;
      if (isControl) {
        if (!fin || len > 125) { this._fail(1002, 'bozuk kontrol çerçevesi'); return; }
        this._control(opcode, payload);
        if (this.readyState === CLOSED) return;
        continue;
      }

      // --- veri çerçevesi (metin / ikili / devam) ---
      if (opcode === OP_CONT) {
        if (!this._fragOp) { this._fail(1002, 'beklenmeyen devam'); return; }
      } else if (opcode === OP_TEXT || opcode === OP_BIN) {
        if (this._fragOp) { this._fail(1002, 'yarım mesajın üstüne yeni mesaj'); return; }
        this._fragOp = opcode;
      } else {
        this._fail(1002, 'bilinmeyen opcode'); return;
      }

      this._fragLen += len;
      if (this._fragLen > this.maxPayload) { this._fail(1009, 'çok büyük'); return; }
      this._fragChunks.push(payload);

      if (!fin) continue;

      const full = this._fragChunks.length === 1
        ? this._fragChunks[0]
        : Buffer.concat(this._fragChunks, this._fragLen);
      const wasText = this._fragOp === OP_TEXT;
      this._fragOp = 0;
      this._fragChunks = [];
      this._fragLen = 0;

      this.emit('message', wasText ? full.toString('utf-8') : full, !wasText);
      if (this.readyState === CLOSED) return;
    }
  }

  _control(opcode, payload) {
    if (opcode === OP_PING) { this.pong(payload); return; }
    if (opcode === OP_PONG) { this.emit('pong', payload); return; }
    // OP_CLOSE
    const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
    const reason = payload.length > 2 ? payload.subarray(2).toString('utf-8') : '';
    if (this.readyState === OPEN) {
      this.readyState = CLOSING;
      this._sendClose(code === 1005 ? 1000 : code, '');
    }
    try { this.socket.end(); } catch { /* yok say */ }
    this._finish(code, reason);
  }
}

export class WebSocketServer extends EventEmitter {
  constructor({ server, maxPayload = 64 * 1024 } = {}) {
    super();
    this.clients = new Set();
    this.maxPayload = maxPayload;
    if (server) this.attach(server);
  }

  attach(server) {
    server.on('upgrade', (req, socket, head) => this._upgrade(req, socket, head));
  }

  _upgrade(req, socket, head) {
    const h = req.headers;
    const key = h['sec-websocket-key'];
    const upgradeOk = String(h.upgrade || '').toLowerCase() === 'websocket';
    const versionOk = String(h['sec-websocket-version'] || '') === '13';

    if (!upgradeOk || !versionOk || !key) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }

    socket.setNoDelay(true);
    socket.setTimeout(0);
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${accept(key)}\r\n`
      + '\r\n',
    );

    const ws = new WebSocket(socket, this.maxPayload);
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => { /* 'close' zaten temizliyor; sessiz yut */ });

    // El sıkışmadan sonra aynı pakette gelmiş olabilecek ilk veriyi kaçırma.
    if (head && head.length) ws._onData(head);

    this.emit('connection', ws, req);
  }

  close(cb) {
    for (const ws of this.clients) { try { ws.terminate(); } catch { /* yok say */ } }
    this.clients.clear();
    if (cb) cb();
  }
}

export default WebSocketServer;
