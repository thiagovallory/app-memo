import { layouts, layoutById } from './layouts/index.js';
import { hashSeed, rng } from './layouts/pack.js';
import { Viewer } from './viewer.js';
import { Bubbles } from './bubbles.js';
import { Keyboard } from './keyboard.js';
import { dialog } from './dialog.js';
import { Manager } from './manage.js';

const api = window.memo;
const $ = (sel) => document.querySelector(sel);

const ROOT = '\u0000root'; // filtro "somente arquivos soltos na pasta raiz"
const MIN_K = 0.22;
const MAX_K = 2.4;

const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

const state = {
  items: [],
  root: '',
  hint: '',
  query: '',
  type: store.get('type', 'all'),
  folder: null,
  layout: 'bubbles', // sempre abre em bolhas
  sort: store.get('sort', 'shuffle'),
  expo: store.get('expo', '') === '1', // modo exposição: sem o menu ⋯
  seed: (Math.random() * 1e9) | 0,
};

const els = {
  stage: $('#stage'), world: $('#world'), bar: $('#bar'), q: $('#q'), clearq: $('#clearq'),
  chips: $('#chips'), subchips: $('#subchips'), status: $('#status'), popover: $('#popover'),
  empty: $('#empty'), reset: $('#reset'), welcome: $('#welcome'), loading: $('#loading'),
};

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const baseName = (p) => p.split('/').pop();

// ---------------------------------------------------------------- dados / filtros

function prepare(items) {
  for (const it of items) it._hay = norm(it.rel);
  return items;
}

function inFolder(it) {
  const f = state.folder;
  if (f == null) return true;
  if (f === ROOT) return it.folder === '';
  return it.folder === f || it.folder.startsWith(f + '/');
}

function filtered() {
  const words = norm(state.query).split(/\s+/).filter(Boolean);
  const list = state.items.filter((it) =>
    (state.type === 'all' || it.type === state.type) && inFolder(it) && words.every((w) => it._hay.includes(w)));
  if (state.sort === 'recent') list.sort((a, b) => b.mtime - a.mtime);
  else if (state.sort === 'name') list.sort((a, b) => a.rel.localeCompare(b.rel, 'pt-BR', { numeric: true }));
  else list.sort((a, b) => (hashSeed(a.id) ^ state.seed) - (hashSeed(b.id) ^ state.seed));
  return list;
}

