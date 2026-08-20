// Uygulama kabuğu: ekran yönetimi, menü/lobi arayüzü ve olay bağlantıları.

import {
  MODES, CLASSES, TEAMS, MAX_PLAYERS, WEAPONS, MAX_NAME_LEN, CHARACTERS,
  UPDATE_SERVER, BOT_LEVELS, DEFAULT_BOT_LEVEL,
} from '/shared/constants.js';
import { getCharacterSprites, drawWeaponOnPreview } from './sprites.js';
import * as spritesModule from './sprites.js';
import { C, S } from '/shared/protocol.js';
import { Net } from './net.js';
import { Input } from './input.js';
import { ClientGame, esc } from './game.js';
import * as renderModule from './render.js';
import * as sfx from './audio.js';

const $ = (id) => document.getElementById(id);

const RANDOM_NAMES = [
  'Yıldırım', 'Çakal', 'Pusu', 'Gölge', 'Karakartal', 'Doludizgin', 'Zırhlı',
  'Kanka', 'Efsane', 'Fırtına', 'Sessiz', 'Keskin', 'Bozkurt', 'Alperen',
];

const state = {
  screen: 'menu',
  me: { id: 0, name: '' },
  lobby: null,
  lobbies: [],
  createMode: 'ffa',
  createBotLevel: DEFAULT_BOT_LEVEL,
  inMatch: false,
  netMode: 'local',      // 'local' | 'online'
};

const net = new Net();
const input = new Input($('canvas'));
const game = new ClientGame(net, input);

// ============================================================ yardımcılar
function show(screen) {
  state.screen = screen;
  for (const id of ['screenMenu', 'screenLobby', 'screenGame']) {
    $(id).classList.toggle('active', id === `screen${cap(screen)}`);
  }
}
function cap(s) { return s[0].toUpperCase() + s.slice(1); }

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

function store(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key) || '';
    localStorage.setItem(key, val);
  } catch { /* gizli sekmede localStorage kapalı olabilir */ }
  return val || '';
}
function savedName() { return store('sa_name'); }
function saveName(n) { store('sa_name', n); }

// --- Bağlantı modu -------------------------------------------------------
function setConnStatus(text, kind = '') {
  const el = $('connStatus');
  el.textContent = text;
  el.className = `conn-status ${kind}`;
}

async function useLocal(save = true) {
  state.netMode = 'local';
  if (save) store('sa_mode', 'local');
  $('tabLocal').classList.add('sel');
  $('tabOnline').classList.remove('sel');
  $('serverRow').classList.add('hidden');
  $('browsePanel').classList.add('hidden');
  $('offlinePanel').classList.remove('hidden');
  $('connBar').classList.add('hidden');
  setConnStatus('Çevrimdışı — oyun bu cihazda çalışıyor.', 'ok');
  state.lobby = null;
  await net.connectLocal();
}

// Boş sunucu adresi "bu sayfanın sunucusu" demektir. Ama paketlenmiş sürümde
// (tek dosya / APK) sayfanın bir sunucusu YOKTUR — o durumda boş adres,
// bağlanılamayan boş bir adrese dönüşüyordu ve ekranda "adresine
// ulaşılamıyor — 3. deneme" gibi adresi olmayan bir mesaj çıkıyordu.
// Paketlenmiş sürümde boş adres artık bulut sunucuya çözülüyor.
// Sayfanın kendi oyun sunucusu var mı?
//
// Protokole bakmak YETMİYOR: APK içindeki sayfa Capacitor tarafından
// `https://localhost` üzerinden servis ediliyor, yani gerçek bir sunucudan
// geliyormuş gibi görünüyor — ama arkasında oyun sunucusu yok. Bu yüzden
// APK'da Online'a basınca oyun kendi kendine bağlanmaya çalışıp
// "Bağlanılıyor: localhost" ekranında takılıyordu.
//
// Doğru ölçüt paketlenmiş olup olmadığı: paket sürümlerinde __BUNDLED__ var.
function isPackagedApp() {
  return !!window.__BUNDLED__
    || !!window.Capacitor
    || location.protocol === 'file:'
    || location.protocol === 'capacitor:';
}

// Adres uygulamanın KENDİ adresini mi gösteriyor?
// Capacitor, APK'nın dosyalarını `https://localhost` üzerinden veriyor. Orada
// oyun sunucusu yoktur — ama eski sürümlerde bu adres "sunucu" diye kaydedilmiş
// olabiliyordu ve webview verisi APK güncellemesinde silinmediği için kayıtlı
// kalıyordu. Sonuç: "localhost adresine ulaşılamıyor".
function ownAddress(u) {
  const s = String(u).replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  const host = s.replace(/:\d+$/, '');
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return true;
  return !!location.host && s === location.host.toLowerCase();
}

function resolveServerUrl(url) {
  const u = (url || '').trim();
  if (!isPackagedApp()) return u;
  // Paketlenmiş sürümde "boş adres" ya da "kendi adresim" diye bir sunucu
  // yoktur; her iki durumda da bulut sunucuya bağlanıyoruz.
  if (!u || ownAddress(u)) return UPDATE_SERVER;
  return u;
}

function useOnline(rawUrl, save = true) {
  const url = resolveServerUrl(rawUrl);
  state.netMode = 'online';
  // Adresi HEMEN kaydetmiyoruz: çalışmayan bir adres kaydedilirse tarayıcıda
  // kalıcı olarak takılı kalır ve kullanıcı bir daha hiçbir sunucuya
  // bağlanamaz. Kayıt, bağlantı gerçekten kurulunca (_open) yapılıyor.
  if (save) { store('sa_mode', 'online'); state.pendingServer = url || ''; }
  $('tabOnline').classList.add('sel');
  $('tabLocal').classList.remove('sel');
  $('serverRow').classList.remove('hidden');
  $('browsePanel').classList.remove('hidden');
  $('offlinePanel').classList.add('hidden');
  setConnStatus(`Bağlanılıyor: ${url || location.host}`);
  state.lobby = null;
  wakeServer(url);
  net.connectRemote(url);
}

// "sunucu.com" / "wss://sunucu.com" → "https://sunucu.com"
function normalizeHttp(u) {
  let x = (u || '').trim().replace(/\/+$/, '');
  if (x.startsWith('wss://')) return `https://${x.slice(6)}`;
  if (x.startsWith('ws://')) return `http://${x.slice(5)}`;
  if (x.startsWith('http://') || x.startsWith('https://')) return x;
  const local = /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x);
  return `${local ? 'http' : 'https'}://${x}`;
}

function randomName() {
  return RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)] + Math.floor(10 + Math.random() * 90);
}

// ============================================================ menü kurulumu
function buildModePicker(container, selected, onPick) {
  container.innerHTML = '';
  for (const id of Object.keys(MODES)) {
    const m = MODES[id];
    const btn = document.createElement('button');
    btn.className = 'mode-card' + (id === selected ? ' sel' : '');
    btn.innerHTML = `<div class="mc-name">${esc(m.name)}</div><div class="mc-desc">${esc(m.desc)}</div>`;
    btn.onclick = () => { sfx.sfxUi(); onPick(id); };
    container.appendChild(btn);
  }
}

// Bot zorluk seçici (kolay / orta / zor). Hem menüde hem lobide aynı bileşen.
function buildLevelPicker(container, selected, onPick) {
  container.innerHTML = '';
  for (const id of Object.keys(BOT_LEVELS)) {
    const lv = BOT_LEVELS[id];
    const btn = document.createElement('button');
    btn.className = 'level-btn lv-' + id + (id === selected ? ' sel' : '');
    btn.type = 'button';
    btn.innerHTML = `<span class="lv-name">${esc(lv.name)}</span><span class="lv-desc">${esc(lv.desc)}</span>`;
    btn.onclick = () => { sfx.sfxUi(); onPick(id); };
    container.appendChild(btn);
  }
}

