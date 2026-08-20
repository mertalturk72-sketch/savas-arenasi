// İstemci tarafı maç mantığı:
//  - girdi toplama ve sunucuya gönderme
//  - kendi hareketini tahmin etme (client-side prediction) ve sunucuyla uzlaştırma
//  - diğer oyuncuları geçmişe göre yumuşatma (entity interpolation)
//  - HUD güncelleme

import {
  INTERP_DELAY_MS, INPUT_RATE, MAX_INPUT_DT_MS, CLASSES, WEAPONS, MODES, TEAMS,
  PLAYER_RADIUS, IN_FIRE, CLASS_IDS, WEAPON_IDS, MATCH_MS,
} from '/shared/constants.js';
import {
  C, PS_FIELDS, BS_FIELDS, SC_FIELDS,
  F_ALIVE, F_PROTECTED, F_MUZZLE, F_HIDDEN,
} from '/shared/protocol.js';
import { buildObstacleIndex, applyMovement, angleLerp } from '/shared/physics.js';
import { Renderer, FX } from './render.js';
import { WALK_FRAMES } from './sprites.js';
import * as sfx from './audio.js';

const $ = (id) => document.getElementById(id);

// Maç sırasında sohbet yazıları ekranda görünsün mü? Kullanıcı görünmesin
// dedi. Tek yerden açılıp kapanabilsin diye sabit olarak duruyor.
const CHAT_IN_GAME = false;

// ÖLDÜRÜNCE çıkan kuru kafa — piksel piksel çizilmiş.
//
// Harita 24x24'lük bir ızgara; her harf bir renk. Kareler SVG dikdörtgeni
// olarak üretiliyor ve `shape-rendering="crispEdges"` sayesinde hangi boyutta
// gösterilirse gösterilsin kenarlar keskin kalıyor. Yumuşak/gradyanlı bir
// çizim piksel oyununun içinde yabancı duruyordu.
//
// Dosya eklemiyoruz: her şey kodun içinde, yani çevrimdışı sürüm ve tek
// dosyalık paket için ek bir kaynak indirmek gerekmiyor.
//
//   K = siyah kontur   W = beyaz   G = açık gri   D = koyu gri
const SKULL_PALETTE = { K: '#1a1a1e', W: '#ffffff', G: '#cecED2', D: '#9a9aa0' };
const SKULL_PIXELS = [
  '........KKKKKKKK........',
  '......KKWWWWWWWWKK......',
  '.....KWWWWWWWWWWWWK.....',
  '....KWWWWWWWWWWWWWWK....',
  '...KWWWWWWWWWWWWWWWWK...',
  '...KGWWWWWWWWWWWWWWDK...',
  '..KGGWWWWWWWWWWWWWWDDK..',
  '..KGGWWWWWWWWWWWWWWDDK..',
  '..KGWWKKKKWWWWKKKKWWDK..',
  '..KGWKKKKKKWWKKKKKKWDK..',
  '..KGWKKKKKKWWKKKKKKWDK..',
  '..KGWKKKKKKWWKKKKKKWDK..',
  '..KGWWKKKKWWWWKKKKWWDK..',
  '..KGWWWWWWWKKWWWWWWWDK..',
  '...KWWWWWWWKKWWWWWWWK...',
  '...KWWWWWWKKKKWWWWWWK...',
  '....KWWWWWWWWWWWWWWK....',
  '.....KKWWWWWWWWWWKK.....',
  '.......KWWWWWWWWK.......',
  '.......KWKWKWKWKK.......',
  '.......KWKWKWKWKK.......',
  '.......KKKKKKKKKK.......',
  '........KKKKKKKK........',
  '........................',
];

function pixelSkullSvg() {
  const n = SKULL_PIXELS.length;
  let kareler = '';
  for (let y = 0; y < n; y++) {
    const satir = SKULL_PIXELS[y];
    let x = 0;
    while (x < satir.length) {
      const c = satir[x];
      if (c === '.') { x++; continue; }
      // Yan yana aynı renkteki pikselleri tek dikdörtgende birleştir: hem
      // daha az düğüm hem de aralarında saç teli kalınlığında boşluk kalmaz.
      let uz = 1;
      while (x + uz < satir.length && satir[x + uz] === c) uz++;
      kareler += `<rect x="${x}" y="${y}" width="${uz}" height="1" fill="${SKULL_PALETTE[c]}"/>`;
      x += uz;
    }
  }
  return `<svg viewBox="0 0 ${SKULL_PIXELS[0].length} ${n}" width="100%" height="100%"
    shape-rendering="crispEdges" aria-hidden="true">${kareler}</svg>`;
}

const SKULL_SVG = pixelSkullSvg();

