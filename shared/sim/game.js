// Otoriter oyun simülasyonu. Tüm kararlar burada verilir; istemci sadece
// girdi gönderir ve sonucu çizer.

import {
  TICK_MS, PLAYER_RADIUS, RESPAWN_MS, SPAWN_PROTECT_MS, MODES, CLASSES, WEAPONS,
  ZONE, HP_REGEN_PER_SEC, AMMO_PACK_RESPAWN_MS, AMMO_PACK_FRACTION, PICKUP_RADIUS,
  IN_FIRE, IN_RELOAD, MAX_INPUT_DT_MS, DEATH_BULLET, DEATH_ZONE,
  CLASS_IDS, WEAPON_IDS, VIS_DIST, VIS_GRACE_MS, BULLET_VIS, EVENT_AUDIO_DIST,
  DEFAULT_CHAR,
  BUSH_REVEAL_DIST, BUSH_FIRE_REVEAL_MS, SPAWN_CENTER_BIAS,
  DEFAULT_BOT_LEVEL,
  ASSIST_WINDOW_MS, KILL_HEAL, muzzleWorld,
} from '../constants.js';
import { F_ALIVE, F_PROTECTED, F_RELOADING, F_MUZZLE, F_HIDDEN } from '../protocol.js';
import { applyMovement, queryObstacles, clamp, lineBlocked } from '../physics.js';
import { createMap } from './map.js';
import { botThink, resetBot, updateVelocityEstimates } from './bot.js';

let nextBulletId = 1;

export class Game {
  /**
   * @param {object} opts { modeId, players: [{id,name,bot,team,cls,conn}] }
   */
  constructor(opts) {
    this.mode = MODES[opts.modeId] || MODES.ffa;
    const built = createMap(this.mode.map);
    this.map = built.map;
    this.idx = built.idx;
    this.spawns = built.spawns;
    this.pickups = built.pickups;
    this.bushes = built.map.bushes || [];

    this.time = 0;              // maç başından beri geçen ms (tick tabanlı)
    this.over = false;
    this.winner = null;
    this.players = new Map();
    this.bullets = [];
    this.globalEvents = [];
    this.teamScore = { 1: 0, 2: 0 };
    this.snapAccum = 0;
    this.tickCount = 0;
    this._scratch = [];

    for (const p of opts.players) this.addPlayer(p);

    this.aliveAtStart = this.players.size;

    if (this.mode.shrinkingZone) this.initZone();
    else this.zone = null;
  }

  // --- Oyuncular ----------------------------------------------------------
  addPlayer(info) {
    const cls = CLASSES[info.cls] || CLASSES.komando;
    const wep = WEAPONS[cls.weapon];
    const p = {
      id: info.id,
      name: info.name,
      bot: !!info.bot,
      botLevel: info.botLevel || DEFAULT_BOT_LEVEL,   // kolay | orta | zor
      conn: info.conn || null,
      team: this.mode.teams ? (info.team || 1) : 0,
      cls: cls.id,
      char: info.char || DEFAULT_CHAR,
      speed: cls.speed,
      maxHp: cls.hp,
      hp: cls.hp,
      weapon: wep.id,
      x: 0, y: 0, aim: 0,
      alive: true,
      deadUntil: 0,
      protectUntil: SPAWN_PROTECT_MS,
      ammo: wep.mag,
      reserve: wep.reserve,          // yedek mermi havuzu
      reloadUntil: 0,
      nextFireAt: 0,
      prevKeys: 0,
      muzzle: -1e9,            // son atış zamanı (hiç ateş etmedi = çok eski)
      kills: 0, deaths: 0, damage: 0, assists: 0, place: 0,
      // Bana son kim hasar verdi? saldıranId -> zaman.
      // Öldüğümde öldüren DIŞINDA buradakiler asist alır.
      hurtBy: new Map(),
      lastSeq: 0,
      inputQueue: [],
      inputBudgetMs: 250,
      privEvents: [],
      brain: info.bot ? {} : null,
    };
    this.players.set(p.id, p);
    this.respawn(p, true);
    // Maç başladıktan sonra katılan oyuncuyu diğer istemcilerin listesine ekle
    if (this.time > 0) {
      this.globalEvents.push({
        e: 'join', i: p.id, n: p.name, t: p.team, c: p.cls, ch: p.char, b: p.bot ? 1 : 0,
      });
    }
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.alive = false;
    p.left = true;
    this.players.delete(id);
    this.checkEnd();
  }