function buildClassPicker(container, selected, onPick) {
  container.innerHTML = '';
  for (const id of Object.keys(CLASSES)) {
    const c = CLASSES[id];
    const w = WEAPONS[c.weapon];
    const btn = document.createElement('button');
    btn.className = 'class-card' + (id === selected ? ' sel' : '');
    btn.innerHTML = `
      <div class="cc-name" style="color:${c.color}">${esc(c.name)}</div>
      <div class="cc-desc">${esc(c.desc)}</div>
      <div class="cc-stats">${c.hp} can · ${w.name} · ${Math.round(c.speed)} hız</div>`;
    btn.onclick = () => { sfx.sfxUi(); onPick(id); };
    container.appendChild(btn);
  }
}

// Karakter seçimi: her karakteri küçük bir tuvalde canlı çizip gösteriyoruz.
function buildCharPicker(container, selected, teamColor, weaponId, onPick) {
  container.innerHTML = '';
  for (const id of Object.keys(CHARACTERS)) {
    const ch = CHARACTERS[id];
    const btn = document.createElement('button');
    btn.className = 'char-card' + (id === selected ? ' sel' : '');
    btn.title = ch.name;

    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 72;
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = false;
    const set = getCharacterSprites({
      jacket: teamColor || ch.jacket, hair: ch.hair, skin: ch.skin,
      accent: ch.accent, eye: ch.eye, style: ch.style,
    });
    cx.drawImage(set.down[1], 0, 0, 64, 72);
    // karakteri silahıyla göster
    drawWeaponOnPreview(cx, 0, 0, 2, weaponId, ch.skin);

    const label = document.createElement('span');
    label.className = 'cc-label';
    label.textContent = ch.name;

    btn.appendChild(cv);
    btn.appendChild(label);
    btn.onclick = () => { sfx.sfxUi(); onPick(id); };
    container.appendChild(btn);
  }
}

function renderLobbyList() {
  const el = $('lobbyList');
  if (!state.lobbies.length) {
    el.innerHTML = '<div class="empty">Henüz açık lobi yok — ilk lobiyi sen kur!</div>';
    return;
  }
  el.innerHTML = '';
  for (const l of state.lobbies) {
    const div = document.createElement('div');
    div.className = 'lobby-item';
    const stateLabel = l.state === 'waiting' ? 'bekliyor' : l.state === 'playing' ? 'maçta' : l.state === 'countdown' ? 'başlıyor' : 'skor';
    div.innerHTML = `
      <span class="li-name">${esc(l.name)}</span>
      <span class="li-mode">${esc(MODES[l.mode]?.short || l.mode)}</span>
      <span class="li-count">${l.players}/${l.max}</span>
      <span class="li-state ${l.state === 'playing' ? 'playing' : 'waiting'}">${stateLabel}</span>`;
    div.onclick = () => {
      if (l.players >= l.max) { toast('Lobi dolu.'); return; }
      sfx.sfxUi();
      net.send(C.LOBBY_JOIN, { id: l.id });
    };
    el.appendChild(div);
  }
}