export class ClientGame {
  constructor(net, input) {
    this.net = net;
    this.input = input;
    this.renderer = new Renderer($('canvas'), $('minimap'));
    // Zemin dokusunu daha menüdeyken yüklemeye başla: maç açılınca ilk
    // kareler yedek çimenle çizilip sonra değişmesin.
    this.renderer.preloadTextures();
    this.fx = new FX();
    this.running = false;

    this.el = {
      hpFill: $('hpFill'), hpText: $('hpText'),
      ammo: $('ammoText'), weapon: $('weaponName'),
      reloadBar: $('reloadBar'), reloadFill: $('reloadFill'),
      matchInfo: $('matchInfo'), killfeed: $('killfeed'),
      netInfo: $('netInfo'), centerMsg: $('centerMsg'),
      respawn: $('respawnMsg'), dmgDirs: $('dmgDirs'),
      scoreboard: $('scoreboard'), chatLog: $('gameChatLog'),
      hideHint: $('hideHint'),
      reserve: $('reserveText'),
    };

    this.reset();
    this.loop = this.loop.bind(this);

    // Elendikten sonra tıklayarak izlenen oyuncuyu değiştir
    $('canvas').addEventListener('mousedown', () => { if (this.spectating) this.cycleSpectate(); });
  }

  reset() {
    this.map = null;
    this.idx = null;
    this.mode = null;
    this.teams = false;
    this.myId = 0;
    this.myTeam = 0;
    this.roster = new Map();
    this.pickups = [];
    this.snaps = [];
    this.pending = [];
    this.seq = 0;
    this.me = { x: 0, y: 0 };
    this.err = { x: 0, y: 0 };
    this.you = null;
    this.alive = true;
    this.aim = 0;
    this.speed = 220;
    this.weapon = 'rifle';
    this.serverOffset = null;
    this.inputAccum = 0;
    this.lastFrame = 0;
    this.localNextFire = 0;
    this.killfeed = [];
    this.dmgMarks = [];
    this.hitMarkerUntil = 0;
    this.scores = null;
    this.showScoreboard = false;
    this.chatLines = [];
    this.playersRender = [];
    this.bulletsRender = [];
    this.zone = null;
    this.zoneWarnPhase = -1;
    this.hudTimer = 0;
    this.meRender = { x: 0, y: 0 };
    this.chargeStart = 0;      // bomba: tuşu ne zaman tutmaya başladık
    this.charge = 0;           // 0..1 menzil doluluğu (sadece gösterim)
    this.anim = new Map();          // id -> yürüyüş animasyonu durumu
  }

  // ---------------------------------------------------------------- başlat
  start(payload) {
    this.reset();
    this.map = payload.map;
    this.idx = buildObstacleIndex(this.map);
    this.mode = MODES[payload.mode] || MODES.ffa;
    this.teams = this.mode.teams;
    this.myId = payload.youId;
    this.pickups = payload.pickups.map((k) => ({ ...k }));
    // Maçın başladığı oyun saati (sunucu belirler). Işık ve gölgeler buradan.

    for (const p of payload.players) {
      this.roster.set(p.id, { name: p.name, team: p.team, cls: p.cls, bot: p.bot, char: p.char });
      if (p.id === this.myId) {
        this.myTeam = p.team;
        this.speed = (CLASSES[p.cls] || CLASSES.komando).speed;
        this.weapon = (CLASSES[p.cls] || CLASSES.komando).weapon;
      }
    }

    this.renderer.seen.clear();
    this.running = true;
    this.input.enabled = true;
    this.lastFrame = performance.now();
    this.el.killfeed.innerHTML = '';
    this.el.chatLog.innerHTML = '';
    this.el.respawn.classList.add('hidden');
    this.setCenterMsg(`${this.mode.name}`, 1800);
    requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    this.input.enabled = false;
    this.el.scoreboard.classList.add('hidden');
    this.el.respawn.classList.add('hidden');
  }

  serverNow() {
    if (this.serverOffset === null) return 0;
    return performance.now() + this.serverOffset;
  }