  // Düşmanlardan en uzak spawn noktasını seç.
  pickSpawn(p) {
    let pool = this.spawns.all;
    if (this.mode.teams && this.spawns[p.team] && this.spawns[p.team].length) {
      pool = this.spawns[p.team];
    }
    let best = pool[0], bestScore = -Infinity;
    for (const s of pool) {
      let dd2 = Infinity;
      for (const o of this.players.values()) {
        if (o === p || !o.alive) continue;
        if (this.mode.teams && o.team === p.team) continue;
        const d2 = (o.x - s.x) ** 2 + (o.y - s.y) ** 2;
        if (d2 < dd2) dd2 = d2;
      }
      // Puanı piksel cinsinden tutuyoruz ki "düşmandan uzaklık" ile
      // "kenardan uzaklık" aynı ölçekte karşılaştırılabilsin.
      const enemyDist = dd2 === Infinity ? 1e6 : Math.sqrt(dd2);
      const edgeDist = Math.min(s.x, this.map.w - s.x, s.y, this.map.h - s.y);
      // Sadece düşmandan uzaklığa bakınca kazanan hep köşe oluyordu; merkeze
      // yakınlık da puanlanıyor. Küçük rastgelelik aynı noktada yığılmayı önler.
      const score = enemyDist + edgeDist * SPAWN_CENTER_BIAS + Math.random() * 140;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    // Daralan alan varsa alan içi tercih edilir
    if (this.zone) {
      const inside = pool.filter((s) => Math.hypot(s.x - this.zone.cx, s.y - this.zone.cy) < this.zone.r * 0.8);
      if (inside.length) best = inside[Math.floor(Math.random() * inside.length)];
    }
    return best || { x: this.map.w / 2, y: this.map.h / 2 };
  }

  respawn(p, initial = false) {
    // Lobiden yapılan sınıf değişimi bir sonraki doğuşta yürürlüğe girer.
    if (p.pendingCls && CLASSES[p.pendingCls]) {
      const c = CLASSES[p.pendingCls];
      p.cls = c.id; p.speed = c.speed; p.maxHp = c.hp; p.weapon = c.weapon;
      p.pendingCls = null;
    }
    const s = this.pickSpawn(p);
    p.x = s.x; p.y = s.y;
    p.hp = p.maxHp;
    p.alive = true;
    p.ammo = WEAPONS[p.weapon].mag;
    p.reserve = WEAPONS[p.weapon].reserve;
    p.reloadUntil = 0;
    p.nextFireAt = this.time;
    p.protectUntil = this.time + SPAWN_PROTECT_MS;
    p.inputQueue.length = 0;
    if (p.brain) resetBot(p);
    if (p.hurtBy) p.hurtBy.clear();
    if (!initial) this.globalEvents.push({ e: 'spawn', i: p.id });
  }

  // --- Girdi --------------------------------------------------------------
  queueInput(p, msg) {
    if (!p || p.left) return;
    // Hile önleme: paket başına dt sınırı + saniyelik toplam dt bütçesi
    const dt = clamp(Number(msg.d) || 0, 0, MAX_INPUT_DT_MS);
    if (dt <= 0) return;
    if (p.inputQueue.length > 40) p.inputQueue.shift();
    const girdi = { s: msg.s | 0, d: dt, k: msg.k | 0, a: Number(msg.a) || 0 };
    // p: bomba menzili doluluğu (0..100). Sadece dokunmatik istemciler
    // gönderir; gelmezse sunucu tutma süresine bakar. Burada kırpıyoruz ki
    // uydurma bir değer menzili silahın sınırının ötesine taşımasın.
    if (msg.p !== undefined) {
      const g = Number(msg.p);
      if (Number.isFinite(g)) girdi.p = clamp(g, 0, 100);
    }
    p.inputQueue.push(girdi);
  }

  drainInputs(p, tickMs) {
    // Bütçe: gerçek zamandan hızlı hareket edilemez (%20 tolerans).
    p.inputBudgetMs = Math.min(300, p.inputBudgetMs + tickMs * 1.2);

    const q = p.inputQueue;
    let processed = 0;
    while (q.length) {
      const inp = q[0];
      if (inp.d > p.inputBudgetMs) break;
      q.shift();
      p.inputBudgetMs -= inp.d;
      this.applyInput(p, inp);
      processed++;
      if (processed > 12) break; // tek tick'te aşırı birikmeyi kes
    }
    // Girdi hiç gelmiyorsa (ağ kesintisi) oyuncu yerinde durur, sorun değil.
  }

  applyInput(p, inp) {
    p.lastSeq = inp.s;
    p.aim = inp.a;
    if (!p.alive) { p.prevKeys = inp.k; return; }

    const dtSec = inp.d / 1000;
    applyMovement(p, inp.k, p.speed, dtSec, this.idx);

    const wep = WEAPONS[p.weapon];
    const wantReload = (inp.k & IN_RELOAD) && !(p.prevKeys & IN_RELOAD);
    if (wantReload && p.ammo < wep.mag && p.reserve > 0 && !p.reloadUntil) {
      p.reloadUntil = this.time + wep.reloadMs;
    }
    if (p.reloadUntil && this.time >= p.reloadUntil) this.finishReload(p, wep);

    // Bomba diğer silahlar gibi "basınca ateşler" değildir: BASILI TUTARKEN
    // menzil dolar, BIRAKINCA atılır. Böylece oyuncu bombayı nereye
    // düşüreceğini kendisi ayarlar.
    let atisMenzili = 0;
    let firing;
    if (wep.throwable) {
      const basili = !!(inp.k & IN_FIRE);
      const oncekiBasili = !!(p.prevKeys & IN_FIRE);
      if (basili && !oncekiBasili) p.chargeStart = this.time;      // tutmaya başladı
      firing = !basili && oncekiBasili && p.chargeStart > 0;       // bıraktı
      // Menzil doluluğu iki şekilde belirlenebilir:
      //
      //   • inp.p geldiyse (dokunmatik) → oyuncu nişan çubuğunu ne kadar
      //     ittiyse o. Telefonda "tutma süresi" işe yaramıyordu: nişan almak
      //     için çubuğu tutmak zorundasın, dolayısıyla menzil kendiliğinden
      //     doluyor ve bomba hep en uzağa gidiyordu.
      //   • gelmediyse (klavye/fare) → tuşu ne kadar tuttuğu.
      //
      // Değeri istemci söylüyor ama bir üstünlük sağlamıyor: 0..1 arasına
      // kırpılıyor ve azami menzil yine silahın kendi sınırı.
      if (firing) {
        let t;
        if (typeof inp.p === 'number' && Number.isFinite(inp.p)) {
          t = Math.max(0, Math.min(1, inp.p / 100));
        } else {
          const tuttu = Math.max(0, this.time - p.chargeStart);
          t = Math.max(0, Math.min(1, tuttu / wep.chargeMs));
        }
        atisMenzili = wep.minRange + t * (wep.maxRange - wep.minRange);
        p.chargeStart = 0;
      }
    } else {
      firing = wep.auto ? !!(inp.k & IN_FIRE) : ((inp.k & IN_FIRE) && !(p.prevKeys & IN_FIRE));
    }

    if (firing && !p.reloadUntil && this.time >= p.nextFireAt) {
      if (p.ammo <= 0) {
        // Şarjör boş: yedek varsa kendiliğinden doldur, yoksa cephane bitti.
        if (p.reserve > 0) p.reloadUntil = this.time + wep.reloadMs;
        else if (!p.dryNotified) {
          p.dryNotified = true;
          p.privEvents.push({ e: 'dry' });
        }
      } else {
        this.fire(p, wep, atisMenzili);
      }
    }
    p.prevKeys = inp.k;
  }

  // Şarjörü yedekten doldurur. Yedek yetmezse ne kadar varsa onu koyar.
  finishReload(p, wep) {
    const need = wep.mag - p.ammo;
    const take = Math.min(need, p.reserve);
    p.ammo += take;
    p.reserve -= take;
    p.reloadUntil = 0;
    if (take > 0) p.dryNotified = false;
  }

  // Namlu ucu duvarın İÇİNE ya da ÖTESİNE düşerse mermi duvarı delmiş olurdu:
  // burnunu duvara dayayıp ateş eden oyuncu karşı tarafı vurabilirdi. Namlu
  // artık gövdeden 32 piksel ileride (eskiden 22'ydi), yani bu ihtimal gerçek.
  //
  // Çözüm: gövdeden namluya doğru ilerlerken duvara girmeden önceki son boş
  // noktayı kullan. Açık alanda hiçbir şey değişmez.
  namluyuDuvarinIcineSokma(p, namlu) {
    const adimlar = 5;
    let son = { x: p.x, y: p.y };
    for (let i = 1; i <= adimlar; i++) {
      const t = i / adimlar;
      const x = p.x + (namlu.x - p.x) * t;
      const y = p.y + (namlu.y - p.y) * t;
      const list = queryObstacles(this.idx, x - 2, y - 2, x + 2, y + 2, this._scratch);
      let carpti = false;
      for (let j = 0; j < list.length; j++) {
        const o = list[j];
        if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) { carpti = true; break; }
      }
      if (carpti) break;
      son = { x, y };
    }
    return son;
  }