// ============================================================ lobi odası
function renderLobby() {
  const l = state.lobby;
  if (!l) return;
  const isHost = l.hostId === state.me.id;
  const mode = MODES[l.mode] || MODES.ffa;
  const meMember = l.members.find((m) => m.id === state.me.id);

  $('lobbyTitle').textContent = l.name;
  $('lobbyCode').textContent = l.code;

  // Davet linki — sadece gerçek bir sunucuya bağlıyken anlamlı
  const inviteRow = $('inviteRow');
  if (state.netMode === 'online' && (net.url || !isPackagedApp())) {
    const base = net.url ? normalizeHttp(net.url) : location.origin;
    const link = `${base}/?lobi=${l.code}`;
    inviteRow.classList.remove('hidden');
    $('inviteLink').value = link;

    const local = /^https?:\/\/(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(base);
    $('inviteNote').innerHTML = local
      ? 'Bu adres <b>sadece aynı wifi ağındaki</b> cihazlarda açılır. Arkadaşın başka yerdeyse ya da mobil veri kullanıyorsa açılmaz — README\'deki tünel ya da bulut sunucu adımlarını uygula.'
      : 'Bu link her yerden açılır. Tıklayan doğrudan bu lobiye girer.';
  } else {
    inviteRow.classList.add('hidden');
  }
  $('lobbyModeLabel').textContent = mode.name;
  $('lobbyCountLabel').textContent = `${l.members.length}/${l.maxPlayers} oyuncu` + (l.botCount ? ` + ${l.botCount} bot` : '');

  // Host kontrolleri
  $('hostControls').classList.toggle('hidden', !isHost);
  if (isHost) {
    buildModePicker($('lobbyModePicker'), l.mode, (m) => net.send(C.SET_SETTINGS, { mode: m }));
    const maxIn = $('lobbyMaxInput'), botIn = $('lobbyBotInput');
    if (document.activeElement !== maxIn) maxIn.value = l.maxPlayers;
    if (document.activeElement !== botIn) botIn.value = l.botCount;
    $('lobbyMaxVal').textContent = l.maxPlayers;
    $('lobbyBotVal').textContent = l.botCount;
    botIn.max = Math.max(0, l.maxPlayers - 1);
    buildLevelPicker($('lobbyLevelPicker'), l.botLevel || DEFAULT_BOT_LEVEL,
      (lv) => net.send(C.SET_SETTINGS, { botLevel: lv }));
  }

  // Takım seçimi
  $('teamPicker').classList.toggle('hidden', !mode.teams);

  // Oyuncu listesi
  const roster = $('roster');
  roster.innerHTML = '';
  for (const m of l.members) {
    const div = document.createElement('div');
    div.className = `roster-item ${m.id === state.me.id ? 'me ' : ''}${mode.teams ? 't' + m.team : ''}`;
    const cls = CLASSES[m.cls]?.name || '';
    div.innerHTML = `
      <span class="r-dot ${m.ready || m.host ? 'ready' : ''}"></span>
      <span class="r-name">${esc(m.name)}${m.host ? ' <span class="r-host">👑</span>' : ''}</span>
      <span class="r-cls">${esc(cls)}</span>`;
    if (isHost && m.id !== state.me.id) {
      const kick = document.createElement('button');
      kick.className = 'r-kick';
      kick.textContent = '✕';
      kick.title = 'At';
      kick.onclick = () => net.send(C.KICK, { id: m.id });
      div.appendChild(kick);
    }
    roster.appendChild(div);
  }
  $('rosterCount').textContent = `(${l.members.length}/${l.maxPlayers})`;

  // Sınıf seçimi
  buildClassPicker($('classPicker'), meMember?.cls || 'komando', (c) => net.send(C.SET_CLASS, { cls: c }));

  // Karakter seçimi
  buildCharPicker(
    $('charPicker'),
    meMember?.char,
    mode.teams ? TEAMS[meMember?.team || 1]?.color : null,
    CLASSES[meMember?.cls || 'komando'].weapon,
    (ch) => net.send(C.SET_CHAR, { char: ch }),
  );

  // Hazır butonu — lobi sahibi dahil herkes basar
  const btnReady = $('btnReady');
  btnReady.classList.toggle('on', !!meMember?.ready);
  btnReady.textContent = meMember?.ready ? 'HAZIRIM ✓' : 'HAZIRIM';
  btnReady.classList.remove('hidden');

  // Kaç kişi hazır?
  const total = l.members.length;
  const ready = l.readyCount ?? 0;
  const status = $('readyStatus');
  if (l.state === 'countdown') {
    status.textContent = 'Herkes hazır!';
    status.className = 'ready-status all';
  } else if (l.state === 'playing') {
    status.textContent = 'Maç sürüyor…';
    status.className = 'ready-status';
  } else {
    status.textContent = `${ready} / ${total} kişi hazır`;
    status.className = 'ready-status' + (ready === total && total > 0 ? ' all' : '');
  }

  // Geri sayım
  if (l.state === 'countdown') startCountdown(l.countdownLeft);
  else stopCountdown();

  // Maç sonu tablosu.
  // Aynı tabloyu İKİ KEZ göstermiyoruz: maç bitince tam ekran tablo çıkıyor
  // (matchEndOverlay), "LOBİYE DÖN" deyince de lobide ikinci bir kopyası
  // beliriyordu — kullanıcı aynı ekranı tekrar görmüş oluyordu. Burası artık
  // sadece maçı KAÇIRANLAR için: lobiye maç sonu evresinde katılan biri
  // sonucu görebilsin diye.
  const sb = l.lastScoreboard;
  if (l.state === 'post' && sb && sb.matchId !== state.seenScoreboard) {
    showPostScoreboard(sb, l.postLeft);
  } else {
    $('lobbyScoreboard').classList.add('hidden');
  }
}

let cdTimer = null;
let cdLastShown = -1;

function startCountdown(ms) {
  const overlay = $('countdownOverlay');
  const num = $('countdownNum');
  if (cdTimer) clearInterval(cdTimer);
  overlay.classList.remove('hidden');

  // İPTAL: hazır durumunu geri alır. Sunucu "herkes hazır değil" görünce
  // geri sayımı durdurup lobiye döner — yani iptal kararı da sunucuda
  // veriliyor, istemci sadece niyeti bildiriyor.
  const iptal = $('btnCancelStart');
  if (iptal) {
    iptal.onclick = () => {
      sfx.sfxUi();
      net.send(C.SET_READY, { ready: false });
      stopCountdown();
    };
  }

  const end = Date.now() + ms;
  const tick = () => {
    const left = Math.max(0, end - Date.now());
    const n = Math.ceil(left / 1000);
    if (n !== cdLastShown) {
      cdLastShown = n;
      num.textContent = n > 0 ? n : 'BAŞLA!';
      // her sayıda kısa bir vuruş: animasyonu yeniden tetikle
      num.classList.remove('pop');
      void num.offsetWidth;
      num.classList.add('pop');
      if (n > 0) sfx.sfxUi();
    }
    if (left <= 0) { clearInterval(cdTimer); cdTimer = null; }
  };
  tick();
  cdTimer = setInterval(tick, 100);
}

function stopCountdown() {
  if (cdTimer) { clearInterval(cdTimer); cdTimer = null; }
  cdLastShown = -1;
  $('countdownOverlay').classList.add('hidden');
}

function renderChat(lines) {
  const log = $('chatLog');
  log.innerHTML = '';
  for (const m of lines) appendChat(m, false);
  log.scrollTop = log.scrollHeight;
}

function appendChat(msg, scroll = true) {
  const log = $('chatLog');
  const div = document.createElement('div');
  div.className = 'chat-line' + (msg.sys ? ' sys' : '');
  div.innerHTML = msg.sys ? esc(msg.text) : `<span class="cf">${esc(msg.from)}:</span> ${esc(msg.text)}`;
  log.appendChild(div);
  while (log.children.length > 120) log.removeChild(log.firstChild);
  if (scroll) log.scrollTop = log.scrollHeight;
}

// ============================================================ skor tabloları
function scoreboardHtml(sb, title) {
  const mode = MODES[sb.mode] || MODES.ffa;
  let html = `<div class="me-inner"><h2>${esc(title)}</h2><div class="me-sub">${esc(mode.name)}</div>`;

  if (sb.teamScore) {
    html += `<div class="sb-teamline">
      <span style="color:${TEAMS[1].color}">${TEAMS[1].name} ${sb.teamScore[1] || 0}</span>
      <span style="color:${TEAMS[2].color}">${TEAMS[2].name} ${sb.teamScore[2] || 0}</span></div>`;
  }

  html += '<table class="sb-table"><tr><th>#</th><th>Oyuncu</th><th>Sınıf</th><th class="num">Öldürme</th><th class="num">Asist</th><th class="num">Ölüm</th><th class="num">Hasar</th></tr>';
  sb.rows.forEach((r, i) => {
    html += `<tr class="${r.id === state.me.id ? 'me ' : ''}${sb.teamScore ? 't' + r.team : ''}">
      <td>${sb.mode === 'br' && r.place ? '#' + r.place : i + 1}</td>
      <td>${esc(r.name)}${r.bot ? '<span class="sb-bot">BOT</span>' : ''}</td>
      <td>${esc(CLASSES[r.cls]?.name || '')}</td>
      <td class="num">${r.kills}</td>
      <td class="num">${r.assists || 0}</td>
      <td class="num">${r.deaths}</td>
      <td class="num">${r.damage}</td>
    </tr>`;
  });
  html += '</table>';
  return html;
}

// Maçı BEN mi kazandım? Takım modunda takımım, diğerlerinde birinci sıra.
function didIWin(sb) {
  if (!sb || !sb.rows || !sb.rows.length) return false;
  const ben = sb.rows.find((r) => r.id === state.me.id);
  if (!ben) return false;
  if (sb.teamScore) {
    const t1 = sb.teamScore[1] || 0, t2 = sb.teamScore[2] || 0;
    if (t1 === t2) return false;
    return ben.team === (t1 > t2 ? 1 : 2);
  }
  if (sb.winner && sb.winner.id) return sb.winner.id === state.me.id;
  return sb.rows[0].id === state.me.id;
}

// Kazanınca ekranın ortasında sarı "KAZANDIN" + konfeti.
// Konfeti tek bir canvas'a çiziliyor; DOM'a yüzlerce parçacık eklemek
// telefonu zorlardı.
let konfetiRaf = 0;
let winTabloTimer = 0;
let winYaziTimer = 0;
function showWinScreen() {
  const el = $('winOverlay');
  const cv = $('winConfetti');
  if (!el || !cv) return;
  el.classList.remove('hidden');
  el.classList.remove('replay', 'fade');
  void el.offsetWidth;            // animasyonu baştan başlat
  el.classList.add('replay');
  // Yazı 2 saniye tek başına kalsın, sonra sönsün; konfeti biraz daha sürer.
  clearTimeout(winYaziTimer);
  winYaziTimer = setTimeout(() => el.classList.add('fade'), WIN_SOLO_MS);

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.width = Math.floor(window.innerWidth * dpr);
  const H = cv.height = Math.floor(window.innerHeight * dpr);
  const ctx = cv.getContext('2d');
  const RENK = ['#ffd479', '#ffb02e', '#7ee787', '#7fb0d8', '#ff8f87', '#c39bff', '#fff3d0'];
  const N = Math.min(220, Math.round(window.innerWidth / 6));
  const parts = Array.from({ length: N }, () => ({
    x: Math.random() * W,
    y: -Math.random() * H * 0.6,
    w: (5 + Math.random() * 7) * dpr,
    h: (8 + Math.random() * 12) * dpr,
    vy: (90 + Math.random() * 190) * dpr,
    vx: (Math.random() - 0.5) * 90 * dpr,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 7,
    c: RENK[Math.floor(Math.random() * RENK.length)],
    sway: Math.random() * Math.PI * 2,
  }));

  let last = performance.now();
  // Konfeti, skor tablosu açılırken bitiyor: tablo okunurken ekranda kâğıt
  // yağmuru olmasın. Son yarım saniyede sönerek kayboluyor.
  const bitis = last + WIN_SOLO_MS;
  cancelAnimationFrame(konfetiRaf);
  const adim = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.sway += dt * 3;
      p.x += (p.vx + Math.sin(p.sway) * 40 * dpr) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.y > H + 40) { p.y = -30; p.x = Math.random() * W; }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.globalAlpha = now > bitis - 550 ? Math.max(0, (bitis - now) / 550) : 1;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (now < bitis) konfetiRaf = requestAnimationFrame(adim);
    else { ctx.clearRect(0, 0, W, H); el.classList.add('hidden'); }
  };
  konfetiRaf = requestAnimationFrame(adim);
}

function hideWinScreen() {
  cancelAnimationFrame(konfetiRaf);
  clearTimeout(winYaziTimer);
  clearTimeout(winTabloTimer);
  const el = $('winOverlay');
  if (el) el.classList.add('hidden');
}