function childrenOf(path) {
  const counts = new Map();
  const prefix = path ? path + '/' : '';
  for (const it of state.items) {
    if (!it.folder || !it.folder.startsWith(prefix)) continue;
    const next = prefix + it.folder.slice(prefix.length).split('/')[0];
    counts.set(next, (counts.get(next) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// ---------------------------------------------------------------- chips de pastas

function chip(label, count, on, onClick, weight = 0) {
  const b = document.createElement('button');
  b.className = 'chip' + (on ? ' on' : '');
  b.style.setProperty('--w', weight.toFixed(2));
  b.append(label);
  if (count != null) {
    const s = document.createElement('small');
    s.textContent = count;
    b.append(s);
  }
  b.addEventListener('click', onClick);
  return b;
}

function renderChips() {
  const top = childrenOf('');
  const rootCount = state.items.filter((it) => it.folder === '').length;
  const max = Math.max(1, ...top.map(([, n]) => n));
  const f = state.folder;
  const selTop = f && f !== ROOT ? f.split('/')[0] : null;

  els.chips.replaceChildren(
    chip('Todas', state.items.length, f == null, () => setFolder(null)),
    ...(rootCount && top.length ? [chip('Soltas', rootCount, f === ROOT, () => setFolder(ROOT))] : []),
    ...top.map(([path, n]) => chip(baseName(path), n, selTop === path, () => setFolder(path), n / max)),
  );

  // segunda linha: subpastas do que está selecionado
  let base = null;
  if (f && f !== ROOT) base = childrenOf(f).length ? f : f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : null;
  const subs = base ? childrenOf(base) : [];
  els.subchips.hidden = !subs.length;
  if (subs.length) {
    const total = state.items.filter((it) => it.folder === base || it.folder.startsWith(base + '/')).length;
    els.subchips.replaceChildren(
      chip(`Tudo em ${baseName(base)}`, total, f === base, () => setFolder(base)),
      ...subs.map(([path, n]) => chip(baseName(path), n, f === path || (f && f.startsWith(path + '/')), () => setFolder(path))),
    );
  }
  document.documentElement.style.setProperty('--bar-h', els.bar.offsetHeight + 'px');
}

// ---------------------------------------------------------------- câmera (pan / zoom)

const view = { x: 0, y: 0, k: 1 };
let current = { list: [], all: [], pos: new Map(), labels: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
let syncQueued = false;
let tween = null;
let inertia = null;

const insetTop = () => els.bar.offsetHeight;

function clampView() {
  const b = current.bounds;
  const pad = 260;
  const cx = (innerWidth / 2 - view.x) / view.k;
  const cy = (insetTop() + (innerHeight - insetTop()) / 2 - view.y) / view.k;
  const nx = Math.min(b.maxX + pad, Math.max(b.minX - pad, cx));
  const ny = Math.min(b.maxY + pad, Math.max(b.minY - pad, cy));
  view.x += (cx - nx) * view.k;
  view.y += (cy - ny) * view.k;
}

function applyView() {
  clampView();
  els.world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
  if (!syncQueued) {
    syncQueued = true;
    requestAnimationFrame(() => { syncQueued = false; sync(); });
  }
}

function centerOn(wx, wy, k = view.k) {
  return { k, x: innerWidth / 2 - wx * k, y: insetTop() + (innerHeight - insetTop()) / 2 - wy * k };
}

function fitTarget() {
  const b = current.bounds;
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const availH = innerHeight - insetTop();
  const byWidth = innerWidth / w;
  const both = Math.min(byWidth, availH / h);
  const cx = (b.minX + b.maxX) / 2;

  // layouts longos (mosaico) ajustam só pela largura e começam pelo topo
  if (layoutById(state.layout).fit === 'width') {
    const k = Math.min(1, Math.max(MIN_K, byWidth * 0.96));
    return centerOn(cx, b.minY + availH / 2 / k - 20 / k, k);
  }
  if (state.layout === 'cloud') return centerOn(cx, (b.minY + b.maxY) / 2, Math.min(1.6, Math.max(0.3, both * 0.97)));
  return centerOn(cx, (b.minY + b.maxY) / 2, Math.min(1, Math.max(MIN_K, both * 0.94)));
}

function animateTo(t, ms = 900) {
  cancelMotion();
  const from = { ...view };
  const t0 = performance.now();
  const ease = (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    const e = ease(p);
    view.x = from.x + (t.x - from.x) * e;
    view.y = from.y + (t.y - from.y) * e;
    view.k = from.k + (t.k - from.k) * e;
    applyView();
    tween = p < 1 ? requestAnimationFrame(step) : null;
  };
  tween = requestAnimationFrame(step);
}

function cancelMotion() {
  if (tween) cancelAnimationFrame(tween);
  if (inertia) cancelAnimationFrame(inertia);
  tween = inertia = null;
}

function zoomAround(factor, cx, cy) {
  const k = Math.min(MAX_K, Math.max(MIN_K, view.k * factor));
  const r = k / view.k;
  view.x = cx - (cx - view.x) * r;
  view.y = cy - (cy - view.y) * r;
  view.k = k;
  applyView();
}

// Gestos no palco: arrastar (com inércia), pinça e roda do mouse. Toque curto abre o item.
const pts = new Map();
let drag = null;

els.stage.addEventListener('pointerdown', (e) => {
  cancelMotion();
  els.popover.hidden = true;
  els.q.blur();
  keyboard.hide();
  noteActivity();
  els.stage.setPointerCapture(e.pointerId);
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 1) {
    drag = { moved: 0, target: e.target, t: performance.now(), vx: 0, vy: 0, lt: performance.now() };
  } else if (pts.size === 2) {
    const [a, b] = [...pts.values()];
    if (bubbles.active) { drag.moved = 99; return; } // bolhas ocupam a tela toda: sem zoom
    drag.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k, c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    drag.moved = 99;
  }
  els.stage.classList.add('dragging');
});

els.stage.addEventListener('pointermove', (e) => {
  const p = pts.get(e.pointerId);
  if (!p || !drag) return;
  const dx = e.clientX - p.x;
  const dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;

  if (pts.size >= 2 && drag.pinch) {
    const [a, b] = [...pts.values()];
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    view.x += c.x - drag.pinch.c.x;
    view.y += c.y - drag.pinch.c.y;
    drag.pinch.c = c;
    zoomAround((drag.pinch.k * d / drag.pinch.d) / view.k, c.x, c.y);
    return;
  }

  drag.moved += Math.abs(dx) + Math.abs(dy);
  if (bubbles.active) { bubbles.nudge(e.clientX, e.clientY, dx, dy); return; }
  const now = performance.now();
  const dt = Math.max(1, now - drag.lt);
  drag.vx = 0.75 * drag.vx + 0.25 * (dx / dt);
  drag.vy = 0.75 * drag.vy + 0.25 * (dy / dt);
  drag.lt = now;
  if (drag.moved > 6) { view.x += dx; view.y += dy; applyView(); }
});

function endPointer(e) {
  if (!pts.delete(e.pointerId)) return;
  if (pts.size) return;
  els.stage.classList.remove('dragging');
  const d = drag;
  drag = null;
  if (!d) return;
  if (d.moved <= 8 && performance.now() - d.t < 450) { handleTap(d.target); return; }
  if (performance.now() - d.lt > 80) return;
  let { vx, vy } = d;
  let last = performance.now();
  const glide = (now) => {
    const dt = now - last;
    last = now;
    const f = Math.exp(-dt / 320);
    vx *= f; vy *= f;
    view.x += vx * dt;
    view.y += vy * dt;
    applyView();
    inertia = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(glide) : null;
  };
  inertia = requestAnimationFrame(glide);
}
els.stage.addEventListener('pointerup', endPointer);
els.stage.addEventListener('pointercancel', endPointer);

els.stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  noteActivity();
  if (bubbles.active) return;
  cancelMotion();
  const trackpadPan = !e.ctrlKey && (e.deltaX !== 0 || !Number.isInteger(e.deltaY));
  if (trackpadPan) { view.x -= e.deltaX; view.y -= e.deltaY; applyView(); return; }
  zoomAround(Math.exp(-e.deltaY * 0.0013 * (e.deltaMode ? 16 : 1)), e.clientX, e.clientY);
}, { passive: false });

function handleTap(target) {
  const label = target.closest?.('.label');
  if (label) { setFolder(label.dataset.folder === '' ? ROOT : label.dataset.folder); return; }
  const tile = target.closest?.('.tile');
  if (!tile) return;
  const index = current.all.findIndex((it) => it.id === tile.dataset.id);
  if (index >= 0) viewer.open(current.all, index, tile.getBoundingClientRect());
}

// ---------------------------------------------------------------- tiles (somente o que está na tela)

const mounted = new Map(); // id -> element
let labelEls = [];

function makeTile(it, p) {
  // (também usada pelas bolhas)
  const rand = rng(hashSeed(it.id));
  const el = document.createElement('div');
  el.className = 'tile enter';
  el.dataset.id = it.id;
  el.style.setProperty('--h', hashSeed(it.rel) % 360);
  el.style.setProperty('--bob', (7 + rand() * 7).toFixed(1) + 's');
  el.style.setProperty('--delay', (-rand() * 12).toFixed(1) + 's');
  setPos(el, p);

  const float = document.createElement('div');
  float.className = 'float';
  const face = document.createElement('div');
  face.className = 'face';
  float.append(face);
  el.append(float);

  if (it.type === 'video') {
    const v = document.createElement('video');
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'metadata';
    v.src = api.fileUrl(it.id) + '#t=0.1';
    v.addEventListener('loadeddata', () => v.classList.add('loaded'));
    face.append(v);
    const play = document.createElement('div');
    play.className = 'play';
    play.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>';
    face.append(play);
  } else {
    const img = document.createElement('img');
    img.decoding = 'async';
    img.draggable = false;
    img.alt = '';
    img.crossOrigin = 'anonymous'; // permite ler os pixels para gerar a miniatura
    img.addEventListener('load', () => { img.classList.add('loaded'); ensureThumb(img, it); });
    img.addEventListener('error', () => img.classList.add('loaded'));
    img.src = api.thumbUrl(it.id);
    face.append(img);
  }
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('enter')));
  return el;
}

