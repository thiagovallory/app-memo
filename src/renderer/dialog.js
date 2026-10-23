/**
 * Diálogo próprio do app (no lugar de prompt/confirm, que o iOS pode suprimir em apps da tela inicial).
 *
 *   await dialog({ title, text, ok, cancel, danger })                          -> true | false
 *   await dialog({ title, text, input: { value, placeholder }, suggestions })  -> string | null
 */
export function dialog({ title, text = '', ok = 'OK', cancel = 'Cancelar', danger = false, input = null, suggestions = [] }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'dlg';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');

    const card = document.createElement('div');
    card.className = 'dlg-card';
    const h = document.createElement('h3');
    h.textContent = title;
    card.append(h);
    if (text) {
      const p = document.createElement('p');
      p.textContent = text;
      card.append(p);
    }

    let field = null;
    if (input) {
      field = document.createElement('input');
      field.type = 'text';
      field.value = input.value || '';
      field.placeholder = input.placeholder || '';
      field.autocomplete = 'off';
      field.spellcheck = false;
      card.append(field);
      if (suggestions.length) {
        const row = document.createElement('div');
        row.className = 'dlg-chips';
        for (const s of suggestions) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'chip';
          b.textContent = s;
          b.addEventListener('click', () => { field.value = s; field.focus(); });
          row.append(b);
        }
        card.append(row);
      }
    }

    const actions = document.createElement('div');
    actions.className = 'dlg-actions';
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'pill ghost';
    no.textContent = cancel;
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'pill' + (danger ? ' danger' : '');
    yes.textContent = ok;
    actions.append(no, yes);
    card.append(actions);
    wrap.append(card);

    const finish = (value) => {
      document.removeEventListener('keydown', onKey, true);
      wrap.remove();
      resolve(value);
    };
    const accept = () => finish(field ? field.value : true);
    const reject = () => finish(field ? null : false);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); reject(); }
      else if (e.key === 'Enter' && (!field || document.activeElement === field)) { e.preventDefault(); e.stopPropagation(); accept(); }
    };
    yes.addEventListener('click', accept);
    no.addEventListener('click', reject);
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) reject(); });
    document.addEventListener('keydown', onKey, true);

    document.body.append(wrap);
    (field || yes).focus({ preventScroll: true });
    if (field) field.select();
  });
}