  fire(p, wep, menzil = 0) {
    p.ammo--;
    p.nextFireAt = this.time + wep.fireMs;
    p.muzzle = this.time;
    if (p.protectUntil > this.time) p.protectUntil = this.time; // ateş edince koruma biter

    // Mermi NAMLU UCUNDAN doğar, oyuncunun göbeğinden değil. Hesap
    // shared/constants.js'te tek yerde: çizim de aynı noktayı kullanıyor.
    const namlu = muzzleWorld(p.x, p.y, p.aim, wep.id);
    const guvenli = this.namluyuDuvarinIcineSokma(p, namlu);
    const ox = guvenli.x;
    const oy = guvenli.y;

    for (let i = 0; i < wep.pellets; i++) {
      const ang = p.aim + (Math.random() - 0.5) * 2 * wep.spread;
      const spd = wep.speed * (0.95 + Math.random() * 0.1);
      this.bullets.push({
        id: nextBulletId++,
        owner: p.id,
        team: p.team,
        x: ox, y: oy,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        dmg: wep.dmg,
        r: wep.bulletR,
        w: wep.id,
        // Bombada menzil her atışta farklı (ne kadar tuttuysan o kadar).
        life: ((menzil > 0 ? menzil : wep.range) / wep.speed) * 1000,
        // Patlayıcıysa çarpınca/menzil bitince patlasın.
        blastR: wep.blastR || 0,
        blastDmg: wep.blastDmg || 0,
      });
    }
    this.globalEvents.push({ e: 'shot', i: p.id, x: Math.round(ox), y: Math.round(oy), a: +p.aim.toFixed(2), w: wep.id });
  }

