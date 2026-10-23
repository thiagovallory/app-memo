import { dialog } from './dialog.js';
import { cleanFolder } from './platform/folder-name.js';

const PAGE = 120;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const label = (folder) => (folder === '' ? 'Soltas' : folder.split('/').join(' › '));

const ICON_CLOSE = '<svg viewBox="0 0 24 24" class="ico"><path d="m6 6 12 12M18 6 6 18"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" class="ico"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

/**
 * Tela "Organizar": pastas (renomear, excluir) e fotos (selecionar, mover, excluir).
 * Só existe quando a plataforma oferece `api.manage` (a versão web, onde os arquivos são cópias do app).
 */
export class Manager {
  constructor({ api, getItems, reload }) {
    this.api = api;
    this.getItems = getItems;   // () => itens da biblioteca inteira
    this.reload = reload;       // () => Promise: relê a biblioteca
    this.tab = 'folders';
    this.filter = null;         // pasta mostrada na aba Fotos (null = todas)
    this.selected = new Set();
    this.shown = PAGE;
    this.isOpen = false;

    this.el = document.createElement('section');
    this.el.id = 'manage';
    this.el.hidden = true;
    this.el.innerHTML = `
      <header class="m-head">
        <h2>Organizar</h2>
        <div class="seg" role="group" aria-label="Seção">
          <button data-tab="folders">Pastas</button>
          <button data-tab="photos">Fotos</button>
        </div>
        <button class="round m-close" aria-label="Fechar" title="Fechar">${ICON_CLOSE}</button>
      </header>
      <div class="m-body"></div>
      <footer class="m-bar" hidden>
        <span class="m-count"></span>
        <button class="pill ghost" data-do="all">Selecionar tudo</button>
        <button class="pill" data-do="move">Mover…</button>
        <button class="pill danger" data-do="delete">Excluir</button>
      </footer>`;
    document.body.append(this.el);
    this.body = this.el.querySelector('.m-body');
    this.bar = this.el.querySelector('.m-bar');

    this.el.querySelector('.m-close').addEventListener('click', () => this.close());
    this.el.querySelector('.seg').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) this.show(b.dataset.tab);
    });
    this.bar.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.do;
      if (act === 'all') this.selectAll();
      else if (act === 'move') this.moveSelected();
      else if (act === 'delete') this.deleteSelected();
    });
    document.addEventListener('keydown', (e) => { if (this.isOpen && e.key === 'Escape') this.close(); });
  }

  open(tab = 'folders', folder = null) {
    this.isOpen = true;
    this.el.hidden = false;
    this.selected.clear();
    this.show(tab, folder);
  }

  close() {
    this.isOpen = false;
    this.el.hidden = true;
    this.body.textContent = '';
    this.selected.clear();
  }

  show(tab, folder = this.filter) {
    this.tab = tab;
    this.filter = folder;
    this.shown = PAGE;
    this.selected.clear();
    this.render();
  }

  // ---------- dados ----------
  folders() {
    const counts = new Map();
    for (const it of this.getItems()) counts.set(it.folder, (counts.get(it.folder) || 0) + 1);
    return [...counts].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : a[0].localeCompare(b[0], 'pt-BR', { numeric: true })));
  }

  visible() {
    const f = this.filter;
    return this.getItems().filter((it) => f === null || it.folder === f);
  }

  // ---------- desenho ----------
  render() {
    for (const b of this.el.querySelectorAll('.seg button')) b.classList.toggle('on', b.dataset.tab === this.tab);
    this.body.textContent = '';
    if (this.tab === 'folders') this.renderFolders();
    else this.renderPhotos();
    this.renderBar();
  }

  renderFolders() {
    const list = this.folders();
    if (!list.length) { this.body.append(this.note('Nenhuma foto ainda. Importe fotos pelo menu ⋯.')); return; }
    const box = document.createElement('div');
    box.className = 'm-list';
    for (const [folder, count] of list) {
      const row = document.createElement('div');
      row.className = 'm-row';
      row.innerHTML = '<div class="m-name"><b></b><small></small></div><div class="m-btns"></div>';
      row.querySelector('b').textContent = label(folder);
      row.querySelector('small').textContent = plural(count, 'memória', 'memórias');
      const btns = row.querySelector('.m-btns');
      btns.append(
        this.button('Ver fotos', 'ghost', () => this.show('photos', folder)),
        ...(folder === '' ? [] : [this.button('Renomear', 'ghost', () => this.renameFolder(folder))]),
        this.button('Excluir', 'danger', () => this.deleteFolder(folder, count)),
      );
      box.append(row);
    }
    this.body.append(box);
  }

  renderPhotos() {
    const tools = document.createElement('div');
    tools.className = 'm-tools';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Pasta');
    select.append(new Option(`Todas as pastas (${this.getItems().length})`, '__all'));
    for (const [folder, count] of this.folders()) select.append(new Option(`${label(folder)} (${count})`, folder));
    select.value = this.filter === null ? '__all' : this.filter;
    select.addEventListener('change', () => this.show('photos', select.value === '__all' ? null : select.value));
    tools.append(select);
    this.body.append(tools);

    const items = this.visible();
    if (!items.length) { this.body.append(this.note('Nenhuma foto aqui.')); return; }

    const grid = document.createElement('div');
    grid.className = 'm-grid';
    for (const it of items.slice(0, this.shown)) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'm-cell' + (this.selected.has(it.id) ? ' on' : '');
      cell.dataset.id = it.id;
      cell.title = it.rel;
      cell.setAttribute('aria-pressed', String(this.selected.has(it.id)));
      if (it.type === 'video') {
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'metadata';
        v.src = this.api.fileUrl(it.id) + '#t=0.1';
        cell.append(v);
      } else {
        const img = document.createElement('img');
        img.loading = 'lazy'; img.decoding = 'async'; img.alt = ''; img.draggable = false;
        img.src = this.api.thumbUrl(it.id);
        cell.append(img);
      }
      const mark = document.createElement('span');
      mark.className = 'm-mark';
      mark.innerHTML = ICON_CHECK;
      cell.append(mark);
      cell.addEventListener('click', () => this.toggle(it.id, cell));
      grid.append(cell);
    }
    this.body.append(grid);

    if (items.length > this.shown) {
      const more = this.button(`Mostrar mais (${items.length - this.shown})`, 'ghost', () => { this.shown += PAGE; this.render(); });
      more.classList.add('m-more');
      this.body.append(more);
    }
  }

  renderBar() {
    const n = this.selected.size;
    this.bar.hidden = this.tab !== 'photos' || n === 0;
    this.bar.querySelector('.m-count').textContent = plural(n, 'selecionada', 'selecionadas');
    const all = this.visible().length;
    this.bar.querySelector('[data-do="all"]').textContent = n >= all ? 'Limpar seleção' : 'Selecionar tudo';
  }

  note(text) {
    const p = document.createElement('p');
    p.className = 'm-note';
    p.textContent = text;
    return p;
  }

  button(text, kind, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `pill ${kind}`;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  // ---------- seleção ----------
  toggle(id, cell) {
    if (this.selected.has(id)) this.selected.delete(id); else this.selected.add(id);
    cell.classList.toggle('on', this.selected.has(id));
    cell.setAttribute('aria-pressed', String(this.selected.has(id)));
    this.renderBar();
  }

  selectAll() {
    const ids = this.visible().map((it) => it.id);
    if (this.selected.size >= ids.length) this.selected.clear();
    else ids.forEach((id) => this.selected.add(id));
    this.render();
  }

  // ---------- ações ----------
  async run(action) {
    try {
      await action();
    } catch (err) {
      await dialog({ title: 'Não deu certo', text: String(err?.message || err), ok: 'OK', cancel: 'Fechar' });
    }
    await this.reload();
    // a pasta filtrada pode ter deixado de existir
    if (this.filter !== null && !this.getItems().some((it) => it.folder === this.filter)) this.filter = null;
    this.selected.clear();
    this.render();
  }

  async renameFolder(folder) {
    const answer = await dialog({
      title: `Renomear "${label(folder)}"`,
      text: 'Se já existir uma pasta com esse nome, as fotos se juntam a ela. Deixe vazio para mandar tudo para "Soltas".',
      input: { value: folder, placeholder: 'Nome da pasta' },
      ok: 'Renomear',
    });
    if (answer === null) return;
    const to = cleanFolder(answer);
    if (to === folder) return;
    await this.run(() => this.api.manage.renameFolder(folder, to));
  }

  async deleteFolder(folder, count) {
    const ok = await dialog({
      title: `Excluir "${label(folder)}"?`,
      text: `${plural(count, 'foto ou vídeo será apagado', 'fotos e vídeos serão apagados')} do app${folder === '' ? '' : ' (inclusive de subpastas)'}. Os originais no seu aparelho não são afetados.`,
      ok: 'Excluir', danger: true,
    });
    if (ok) await this.run(() => this.api.manage.deleteFolder(folder));
  }

  async moveSelected() {
    const ids = [...this.selected];
    if (!ids.length) return;
    const answer = await dialog({
      title: `Mover ${plural(ids.length, 'item', 'itens')}`,
      text: 'Para qual pasta? Escolha uma existente ou digite um nome novo. Vazio = "Soltas".',
      input: { value: '', placeholder: 'Nome da pasta' },
      suggestions: this.folders().map(([f]) => f).filter((f) => f !== '').slice(0, 12),
      ok: 'Mover',
    });
    if (answer === null) return;
    await this.run(() => this.api.manage.moveItems(ids, cleanFolder(answer)));
  }

  async deleteSelected() {
    const ids = [...this.selected];
    if (!ids.length) return;
    const ok = await dialog({
      title: `Excluir ${plural(ids.length, 'item', 'itens')}?`,
      text: 'Serão apagados só do app. Os originais no seu aparelho não são afetados.',
      ok: 'Excluir', danger: true,
    });
    if (ok) await this.run(() => this.api.manage.deleteItems(ids));
  }
}