// Formatos que o processo principal não consegue reduzir (webp, avif, gif, JPEG girado por EXIF) chegam
// aqui em tamanho original: o Chromium reduz, e a miniatura vai para o cache em disco.
const THUMB_PX = 640;
const thumbSent = new Set();
const thumbQueue = [];
let thumbBusy = 0;

function ensureThumb(img, it) {
  const { naturalWidth: w, naturalHeight: h } = img;
  if (!api.saveThumb || thumbSent.has(it.id) || Math.min(w, h) <= THUMB_PX * 1.2) return;
  thumbSent.add(it.id);
  thumbQueue.push({ img, it });
  pumpThumbs();
}

function pumpThumbs() {
  while (thumbBusy < 2 && thumbQueue.length) {
    const { img, it } = thumbQueue.shift();
    thumbBusy++;
    makeThumb(img, it).catch(() => {}).finally(() => { thumbBusy--; pumpThumbs(); });
  }
}

async function makeThumb(img, it) {
  if (!img.isConnected) { thumbSent.delete(it.id); return; } // a bolha já saiu: tenta de novo quando voltar
  const scale = THUMB_PX / Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
  if (blob) await api.saveThumb(it.id, new Uint8Array(await blob.arrayBuffer()));
}

function setPos(el, p) {
  el.style.width = p.w + 'px';
  el.style.height = p.h + 'px';
  el.style.borderRadius = p.radius;
  el.style.transform = `translate(${p.x - p.w / 2}px, ${p.y - p.h / 2}px)`;
  el._p = p;
}