function winnerText(sb) {
  if (!sb) return 'Maç bitti';
  if (sb.teamScore) {
    const t1 = sb.teamScore[1] || 0, t2 = sb.teamScore[2] || 0;
    if (t1 === t2) return 'Berabere!';
    return `${t1 > t2 ? TEAMS[1].name : TEAMS[2].name} kazandı!`;
  }
  if (sb.winner?.name) return `${sb.winner.name} kazandı!`;
  const top = sb.rows[0];
  return top ? `${top.name} kazandı!` : 'Maç bitti';
}

function showPostScoreboard(sb, leftMs) {
  const el = $('lobbyScoreboard');
  el.classList.remove('hidden');
  el.innerHTML = `<div class="panel" style="max-width:820px;width:100%">
    ${scoreboardHtml(sb, winnerText(sb))}
    <div class="me-next">Lobi ${Math.ceil((leftMs || 0) / 1000)} saniye içinde açılıyor…</div>
    <button id="btnClosePost" class="ghost small" style="margin-top:12px">Kapat</button>
  </div></div>`;
  $('btnClosePost').onclick = () => {
    if (sb && sb.matchId) state.seenScoreboard = sb.matchId;
    el.classList.add('hidden');
  };
}

// ============================================================ ağ olayları
// Ücretsiz bulut sunucu (Render) 15 dk boştaysa uyur; uyanması 1 dakikayı
// bulabilir. Mobil veride WebSocket el sıkışması da yavaştır. Eskiden 3 saniye
// sonra çevrimdışına düşüyorduk — telefondan sunucuya hiç bağlanamamanın
// sebebi buydu. Artık sabırla bekliyoruz ve çevrimdışına geçmeyi kullanıcıya
// bırakıyoruz; kendiliğinden geçiş yalnızca çok uzun süre sonra oluyor.
const CONNECT_PATIENCE_MS = 45000;

let autoFallbackTimer = null;
function cancelAutoFallback() {
  if (autoFallbackTimer) { clearTimeout(autoFallbackTimer); autoFallbackTimer = null; }
  const b = $('btnPlayOffline');
  if (b) b.classList.add('hidden');
}

