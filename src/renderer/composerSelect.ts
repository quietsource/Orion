import './composerSelect.css';

/** Keep the existing selects as the source of truth for model/runtime handlers. */
export function installComposerSelects() {
  let dismiss: (() => void) | undefined;
  for (const id of ['engine', 'model', 'context-window']) {
    const select = document.getElementById(id) as HTMLSelectElement;
    select.classList.add('composer-native-select'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.className = `composer-select ${id === 'model' ? 'composer-model-select' : id === 'engine' ? 'composer-engine-select' : 'composer-context-select'}`;
    trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
    const label = document.createElement('span'); label.className = 'composer-select-label';
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); arrow.setAttribute('viewBox', '0 0 12 12'); arrow.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(arrow.namespaceURI, 'path'); path.setAttribute('d', 'm3 4.5 3 3 3-3'); arrow.append(path); trigger.append(label, arrow);
    select.after(trigger);
    const menu = document.createElement('div'); menu.id = `${id}-composer-menu`; menu.className = 'composer-select-menu'; menu.hidden = true; menu.tabIndex = -1;
    menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', id === 'model' ? 'Chat model' : id === 'engine' ? 'Inference engine' : 'Context length');
    trigger.setAttribute('aria-controls', menu.id); document.body.append(menu);
    let active = -1, options: HTMLOptionElement[] = [], rows: HTMLElement[] = [], search = '', searchAt = 0;
    const position = () => {
      if (menu.hidden) return;
      const rect = trigger.getBoundingClientRect();
      if (!rect.width || !rect.height) { close(false); return; }
      const width = Math.min(innerWidth - 24, id === 'model' ? Math.max(rect.width, 320) : id === 'engine' ? Math.max(rect.width, 170) : 150);
      menu.style.width = `${width}px`;
      menu.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
      menu.style.bottom = `${innerHeight - rect.top + 8}px`;
      menu.style.maxHeight = `${Math.max(0, Math.min(360, rect.top - 20))}px`;
    };
    const highlight = (index: number) => {
      active = index;
      rows.forEach((row, i) => row.classList.toggle('highlighted', i === index));
      const row = rows[index]; if (row) { menu.setAttribute('aria-activedescendant', row.id); row.scrollIntoView({ block: 'nearest' }); }
    };
    const close = (focus = true) => { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); if (dismiss === dismissThis) dismiss = undefined; if (focus) trigger.focus(); };
    const dismissThis = () => close(false);
    const choose = (index: number) => {
      const option = options[index]; if (!option || option.disabled) return;
      select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); sync(); close();
    };
    const populate = () => {
      options = Array.from(select.options).filter(option => !option.hidden);
      rows = options.map((option, index) => {
        const row = document.createElement('div'); row.id = `${menu.id}-${index}`; row.className = 'composer-select-option'; row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(option.selected)); row.setAttribute('aria-disabled', String(option.disabled));
        const text = document.createElement('span'); text.textContent = option.label; row.append(text);
        const check = document.createElement('span'); check.className = 'composer-select-check'; check.textContent = option.selected ? '✓' : ''; check.setAttribute('aria-hidden', 'true'); row.append(check);
        row.addEventListener('click', () => choose(index)); row.addEventListener('pointermove', () => { if (!option.disabled) highlight(index); }); return row;
      });
      menu.replaceChildren(...rows);
      highlight(Math.max(0, options.findIndex(option => option.selected && !option.disabled)));
    };
    const sync = () => {
      label.textContent = select.selectedOptions[0]?.label ?? (id === 'model' ? 'Choose model' : id === 'engine' ? 'Engine' : 'Context');
      trigger.title = label.textContent; trigger.disabled = select.disabled || !select.options.length;
      trigger.setAttribute('aria-label', `${id === 'model' ? 'Model' : id === 'engine' ? 'Inference engine' : 'Context length'}: ${label.textContent}`);
      if (!menu.hidden) { populate(); position(); }
    };
    const open = () => { if (trigger.disabled) return; dismiss?.(); dismiss = dismissThis; menu.hidden = false; trigger.setAttribute('aria-expanded', 'true'); populate(); position(); menu.focus(); };
    trigger.addEventListener('click', () => menu.hidden ? open() : close());
    trigger.addEventListener('keydown', event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(); } });
    menu.addEventListener('keydown', event => {
      const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      else if (event.key === 'Tab') { close(); }
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(active); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const index = enabled.indexOf(active);
        const next = event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled.at(-1) : enabled[(index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length];
        if (next !== undefined) highlight(next);
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault(); const now = performance.now(); search = now - searchAt > 700 ? event.key : search + event.key; searchAt = now;
        const match = enabled.find(index => options[index]!.label.toLowerCase().startsWith(search.toLowerCase())); if (match !== undefined) highlight(match);
      }
    });
    document.addEventListener('pointerdown', event => { if (!menu.hidden && !menu.contains(event.target as Node) && !trigger.contains(event.target as Node)) close(false); });
    document.addEventListener('focusin', event => { if (!menu.hidden && !menu.contains(event.target as Node) && !trigger.contains(event.target as Node)) close(false); });
    window.addEventListener('resize', position); document.addEventListener('scroll', event => { if (!menu.contains(event.target as Node)) position(); }, true);
    new ResizeObserver(position).observe(trigger);
    new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true, characterData: true });
    select.addEventListener('change', sync); select.addEventListener('orion:select-sync', sync); trigger.addEventListener('pointerenter', sync); sync();
  }
}