function retire(id) {
  const el = mounted.get(id);
  if (!el) return;
  mounted.delete(id);
  el.classList.add('leave');
  setTimeout(() => el.remove(), 450);
}

function sync() {
  const x0 = -view.x / view.k, y0 = -view.y / view.k;
  const x1 = x0 + innerWidth / view.k, y1 = y0 + innerHeight / view.k;
  const near = 240 / view.k, far = 900 / view.k;
  const byId = new Map(current.list.map((it) => [it.id, it]));

  for (const [id, p] of current.pos) {
    const hw = p.w / 2, hh = p.h / 2;
    const dx = Math.max(x0 - (p.x + hw), p.x - hw - x1, 0);
    const dy = Math.max(y0 - (p.y + hh), p.y - hh - y1, 0);
    const dist = Math.max(dx, dy);
    const el = mounted.get(id);
    if (el) {
      if (dist > far) { el.remove(); mounted.delete(id); }
      else if (el._p !== p) setPos(el, p);
    } else if (dist <= near) {
      const t = makeTile(byId.get(id), p);
      mounted.set(id, t);
      els.world.append(t);
    }
  }
  for (const id of [...mounted.keys()]) if (!current.pos.has(id)) retire(id);
}

function renderLabels() {
  for (const l of labelEls) { l.classList.add('enter'); setTimeout(() => l.remove(), 400); }
  labelEls = current.labels.map((l) => {
    const el = document.createElement('div');
    el.className = 'label enter';
    el.dataset.folder = l.folder ?? '';
    el.style.transform = `translate(${l.x}px, ${l.y}px)`;
    el.innerHTML = '<div class="in"><b></b><span></span></div>';
    el.querySelector('b').textContent = l.text;
    el.querySelector('b').style.fontSize = l.size + 'px';
    el.querySelector('span').style.fontSize = Math.max(14, l.size * 0.32) + 'px';
    el.querySelector('span').textContent = l.count === 1 ? '1 memória' : `${l.count} memórias`;
    els.world.append(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('enter')));
    return el;
  });
}