// Uyuyan servisi WebSocket değil, sıradan bir HTTP isteği uyandırır.
// Bağlanmadan önce /health'e dokunuyoruz ki sunucu ayağa kalkmaya başlasın.
function wakeServer(url) {
  let base;
  try {
    base = url ? normalizeHttp(url) : location.origin;
  } catch { return; }
  if (!/^https?:\/\//.test(base)) return;
  fetch(`${base}/health`, { cache: 'no-store' }).catch(() => { /* uyanıyor olabilir */ });
}

net.on('_open', () => {
  cancelAutoFallback();
  $('connBar').classList.add('hidden');
  if (state.netMode === 'online') {
    // Ancak GERÇEKTEN bağlanınca adresi kaydediyoruz.
    if (state.pendingServer !== undefined) {
      store('sa_server', state.pendingServer);
      state.pendingServer = undefined;
    }
    setConnStatus(`Bağlandı: ${net.url || location.host}`, 'ok');
  }
  const name = $('nameInput').value.trim() || savedName() || randomName();
  net.send(C.HELLO, { name });
});

net.on('_close', () => {
  if (state.netMode !== 'online') return;
  $('connBar').classList.remove('hidden');
  $('connText').textContent = 'Bağlantı koptu — yeniden bağlanılıyor…';
  setConnStatus('Bağlantı koptu.', 'bad');
  if (state.inMatch) {
    game.stop();
    state.inMatch = false;
    show('menu');
  }
});

// Hangi adrese bağlanmaya çalışıyoruz? Boşsa sayfanın kendi sunucusu.
function currentTarget() {
  return net.url || location.host || UPDATE_SERVER;
}

// Bağlantı hiç kurulamayacak durumda (mesela adres yok): kullanıcıyı sonsuz
// "deneniyor" ekranında bırakmayalım, sebebini söyleyip çevrimdışına dönelim.
net.on('_error', (d) => {
  if (state.netMode !== 'online') return;
  toast(`Bağlanılamadı: ${d.message}. Çevrimdışı moda geçiliyor.`);
  cancelAutoFallback();
  useLocal(false);
});

net.on('_retry', (d) => {
  if (state.netMode !== 'online') return;
  // Her denemede sunucuyu HTTP ile de dürtüyoruz: uykudaysa uyanma yolu budur.
  wakeServer(net.url);

  // Kayıtlı ÖZEL bir adres tutmuyorsa, sayfanın kendi sunucusuna dön.
  //
  // Neden: kullanıcı daha önce kutuya bir adres yazdıysa (mesela ev ağındaki
  // 192.168.x.x) o adres tarayıcıda saklı kalıyor ve bulut sunucudan açılan
  // sayfa bile o ölü adrese bağlanmaya çalışıyordu. Ekranda sadece "sunucu
  // uyanıyor" yazdığı için sebebi görmek imkânsızdı.
  // Paketlenmiş sürümde sayfanın sunucusu olmadığı için buraya düşmemeli.
  const servedFromServer = !isPackagedApp()
    && (location.protocol === 'http:' || location.protocol === 'https:');
  if (d.attempt >= 3 && net.url && servedFromServer) {
    toast('Kayıtlı sunucu adresine ulaşılamadı — bu sayfanın sunucusuna geçiliyor.');
    $('serverInput').value = '';
    useOnline('');
    return;
  }

  $('connBar').classList.remove('hidden');
  $('connText').textContent = d.attempt <= 2
    ? `Bağlanılıyor: ${currentTarget()}`
    : `${currentTarget()} adresine ulaşılamıyor — ${d.attempt}. deneme.`;
  setConnStatus(
    `Bağlanmaya çalışılıyor: ${currentTarget()} (${d.attempt}. deneme). `
    + 'Ücretsiz sunucu uykudaysa 1 dakikaya kadar sürebilir.',
  );
  const b = $('btnPlayOffline');
  if (b) b.classList.remove('hidden');
});

net.on(S.WELCOME, (m) => {
  state.me.id = m.id;
  state.me.name = m.name;
  $('nameInput').value = m.name;
  saveName(m.name);

  // Davet linkiyle gelindiyse doğrudan lobiye gir
  if (state.pendingJoinCode) {
    const code = state.pendingJoinCode;
    state.pendingJoinCode = null;
    net.send(C.LOBBY_JOIN, { code });
  }
});

net.on(S.LOBBY_LIST, (m) => {
  state.lobbies = m.lobbies || [];
  if (state.screen === 'menu') renderLobbyList();
});

net.on(S.LOBBY_STATE, (m) => {
  const wasInLobby = !!state.lobby;
  state.lobby = m.lobby;
  if (!state.inMatch) {
    if (!wasInLobby) { show('lobby'); renderChat(m.lobby.chat || []); }
    renderLobby();
  } else {
    // Maç sırasında gelen lobi güncellemesi: sadece veriyi sakla
    if (m.lobby.state === 'post') { /* maç sonu ekranı MATCH_END ile açılıyor */ }
  }
});

net.on(S.LOBBY_LEFT, (m) => {
  state.lobby = null;
  state.inMatch = false;
  game.stop();
  closeSettings();
  show('menu');
  renderLobbyList();
  if (m.reason) toast(m.reason);
  net.send(C.LOBBY_LIST, {});
});

net.on(S.CHAT, (m) => {
  if (state.inMatch) game.pushChat(m);
  else appendChat(m);
  if (state.lobby) {
    state.lobby.chat = (state.lobby.chat || []).concat(m).slice(-40);
  }
});

net.on(S.ERROR, (m) => toast(m.message || 'Bir hata oluştu'));

net.on(S.MATCH_START, (m) => {
  stopCountdown();
  state.inMatch = true;
  $('matchEndOverlay').classList.add('hidden');
  closeSettings();
  show('game');
  sfx.unlockAudio();
  game.start(m);
});

net.on(S.SNAPSHOT, (m) => game.onSnapshot(m));

// Kazanma anında KAZANDIN yazısının tek başına kaldığı süre.
const WIN_SOLO_MS = 2000;

net.on(S.MATCH_END, (m) => {
  if (!state.inMatch) return;
  closeSettings();
  // Bu tabloyu gördük; lobide ikinci kez gösterilmesin.
  state.seenScoreboard = m.scoreboard && m.scoreboard.matchId;

  const kazandim = didIWin(m.scoreboard);

  const tabloyuGoster = () => {
    if (!state.inMatch) return;          // bu arada lobiye dönmüş olabilir
    const el = $('matchEndOverlay');
    el.classList.remove('hidden');
    el.innerHTML = scoreboardHtml(m.scoreboard, winnerText(m.scoreboard))
      + `<div class="me-next">Lobiye dönülüyor…</div>
         <button id="btnBackLobby" class="primary big">LOBİYE DÖN</button></div>`;
    $('btnBackLobby').onclick = backToLobby;
  };

  if (kazandim) {
    // Önce sadece KAZANDIN (+ konfeti). Skor tablosu 2 saniye sonra geliyor —
    // ikisi aynı anda çıkınca yazı tabloyu örtüyordu.
    showWinScreen();
    sfx.sfxWin();
    clearTimeout(winTabloTimer);
    winTabloTimer = setTimeout(tabloyuGoster, WIN_SOLO_MS);
  } else {
    tabloyuGoster();
  }

  // Otomatik lobiye dönüş: kazananda tablo 2 sn geç açıldığı için o kadar
  // ek süre tanıyoruz, tabloya bakacak vakit kalsın.
  const bekle = Math.max(3000, (m.nextIn || 10000) - 1500) + (kazandim ? WIN_SOLO_MS : 0);
  setTimeout(() => { if (state.inMatch) backToLobby(); }, bekle);
});

function backToLobby() {
  hideWinScreen();
  if (!state.inMatch) return;
  state.inMatch = false;
  game.stop();
  $('matchEndOverlay').classList.add('hidden');
  show('lobby');
  if (state.lobby) { renderLobby(); renderChat(state.lobby.chat || []); }
}

// ============================================================ arayüz olayları
function initUi() {
  // İsim
  const nameInput = $('nameInput');
  nameInput.value = savedName() || randomName();
  nameInput.maxLength = MAX_NAME_LEN;
  nameInput.addEventListener('change', () => {
    const n = nameInput.value.trim().slice(0, MAX_NAME_LEN);
    if (!n) { nameInput.value = state.me.name; return; }
    saveName(n);
    net.send(C.RENAME, { name: n });
    state.me.name = n;
  });
  $('btnRandomName').onclick = () => {
    nameInput.value = randomName();
    nameInput.dispatchEvent(new Event('change'));
    sfx.sfxUi();
  };

  // Lobi kurma paneli
  const rebuildCreateModes = () => buildModePicker($('modePicker'), state.createMode, (m) => {
    state.createMode = m;
    rebuildCreateModes();
  });
  rebuildCreateModes();

  const maxIn = $('maxPlayersInput'), botIn = $('botCountInput');
  maxIn.max = MAX_PLAYERS;
  const syncCreateSliders = () => {
    $('maxPlayersVal').textContent = maxIn.value;
    botIn.max = Math.max(0, Number(maxIn.value) - 1);
    if (Number(botIn.value) > Number(botIn.max)) botIn.value = botIn.max;
    $('botCountVal').textContent = botIn.value;
  };
  maxIn.addEventListener('input', syncCreateSliders);
  botIn.addEventListener('input', syncCreateSliders);
  const seviyeSec = (lv) => {
    state.createBotLevel = lv;
    buildLevelPicker($('botLevelPicker'), lv, seviyeSec);
  };
  buildLevelPicker($('botLevelPicker'), state.createBotLevel, seviyeSec);
  syncCreateSliders();

  $('btnCreate').onclick = () => {
    sfx.unlockAudio(); sfx.sfxUi();
    net.send(C.LOBBY_CREATE, {
      name: $('lobbyNameInput').value.trim(),
      mode: state.createMode,
      maxPlayers: Number(maxIn.value),
      botCount: Number(botIn.value),
      botLevel: state.createBotLevel,
      private: $('privateInput').checked,
    });
  };

  // Bağlantı modu sekmeleri
  $('tabLocal').onclick = () => { sfx.unlockAudio(); sfx.sfxUi(); cancelAutoFallback(); useLocal(); };
  $('tabOnline').onclick = () => {
    // Paketlenmiş sürümde "boş = bu sayfanın sunucusu" diye bir şey yok;
    // kutuyu bulut sunucuyla dolduruyoruz ki kullanıcı nereye bağlandığını görsün.
    // Kutuda boş ya da kendi adresi varsa bulut sunucuyu yaz — kullanıcı ne
    // yazdığını görsün, sessizce başka yere bağlanmayalım.
    if (isPackagedApp()) $('serverInput').value = resolveServerUrl($('serverInput').value);
    sfx.unlockAudio(); sfx.sfxUi(); cancelAutoFallback();
    useOnline($('serverInput').value.trim());
  };
  $('btnConnect').onclick = () => { cancelAutoFallback(); useOnline($('serverInput').value.trim()); };

  // Bağlantı beklenirken çıkan "beklemeden çevrimdışı oyna" düğmesi
  $('btnPlayOffline').onclick = () => {
    sfx.sfxUi();
    cancelAutoFallback();
    useLocal();
  };
  $('serverInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('btnConnect').click(); }
  });

  $('btnRefresh').onclick = () => { net.send(C.LOBBY_LIST, {}); sfx.sfxUi(); };
  $('btnJoinCode').onclick = () => {
    const code = $('codeInput').value.trim().toUpperCase();
    if (!code) { toast('Lobi kodunu gir.'); return; }
    sfx.unlockAudio();
    net.send(C.LOBBY_JOIN, { code });
  };
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoinCode').click(); });

  // Lobi odası
  $('btnLeave').onclick = () => { net.send(C.LOBBY_LEAVE, {}); sfx.sfxUi(); };
  $('btnReady').onclick = () => {
    const me = state.lobby?.members.find((m) => m.id === state.me.id);
    net.send(C.SET_READY, { ready: !me?.ready });
    sfx.sfxUi();
  };
  $('btnCopyLink').onclick = async () => {
    const link = $('inviteLink').value;
    try {
      await navigator.clipboard.writeText(link);
      toast('Link kopyalandı — arkadaşına gönder');
    } catch {
      $('inviteLink').select();
      toast('Kopyalanamadı — elle seçip kopyala');
    }
  };

  $('btnCopyCode').onclick = async () => {
    try {
      await navigator.clipboard.writeText(state.lobby?.code || '');
      toast('Kod kopyalandı');
    } catch { toast('Kopyalanamadı — elle seç'); }
  };
  document.querySelectorAll('.team-btn').forEach((b) => {
    b.onclick = () => { net.send(C.SET_TEAM, { team: Number(b.dataset.team) }); sfx.sfxUi(); };
  });

  $('lobbyMaxInput').addEventListener('change', (e) => net.send(C.SET_SETTINGS, { maxPlayers: Number(e.target.value) }));
  $('lobbyMaxInput').addEventListener('input', (e) => { $('lobbyMaxVal').textContent = e.target.value; });
  $('lobbyBotInput').addEventListener('change', (e) => net.send(C.SET_SETTINGS, { botCount: Number(e.target.value) }));
  $('lobbyBotInput').addEventListener('input', (e) => { $('lobbyBotVal').textContent = e.target.value; });

  // Sohbet
  $('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('chatInput').value.trim();
    if (!v) return;
    net.send(C.LOBBY_CHAT, { text: v });
    $('chatInput').value = '';
  });

  const gameChatForm = $('gameChatForm'), gameChatInput = $('gameChatInput');
  gameChatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = gameChatInput.value.trim();
    if (v) net.send(C.LOBBY_CHAT, { text: v });
    gameChatInput.value = '';
    gameChatForm.classList.add('hidden');
    input.typing = false;
  });

  // Oyun içi kısayollar
  window.addEventListener('keydown', (e) => {
    if (!state.inMatch) return;

    // Esc: sohbet açıksa onu kapatır, değilse ayarlar panelini açar/kapatır.
    if (e.code === 'Escape' && !input.typing) {
      e.preventDefault();
      if (game.showScoreboard) { game.toggleScoreboard(false); return; }
      toggleSettings();
      return;
    }

    // Tab AÇAR/KAPATIR — basılı tutmak gerekmiyor. Basılı tutma modelinde
    // tabloyu kaydırıp alttaki oyuncuları okumak imkânsızdı: fareye/tekerleğe
    // gitmek için tuşu bırakınca tablo kapanıyordu.
    if (e.code === 'Tab') {
      e.preventDefault();
      if (e.repeat) return;                       // tuşu basılı tutmak tekrar açıp kapatmasın
      game.toggleScoreboard(!game.showScoreboard);
      return;
    }

    if (input.typing) {
      if (e.code === 'Escape') {
        gameChatInput.value = '';
        gameChatForm.classList.add('hidden');
        input.typing = false;
        gameChatInput.blur();
      }
      return;
    }
    if (e.code === 'Enter') {
      e.preventDefault();
      gameChatForm.classList.remove('hidden');
      input.typing = true;
      gameChatInput.focus();
    }
  });
  // Tab artık bırakılınca kapanmıyor (açar/kapatır oldu). Esc ile de kapansın:
  // tablo açıkken Esc'nin ayarları açması kafa karıştırıcıydı.
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Tab' && state.inMatch) e.preventDefault();
  });

  // Dokunmatik skor düğmesi
  input.onScoreboard = (on) => { if (state.inMatch) game.toggleScoreboard(on); };

  // Telefonda kaydırma/zoom jestleri oyunu bozmasın
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => {
    if (state.inMatch) e.preventDefault();
  }, { passive: false });

  // İlk kullanıcı etkileşiminde sesi aç (tarayıcı kısıtı)
  const unlock = () => { sfx.unlockAudio(); window.removeEventListener('pointerdown', unlock); };
  window.addEventListener('pointerdown', unlock);
}

