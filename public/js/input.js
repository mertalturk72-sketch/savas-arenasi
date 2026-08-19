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
    // Atılabilir silah (bomba): nişan çubuğu basılı tutulurken menzil dolar,
    // BIRAKINCA atılır. Yani tutarken IN_FIRE gönderilir, bırakınca kesilir —
    // tek atışlılardaki "bırakınca tek darbe" davranışı burada YANLIŞ olur.
    this.weaponThrowable = false;
    this.firePulse = 0;
    // Oyun içi ayarlar paneli açıkken girdiler oyuna gitmemeli.
    this.menuOpen = false;

    this.touch = {
      active: false,
      move: { id: null, dx: 0, dy: 0, mag: 0 },
      aim: { id: null, dx: 0, dy: 0, mag: 0, firing: false, aiming: false },
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
        // dx/dy YÖN bilgisidir (birim uzunluk). Çubuğun ne kadar itildiğini
        // ayrıca saklıyoruz: bomba menzili buna bağlı. Yönü normalize edip
        // büyüklüğü atmak, "ne kadar ittiğim" bilgisini yok ediyordu.
        slot.mag = radius > 0 ? Math.min(1, clamped / radius) : 0;
        if (isAimStick) {
          slot.aiming = len > 20;
          // Otomatik silah: basılı tuttukça ateş. Tek atışlı: sadece nişan al.
          slot.firing = (this.weaponAuto || this.weaponThrowable) && len > 20;
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
          if (isAimStick && !this.weaponAuto && !this.weaponThrowable && slot.aiming) this.firePulse = 3;
          slot.id = null; slot.dx = 0; slot.dy = 0;
          // slot.mag BİLEREK sıfırlanmıyor: bomba tam da parmağı kaldırınca
          // atılır ve menzili "bırakma anındaki itilme miktarı" belirler.
          // Burada sıfırlarsak her bomba en yakına düşer.
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

    // --- Dokunmatik mi, fare/klavye mi? --------------------------------------
    //
    // Eski hâli "cihazda dokunmatik VAR mı" diye soruyordu. Dokunmatik ekranlı
    // Windows dizüstülerinde bu her zaman doğru çıkıyor ve masaüstünde oyun
    // telefon arayüzüne (sanal çubuklar) düşüyordu — babanın bilgisayarında
    // olan buydu.
    //
    // Doğru soru: "şu an hangi girdiyi KULLANIYOR?" Cihazda gerçek bir fare
    // varsa (pointer: fine) masaüstü arayüzüyle başlıyoruz; sonra kullanıcı
    // hangi girdiyi kullanırsa arayüz ona geçiyor.
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const hasMouse = !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches);
    this.setTouchMode(hasTouch && !hasMouse);

    // Dokunma olunca dokunmatik arayüze geç
    const toTouch = () => { this.lastTouchAt = performance.now(); this.setTouchMode(true); };
    window.addEventListener('touchstart', toTouch, { passive: true });
    window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') toTouch(); }, { passive: true });

    // Fare/klavye kullanılınca masaüstü arayüzüne dön.
    // Telefonlarda dokunma sonrası sahte fare olayları üretilir; dokunmadan
    // hemen sonra gelen fare olaylarını yok sayıyoruz.
    const toDesktop = () => {
      if (performance.now() - (this.lastTouchAt || 0) < 800) return;
      // Telefonlar dokunmadan sonra SAHTE fare olayları üretir. Cihazda
      // gerçekten ince bir işaretçi (fare/kalem) yoksa bu olaylara bakıp
      // masaüstü arayüzüne geçmek yanlış olur — telefonda kumanda kaybolurdu.
      const fine = !!(window.matchMedia && window.matchMedia('(any-pointer: fine)').matches);
      if (!fine) return;
      this.setTouchMode(false);
    };
    window.addEventListener('mousemove', (e) => { if (e.movementX || e.movementY) toDesktop(); }, { passive: true });
    window.addEventListener('mousedown', toDesktop, { passive: true });
    window.addEventListener('keydown', toDesktop, { passive: true });
  }

  /** Dokunmatik arayüzü açar/kapatır ve yarım kalmış girdileri temizler. */
  setTouchMode(on) {
    on = !!on;
    if (this.touch.active === on && this._touchModeSet) return;
    this._touchModeSet = true;
    this.touch.active = on;
    document.body.classList.toggle('touch', on);
    document.getElementById('touchUI')?.classList.toggle('hidden', !on);
    if (!on) {
      for (const slot of [this.touch.move, this.touch.aim]) {
        slot.id = null; slot.dx = 0; slot.dy = 0; slot.mag = 0;
        if ('firing' in slot) { slot.firing = false; slot.aiming = false; }
      }
      for (const id of ['stickMove', 'stickAim']) {
        const knob = document.getElementById(id)?.querySelector('.knob');
        if (knob) knob.style.transform = '';
      }
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

    // --- Bomba menzili -----------------------------------------------------
    // Bilgisayarda menzil TUTMA SÜRESİYLE dolar. Dokunmatikte bu çalışmıyordu:
    // nişan çubuğunu tutmak aynı zamanda ateş tuşunu basılı tutmak demek, yani
    // nişan alırken geçen süre menzili kendiliğinden dolduruyordu ve bomba hep
    // en uzağa gidiyordu — oyuncunun elinde hiçbir kontrol kalmıyordu.
    //
    // Çözüm: dokunmatikte menzili SÜRE değil, çubuğu ne kadar ittiğin belirler.
    // Az it → yakına, sonuna kadar it → en uzağa. Nişan alırken ne kadar
    // beklediğin hiç önemli değil ve hedef halkası parmağınla birlikte kayar.
    let guc;
    if (this.touch.active && this.weaponThrowable) {
      const uz = Math.max(0, Math.min(1, ta.mag || 0));
      // Çubuğun ilk %25'i "yön verme" bölgesi; menzil ondan sonra artmaya
      // başlar, yoksa hafifçe dokunmak bile bombayı fırlatırdı.
      guc = Math.max(0, Math.min(1, (uz - 0.25) / 0.7));
    }

    const out = { keys, aim: Math.round(this.aim * 1000) / 1000 };
    // p: 0..100 arası menzil doluluğu. Sadece dokunmatikte gönderiliyor;
    // yoksa sunucu eskisi gibi tutma süresine bakar.
    if (guc !== undefined) out.p = Math.round(guc * 100);
    return out;
  }
}
