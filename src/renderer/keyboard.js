const ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', { k: 'back', label: '⌫', wide: 1.6 }],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ç'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', '-', '_', '.'],
  [{ k: 'clear', label: 'Limpar', wide: 2 }, { k: ' ', label: 'espaço', wide: 6 }, { k: 'done', label: 'Pronto', wide: 2, accent: true }],
];

/** Teclado na tela para o campo de busca (a busca ignora acentos e maiúsculas, então não há shift). */
export class Keyboard {
  constructor(input) {
    this.input = input;
    this.el = document.createElement('div');
    this.el.id = 'keyboard';
    this.el.hidden = true;
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', 'Teclado');

    for (const row of ROWS) {
      const r = document.createElement('div');
      r.className = 'krow';
      for (const key of row) {
        const def = typeof key === 'string' ? { k: key, label: key } : key;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'key' + (def.accent ? ' accent' : '') + (def.k.length > 1 ? ' fn' : '');
        b.style.flexGrow = def.wide || 1;
        b.dataset.k = def.k;
        b.textContent = def.label;
        r.append(b);
      }
      this.el.append(r);
    }
    document.body.append(this.el);

    // pointerdown + preventDefault: o campo de busca não perde o foco
    this.el.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('.key');
      if (!b) return;
      e.preventDefault();
      this.press(b.dataset.k);
      if (b.dataset.k === 'back') {
        this.hold = setTimeout(() => { this.repeat = setInterval(() => this.press('back'), 55); }, 420);
      }
    });
    const release = () => { clearTimeout(this.hold); clearInterval(this.repeat); };
    this.el.addEventListener('pointerup', release);
    this.el.addEventListener('pointerleave', release);
    this.el.addEventListener('pointercancel', release);
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get visible() { return !this.el.hidden; }

  show() {
    this.el.hidden = false;
    this.el.classList.remove('out');
    document.body.classList.add('kbd-open');
    this.input.focus({ preventScroll: true });
  }

  hide() {
    if (this.el.hidden) return;
    document.body.classList.remove('kbd-open');
    this.el.classList.add('out');
    setTimeout(() => { if (this.el.classList.contains('out')) this.el.hidden = true; }, 220);
  }

  toggle() { this.visible ? this.hide() : this.show(); }

  press(k) {
    const input = this.input;
    if (k === 'done') { this.hide(); input.blur(); return; }
    if (k === 'clear') { input.value = ''; this.emit(); return; }
    input.focus({ preventScroll: true });
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    if (k === 'back') {
      if (start !== end) input.setRangeText('', start, end, 'end');
      else if (start > 0) input.setRangeText('', start - 1, start, 'end');
    } else {
      input.setRangeText(k, start, end, 'end');
    }
    this.emit();
  }

  emit() { this.input.dispatchEvent(new Event('input', { bubbles: true })); }
}
