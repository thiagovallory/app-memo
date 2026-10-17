const SLIDE_MS = 5500;
const MAX_ZOOM = 6;

const ICON_PLAY = '<svg viewBox="0 0 24 24" class="ico fill"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" class="ico fill"><rect x="6.5" y="5" width="3.8" height="14" rx="1.2"/><rect x="13.7" y="5" width="3.8" height="14" rx="1.2"/></svg>';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Visualizador em tela cheia: swipe entre itens, zoom por pinça/duplo toque, apresentação automática. */
export class Viewer {
  constructor({ api, onClose, onToggleFullscreen }) {
    this.api = api;
    this.onClose = onClose;
    this.onToggleFullscreen = onToggleFullscreen;
    this.el = document.getElementById('viewer');
    this.stage = this.el.querySelector('.v-stage');
    this.backdrop = this.el.querySelector('.v-backdrop');
    this.titleEl = this.el.querySelector('.v-title b');
    this.subEl = this.el.querySelector('.v-title span');
    this.countEl = this.el.querySelector('.v-count');
    this.progress = this.el.querySelector('.v-progress i');
    this.playBtn = document.getElementById('v-play');

    this.list = [];
    this.i = 0;
    this.slide = null;
    this.zoom = { s: 1, x: 0, y: 0 };
    this.playing = false;
    this.pts = new Map();
    this.gesture = null;
    this.isOpen = false;

    this.playBtn.innerHTML = ICON_PLAY;
    document.getElementById('v-close').addEventListener('click', () => this.close());
    document.getElementById('v-fs').addEventListener('click', () => this.onToggleFullscreen?.());
    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.el.querySelector('.v-nav.prev').addEventListener('click', () => this.go(-1));
    this.el.querySelector('.v-nav.next').addEventListener('click', () => this.go(1));

    this.stage.addEventListener('pointerdown', (e) => this.down(e));
    this.stage.addEventListener('pointermove', (e) => this.move(e));
    this.stage.addEventListener('pointerup', (e) => this.up(e));
    this.stage.addEventListener('pointercancel', (e) => this.up(e));
    this.stage.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.stage.addEventListener('dblclick', (e) => this.dblclick(e));
    this.el.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') this.poke(); });
    document.addEventListener('keydown', (e) => this.key(e), true);
  }

  get item() { return this.list[this.i]; }

  open(list, index, rect) {
    this.list = list;
    this.i = index;
    this.isOpen = true;
    this.el.hidden = false;
    this.el.classList.remove('closing', 'idle');
    this.el.classList.toggle('single', list.length < 2);
    this.show(0, rect);
    this.poke();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.stopPlay();
    clearTimeout(this.idleTimer);
    const item = this.item;
    this.el.classList.add('closing');
    setTimeout(() => {
      this.el.hidden = true;
      this.stage.textContent = '';
      this.slide = null;
    }, 280);
    this.onClose?.(item);
  }

  // ---------- navegação ----------
  go(delta) {
    if (this.list.length < 2) return;
    this.i = (this.i + delta + this.list.length) % this.list.length;
    this.show(delta);
    if (this.playing) this.schedule();
    this.poke();
  }

  show(dir, rect) {
    const it = this.item;
    const slide = this.buildSlide(it);
    const old = this.slide;
    this.slide = slide;
    this.zoom = { s: 1, x: 0, y: 0 };
    this.stage.appendChild(slide);

    this.titleEl.textContent = it.name;
    this.subEl.textContent = (it.folder || 'Início') + ' · ' + it.ext.toUpperCase();
    this.countEl.textContent = `${this.i + 1} / ${this.list.length}`;
    this.backdrop.style.backgroundImage = it.type === 'image' ? `url("${this.api.thumbUrl(it.id)}")` : 'none';

    if (old) {
      old.classList.add('anim');
      old.style.transform = `translateX(${-dir * 90}px)`;
      old.style.opacity = '0';
      old.querySelector('video')?.pause();
      setTimeout(() => old.remove(), 460);
    }

    if (rect && !old) {
      const sx = Math.max(0.12, (rect.width / Math.min(innerWidth, innerHeight)) * 0.9);
      slide.style.transform = `translate(${rect.left + rect.width / 2 - innerWidth / 2}px, ${rect.top + rect.height / 2 - innerHeight / 2}px) scale(${sx})`;
    } else {
      slide.style.transform = `translateX(${dir * 90}px)`;
    }
    slide.style.opacity = '0';
    void slide.offsetWidth;
    slide.classList.add('anim');
    slide.style.transform = '';
    slide.style.opacity = '1';

    this.preloadNeighbours();
    if (this.playing) this.schedule();
  }