// ---------------------------------------------------------------- atualização geral

function relayout({ fit = true } = {}) {
  const all = filtered();
  const layout = layoutById(state.layout);
  const total = state.items.length;
  if (all.length === 0 && total > 0) showEmpty('Nada encontrado', 'Tente outra palavra ou limpe os filtros.', 'Limpar filtros', resetFilters);
  else if (total === 0 && state.root) {
    const text = state.hint || 'Não encontrei imagens (jpg, png, webp…) nem vídeos (mp4, webm, mov…) nesta pasta.';
    if (api.chooseFolder) showEmpty('Pasta sem fotos ou vídeos', text, 'Trocar pasta', chooseFolder);
    else if (api.importFiles) showEmpty('Nenhuma foto ainda', text, 'Importar fotos e vídeos', () => runImport({ directory: false }));
    else showEmpty('Nenhuma foto ainda', text, 'Recarregar', load);
  }
  else els.empty.hidden = true;

  if (layout.live) { startBubbles(all, total); return; }
  stopBubbles();

  const res = layout.compute(all, {
    width: innerWidth, height: innerHeight, insetTop: insetTop(), seed: state.seed,
  });
  const list = res.shown || all;
  current = { list, all, ...res };
  state.sampled = list.length < all.length;

  els.status.textContent = statusText(all.length, total, state.sampled ? list.length : 0);
  renderLabels();
  sync();
  if (fit) animateTo(fitTarget(), mounted.size ? 1000 : 1);
  else applyView();
}

let emptyAction = null;
function showEmpty(title, text, button, action) {
  els.empty.querySelector('h2').textContent = title;
  els.empty.querySelector('p').textContent = text;
  els.reset.textContent = button;
  emptyAction = action;
  els.empty.hidden = false;
}

function statusText(count, total, shown) {
  let t = count === total ? `${total} memórias` : `${count} de ${total} memórias`;
  if (shown) t += ` · mostrando ${shown} (toque em embaralhar para ver outras)`;
  return t;
}

// ---------------------------------------------------------------- bolhas de sabão

const bubbles = new Bubbles({
  host: els.world,
  create: (it, d) => makeTile(it, { x: 0, y: 0, w: d, h: d, radius: '50%' }),
});

function startBubbles(all, total) {
  const dims = { width: innerWidth, height: innerHeight };
  const bounds = { minX: 0, minY: 0, maxX: innerWidth, maxY: innerHeight };
  els.status.textContent = statusText(all.length, total, 0);

  if (bubbles.active) {
    current = { ...current, all };
    bubbles.update(all, dims);
    return;
  }

  // vindo de outro layout: os tiles que estão na tela viram bolhas onde estão
  cancelMotion();
  const byId = new Map(all.map((it) => [it.id, it]));
  const seeds = [];
  for (const [id, el] of [...mounted]) {
    const r = el.getBoundingClientRect();
    const visible = r.width > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
    if (visible && byId.has(id)) { seeds.push({ el, item: byId.get(id), x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }); mounted.delete(id); }
    else retire(id);
  }
  current = { list: [], all, pos: new Map(), labels: [], bounds };
  renderLabels();
  view.x = 0; view.y = 0; view.k = 1;
  els.world.style.transform = 'translate(0px, 0px) scale(1)';
  bubbles.start(all, dims, seeds);
}