// ============================================================ oyun içi ayarlar
// Maç sırasında sağ üstteki ⚙ düğmesi. Buradan sesi ayarlamak, tam ekrana
// geçmek ve maçtan çıkmak mümkün. Panel açıkken tuşlar oyuna gitmez —
// yoksa menüde gezerken karakter yürümeye devam ederdi.
function closeSettings() {
  const ov = $('settingsOverlay');
  if (ov && !ov.classList.contains('hidden')) toggleSettings(false);
}

function toggleSettings(open) {
  const ov = $('settingsOverlay');
  const willOpen = open === undefined ? ov.classList.contains('hidden') : open;
  ov.classList.toggle('hidden', !willOpen);
  input.setMenuOpen(willOpen);
  if (willOpen) sfx.sfxUi();
}

function requestFullscreen() {
  try {
    if (document.fullscreenElement) return document.exitFullscreen();
    return document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => { /* masaüstünde desteklenmez */ });
      }
    });
  } catch { toast('Tam ekran bu tarayıcıda desteklenmiyor.'); return Promise.resolve(); }
}

function initSettings() {
  const soundOn = store('sa_sound') !== '0';
  const vol = Number(store('sa_volume') || 70);

  $('setSound').checked = soundOn;
  $('setVolume').value = vol;
  $('setVolumeVal').textContent = vol;
  sfx.setEnabled(soundOn);
  sfx.setVolume(vol / 100);

  $('btnSettings').onclick = () => toggleSettings(true);
  $('setResume').onclick = () => toggleSettings(false);
  $('settingsOverlay').onclick = (e) => { if (e.target.id === 'settingsOverlay') toggleSettings(false); };

  $('setSound').onchange = (e) => {
    const on = e.target.checked;
    sfx.setEnabled(on);
    store('sa_sound', on ? '1' : '0');
    if (on) sfx.sfxUi();
  };

  $('setVolume').oninput = (e) => {
    const v = Number(e.target.value);
    $('setVolumeVal').textContent = v;
    sfx.setVolume(v / 100);
    store('sa_volume', String(v));
  };

  $('setFullscreen').onclick = () => { requestFullscreen(); };

  $('setLeave').onclick = () => {
    toggleSettings(false);
    net.send(C.LOBBY_LEAVE, {});
    sfx.sfxUi();
  };
}

// ============================================================ PWA / kurulum
let deferredInstall = null;

// Tarayıcılar service worker'ı yalnızca güvenli kaynaklarda (https:// ya da
// localhost) çalıştırır. Ev ağındaki http://192.168.x.x adresinde çevrimdışı
// önbellek HİÇ kurulmaz; PC kapanınca sayfa ölü bir anlık görüntüye döner.
// Kullanıcı bunu bilmeden "çevrimdışı çalışmıyor" diye takılıyor — açıkça yaz.
function isSecureOrigin() {
  if (location.protocol === 'https:') return true;
  if (location.protocol === 'file:' || location.protocol === 'capacitor:') return true;
  return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
}

function showInsecureWarning() {
  const el = $('insecureWarn');
  if (!el) return;
  const servedOverHttp = location.protocol === 'http:';
  if (!servedOverHttp || isSecureOrigin()) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML = '<b>Bu sayfa <code>http://</code> ile açıldı.</b> Tarayıcılar güvensiz '
    + 'adreslerde çevrimdışı önbelleği kurmaz — yani bilgisayar kapanınca bu sayfa '
    + '<b>açılmaz</b> ("şu zamandan kalma veri" yazar). İnternetsiz oynamak için '
    + '<b>savas-arenasi.html</b> dosyasını telefona indirip onu aç: sunucu, internet '
    + 've kurulum gerekmez.';
}

// "Güncelle" düğmesi.
//
// Neden gerekli: oyun https üzerinden açıldığında kendini tarayıcıya
// kaydediyor (service worker) ki internetsiz de açılabilsin. Bu iyi bir şey
// ama sunucuya yeni sürüm yüklenince tarayıcı bir süre eski kopyayı
// göstermeye devam edebiliyor — "neden değişmedi?" sorusunun sebebi bu.
// Bu düğme kayıtlı kopyayı ve tüm önbellekleri silip sayfayı sıfırdan yükler.
// ============================================================ paket güncelleme
//
// Paketlenmiş sürüm (APK ya da tek dosya) oyunun tamamını içinde taşır; bu
// yüzden internetsiz çalışır ama kendiliğinden yenilenmez. Burada açılışta
// sunucudaki sürüm damgasına bakıp yeni sürüm çıkmışsa kullanıcıya haber
// veriyoruz. "GÜNCELLE" denince uygulama sunucudaki güncel sürüme geçiyor ve
// bu tercih hatırlanıyor — bir daha APK kurmak gerekmiyor.
//
// İnternet yoksa hiçbir şey olmaz: oyun içindeki kopyayla sessizce açılır.
const UPDATE_PREF_KEY = 'sa_online_surum';
const UPDATE_SKIP_KEY = 'sa_surum_atla';

function isPackaged() {
  return typeof window.__BUILD__ === 'string' && window.__BUILD__.length > 0;
}

function serverBase() {
  // Kullanıcı kendi sunucusunu yazdıysa ona bak, yoksa varsayılana.
  // Paketlenmiş sürümde uygulamanın KENDİ adresi (localhost) asla sunucu
  // olamaz; eski bir sürümden kalmış olsa bile yok sayıyoruz.
  const custom = store('sa_server');
  try {
    if (custom && !(isPackagedApp() && ownAddress(custom))) return normalizeHttp(custom);
  } catch { /* bozuk adres: varsayılana düş */ }
  return UPDATE_SERVER;
}

function showBuildInfo() {
  const el = $('buildInfo');
  if (!el) return;
  if (!isPackaged()) return;
  el.classList.remove('hidden');
  el.textContent = `sürüm ${window.__BUILD__}`;
}