  buildSlide(it) {
    const slide = document.createElement('div');
    slide.className = 'slide';
    if (it.type === 'video') {
      const v = document.createElement('video');
      v.src = this.api.fileUrl(it.id);
      v.controls = true;
      v.autoplay = true;
      v.playsInline = true;
      v.addEventListener('ended', () => { if (this.playing && slide === this.slide) this.go(1); });
      slide.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.draggable = false;
      img.className = 'pending';
      img.src = this.api.thumbUrl(it.id);
      img.alt = it.name;
      slide.appendChild(img);
      const full = new Image();
      full.onload = () => {
        if (!slide.isConnected) return;
        img.src = full.src;
        img.classList.remove('pending');
      };
      full.onerror = () => img.classList.remove('pending');
      full.src = this.api.fileUrl(it.id);
    }
    return slide;
  }

  preloadNeighbours() {
    for (const d of [1, -1]) {
      const n = this.list[(this.i + d + this.list.length) % this.list.length];
      if (n && n.type === 'image') new Image().src = this.api.fileUrl(n.id);
    }
  }

  // ---------- apresentação ----------
  togglePlay() { this.playing ? this.stopPlay() : this.startPlay(); }

  startPlay() {
    this.playing = true;
    this.el.classList.add('playing');
    this.playBtn.innerHTML = ICON_PAUSE;
    this.schedule();
  }

  stopPlay() {
    this.playing = false;
    this.el.classList.remove('playing');
    this.playBtn.innerHTML = ICON_PLAY;
    clearTimeout(this.slideTimer);
    this.progressAnim?.cancel();
  }

  schedule() {
    clearTimeout(this.slideTimer);
    this.progressAnim?.cancel();
    if (this.item.type === 'video') return; // avança no evento "ended"
    this.progressAnim = this.progress.animate([{ width: '0%' }, { width: '100%' }], { duration: SLIDE_MS, easing: 'linear', fill: 'forwards' });
    this.slideTimer = setTimeout(() => this.go(1), SLIDE_MS);
  }