// saindo de Bolhas: cada bolha vira um tile no lugar onde está e desliza para o novo layout
function stopBubbles() {
  if (!bubbles.active) return;
  for (const b of bubbles.release()) {
    const el = b.el;
    el.classList.remove('bubble', 'enter', 'leave');
    el.style.transitionDelay = '';
    setPos(el, { x: b.x, y: b.y, w: b.w, h: b.w, radius: '50%' });
    mounted.set(b.item.id, el);
  }
}

// Nuvem com acervo grande: troca as fotos exibidas de tempos em tempos, se ninguém está mexendo.
let lastActivity = Date.now();
function noteActivity() { lastActivity = Date.now(); }
setInterval(() => {
  if (state.layout !== 'cloud' || !state.sampled || viewer.isOpen || document.hidden) return;
  if (Date.now() - lastActivity < 25000) return;
  state.seed = (Math.random() * 1e9) | 0;
  relayout();
}, 30000);

function setFolder(path) {
  state.folder = path;
  renderChips();
  relayout();
}

function setLayout(id) {
  state.layout = id;
  document.querySelectorAll('#layouts button').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
  relayout();
}

function setSort(sort) {
  state.sort = sort;
  store.set('sort', sort);
  popoverState();
  relayout();
}

function popoverState() {
  els.popover.querySelectorAll('[data-sort]').forEach((b) => b.classList.toggle('on', b.dataset.sort === state.sort));
}

function setExpo(on) {
  state.expo = on;
  store.set('expo', on ? '1' : '');
  document.body.classList.toggle('expo', on);
  els.popover.hidden = true;
}

// segurar o logo por 2 s sai do modo exposição
let expoTimer;
const brand = $('.brand');
brand.addEventListener('pointerdown', () => {
  clearTimeout(expoTimer);
  if (state.expo) expoTimer = setTimeout(() => setExpo(false), 2000);
});
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) brand.addEventListener(ev, () => clearTimeout(expoTimer));
brand.addEventListener('contextmenu', (e) => e.preventDefault());

function resetFilters() {
  state.query = '';
  els.q.value = '';
  els.clearq.hidden = true;
  state.type = 'all';
  state.folder = null;
  syncTypeButtons();
  renderChips();
  relayout();
}

function syncTypeButtons() {
  document.querySelectorAll('#types button').forEach((b) => b.classList.toggle('on', b.dataset.type === state.type));
}

// ---------------------------------------------------------------- tela cheia / janela

async function toggleFullscreen() {
  if (api.toggleFullscreen) return api.toggleFullscreen();
  if (document.fullscreenElement) return document.exitFullscreen();
  return document.documentElement.requestFullscreen();
}

let manager = null; // tela "Organizar" (só quando a plataforma deixa organizar)

const viewer = new Viewer({
  api,
  onOpen: () => { bubbles.pause(true); keyboard.hide(); },
  onToggleFullscreen: toggleFullscreen,
  onClose(item) {
    bubbles.pause(false);
    noteActivity();
    const p = item && current.pos.get(item.id);
    if (!p) return;
    const sx = p.x * view.k + view.x, sy = p.y * view.k + view.y;
    const visible = sx > 0 && sx < innerWidth && sy > insetTop() && sy < innerHeight;
    if (!visible) animateTo(centerOn(p.x, p.y), 700);
  },
});

// ---------------------------------------------------------------- eventos da interface

let searchTimer;
els.q.addEventListener('input', () => {
  els.clearq.hidden = !els.q.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.query = els.q.value; relayout(); }, 140);
});
const keyboard = new Keyboard(els.q);
const kbdBtn = $('#kbd');
const syncKbdBtn = () => kbdBtn.classList.toggle('on', keyboard.visible);
// toque (ou caneta) no campo abre o teclado na tela; com mouse/teclado físico ele continua opcional
els.q.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { keyboard.show(); syncKbdBtn(); } });
kbdBtn.addEventListener('pointerdown', (e) => e.preventDefault());
kbdBtn.addEventListener('click', () => { keyboard.toggle(); syncKbdBtn(); });
new MutationObserver(syncKbdBtn).observe(keyboard.el, { attributes: true, attributeFilter: ['hidden', 'class'] });
els.q.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { els.q.blur(); keyboard.hide(); } });
els.clearq.addEventListener('click', () => { els.q.value = ''; els.q.dispatchEvent(new Event('input')); els.q.focus(); });