  // --- Ana tick -----------------------------------------------------------
  tick(dtMs) {
    if (this.over) return;
    this.time += dtMs;
    this.tickCount++;
    const dtSec = dtMs / 1000;

    this.updateHidden();

    for (const p of this.players.values()) {
      if (p.bot) botThink(p, this, dtMs);
      this.drainInputs(p, dtMs);

      if (!p.alive && this.mode.respawn && this.time >= p.deadUntil) this.respawn(p);
      if (p.alive && p.reloadUntil && this.time >= p.reloadUntil) {
        this.finishReload(p, WEAPONS[p.weapon]);
      }
    }

    this.regenerate(dtSec);
    updateVelocityEstimates(this, dtMs);
    this.stepBullets(dtSec);
    this.stepPickups();
    if (this.zone) this.stepZone(dtMs, dtSec);
    this.checkEnd();
  }

  // Can kutusu yok: canın kendiliğinden yavaşça dolar (2 saniyede 1 can).
  regenerate(dtSec) {
    const amount = HP_REGEN_PER_SEC * dtSec;
    for (const p of this.players.values()) {
      if (!p.alive || p.hp >= p.maxHp) continue;
      p.hp = Math.min(p.maxHp, p.hp + amount);
    }
  }

  stepBullets(dtSec) {
    const next = [];
    for (const b of this.bullets) {
      b.life -= dtSec * 1000;
      // Ömrü bitti: normal mermi sessizce kaybolur, bomba düştüğü yerde patlar.
      if (b.life <= 0) {
        if (b.blastR > 0) this.explode(b, b.x, b.y);
        continue;
      }

      const dx = b.vx * dtSec, dy = b.vy * dtSec;
      const hit = this.raycast(b, dx, dy);

      if (hit.type === 'player') {
        if (b.blastR > 0) { this.explode(b, hit.x, hit.y); continue; }
        this.damage(hit.player, b.dmg, this.players.get(b.owner), DEATH_BULLET, b.w);
        this.globalEvents.push({ e: 'imp', x: Math.round(hit.x), y: Math.round(hit.y), t: 1 });
        continue;
      }
      if (hit.type === 'wall') {
        if (b.blastR > 0) { this.explode(b, hit.x, hit.y); continue; }
        this.globalEvents.push({ e: 'imp', x: Math.round(hit.x), y: Math.round(hit.y), t: 0 });
        continue;
      }
      b.x += dx; b.y += dy;
      if (b.x < 0 || b.y < 0 || b.x > this.map.w || b.y > this.map.h) {
        if (b.blastR > 0) this.explode(b, Math.max(0, Math.min(this.map.w, b.x)), Math.max(0, Math.min(this.map.h, b.y)));
        continue;
      }
      next.push(b);
    }
    this.bullets = next;
  }