async function checkForUpdate() {
  if (!isPackaged()) return;                 // sunucudan açıldıysa zaten günceldir
  if (navigator.onLine === false) return;    // internet yok, sessizce geç

  const base = serverBase();
  let uzak;
  try {
    const res = await fetch(`${base}/surum.json`, { cache: 'no-store' });
    if (!res.ok) return;
    uzak = await res.json();
  } catch { return; }                        // sunucuya ulaşılamadı: sorun değil

  if (!uzak || typeof uzak.surum !== 'string') return;
  if (uzak.surum === window.__BUILD__) return;              // zaten güncel
  if (store(UPDATE_SKIP_KEY) === uzak.surum) return;        // bu sürümü atladı

  markUpdateAvailable();
  const bar = $('updateOverlay');
  $('updateText').textContent =
    `Sunucuda yeni bir sürüm hazır (${uzak.surum.slice(0, 6)}). `
    + 'Güncelleyince oyunun en yeni hâline geçersin — yeniden kurmana gerek yok.';
  bar.classList.remove('hidden');
  $('btnGetUpdate').onclick = () => { guncellemeyiUygula(base, uzak.surum); };
  $('btnSkipUpdate').onclick = () => {
    store(UPDATE_SKIP_KEY, uzak.surum);
    bar.classList.add('hidden');
  };
}

// Uygulamanın KENDİNİ güncellemesi (APK'yı yeniden kurmadan).
//
// Oyunun tamamı web dosyalarından ibaret; APK bu dosyaları içinde taşıyor.
// Capgo eklentisi sunucudan yeni dosya paketini (paket.zip) indirip
// uygulamanın web katmanının yerine koyabiliyor. Yani GÜNCELLE deyince
// uygulama kendini yeniliyor, Android'in "yükle" ekranı çıkmıyor.
//
// Eklentiye JS tarafından import etmiyoruz: derleyici/paketleyici
// kullanmadığımız için native eklentiye köprü üzerinden erişiyoruz. Eklenti
// yoksa (tarayıcı, tek dosya sürümü, eski APK) eski davranışa düşüyoruz:
// sunucudaki web sürümüne git.
function selfUpdater() {
  try {
    const p = window.Capacitor && window.Capacitor.Plugins;
    return (p && p.CapacitorUpdater) || null;
  } catch { return null; }
}

async function guncellemeyiUygula(base, surum) {
  const btn = $('btnGetUpdate');
  const yaz = (t) => { if ($('updateText')) $('updateText').textContent = t; };
  const up = selfUpdater();

  if (!up) {
    // Eklenti yok: eski yol. Sunucudaki güncel sürüme geç ve bunu hatırla.
    store(UPDATE_PREF_KEY, '1');
    location.href = `${base}/`;
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ İNDİRİLİYOR…'; }
  yaz('Yeni sürüm indiriliyor. Bu bir kereliğine birkaç saniye sürer.');
  try {
    const paket = await up.download({ url: `${base}/paket.zip?s=${encodeURIComponent(surum)}`, version: surum });
    yaz('İndirildi, uygulama yenileniyor…');
    // set() uygulamayı yeni paketle yeniden başlatır. Yeni sürüm açılınca
    // notifyAppReady() çağrılmazsa eklenti eski sürüme geri döner — bu bizim
    // güvenlik ağımız (bkz. initSelfUpdate).
    await up.set(paket);
  } catch (e) {
    console.warn('[güncelleme] paket kurulamadı:', e);
    yaz('Güncelleme indirilemedi. İnternetini kontrol edip tekrar dene.');
    if (btn) { btn.disabled = false; btn.textContent = 'GÜNCELLE'; }
  }
}

// Yeni paket açıldıktan sonra "ben sağ salim açıldım" demek zorundayız;
// demezsek eklenti bunu bozuk sürüm sayıp eskiye döner. Bozuk bir paketin
// telefonu kilitlememesi için bu davranış bilerek açık bırakıldı.
function initSelfUpdate() {
  const up = selfUpdater();
  if (!up) return;
  try { up.notifyAppReady(); } catch { /* önemli değil */ }
}

// Daha önce "GÜNCELLE" dendiyse ve internet varsa, uygulama açılışta doğrudan
// sunucudaki güncel sürüme gider. İnternet yoksa içindeki kopyayla açılır.
// KRİTİK: burada uygulamanın kendi sayfasının ÜSTÜNE yazıyoruz. Gittiğimiz
// adres açılmazsa (sunucu uykuda, adres bozuk, mobil veri kapalı) kullanıcının
// elinde çalışan bir uygulama değil, tarayıcının hata sayfası kalır — ve geri
// dönüş yolu yoktur, çünkü kendi sayfamızı kapatmışızdır. Kullanıcıda tam da
// bu oldu: "localhost adresine ulaşılamıyor".
//
// O yüzden yönlendirmeden ÖNCE sunucunun gerçekten cevap verdiğini
// doğruluyoruz. Cevap yoksa hiçbir şey yapmıyoruz: uygulama kendi içindeki
// kopyayla normal şekilde açılır, oyun oynanır.
async function preferOnlineIfChosen() {
  if (!isPackaged()) return false;
  if (store(UPDATE_PREF_KEY) !== '1') return false;
  if (navigator.onLine === false) return false;

  const base = serverBase();
  if (!base || ownAddress(base)) { store(UPDATE_PREF_KEY, ''); return false; }

  try {
    const iptal = new AbortController();
    const zaman = setTimeout(() => iptal.abort(), 12000);
    const r = await fetch(`${base}/surum.json?t=${Date.now()}`, { cache: 'no-store', signal: iptal.signal });
    clearTimeout(zaman);
    if (!r.ok) return false;
    await r.json();                       // gerçekten bizim sunucumuz mu?
  } catch {
    return false;                         // ulaşılamadı: kendi kopyamızla aç
  }

  // Android'de bu satır iki farklı şey yapabilir ve farkı kod içinden
  // göremiyoruz:
  //
  //   • capacitor.config.json'da allowNavigation listesinde olan bir adres →
  //     uygulamanın KENDİ penceresinde açılır (istediğimiz bu).
  //   • listede olmayan bir adres → Android bunu "dışarı çıkmak" sayar ve
  //     CHROME'DA açar. Uygulama arkada kendi sayfasında kalır; kullanıcı da
  //     "APK'yı açınca beni Chrome'a atıyor" der. Kullanıcıda tam da bu oldu.
  //
  // Adresi listeye ekledik, ama eski kurulumlarda liste yok ve tercih
  // telefonda kayıtlı olduğu için her açılışta tekrarlanır. O yüzden bir
  // emniyet supabı koyuyoruz: yönlendirme gerçekten olduysa bu sayfa zaten
  // kapanır. Hâlâ buradaysak yönlendirme DIŞARI gitmiş demektir; tercihi
  // siliyoruz ki bir daha olmasın ve oyun kendi kopyasıyla açılsın.
  const oncekiUrl = location.href;
  location.replace(`${base}/`);
  setTimeout(() => {
    if (location.href !== oncekiUrl) return;        // sayfa değişti, sorun yok
    store(UPDATE_PREF_KEY, '');
    console.warn('[güncelleme] yönlendirme uygulama dışında açıldı; tercih temizlendi');
    toast('Güncel sürüm tarayıcıda açıldı. Uygulama kendi kopyasıyla devam ediyor.');
  }, 2500);
  return true;
}

// GÜNCELLE düğmesi artık HER ZAMAN durmuyor: sadece gerçekten güncelleme
// varken çıkıyor. Sürekli duran bir "güncelle" düğmesi hem menüyü kalabalık
// yapıyor hem de "acaba eski sürümde miyim?" diye tedirgin ediyordu.
//
// "Güncelleme var" iki yerden anlaşılıyor:
//   • paket sürümde  → sunucudaki damga bizimkinden farklı (checkForUpdate)
//   • tarayıcıda     → service worker yeni bir sürüm indirip beklemeye geçti
function showUpdateButton() {
  const btn = $('btnUpdate');
  const note = $('downloadNote');
  if (!btn) return;
  btn.classList.add('hidden');
  if (note) note.classList.add('hidden');
  btn.onclick = () => { forceUpdate(); };
}

// Güncelleme bulundu: düğmeyi göster.
function markUpdateAvailable() {
  const btn = $('btnUpdate');
  const note = $('downloadNote');
  if (!btn) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  btn.classList.remove('hidden');
  if (note) note.classList.remove('hidden');
}

async function forceUpdate() {
  const btn = $('btnUpdate');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Güncelleniyor…'; }
  setConnStatus('Kayıtlı kopya siliniyor, en yeni sürüm indiriliyor…');

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
    }
  } catch { /* devam */ }

  try {
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})));
    }
  } catch { /* devam */ }

  // Tarayıcının kendi önbelleğini de atlamak için adrese tek seferlik bir
  // damga ekliyoruz; sayfa açılınca damgayı adres çubuğundan temizliyoruz.
  const u = new URL(location.href);
  u.searchParams.set('g', Date.now().toString(36));
  location.replace(u.toString());
}