$('#types').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.type = b.dataset.type;
  store.set('type', state.type);
  syncTypeButtons();
  relayout();
});

const layoutBox = $('#layouts');
for (const l of layouts) {
  const b = document.createElement('button');
  b.dataset.id = l.id;
  b.title = l.name;
  b.setAttribute('aria-label', l.name);
  b.innerHTML = `<svg viewBox="0 0 24 24" class="ico">${l.icon}</svg>`;
  layoutBox.append(b);
}
layoutBox.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setLayout(b.dataset.id);
});

$('#shuffle').addEventListener('click', () => {
  state.seed = (Math.random() * 1e9) | 0;
  if (state.sort !== 'shuffle') setSort('shuffle'); else relayout();
});
$('#fit').addEventListener('click', () => animateTo(fitTarget(), 800));
$('#fs').addEventListener('click', toggleFullscreen);
els.reset.addEventListener('click', () => emptyAction?.());
$('#choose').addEventListener('click', chooseFolder);

$('#menu').addEventListener('click', (e) => {
  e.stopPropagation();
  els.popover.hidden = !els.popover.hidden;
});
document.addEventListener('pointerdown', (e) => {
  if (!els.popover.hidden && !e.target.closest('#popover, #menu')) els.popover.hidden = true;
});
els.popover.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.sort) { setSort(b.dataset.sort); return; }
  els.popover.hidden = true;
  const act = b.dataset.act;
  if (act === 'import') await runImport({ directory: false }); // o seletor de arquivos precisa abrir dentro do toque
  else if (act === 'importdir') await runImport({ directory: true });
  else if (act === 'clear') await clearAll();
  else if (act === 'folder') await chooseFolder();
  else if (act === 'reload') await load();
  else if (act === 'fullscreen') toggleFullscreen();
  else if (act === 'expo') {
    const ok = await dialog({
      title: 'Ativar o modo exposição?',
      text: 'O menu ⋯ some (sem importar, organizar, apagar ou trocar pasta).\n\nPara voltar, segure o logo "memo" por 2 segundos.',
      ok: 'Ativar',
    });
    if (ok) setExpo(true);
  }
  else if (act === 'manage') manager?.open('folders');
  else if (act === 'quit') api.quit?.();
});

// rolagem vertical do mouse nas linhas de chips vira rolagem horizontal
for (const row of [els.chips, els.subchips]) {
  row.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { row.scrollLeft += e.deltaY; e.preventDefault(); }
  }, { passive: false });
}

document.addEventListener('keydown', (e) => {
  noteActivity();
  if (viewer.isOpen || manager?.isOpen) return;
  const typing = document.activeElement === els.q;
  if (e.key === 'Escape') { els.popover.hidden = true; els.q.blur(); keyboard.hide(); }
  else if (!typing && (e.key === 'F11' || e.key === 'f')) { e.preventDefault(); toggleFullscreen(); }
  else if (!typing && e.key === 'F5') { e.preventDefault(); load(); }
  else if (!typing && (e.key === '/' || (e.key === 'k' && (e.ctrlKey || e.metaKey)))) { e.preventDefault(); els.q.focus(); }
});

let resizeTimer;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { renderChips(); relayout({ fit: false }); }, 220);
});

// ---------------------------------------------------------------- carregar biblioteca

function showLibrary(lib) {
  els.loading.hidden = true;
  state.root = lib.folder || '';
  state.hint = lib.hint || '';
  state.items = prepare(lib.items || []);
  state.folder = null;
  els.welcome.hidden = !!lib.folder;
  els.bar.style.visibility = lib.folder ? '' : 'hidden';
  els.status.hidden = !lib.folder;
  renderChips();
  mounted.forEach((el) => el.remove());
  mounted.clear();
  relayout();
}

