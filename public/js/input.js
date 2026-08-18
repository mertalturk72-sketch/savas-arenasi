// Klavye / fare / dokunmatik girdileri tek bir duruma indirger.

import { IN_UP, IN_DOWN, IN_LEFT, IN_RIGHT, IN_FIRE, IN_RELOAD } from '/shared/constants.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.mouseX = window.innerWidth / 2;
    this.mouseY = window.innerHeight / 2;
    this.firing = false;
    this.reloadPulse = 0;
    this.typing = false;
    this.enabled = false;
    this.aim = 0;

    // weaponAuto: otomatik silahlarda (tüfek, makineli) çubuk basılıyken ateş
    // edilir. Tek atışlılarda (keskin tüfek, pompalı) çubukla NİŞAN ALINIR,
    // parmağı kaldırınca ateş edilir — oyun kodu bunu her kareye günceller.
    this.weaponAuto = true;
    this.firePulse = 0;
    // Oyun içi ayarlar paneli açıkken girdiler oyuna gitmemeli.
    this.menuOpen = false;

    this.touch = {
      active: false,
      move: { id: null, dx: 0, dy: 0 },
      aim: { id: null, dx: 0, dy: 0, firing: false, aiming: false },
    };

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.bind();
  }

  bind() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => { this.down.clear(); this.firing = false; });

    this.canvas.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX; this.mouseY = e.clientY;
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.firing = true; e.preventDefault(); }
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.firing = false; });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.bindTouch();
  }

  bindTouch() {
    const stickMove = document.getElementById('stickMove');
    const stickAim = document.getElementById('stickAim');
    const btnReload = document.getElementById('btnTouchReload');
    const btnScore = document.getElementById('btnTouchScore');
    if (!stickMove || !stickAim) return;

    const setup = (el, slot, isAimStick) => {
      const knob = el.querySelector('.knob');
      const radius = 52;

      const update = (t, rect) => {
        let dx = t.clientX - (rect.left + rect.width / 2);
        let dy = t.clientY - (rect.top + rect.height / 2);
        const len = Math.hypot(dx, dy);
        const clamped = Math.min(len, radius);
        const nx = len ? (dx / len) : 0, ny = len ? (dy / len) : 0;
        knob.style.transform = `translate(${nx * clamped}px, ${ny * clamped}px)`;
        slot.dx = len > 12 ? nx : 0;
        slot.dy = len > 12 ? ny : 0;
        if (isAimStick) {
          slot.aiming = len > 20;
          // Otomatik silah: basılı tuttukça ateş. Tek atışlı: sadece nişan al.
          slot.firing = this.weaponAuto && len > 20;
          el.classList.toggle('aiming', slot.aiming && !this.weaponAuto);
        }
      };

      el.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.touch.active = true;
        const t = e.changedTouches[0];
        slot.id = t.identifier;
        update(t, el.getBoundingClientRect());
      }, { passive: false });

      el.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        for (const t of e.changedTouches) if (t.identifier === slot.id) update(t, rect);
      }, { passive: false });

      const end = (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier !== slot.id) continue;
          // Tek atışlı silahta parmağı kaldırmak = ateş etmek
          if (isAimStick && !this.weaponAuto && slot.aiming) this.firePulse = 3;
          slot.id = null; slot.dx = 0; slot.dy = 0;
          if (isAimStick) { slot.firing = false; slot.aiming = false; }
          el.classList.remove('aiming');
          knob.style.transform = '';
        }
      };
      el.addEventListener('touchend', end);
      el.addEventListener('touchcancel', end);
    };

    setup(stickMove, this.touch.move, false);
    setup(stickAim, this.touch.aim, true);

    if (btnReload) {
      btnReload.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.reloadPulse = 3;
      }, { passive: false });
    }

    // Skor tablosu: basılı tutunca açılır
    if (btnScore) {
      const show = (e) => { e.preventDefault(); this.onScoreboard?.(true); };
      const hide = (e) => { e.preventDefault(); this.onScoreboard?.(false); };
      btnScore.addEventListener('touchstart', show, { passive: false });
      btnScore.addEventListener('touchend', hide, { passive: false });
      btnScore.addEventListener('touchcancel', hide, { passive: false });
    }

    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      this.touch.active = true;
      document.body.classList.add('touch');
      document.getElementById('touchUI')?.classList.remove('hidden');
    }
  }

  onKeyDown(e) {
    if (this.typing) return;
    if (e.repeat) return;
    const k = e.code;
    this.down.add(k);
    if (k === 'KeyR') this.reloadPulse = 3;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(k)) {
      e.preventDefault();
    }
  }

  onKeyUp(e) { this.down.delete(e.code); }

  isDown(...codes) { return codes.some((c) => this.down.has(c)); }

  /**
   * Ayarlar paneli açılıp kapanınca çağrılır. Basılı kalan tuşları ve
   * dokunmatik çubukları sıfırlar; yoksa panel kapandığında karakter
   * kendiliğinden yürümeye devam ederdi.
   */
  setMenuOpen(on) {
    this.menuOpen = !!on;
    if (!on) return;
    this.down.clear();
    this.firing = false;
    this.firePulse = 0;
    this.reloadPulse = 0;
    for (const slot of [this.touch.move, this.touch.aim]) {
      slot.id = null; slot.dx = 0; slot.dy = 0;
      if ('firing' in slot) { slot.firing = false; slot.aiming = false; }
    }
    for (const id of ['stickMove', 'stickAim']) {
      const knob = document.getElementById(id)?.querySelector('.knob');
      if (knob) knob.style.transform = '';
    }
  }

  /**
   * @param {number} sx oyuncunun ekran üzerindeki x'i
   * @param {number} sy oyuncunun ekran üzerindeki y'si
   */
  sample(sx, sy) {
    // Panel açıkken hareket ve ateş yok; sadece son nişan açısı korunur.
    if (this.menuOpen) return { keys: 0, aim: Math.round(this.aim * 1000) / 1000 };

    let keys = 0;
    if (!this.typing) {
      if (this.isDown('KeyW', 'ArrowUp')) keys |= IN_UP;
      if (this.isDown('KeyS', 'ArrowDown')) keys |= IN_DOWN;
      if (this.isDown('KeyA', 'ArrowLeft')) keys |= IN_LEFT;
      if (this.isDown('KeyD', 'ArrowRight')) keys |= IN_RIGHT;
      if (this.firing || this.isDown('Space')) keys |= IN_FIRE;
    }

    // Dokunmatik
    const tm = this.touch.move, ta = this.touch.aim;
    if (tm.dx || tm.dy) {
      if (tm.dy < -0.38) keys |= IN_UP;
      if (tm.dy > 0.38) keys |= IN_DOWN;
      if (tm.dx < -0.38) keys |= IN_LEFT;
      if (tm.dx > 0.38) keys |= IN_RIGHT;
    }

    if (this.reloadPulse > 0) { keys |= IN_RELOAD; this.reloadPulse--; }
    // Nişan çubuğu bırakıldığında tetiklenen tek atış
    if (this.firePulse > 0) { keys |= IN_FIRE; this.firePulse--; }

    if (ta.dx || ta.dy) {
      this.aim = Math.atan2(ta.dy, ta.dx);
      if (ta.firing) keys |= IN_FIRE;
    } else if (!this.touch.active) {
      this.aim = Math.atan2(this.mouseY - sy, this.mouseX - sx);
    }
    // Dokunmatikte nişan çubuğu bırakılınca son bakılan yön korunur.

    return { keys, aim: Math.round(this.aim * 1000) / 1000 };
  }
}