  // -------------------------------------------------------------- snapshot
  onSnapshot(snap) {
    if (!this.running) return;

    // Sunucu saati tahmini: en hızlı gelen paketi referans al, sonra yumuşat.
    const off = snap.t - performance.now();
    if (this.serverOffset === null || off > this.serverOffset) this.serverOffset = off;
    else this.serverOffset += (off - this.serverOffset) * 0.03;

    // Düz sayı dizilerini çöz (bkz. shared/protocol.js)
    const players = new Map();
    const ps = snap.ps || [];
    for (let i = 0; i + PS_FIELDS <= ps.length; i += PS_FIELDS) {
      players.set(ps[i], {
        i: ps[i],
        x: ps[i + 1], y: ps[i + 2],
        a: ps[i + 3] / 100,
        h: ps[i + 4], m: ps[i + 5],
        c: CLASS_IDS[ps[i + 6]] || 'komando',
        f: ps[i + 7],
      });
    }
    const bullets = new Map();
    const bs = snap.bs || [];
    for (let i = 0; i + BS_FIELDS <= bs.length; i += BS_FIELDS) {
      bullets.set(bs[i], {
        i: bs[i], x: bs[i + 1], y: bs[i + 2],
        a: bs[i + 3] / 100,
        w: WEAPON_IDS[bs[i + 4]] || 'rifle',
      });
    }

    this.snaps.push({ t: snap.t, players, bullets, zone: snap.zn || null });
    while (this.snaps.length > 40) this.snaps.shift();

    if (snap.sc) this.scores = snap.sc;
    if (snap.zn) this.zone = snap.zn;

    // --- Kendi durumumuz: uzlaştırma -------------------------------------
    const you = snap.you;
    this.you = you;
    this.alive = !!you.al;
    if (you.cl && CLASSES[you.cl]) {
      this.speed = you.sp || CLASSES[you.cl].speed;
      this.weapon = you.wp || CLASSES[you.cl].weapon;
    }
    // Dokunmatik kumanda tek atışlı silahlarda "bırakınca ateşle" moduna geçsin
    const _w = WEAPONS[this.weapon] || WEAPONS.rifle;
    this.input.weaponAuto = _w.auto !== false;
    this.input.weaponThrowable = !!_w.throwable;

    const before = { x: this.me.x, y: this.me.y };
    this.me.x = you.x; this.me.y = you.y;
    this.pending = this.pending.filter((i) => i.seq > snap.ack);
    for (const i of this.pending) {
      applyMovement(this.me, i.keys, this.speed, i.dt / 1000, this.idx);
    }

    // Fark varsa anında zıplamak yerine hatayı zamanla erit
    const ex = before.x - this.me.x, ey = before.y - this.me.y;
    if (Math.hypot(ex, ey) < 220) {          // büyük fark = ışınlanma/doğuş, düzeltme yapma
      this.err.x = ex; this.err.y = ey;
    } else {
      this.err.x = 0; this.err.y = 0;
    }

    if (snap.ev) this.handleEvents(snap.ev);
    if (snap.pe) this.handlePrivate(snap.pe);
  }

  // ---------------------------------------------------------------- olaylar
  handleEvents(events) {
    for (const ev of events) {
      switch (ev.e) {
        case 'shot': {
          if (ev.i === this.myId) break;    // kendi sesimizi yerel çalıyoruz
          const d = Math.hypot(ev.x - this.me.x, ev.y - this.me.y);
          if (d < 1400) {
            const pan = Math.max(-1, Math.min(1, (ev.x - this.me.x) / 700));
            sfx.sfxShot(ev.w, pan, d);
          }
          this.fx.spawn(ev.x, ev.y, {
            count: 4, angle: ev.a, spread: 0.5, speed: 260, life: 0.12, size: 3,
            color: '#ffd28a', glow: true,
          });
          break;
        }
        case 'imp': {
          if (ev.t === 1) {
            this.fx.spawn(ev.x, ev.y, { count: 9, speed: 190, life: 0.42, size: 3.4, color: '#c8323c' });
          } else {
            this.fx.spawn(ev.x, ev.y, { count: 6, speed: 150, life: 0.3, size: 2.6, color: '#9fb0c2' });
          }
          break;
        }
        case 'boom': {
          const d = Math.hypot(ev.x - this.me.x, ev.y - this.me.y);
          // Ateş topu + kıvılcım + duman
          this.fx.spawn(ev.x, ev.y, { count: 26, speed: 520, life: 0.5, size: 6, color: '#ffcf6a', glow: true, drag: 2.6 });
          this.fx.spawn(ev.x, ev.y, { count: 18, speed: 330, life: 0.75, size: 8, color: '#c2410c', drag: 2.2 });
          this.fx.spawn(ev.x, ev.y, { count: 14, speed: 180, life: 1.1, size: 11, color: '#3a3a3a', drag: 1.6 });
          this.blasts = this.blasts || [];
          this.blasts.push({ x: ev.x, y: ev.y, r: ev.r, t: performance.now() });
          if (d < 900) this.fx.addShake(Math.max(2, 13 - d / 90));
          if (d < 2200) {
            const pan = Math.max(-1, Math.min(1, (ev.x - this.me.x) / 800));
            sfx.sfxBoom(pan, d);
          }
          break;
        }
        case 'kill': this.addKillfeed(ev); break;
        case 'join':
          this.roster.set(ev.i, { name: ev.n, team: ev.t, cls: ev.c, bot: !!ev.b, char: ev.ch });
          break;
        case 'pk': {
          const k = this.pickups.find((q) => q.id === ev.i);
          if (k) {
            k.active = !!ev.a;
            if (!ev.a) this.fx.spawn(k.x, k.y, { count: 10, speed: 150, life: 0.4, size: 3, color: k.kind === 'heal' ? '#48d17a' : '#ffc14d', glow: true });
          }
          break;
        }
        case 'zone': {
          if (ev.p !== this.zoneWarnPhase) {
            this.zoneWarnPhase = ev.p;
            this.setCenterMsg('⚠ GÜVENLİ ALAN DARALIYOR', 2600, '#ff7a7a');
            sfx.sfxAlarm();
          }
          break;
        }
        default: break;
      }
    }
  }