  // Patlama: yarıçap içindeki herkese, merkeze yakınlıkla artan hasar.
  //
  // Kurallar mermiyle aynı tutuluyor ki bomba "kural tanımaz" olmasın:
  //   • dost ateşi geçmez (takım modunda),
  //   • yeni doğmuş (koruma altındaki) oyuncu zarar görmez,
  //   • DUVAR ARKASI KORUR — patlama duvarı delip geçmez.
  // Atan kişi kendi bombasından zarar görür: yakına atmak risklidir.
  explode(b, x, y) {
    const attacker = this.players.get(b.owner) || null;
    this.globalEvents.push({ e: 'boom', x: Math.round(x), y: Math.round(y), r: Math.round(b.blastR) });

    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (this.mode.teams && p.id !== b.owner && p.team === b.team) continue;
      if (p.protectUntil > this.time) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d > b.blastR) continue;
      if (lineBlocked(x, y, p.x, p.y, this.idx)) continue;
      // Merkezde tam hasar, kenarda dörtte biri.
      const k = 1 - (d / b.blastR) * 0.75;
      this.damage(p, b.blastDmg * k, attacker, DEATH_BULLET, b.w);
    }
  }

  // Mermi yolu üzerinde en yakın çarpışmayı bulur (tünelleme olmaz).
  raycast(b, dx, dy) {
    let bestT = 1.0001, best = { type: 'none' };

    // Engeller
    const minX = Math.min(b.x, b.x + dx) - b.r, maxX = Math.max(b.x, b.x + dx) + b.r;
    const minY = Math.min(b.y, b.y + dy) - b.r, maxY = Math.max(b.y, b.y + dy) + b.r;
    const list = queryObstacles(this.idx, minX, minY, maxX, maxY, this._scratch);
    for (let i = 0; i < list.length; i++) {
      const t = raySlab(b.x, b.y, dx, dy, list[i], b.r);
      if (t !== null && t < bestT) { bestT = t; best = { type: 'wall' }; }
    }

    // Oyuncular
    for (const p of this.players.values()) {
      if (!p.alive || p.id === b.owner) continue;
      if (this.mode.teams && p.team === b.team) continue;   // dost ateşi kapalı
      if (p.protectUntil > this.time) continue;
      const t = rayCircle(b.x, b.y, dx, dy, p.x, p.y, PLAYER_RADIUS + b.r);
      if (t !== null && t < bestT) { bestT = t; best = { type: 'player', player: p }; }
    }

    if (best.type !== 'none') {
      best.x = b.x + dx * bestT;
      best.y = b.y + dy * bestT;
    }
    return best;
  }

  damage(victim, amount, attacker, cause, weapon) {
    if (!victim.alive) return;
    victim.hp -= amount;

    if (attacker && attacker !== victim) {
      attacker.damage += Math.min(amount, amount + Math.min(0, victim.hp));
      attacker.privEvents.push({ e: 'hit', d: Math.round(amount), k: victim.hp <= 0 ? 1 : 0 });
      // Asist defteri: takım arkadaşına verilen hasar (dost ateşi kapalı olsa
      // da alan hasarı gibi durumlar) sayılmasın.
      if (!(this.mode.teams && attacker.team === victim.team)) {
        if (!victim.hurtBy) victim.hurtBy = new Map();
        victim.hurtBy.set(attacker.id, this.time);
      }
    }
    victim.privEvents.push({
      e: 'hurt',
      d: Math.round(amount),
      a: attacker && attacker !== victim ? Math.round(Math.atan2(attacker.y - victim.y, attacker.x - victim.x) * 100) / 100 : 0,
      z: cause === DEATH_ZONE ? 1 : 0,
    });

    if (victim.hp <= 0) this.kill(victim, attacker, cause, weapon);
  }

  kill(victim, attacker, cause, weapon) {
    victim.hp = 0;
    victim.alive = false;
    victim.deaths++;

    // ASİST: son ASSIST_WINDOW_MS içinde bu oyuncuya hasar vermiş herkes —
    // öldüren ve kurbanın kendisi hariç — bir asist alır. Süre sınırı önemli:
    // maçın başında bir kez vurup unuttuğun biri sonradan ölünce asist
    // almamalı.
    if (victim.hurtBy) {
      for (const [id, t] of victim.hurtBy) {
        if (this.time - t > ASSIST_WINDOW_MS) continue;
        if (attacker && id === attacker.id) continue;
        if (id === victim.id) continue;
        const yardimci = this.players.get(id);
        if (yardimci) yardimci.assists++;
      }
      victim.hurtBy.clear();
    }
    victim.deadUntil = this.time + RESPAWN_MS;
    victim.inputQueue.length = 0;

    if (attacker && attacker !== victim) {
      attacker.kills++;
      if (this.mode.teams) this.teamScore[attacker.team] = (this.teamScore[attacker.team] || 0) + 1;

      // ÖLDÜRME ÖDÜLÜ: öldüren oyuncu KILL_HEAL kadar can kazanır.
      // TAVAN ÖNEMLİ: canı taşırmıyoruz — 90 canlıyken öldüren 140 değil,
      // 100 (kendi azamisi) olur. Bunu Math.min ile değil, açıkça yazıyoruz
      // ki niyet kodda görünsün.
      //
      // Ölmüş bir oyuncuya can vermek de anlamsız (aynı anda ikisi birden
      // ölebilir), o yüzden hayatta olma şartı var.
      // Can, durum paketinde zaten her karede gönderiliyor; HUD'daki çubuk
      // kendiliğinden dolar, ayrıca bir olay göndermeye gerek yok.
      if (attacker.alive && KILL_HEAL > 0) {
        const hedef = attacker.hp + KILL_HEAL;
        attacker.hp = hedef > attacker.maxHp ? attacker.maxHp : hedef;
      }
    }

    if (!this.mode.respawn) {
      victim.place = this.countAlive() + 1;
    }

    this.globalEvents.push({
      e: 'kill',
      k: attacker && attacker !== victim ? attacker.id : 0,
      kn: attacker && attacker !== victim ? attacker.name : '',
      kt: attacker ? attacker.team : 0,
      v: victim.id, vn: victim.name, vt: victim.team,
      w: cause === DEATH_ZONE ? 'zone' : (weapon || 'rifle'),
      x: Math.round(victim.x), y: Math.round(victim.y),
    });
  }

  countAlive() {
    let n = 0;
    for (const p of this.players.values()) if (p.alive) n++;
    return n;
  }

  // --- Toplanabilirler ----------------------------------------------------
  stepPickups() {
    for (const k of this.pickups) {
      if (!k.active) {
        if (this.time >= k.respawnAt) { k.active = true; this.globalEvents.push({ e: 'pk', i: k.id, a: 1 }); }
        continue;
      }
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const wep = WEAPONS[p.weapon];
        if (p.reserve >= wep.reserve) continue;          // yedeği zaten dolu
        if ((p.x - k.x) ** 2 + (p.y - k.y) ** 2 > (PLAYER_RADIUS + PICKUP_RADIUS) ** 2) continue;

        p.reserve = Math.min(wep.reserve, p.reserve + Math.ceil(wep.reserve * AMMO_PACK_FRACTION));
        p.dryNotified = false;
        k.active = false;
        k.respawnAt = this.time + AMMO_PACK_RESPAWN_MS;
        p.privEvents.push({ e: 'pick', k: 'ammo' });
        this.globalEvents.push({ e: 'pk', i: k.id, a: 0 });
        break;
      }
    }
  }

  // --- Daralan alan -------------------------------------------------------
  initZone() {
    const cx = this.map.w / 2, cy = this.map.h / 2;
    const r0 = Math.hypot(this.map.w, this.map.h) / 2;
    this.zone = {
      cx, cy, r: r0,
      fromCx: cx, fromCy: cy, fromR: r0,
      toCx: cx, toCy: cy, toR: r0,
      phase: 0,
      shrinking: false,
      timer: ZONE.startDelayMs,
      dps: ZONE.dpsBase,
    };
  }

  nextZonePhase() {
    const z = this.zone;
    z.phase++;
    z.fromCx = z.cx; z.fromCy = z.cy; z.fromR = z.r;
    const factor = 1 - z.phase / (ZONE.phases + 0.6);
    const targetR = Math.max(ZONE.minRadius, z.fromR * (0.62 + 0.06 * Math.random()) * (factor > 0.15 ? 1 : 0.85));
    const maxOff = Math.max(0, z.fromR - targetR) * 0.7;
    const ang = Math.random() * Math.PI * 2;
    const off = Math.random() * maxOff;
    z.toCx = clamp(z.fromCx + Math.cos(ang) * off, targetR * 0.4, this.map.w - targetR * 0.4);
    z.toCy = clamp(z.fromCy + Math.sin(ang) * off, targetR * 0.4, this.map.h - targetR * 0.4);
    z.toR = targetR;
    z.shrinking = true;
    z.timer = ZONE.shrinkMs;
    z.dps = ZONE.dpsBase + ZONE.dpsPerPhase * z.phase;
    this.globalEvents.push({ e: 'zone', p: z.phase, x: Math.round(z.toCx), y: Math.round(z.toCy), r: Math.round(z.toR) });
  }

  stepZone(dtMs, dtSec) {
    const z = this.zone;
    z.timer -= dtMs;

    if (z.shrinking) {
      const total = ZONE.shrinkMs;
      const t = clamp(1 - z.timer / total, 0, 1);
      const e = t * t * (3 - 2 * t);           // yumuşak geçiş
      z.cx = z.fromCx + (z.toCx - z.fromCx) * e;
      z.cy = z.fromCy + (z.toCy - z.fromCy) * e;
      z.r = z.fromR + (z.toR - z.fromR) * e;
      if (z.timer <= 0) {
        z.shrinking = false;
        z.cx = z.toCx; z.cy = z.toCy; z.r = z.toR;
        z.timer = ZONE.holdMs;
      }
    } else if (z.timer <= 0 && z.phase < ZONE.phases) {
      this.nextZonePhase();
    }

    // Alan dışı hasarı
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - z.cx, p.y - z.cy);
      if (d > z.r) this.damage(p, z.dps * dtSec, null, DEATH_ZONE, 'zone');
    }
  }

  // --- Bitiş koşulları ----------------------------------------------------
  checkEnd() {
    if (this.over) return;
    const m = this.mode;

    if (m.timeLimitMs && this.time >= m.timeLimitMs) return this.end('time');

    if (m.id === 'ffa') {
      for (const p of this.players.values()) {
        if (p.kills >= m.scoreLimit) return this.end('score', { id: p.id, name: p.name });
      }
    } else if (m.id === 'tdm') {
      for (const t of [1, 2]) {
        if ((this.teamScore[t] || 0) >= m.scoreLimit) return this.end('score', { team: t });
      }
    } else if (m.id === 'br') {
      const alive = [...this.players.values()].filter((p) => p.alive);
      if (this.aliveAtStart > 1 && alive.length <= 1) {
        if (alive[0]) alive[0].place = 1;
        return this.end('lastman', alive[0] ? { id: alive[0].id, name: alive[0].name } : null);
      }
      if (this.players.size === 0) return this.end('empty');
    }
  }

  end(reason, winner = null) {
    this.over = true;
    this.endReason = reason;
    this.winner = winner;
  }

  scoreboard() {
    const rows = [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, bot: p.bot, team: p.team, cls: p.cls,
      kills: p.kills, deaths: p.deaths, assists: p.assists || 0, damage: Math.round(p.damage),
      place: p.place || (p.alive ? 1 : 0),
    }));
    if (this.mode.id === 'br') {
      rows.sort((a, b) => (a.place || 999) - (b.place || 999) || b.kills - a.kills);
    } else {
      rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.damage - a.damage);
    }
    return {
      mode: this.mode.id,
      rows,
      teamScore: this.mode.teams ? this.teamScore : null,
      winner: this.winner,
      reason: this.endReason,
    };
  }

  // --- Anlık durum paketi -------------------------------------------------
  // Varlıklar düz sayı dizisi olarak kodlanır (bkz. shared/protocol.js) ve
  // her istemciye SADECE görebildiği şeyler gönderilir. Bu hem bant
  // genişliğini düşürür hem de duvar arkasını okuyan hile yazılmasını
  // engeller: istemcide o veri hiç yoktur.
  prepareSnapshot() {
    const base = {
      t: Math.round(this.time),
      ev: this.globalEvents.length ? this.globalEvents : undefined,
    };
    if (this.zone) {
      base.zn = {
        x: Math.round(this.zone.cx), y: Math.round(this.zone.cy), r: Math.round(this.zone.r),
        tx: Math.round(this.zone.toCx), ty: Math.round(this.zone.toCy), tr: Math.round(this.zone.toR),
        s: this.zone.shrinking ? 1 : 0,
        w: Math.max(0, Math.round(this.zone.timer / 1000)),
        p: this.zone.phase,
      };
    }
    if (this.tickCount % 10 === 0) {
      // Tam skor listesi saniyede iki kez gider.
      const sp = [];
      for (const p of this.players.values()) {
        sp.push(p.id, p.kills, p.deaths, Math.round(p.damage), p.alive ? 1 : 0, p.assists);
      }
      base.sc = {
        team: this.mode.teams ? this.teamScore : null,
        alive: this.countAlive(),
        total: this.players.size,
        ps: sp,
        left: this.mode.timeLimitMs ? Math.max(0, Math.round((this.mode.timeLimitMs - this.time) / 1000)) : 0,
      };
    }
    this._base = base;
    return base;
  }

  clearEvents() {
    this.globalEvents = [];
    for (const p of this.players.values()) p.privEvents = [];
  }

  // Çalıda saklanma durumunu her tick'te bir kez hesapla.
  // Ateş eden oyuncu kısa süreliğine açığa çıkar — çalı kalkan değil.
  updateHidden() {
    const bushes = this.bushes;
    if (!bushes.length) return;
    for (const p of this.players.values()) {
      if (!p.alive || this.time - p.muzzle < BUSH_FIRE_REVEAL_MS) { p.hidden = false; continue; }
      let inside = false;
      for (let i = 0; i < bushes.length; i++) {
        const b = bushes[i];
        const dx = p.x - b.x, dy = p.y - b.y;
        if (dx * dx + dy * dy < b.r * b.r) { inside = true; break; }
      }
      p.hidden = inside;
    }
  }

  // Bir izleyici belirli bir oyuncuyu görüyor mu? (mesafe + çalı + görüş hattı)
  canSee(viewer, other) {
    if (viewer === other) return true;
    if (this.mode.teams && other.team === viewer.team) return true;   // takım arkadaşları hep görünür
    if (!other.alive) return false;
    const dx = other.x - viewer.x, dy = other.y - viewer.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > VIS_DIST * VIS_DIST) return false;
    if (other.hidden && d2 > BUSH_REVEAL_DIST * BUSH_REVEAL_DIST) return false;
    return !lineBlocked(viewer.x, viewer.y, other.x, other.y, this.idx);
  }

  snapshotFor(viewer) {
    const base = this._base || this.prepareSnapshot();
    const now = this.time;
    // Sadece elenmiş (yeniden doğmayacak) oyuncu izleyici olur ve her şeyi görür.
    // Yeniden doğacak ölülerde görüş kısıtı sürer; ölüm ekranında zaten bir şey
    // göstermiyoruz, böylece hiçbir anda fazladan bilgi sızmıyor.
    const seeAll = !viewer.alive && !this.mode.respawn;
    if (!viewer.seen) viewer.seen = new Map();

    const ps = [];
    for (const o of this.players.values()) {
      let include = seeAll || this.canSee(viewer, o);
      if (include && o !== viewer) viewer.seen.set(o.id, now);
      else if (!include && now - (viewer.seen.get(o.id) || -1e9) < VIS_GRACE_MS) include = true;
      if (!include) continue;

      let f = 0;
      if (o.alive) f |= F_ALIVE;
      if (o.protectUntil > now) f |= F_PROTECTED;
      if (o.reloadUntil) f |= F_RELOADING;
      if (now - o.muzzle < 60) f |= F_MUZZLE;
      if (o.hidden) f |= F_HIDDEN;

      ps.push(
        o.id,
        Math.round(o.x), Math.round(o.y),
        Math.round(o.aim * 100),
        Math.max(0, Math.round(o.hp)),
        o.maxHp,
        CLASS_IDS.indexOf(o.cls),
        f,
      );
    }

    const bs = [];
    const bvis = BULLET_VIS * BULLET_VIS;
    for (const b of this.bullets) {
      if (!seeAll) {
        const dx = b.x - viewer.x, dy = b.y - viewer.y;
        if (dx * dx + dy * dy > bvis) continue;
      }
      bs.push(
        b.id,
        Math.round(b.x), Math.round(b.y),
        Math.round(Math.atan2(b.vy, b.vx) * 100),
        WEAPON_IDS.indexOf(b.w),
      );
    }

    const wep = WEAPONS[viewer.weapon];
    const out = {
      t: base.t,
      ack: viewer.lastSeq,
      ps, bs,
      you: {
        x: Math.round(viewer.x * 100) / 100,
        y: Math.round(viewer.y * 100) / 100,
        hp: Math.max(0, Math.round(viewer.hp)),
        mx: viewer.maxHp,
        am: viewer.ammo,
        mg: wep.mag,
        ar: viewer.reserve,
        mr: wep.reserve,
        rl: viewer.reloadUntil ? Math.max(0, Math.round(viewer.reloadUntil - now)) : 0,
        rt: wep.reloadMs,
        al: viewer.alive ? 1 : 0,
        hd: viewer.hidden ? 1 : 0,
        rs: viewer.alive ? 0 : Math.max(0, Math.round(viewer.deadUntil - now)),
        cl: viewer.cls, wp: viewer.weapon, sp: viewer.speed,
        k: viewer.kills, d: viewer.deaths, dm: Math.round(viewer.damage),
        pl: viewer.place || 0,
      },
    };
    // Olay filtresi:
    //  - 'shot' / 'imp' konumludur; sadece menzildekilere gider (bant + hile).
    //  - 'kill' herkese gider ama uzaktaysa konumu gizlenir (öldürme akışı
    //    bozulmasın, ama konum sızmasın).
    //  - diğerleri (zone, join, pk, spawn) herkese olduğu gibi gider.
    if (base.ev) {
      const evs = [];
      for (const e of base.ev) {
        if (e.e === 'shot' || e.e === 'imp') {
          if (!seeAll) {
            const lim = e.e === 'shot' ? EVENT_AUDIO_DIST : BULLET_VIS;
            const dx = e.x - viewer.x, dy = e.y - viewer.y;
            if (dx * dx + dy * dy > lim * lim) continue;
          }
          evs.push(e);
        } else if (e.e === 'kill' && !seeAll) {
          const dx = e.x - viewer.x, dy = e.y - viewer.y;
          if (dx * dx + dy * dy > BULLET_VIS * BULLET_VIS) {
            const { x, y, ...rest } = e;
            evs.push(rest);
          } else evs.push(e);
        } else {
          evs.push(e);
        }
      }
      if (evs.length) out.ev = evs;
    }
    if (base.zn) out.zn = base.zn;
    if (base.sc) out.sc = base.sc;
    if (viewer.privEvents.length) out.pe = viewer.privEvents;
    return out;
  }

  matchStartPayload(p) {
    return {
      map: this.map,
      mode: this.mode.id,
      youId: p.id,
      tickMs: TICK_MS,
      players: [...this.players.values()].map((q) => ({
        id: q.id, name: q.name, team: q.team, cls: q.cls, char: q.char, bot: q.bot,
      })),
      pickups: this.pickups.map((k) => ({ id: k.id, x: k.x, y: k.y, kind: k.kind, active: k.active })),
    };
  }
}

// --- Işın testleri --------------------------------------------------------
// Segment (p,d) ile şişirilmiş AABB kesişimi; [0,1] aralığında en küçük t.
function raySlab(px, py, dx, dy, o, pad) {
  const minX = o.x - pad, maxX = o.x + o.w + pad;
  const minY = o.y - pad, maxY = o.y + o.h + pad;
  let t0 = 0, t1 = 1;

  if (Math.abs(dx) < 1e-9) {
    if (px < minX || px > maxX) return null;
  } else {
    let ta = (minX - px) / dx, tb = (maxX - px) / dx;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  if (Math.abs(dy) < 1e-9) {
    if (py < minY || py > maxY) return null;
  } else {
    let ta = (minY - py) / dy, tb = (maxY - py) / dy;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0 >= 0 ? t0 : null;
}

// Segment ile daire kesişimi; [0,1] aralığında en küçük t.
function rayCircle(px, py, dx, dy, cx, cy, r) {
  const fx = px - cx, fy = py - cy;
  const a = dx * dx + dy * dy;
  if (a < 1e-9) return null;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;                       // zaten içinde
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t = (-b - sq) / (2 * a);
  if (t >= 0 && t <= 1) return t;
  return null;
}