async function load() {
  els.loading.hidden = false;
  try {
    showLibrary(await api.loadLibrary());
  } catch (err) {
    els.loading.hidden = true;
    showEmpty('Não consegui ler a pasta', String(err?.message || err), 'Tentar de novo', load);
  }
}

// versão web: o seletor de arquivos tem que ser chamado direto do toque, sem nenhum await antes
async function runImport({ directory = false, entries = null } = {}) {
  const res = await api.importFiles({
    directory,
    entries,
    // o seletor do iPad não informa a pasta de origem: pergunta em qual categoria colocar
    askFolder: (n) => dialog({
      title: `Importar ${n} ${n === 1 ? 'arquivo' : 'arquivos'}`,
      text: 'Em qual pasta (categoria) colocar? Deixe vazio para "Soltas".',
      input: { value: '', placeholder: 'Soltas' },
      suggestions: [...new Set(state.items.map((it) => it.folder).filter(Boolean))].sort().slice(0, 12),
      ok: 'Importar',
    }),
    onProgress: ({ done, total }) => { els.status.hidden = false; els.status.textContent = `Importando ${done} de ${total}…`; },
  });
  if (!res) return;
  await load();
  manager?.isOpen && manager.render();
  const note = [
    res.added && `${plural(res.added, 'nova', 'novas')}`,
    res.duplicates && `${plural(res.duplicates, 'já estava no app', 'já estavam no app')}`,
    res.skipped && `${res.skipped} ignorados (formato não suportado)`,
    res.failed.length && `${res.failed.length} falharam: ${res.failed[0].error}`,
  ].filter(Boolean);
  els.status.textContent += ` · ${note.join(' · ') || 'nada para importar'}`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

async function clearAll() {
  const ok = await dialog({
    title: 'Apagar tudo do app?',
    text: 'Todas as fotos e vídeos guardados neste app serão apagados. Os arquivos originais no seu aparelho não são afetados.',
    ok: 'Apagar tudo', danger: true,
  });
  if (!ok) return;
  await api.clearAll();
  await load();
}

async function chooseFolder() {
  try {
    const lib = await api.chooseFolder();
    if (lib) showLibrary(lib);
  } catch (err) {
    showEmpty('Não consegui ler a pasta', String(err?.message || err), 'Tentar de novo', chooseFolder);
  }
}

async function boot() {
  if (!api) {
    els.loading.hidden = true;
    document.body.insertAdjacentHTML('beforeend', '<section class="center"><h2>Abra pelo app</h2><p>Esta tela precisa do Electron: rode <code>npm start</code>.</p></section>');
    return;
  }
  // controles que não existem em todas as plataformas (o iPad não tem seletor de pasta, tela cheia nem "sair")
  const hide = (sel, on) => document.querySelectorAll(sel).forEach((el) => { if (on) el.hidden = true; });
  hide('[data-act="folder"]', !api.chooseFolder);
  hide('[data-act="quit"]', !api.quit);
  hide('#fs, #v-fs, [data-act="fullscreen"]', api.noFullscreen);
  hide('[data-act="import"], [data-act="importdir"]', !api.importFiles);
  hide('[data-act="clear"]', !api.clearAll);
  hide('[data-act="manage"]', !api.manage);
  if (api.manage) manager = new Manager({ api, getItems: () => state.items, reload: load });
  document.body.classList.toggle('expo', state.expo);
  setLayout(state.layout);
  syncTypeButtons();
  popoverState();
  await load();
}

// arrastar fotos e pastas para a janela (computador); ignora no modo exposição
document.addEventListener('memo:drop', (e) => { if (!state.expo) runImport({ entries: e.detail }); });

// volta para o app (ex.: depois de copiar fotos pelo app Arquivos): relê a pasta
let lastShown = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !api?.reloadOnShow || viewer.isOpen || Date.now() - lastShown < 10000) return;
  lastShown = Date.now();
  load();
});

boot();