  handlePrivate(events) {
    for (const ev of events) {
      if (ev.e === 'hit') {
        this.hitMarkerUntil = performance.now() + (ev.k ? 320 : 160);
        sfx.sfxHit();
      } else if (ev.e === 'hurt') {
        sfx.sfxHurt();
        this.fx.addShake(ev.z ? 2 : 4);
        this.addDamageDir(ev.a, ev.z);
      } else if (ev.e === 'pick') {
        sfx.sfxPickup();
      } else if (ev.e === 'dry') {
        this.setCenterMsg('CEPHANE BİTTİ — kutu bul', 1800, '#ff9b6b');
      }
    }
  }

  // Öldürme kuru kafası: ekranın solunda kısa süre görünür.
  // Ölünce DEĞİL, öldürünce çıkar — öldüğünde zaten "ÖLDÜN" ekranı var.
  showKillSkull() {
    const el = $('killSkull');
    if (!el) return;
    if (!el.innerHTML) el.innerHTML = SKULL_SVG;
    // Üst üste öldürmelerde animasyon baştan başlasın diye sınıfı sıfırlıyoruz.
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this._skullTimer);
    this._skullTimer = setTimeout(() => el.classList.remove('show'), 1500);
  }

  addKillfeed(ev) {
    // Öldüren ben miyim? (Kendini öldürmek sayılmaz.)
    if (ev.k && ev.k === this.myId && ev.v !== this.myId) this.showKillSkull();
    const wepName = ev.w === 'zone' ? 'alan' : (WEAPONS[ev.w]?.name || '');
    const kc = ev.kt === 1 ? '#ff8080' : ev.kt === 2 ? '#8fc4ff' : '#e8eef5';
    const vc = ev.vt === 1 ? '#ff8080' : ev.vt === 2 ? '#8fc4ff' : '#98a6b5';
    const div = document.createElement('div');
    div.className = 'kf-item';
    const killer = ev.kn
      ? `<span class="kf-k" style="color:${kc}">${esc(ev.kn)}</span>`
      : '<span class="kf-k" style="color:#98a6b5">—</span>';
    div.innerHTML = `${killer}<span class="kf-w">${esc(wepName)}</span><span class="kf-v" style="color:${vc}">${esc(ev.vn)}</span>`;
    this.el.killfeed.appendChild(div);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.removeChild(this.el.killfeed.firstChild);
    setTimeout(() => div.remove(), 6500);

    if (ev.v === this.myId) {
      sfx.sfxDeath();
      this.fx.addShake(12);
      this.deathKiller = ev.kn || 'Güvenli alan';
    }
    // Uzaktaki ölümlerde sunucu konum göndermez (bilgi sızmasın) — efekt yok.
    if (ev.x !== undefined) {
      this.fx.spawn(ev.x, ev.y, { count: 26, speed: 260, life: 0.7, size: 4, color: '#b8242f' });
    }
  }

  addDamageDir(angle, isZone) {
    const div = document.createElement('div');
    div.className = 'dmg-dir';
    // angle: saldırganın oyuncuya göre dünya açısı
    div.style.transform = `rotate(${angle + Math.PI / 2}rad)`;
    if (isZone) div.style.opacity = '0.5';
    this.el.dmgDirs.appendChild(div);
    setTimeout(() => {
      div.style.transition = 'opacity .5s';
      div.style.opacity = '0';
      setTimeout(() => div.remove(), 520);
    }, 380);
  }

  setCenterMsg(text, ms, color) {
    const el = this.el.centerMsg;
    el.textContent = text;
    el.style.color = color || '#ffd9a3';
    el.classList.add('show');
    clearTimeout(this._centerTimer);
    this._centerTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  pushChat(msg) {
    // Maç içinde sohbet yazıları GÖSTERİLMİYOR — istenmedi. Mesajlar lobide
    // görünmeye devam ediyor; burada sadece ekrana basmıyoruz.
    if (!CHAT_IN_GAME) return;
    const div = document.createElement('div');
    div.className = 'chat-line' + (msg.sys ? ' sys' : '');
    div.innerHTML = msg.sys ? esc(msg.text) : `<span class="cf">${esc(msg.from)}:</span> ${esc(msg.text)}`;
    this.el.chatLog.appendChild(div);
    while (this.el.chatLog.children.length > 6) this.el.chatLog.removeChild(this.el.chatLog.firstChild);
    setTimeout(() => div.remove(), 12000);
  }

  // ------------------------------------------------------------- ana döngü
  loop(ts) {
    if (!this.running) return;
    requestAnimationFrame(this.loop);

    let dtMs = ts - this.lastFrame;
    this.lastFrame = ts;
    if (dtMs > 120) dtMs = 120;
    if (dtMs <= 0) dtMs = 1;
    const dt = dtMs / 1000;

    this.step(dtMs);
    this.fx.update(dt);
    this.buildRenderState(dtMs);
    this.renderer.draw(this);
    this.drawHitMarker();

    this.hudTimer += dtMs;
    if (this.hudTimer >= 60) { this.hudTimer = 0; this.updateHud(); }
  }

  step(dtMs) {
    // Girdiyi sabit hızda örnekle ve gönder
    this.inputAccum += dtMs;
    const stepMs = 1000 / INPUT_RATE;

    while (this.inputAccum >= stepMs) {
      this.inputAccum -= stepMs;
      const sc = this.renderer.worldToScreen(this.meRender.x || this.me.x, this.meRender.y || this.me.y);
      const sample = this.input.sample(sc.x, sc.y);
      this.aim = sample.aim;

      // BOMBA NİŞANGÂHI TAKİP ETSİN.
      //
      // Eskiden menzil, ateş tuşunu ne kadar tuttuğuna bağlıydı; nişangâhın
      // nerede olduğunun hiç önemi yoktu ve bomba imlecin çok ötesine ya da
      // berisine düşüyordu. Oysa fare zaten hem YÖNÜ hem UZAKLIĞI söylüyor.
      // Artık bomba doğrudan imlecin bulunduğu noktaya gidiyor; silahın
      // asgari/azami menzili dışına taşarsa oraya kırpılıyor.
      // (Dokunmatikte menzili çubuğun itilme miktarı belirliyor — bkz. input.js)
      const wep0 = WEAPONS[this.weapon];
      if (wep0 && wep0.throwable && !this.input.touch.active) {
        const uzak = (this.input.aimScreenDist || 0) / (this.renderer.zoom || 1);
        const aralik = wep0.maxRange - wep0.minRange;
        const oran = aralik > 0 ? (uzak - wep0.minRange) / aralik : 0;
        sample.p = Math.round(Math.max(0, Math.min(1, oran)) * 100);
      }

      const dt = Math.max(1, Math.min(MAX_INPUT_DT_MS, Math.round(stepMs)));
      const packet = { seq: ++this.seq, dt, keys: sample.keys, aim: sample.aim, power: sample.p };

      if (this.alive) {
        applyMovement(this.me, sample.keys, this.speed, dt / 1000, this.idx);
        this.pending.push(packet);
        if (this.pending.length > 180) this.pending.shift();
        this.predictFire(sample.keys, sample.p);
      }

      const msg = { s: packet.seq, d: packet.dt, k: packet.keys, a: packet.aim };
      if (packet.power !== undefined) msg.p = packet.power;   // dokunmatik menzil
      this.net.send(C.INPUT, msg);
    }

    // Tahmin hatasını yumuşakça sıfırla
    const decay = Math.pow(0.001, dtMs / 1000);
    this.err.x *= decay; this.err.y *= decay;
    if (Math.abs(this.err.x) < 0.05) this.err.x = 0;
    if (Math.abs(this.err.y) < 0.05) this.err.y = 0;
  }

  // Ateş sesi/efekti gecidikmesin diye görsel-işitsel kısmı yerelde tahmin ediyoruz.
  predictFire(keys, guc) {
    const wep = WEAPONS[this.weapon] || WEAPONS.rifle;

    // Bomba: tuşu TUTARKEN menzil dolar, BIRAKINCA atılır. Sunucu da aynı
    // kuralla çalışıyor; buradaki iş sadece göstergeyi ve sesi gecikmesiz
    // vermek (yetkili karar hep sunucuda).
    if (wep.throwable) {
      const basili = !!(keys & IN_FIRE);
      const now0 = performance.now();
      if (basili) {
        if (!this.chargeStart) this.chargeStart = now0;
        // Dokunmatikte menzili çubuğun itilme miktarı belirliyor (input.js),
        // bilgisayarda tutma süresi. Gösterge hangisi geçerliyse onu çizsin.
        this.charge = (guc !== undefined)
          ? Math.max(0, Math.min(1, guc / 100))
          : Math.max(0, Math.min(1, (now0 - this.chargeStart) / wep.chargeMs));
        this.firePrev = true;
        return;
      }
      if (this.firePrev && this.chargeStart) {
        // bıraktı → attı
        this.chargeStart = 0;
        this.charge = 0;
        this.firePrev = false;
        if (now0 >= this.localNextFire && !(this.you && (this.you.rl > 0 || this.you.am <= 0))) {
          this.localNextFire = now0 + wep.fireMs;
          sfx.sfxShot(wep.id, 0, 0);
        }
        return;
      }
      this.firePrev = false;
      this.charge = 0;
      return;
    }

    if (!(keys & IN_FIRE)) { this.firePrev = false; return; }
    if (!wep.auto && this.firePrev) return;
    this.firePrev = true;

    const now = performance.now();
    if (now < this.localNextFire) return;
    if (this.you && (this.you.rl > 0 || this.you.am <= 0)) return;   // dolduruyor ya da şarjör boş
    this.localNextFire = now + wep.fireMs;

    const mx = this.me.x + Math.cos(this.aim) * (PLAYER_RADIUS + 8);
    const my = this.me.y + Math.sin(this.aim) * (PLAYER_RADIUS + 8);
    sfx.sfxShot(wep.id, 0, 0);
    this.fx.spawn(mx, my, {
      count: 6, angle: this.aim, spread: 0.55, speed: 300, life: 0.13, size: 3.2,
      color: '#ffe0a0', glow: true,
    });
    this.fx.addShake(wep.id === 'sniper' ? 7 : wep.id === 'shotgun' ? 5 : 1.6);
  }

  // --------------------------------------------------- çizim durumu kurulumu
  buildRenderState(dtMs) {
    this.meRender.x = this.me.x + this.err.x;
    this.meRender.y = this.me.y + this.err.y;

    const renderT = this.serverNow() - INTERP_DELAY_MS;
    const { s0, s1, alpha } = this.findSnapshots(renderT);

    const out = [];
    const bullets = [];

    if (s1) {
      for (const [id, p1] of s1.players) {
        const info = this.roster.get(id) || { name: '?', team: 0, cls: 'komando' };
        const alive = !!(p1.f & F_ALIVE);
        let x = p1.x, y = p1.y, a = p1.a;

        if (s0 && s0.players.has(id) && alpha > 0) {
          const p0 = s0.players.get(id);
          x = p0.x + (p1.x - p0.x) * alpha;
          y = p0.y + (p1.y - p0.y) * alpha;
          a = angleLerp(p0.a, p1.a, alpha);
        }

        if (id === this.myId) {
          out.push({
            id, name: info.name, team: info.team, cls: p1.c || info.cls,
            char: info.char,
            x: this.meRender.x, y: this.meRender.y, aim: this.aim,
            hp: p1.h, maxHp: p1.m, alive: this.alive,
            protected: !!(p1.f & F_PROTECTED),
            hidden: !!(p1.f & F_HIDDEN),
            muzzle: performance.now() < this.localNextFire - (WEAPONS[this.weapon]?.fireMs || 120) + 60,
          });
        } else {
          out.push({
            id, name: info.name, team: info.team, cls: p1.c || info.cls,
            char: info.char,
            x, y, aim: a, hp: p1.h, maxHp: p1.m, alive,
            protected: !!(p1.f & F_PROTECTED),
            hidden: !!(p1.f & F_HIDDEN),
            muzzle: !!(p1.f & F_MUZZLE),
          });
        }
      }

      // Mermiler
      for (const [id, b1] of s1.bullets) {
        let x = b1.x, y = b1.y;
        if (s0 && s0.bullets.has(id) && alpha > 0) {
          const b0 = s0.bullets.get(id);
          x = b0.x + (b1.x - b0.x) * alpha;
          y = b0.y + (b1.y - b0.y) * alpha;
        } else if (s0) {
          // Yeni doğmuş mermi: hızıyla geriye doğru tahmin et
          const wep = WEAPONS[b1.w] || WEAPONS.rifle;
          const back = (s1.t - renderT) / 1000;
          x = b1.x - Math.cos(b1.a) * wep.speed * back;
          y = b1.y - Math.sin(b1.a) * wep.speed * back;
        }
        bullets.push({ x, y, a: b1.a, w: b1.w });
      }

      // Alan (zone) yumuşatma
      if (s1.zone) {
        if (s0 && s0.zone && alpha > 0) {
          const z0 = s0.zone, z1 = s1.zone;
          this.zone = {
            x: z0.x + (z1.x - z0.x) * alpha,
            y: z0.y + (z1.y - z0.y) * alpha,
            r: z0.r + (z1.r - z0.r) * alpha,
            tx: z1.tx, ty: z1.ty, tr: z1.tr, s: z1.s, w: z1.w, p: z1.p,
          };
        } else this.zone = s1.zone;
      }
    }

    // Yürüyüş animasyonu: kat edilen mesafeye göre adım karesi ilerler.
    for (const e of out) {
      let a = this.anim.get(e.id);
      if (!a) { a = { x: e.x, y: e.y, phase: 0, moving: false }; this.anim.set(e.id, a); }
      const d = Math.hypot(e.x - a.x, e.y - a.y);
      a.x = e.x; a.y = e.y;
      // Kare, kat edilen mesafeyle ilerler: hızlı koşan hızlı adımlar.
      if (d > 0.35) { a.phase += d / 7; a.moving = true; a.idle = 0; }
      else { a.idle = (a.idle || 0) + 1; if (a.idle > 6) a.moving = false; }
      e.moving = a.moving && e.alive;
      const frame = Math.floor(a.phase) % WALK_FRAMES;
      e.walkFrame = frame;
      // Kesirli faz: çizim tarafı bunu sürekli bir eğriye çevirip gövdeyi
      // yumuşakça indirip kaldırıyor. Kare sayısından bağımsız akıcılık.
      e.walkPhase = a.phase;

      // Ayak yere bastığı karelerde (temas: 1 ve 4) küçük bir toz bulutu.
      if (e.moving && frame !== a.lastFrame && (frame === 2 || frame === 6)) {
        this.fx.spawn(e.x, e.y + 6, {
          count: 3, speed: 26, life: 0.34, size: 2.2, drag: 6,
          color: 'rgba(126,150,104,0.50)',
        });
      }
      a.lastFrame = frame;
    }
    if (this.anim.size > 64) {
      const live = new Set(out.map((e) => e.id));
      for (const id of [...this.anim.keys()]) if (!live.has(id)) this.anim.delete(id);
    }

    this.aiming = this.input.touch.active && this.input.touch.aim.aiming;
    this.playersRender = out;
    this.bulletsRender = bullets;

    // İzleme kamerası: yeniden doğuş olmayan modlarda elenince başkasını izle
    this.spectating = !this.alive && this.mode && !this.mode.respawn;
    if (this.spectating) {
      const alive = out.filter((p) => p.alive && p.id !== this.myId);
      if (alive.length) {
        let t = alive.find((p) => p.id === this.spectateId);
        if (!t) { t = alive[0]; this.spectateId = t.id; }
        this.meRender.x = t.x;
        this.meRender.y = t.y;
        this.spectateName = t.name;
      }
    }
    void dtMs;
  }

  cycleSpectate() {
    if (!this.spectating) return;
    const alive = this.playersRender.filter((p) => p.alive && p.id !== this.myId);
    if (!alive.length) return;
    const i = alive.findIndex((p) => p.id === this.spectateId);
    this.spectateId = alive[(i + 1) % alive.length].id;
  }

  findSnapshots(renderT) {
    const s = this.snaps;
    if (s.length === 0) return { s0: null, s1: null, alpha: 0 };
    if (s.length === 1) return { s0: null, s1: s[0], alpha: 0 };

    for (let i = s.length - 1; i > 0; i--) {
      if (s[i - 1].t <= renderT && renderT <= s[i].t) {
        const span = s[i].t - s[i - 1].t;
        return { s0: s[i - 1], s1: s[i], alpha: span > 0 ? (renderT - s[i - 1].t) / span : 1 };
      }
    }
    // Zaman aralığın dışında: en yakın uca yaslan
    if (renderT > s[s.length - 1].t) return { s0: s[s.length - 2], s1: s[s.length - 1], alpha: 1 };
    return { s0: null, s1: s[0], alpha: 0 };
  }

  drawHitMarker() {
    if (performance.now() > this.hitMarkerUntil) return;
    const ctx = this.renderer.ctx;
    const x = this.input.mouseX, y = this.input.mouseY;
    ctx.save();
    ctx.strokeStyle = '#ff5c5c';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.moveTo(x + dx * 7, y + dy * 7);
      ctx.lineTo(x + dx * 15, y + dy * 15);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------------ HUD
  updateHud() {
    const you = this.you;
    if (!you) return;

    const ratio = Math.max(0, Math.min(1, you.hp / you.mx));
    this.el.hpFill.style.width = `${ratio * 100}%`;
    this.el.hpFill.classList.toggle('mid', ratio <= 0.55 && ratio > 0.25);
    this.el.hpFill.classList.toggle('low', ratio <= 0.25);
    this.el.hpText.textContent = you.hp;
    this.el.hpText.style.color = ratio > 0.5 ? '#e6edf4' : ratio > 0.25 ? '#ffb84d' : '#ff5f5f';

    // Cephane "şarjördeki / yedek" biçiminde: 30 / 60
    this.el.ammo.textContent = you.am;
    this.el.ammo.classList.toggle('low', you.am <= Math.max(1, you.mg * 0.2));
    if (this.el.reserve) {
      const reserve = you.ar ?? 0;
      this.el.reserve.textContent = reserve;
      this.el.reserve.classList.toggle('empty', reserve === 0);
    }
    this.el.weapon.textContent = (WEAPONS[this.weapon] || WEAPONS.rifle).name;

    // Çalıda gizlenme durumu
    if (this.el.hideHint) {
      this.el.hideHint.classList.toggle('hidden', !(you.hd && you.al));
    }

    if (you.rl > 0) {
      this.el.reloadBar.classList.remove('hidden');
      this.el.reloadFill.style.width = `${(1 - you.rl / you.rt) * 100}%`;
    } else {
      this.el.reloadBar.classList.add('hidden');
    }

    // Ölüm ekranı
    if (!this.alive) {
      this.el.respawn.classList.remove('hidden');
      const canRespawn = this.mode.respawn;
      this.el.respawn.innerHTML = `
        <div class="rm-title">ÖLDÜN</div>
        <div class="rm-killer">${this.deathKiller ? esc(this.deathKiller) + ' seni indirdi' : ''}</div>
        <div class="rm-sub">${canRespawn
          ? `Yeniden doğuş: ${(you.rs / 1000).toFixed(1)} sn`
          : `${you.pl ? `Sıralaman: #${you.pl}` : 'Elendin'}${this.spectateName ? ` · İzliyorsun: ${esc(this.spectateName)}` : ''}`}</div>
        ${canRespawn ? '' : '<div class="rm-killer">Başkasını izlemek için tıkla</div>'}`;
    } else {
      this.el.respawn.classList.add('hidden');
    }

    // Üst bilgi: sadece kalan süre
    const sc = this.scores;
    if (sc) {
      const left = Math.max(0, sc.left | 0);
      const mm = Math.floor(left / 60);
      const ss = String(left % 60).padStart(2, '0');
      this.el.matchInfo.innerHTML = `<div class="mi-time-only${left <= 30 ? ' urgent' : ''}">${mm}:${ss}</div>`;
    }

    const pingMs = this.net.mode === 'local' ? 0 : (you.pg ?? 0);
    this.el.netInfo.textContent = this.net.mode === 'local'
      ? `çevrimdışı · ${this.playersRender.length} birim`
      : `${pingMs} ms · ${this.playersRender.length} birim`;

    if (this.showScoreboard) this.renderScoreboard();
  }

  toggleScoreboard(on) {
    this.showScoreboard = on;
    this.el.scoreboard.classList.toggle('hidden', !on);
    if (on) this.renderScoreboard();
  }

  renderScoreboard() {
    const rows = decodeScores(this.scores).map((s) => {
      const info = this.roster.get(s.id) || { name: '?', team: 0, cls: 'komando' };
      return { name: info.name, team: info.team, cls: info.cls, bot: info.bot, ...s };
    });
    rows.sort((a, b) => b.k - a.k || b.as - a.as || a.d - b.d || b.dm - a.dm);

    let html = `<h3>${esc(this.mode.name)}</h3><div class="sb-sub">Kapatmak için tekrar Tab (ya da Esc) · liste uzunsa kaydır</div>`;
    if (this.teams && this.scores?.team) {
      html += `<div class="sb-teamline">
        <span style="color:${TEAMS[1].color}">${TEAMS[1].name} ${this.scores.team[1] || 0}</span>
        <span style="color:${TEAMS[2].color}">${TEAMS[2].name} ${this.scores.team[2] || 0}</span></div>`;
    }
    html += '<div class="sb-scroll"><table class="sb-table"><tr><th>Oyuncu</th><th>Sınıf</th><th class="num">Öldürme</th><th class="num">Asist</th><th class="num">Ölüm</th><th class="num">Hasar</th><th class="num">Durum</th></tr>';
    for (const r of rows) {
      html += `<tr class="${r.id === this.myId ? 'me ' : ''}${this.teams ? 't' + r.team : ''}">
        <td>${esc(r.name)}${r.bot ? '<span class="sb-bot">BOT</span>' : ''}</td>
        <td>${esc(CLASSES[r.cls]?.name || '')}</td>
        <td class="num">${r.k}</td>
        <td class="num">${r.as}</td>
        <td class="num">${r.d}</td>
        <td class="num">${r.dm}</td>
        <td class="num">${r.a ? '<span class="sb-alive">yaşıyor</span>' : '<span class="sb-dead">öldü</span>'}</td>
      </tr>`;
    }
    html += '</table></div>';
    this.el.scoreboard.innerHTML = html;
  }
}

// sc.ps düz dizisini nesne listesine çevirir.
function decodeScores(sc) {
  const out = [];
  const a = sc?.ps || [];
  for (let i = 0; i + SC_FIELDS <= a.length; i += SC_FIELDS) {
    out.push({ id: a[i], k: a[i + 1], d: a[i + 2], dm: a[i + 3], a: a[i + 4], as: a[i + 5] || 0 });
  }
  return out;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export { esc };