  // ---------- interface que some sozinha ----------
  poke() {
    this.el.classList.remove('idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.el.classList.add('idle'), 3500);
  }

  // ---------- gestos ----------
  imgEl() { return this.slide?.querySelector('img'); }

  applyZoom() {
    const img = this.imgEl();
    if (!img) return;
    const { s, x, y } = this.zoom;
    img.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  }

  clampPan() {
    const img = this.imgEl();
    if (!img) return;
    const { s } = this.zoom;
    const mx = Math.max(0, (img.clientWidth * s - innerWidth) / 2);
    const my = Math.max(0, (img.clientHeight * s - innerHeight) / 2);
    this.zoom.x = clamp(this.zoom.x, -mx, mx);
    this.zoom.y = clamp(this.zoom.y, -my, my);
  }

  zoomAt(factor, cx, cy) {
    const z = this.zoom;
    const s = clamp(z.s * factor, 1, MAX_ZOOM);
    const ratio = s / z.s;
    // mantém o ponto sob o dedo/cursor parado
    const px = cx - innerWidth / 2;
    const py = cy - innerHeight / 2;
    z.x = px - (px - z.x) * ratio;
    z.y = py - (py - z.y) * ratio;
    z.s = s;
    if (s <= 1.001) { z.s = 1; z.x = 0; z.y = 0; }
    this.clampPan();
    this.applyZoom();
  }

  down(e) {
    this.poke();
    const video = this.slide?.querySelector('video');
    if (video && e.target === video) {
      const r = video.getBoundingClientRect();
      if (e.clientY > r.bottom - 84) return; // barra de controles nativa
    }
    this.stage.setPointerCapture(e.pointerId);
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.slide?.classList.remove('anim');
    if (this.pts.size === 1) {
      this.gesture = { x0: e.clientX, y0: e.clientY, t0: performance.now(), axis: null, dx: 0, dy: 0, lastX: e.clientX, lastT: performance.now(), vx: 0, vy: 0, lastY: e.clientY, target: e.target };
    } else if (this.pts.size === 2 && this.imgEl()) {
      const [a, b] = [...this.pts.values()];
      this.gesture = { pinch: true, d0: Math.hypot(a.x - b.x, a.y - b.y), s0: this.zoom.s, last: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    }
  }

  move(e) {
    const p = this.pts.get(e.pointerId);
    if (!p || !this.gesture) return;
    const g = this.gesture;
    p.x = e.clientX; p.y = e.clientY;

    if (g.pinch) {
      if (this.pts.size < 2) return;
      const [a, b] = [...this.pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.zoom.x += c.x - g.last.x;
      this.zoom.y += c.y - g.last.y;
      g.last = c;
      this.zoomAt((g.s0 * d / g.d0) / this.zoom.s, c.x, c.y);
      return;
    }

    const now = performance.now();
    g.dx = e.clientX - g.x0;
    g.dy = e.clientY - g.y0;
    const dt = Math.max(1, now - g.lastT);
    g.vx = 0.7 * g.vx + 0.3 * ((e.clientX - g.lastX) / dt);
    g.vy = 0.7 * g.vy + 0.3 * ((e.clientY - g.lastY) / dt);
    g.lastX = e.clientX; g.lastY = e.clientY; g.lastT = now;

    if (this.zoom.s > 1.01) {
      this.zoom.x += e.movementX || 0;
      this.zoom.y += e.movementY || 0;
      this.clampPan();
      this.applyZoom();
      g.axis = 'pan';
      return;
    }
    if (!g.axis && Math.hypot(g.dx, g.dy) > 10) {
      g.axis = Math.abs(g.dx) > Math.abs(g.dy) ? 'x' : 'y';
    }
    if (g.axis === 'x') {
      this.slide.style.transform = `translateX(${g.dx}px)`;
      this.slide.style.opacity = String(1 - Math.min(0.6, Math.abs(g.dx) / innerWidth));
    } else if (g.axis === 'y') {
      const dy = Math.max(0, g.dy);
      const k = 1 - Math.min(0.25, dy / innerHeight);
      this.slide.style.transform = `translateY(${dy}px) scale(${k})`;
      this.slide.style.opacity = String(1 - Math.min(0.7, dy / (innerHeight * 0.6)));
    }
  }

  up(e) {
    if (!this.pts.has(e.pointerId)) return;
    this.pts.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;

    if (g.pinch) {
      if (this.pts.size < 2) {
        this.gesture = null;
        if (this.zoom.s < 1.05) { this.zoom = { s: 1, x: 0, y: 0 }; this.applyZoom(); }
      }
      return;
    }
    this.gesture = null;
    const slide = this.slide;
    const moved = Math.hypot(g.dx, g.dy);
    slide?.classList.add('anim');

    if (g.axis === 'x') {
      const fast = Math.abs(g.vx) > 0.5;
      if ((Math.abs(g.dx) > innerWidth * 0.18 || fast) && this.list.length > 1) {
        this.go(g.dx < 0 ? 1 : -1);
        return;
      }
    } else if (g.axis === 'y' && g.dy > 0) {
      if (g.dy > 130 || g.vy > 0.8) { this.close(); return; }
    } else if (!g.axis && moved < 10 && performance.now() - g.t0 < 350) {
      this.tap(g, e);
      return;
    }
    if (slide) { slide.style.transform = ''; slide.style.opacity = '1'; }
  }

  tap(g, e) {
    const video = this.slide?.querySelector('video');
    if (video && g.target === video) {
      video.paused ? video.play() : video.pause();
      this.poke();
      return;
    }
    // toque em área vazia ou na imagem alterna a interface
    if (this.el.classList.contains('idle')) this.poke();
    else { clearTimeout(this.idleTimer); this.el.classList.add('idle'); }
  }

  dblclick(e) {
    if (!this.imgEl()) return;
    if (this.zoom.s > 1.05) this.zoomAt(1 / this.zoom.s, e.clientX, e.clientY);
    else this.zoomAt(2.6, e.clientX, e.clientY);
  }

  wheel(e) {
    if (!this.imgEl()) return;
    e.preventDefault();
    this.poke();
    this.zoomAt(Math.exp(-e.deltaY * 0.0016 * (e.deltaMode ? 16 : 1)), e.clientX, e.clientY);
  }

  key(e) {
    if (!this.isOpen) return;
    const handled = { Escape: () => this.close(), ArrowRight: () => this.go(1), ArrowLeft: () => this.go(-1),
      ' ': () => this.togglePlay(), f: () => this.onToggleFullscreen?.(), F: () => this.onToggleFullscreen?.() }[e.key];
    if (!handled) return;
    e.preventDefault();
    e.stopPropagation();
    handled();
    this.poke();
  }
}