// Güncelleme damgasını adres çubuğunda bırakma (link paylaşılırsa kirletmesin).
function cleanUpdateStamp() {
  try {
    const u = new URL(location.href);
    if (!u.searchParams.has('g')) return;
    u.searchParams.delete('g');
    history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
  } catch { /* önemsiz */ }
}

// Paketlenmiş sürümde (APK / tek dosya) daha önce kurulmuş bir service
// worker varsa onu SÖK ve önbelleklerini sil.
//
// NEDEN: Capacitor uygulamanın dosyalarını `https://localhost` üzerinden
// veriyor. Burası "güvenli kaynak" sayıldığı için service worker kayıt
// oluyordu. Sonuç: kullanıcı yeni APK'yı kursa bile ilk açılışta ESKİ
// sürümün önbellekten gelen dosyaları çalışıyordu — yani düzelttiğimiz
// hatalar telefonda düzelmiş görünmüyordu.
//
// APK'nın service worker'a ihtiyacı da yok: bütün dosyalar zaten uygulamanın
// içinde, internetsiz açılması için ek bir önbellek katmanına gerek yok.
// Webview verisi APK güncellemesinde silinmediği için sökme işini burada,
// her açılışta yapıyoruz.
async function dropServiceWorker() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      if (regs.length) {
        await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
        console.info('[paket] eski service worker söküldü');
      }
    }
  } catch { /* önemli değil */ }
  try {
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})));
    }
  } catch { /* önemli değil */ }
}

function initPwa() {
  // Service worker: TARAYICIDAN açılan sürümün internetsiz çalışmasını sağlar.
  // Paketlenmiş sürümde (APK / tek dosya) kaydedilmez — yukarıdaki açıklamaya
  // bakın. Ayrıca file:// ve http://192.168… üzerinde kayıt zaten hata verir.
  if (isPackagedApp()) {
    dropServiceWorker();
  } else if ('serviceWorker' in navigator && isSecureOrigin() && location.protocol !== 'file:'
      && location.protocol !== 'capacitor:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        if (!reg) return;
        // Zaten beklemede bir sürüm varsa (önceki ziyaretten kalma)
        if (reg.waiting && navigator.serviceWorker.controller) markUpdateAvailable();
        reg.addEventListener('updatefound', () => {
          const yeni = reg.installing;
          if (!yeni) return;
          yeni.addEventListener('statechange', () => {
            // 'installed' + zaten bir kontrolcü varsa: bu bir GÜNCELLEME.
            // Kontrolcü yoksa ilk kurulumdur, güncelleme değil.
            if (yeni.state === 'installed' && navigator.serviceWorker.controller) {
              markUpdateAvailable();
            }
          });
        });
      }).catch((err) => {
        console.warn('Service worker kaydolmadı:', err);
      });
    });
  }
  initSelfUpdate();
  showInsecureWarning();
  showUpdateButton();
  showBuildInfo();
  cleanUpdateStamp();
  checkForUpdate();

  // "Ana ekrana ekle" istemi: tarayıcı izin verdiğinde butonu göster.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    $('btnInstall').classList.remove('hidden');
  });

  $('btnInstall').onclick = async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice;
    deferredInstall = null;
    $('btnInstall').classList.add('hidden');
    if (outcome === 'accepted') toast('Kuruldu — ana ekrandan açabilirsin.');
  };

  window.addEventListener('appinstalled', () => {
    $('btnInstall').classList.add('hidden');
    toast('Uygulama kuruldu.');
  });

  // Tam ekran (özellikle telefonda çok fark ediyor)
  $('btnFullscreen').onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => { /* masaüstünde desteklenmez */ });
      }
    } catch { toast('Tam ekran bu tarayıcıda desteklenmiyor.'); }
  };

  // Zaten kurulu olarak açıldıysa kurulum butonunu hiç gösterme
  if (window.matchMedia('(display-mode: fullscreen)').matches
    || window.matchMedia('(display-mode: standalone)').matches) {
    $('btnInstall').classList.add('hidden');
    $('btnFullscreen').classList.add('hidden');
  }
}

// Hata ayıklama kolaylığı: konsoldan durum incelenebilsin.
window.__game = game;
window.__sprites = spritesModule;
window.__render = renderModule;
window.__net = net;
window.__state = state;

// Daha önce "GÜNCELLE" denmişse ve internet varsa doğrudan güncel sürüme git.
// Bu, oyunun geri kalanını kurmadan önce olmalı — boşuna iş yapmayalım.
// Sunucuya erişilebildiği doğrulanana kadar uygulamayı normal şekilde
// açıyoruz. Doğrulama başarılı olursa zaten sayfa değişir; olmazsa oyuncu
// hiçbir şey kaybetmemiş olur.
initUi();
initSettings();
initPwa();
show('menu');
startup();
preferOnlineIfChosen();

// Açılış bekçisine "her şey yüklendi" işareti (bkz. index.html).
window.__bootOk = true;

function startup() {
  const params = new URLSearchParams(location.search);

  // Ana ekran kısayolu: ?mod=cevrimdisi doğrudan çevrimdışı açar
  if (params.get('mod') === 'cevrimdisi') { useLocal(); return; }

  // Davet linki: ?lobi=ABCDE → online moda geç ve o lobiye gir
  const invite = (params.get('lobi') || '').toUpperCase().trim();
  if (invite) {
    state.pendingJoinCode = invite;
    setConnStatus(`Lobiye bağlanılıyor: ${invite}…`);
    useOnline('', false);
    return;
  }

  // Kayıtlı adres eski bir sürümden kalma "localhost" olabilir; paketlenmiş
  // sürümde bu adres asla çalışmaz, o yüzden temizleyip kaydını da siliyoruz.
  const savedServer = store('sa_server');
  if (isPackagedApp() && savedServer && ownAddress(savedServer)) {
    store('sa_server', '');
    $('serverInput').value = '';
  } else {
    $('serverInput').value = savedServer;
  }

  const savedMode = store('sa_mode');

  // İnternet yoksa hiç bekleme, doğrudan çevrimdışı başla.
  if (navigator.onLine === false) {
    useLocal(false);
    setConnStatus('İnternet yok — çevrimdışı moddasın. Oyun bu cihazda çalışıyor.', 'ok');
    return;
  }

  // Uygulama olarak paketlendiğinde (Android/APK veya dosyadan açıldığında)
  // içinde sunucu yoktur; doğrudan çevrimdışı başla.
  const packaged = !!window.__BUNDLED__
    || !!window.Capacitor
    || location.protocol === 'file:'
    || location.protocol === 'capacitor:';
  const servedFromServer = location.protocol === 'http:' || location.protocol === 'https:';

  if (packaged || savedMode === 'local' || !servedFromServer) {
    useLocal(false);
    return;
  }

  // İlk açılışta ya da online seçiliyken sunucuyu dene; ulaşılamazsa
  // kullanıcıyı boşta bırakmayıp çevrimdışı moda geç.
  useOnline(savedServer, false);
  autoFallbackTimer = setTimeout(() => {
    autoFallbackTimer = null;
    if (net.connected) return;
    toast('Sunucuya ulaşılamadı — çevrimdışı moda geçildi.');
    useLocal(false);
  }, CONNECT_PATIENCE_MS);
}
