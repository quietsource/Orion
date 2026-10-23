import './managedPopups.css';

/** Keep native select controls and their handlers, but render choices in Orion's popup layer. */
export function installManagedPopups() {
  const menu = document.createElement('div');
  menu.className = 'orion-select-popup'; menu.setAttribute('popover', 'manual');
  menu.setAttribute('role', 'listbox'); menu.tabIndex = -1;
  document.body.append(menu);
  const validation = document.createElement('div'); validation.className = 'orion-validation-popup';
  validation.setAttribute('popover', 'manual'); validation.setAttribute('role', 'alert'); document.body.append(validation);
  let invalidControl: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | undefined;
  const closeValidation = () => { if (validation.matches(':popover-open')) validation.hidePopover(); invalidControl?.removeAttribute('aria-invalid'); invalidControl = undefined; };
  document.addEventListener('invalid', event => {
    const control = event.target;
    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) return;
    event.preventDefault(); if (validation.matches(':popover-open')) return;
    invalidControl = control; control.setAttribute('aria-invalid', 'true'); control.focus();
    validation.textContent = control.validationMessage;
    (control.closest('dialog[open]') ?? document.body).append(validation);
    validation.style.width = `${Math.min(320, innerWidth - 24)}px`;
    const rect = control.getBoundingClientRect();
    validation.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - Math.min(320, innerWidth - 24) - 12))}px`;
    validation.style.top = rect.bottom + 70 < innerHeight ? `${rect.bottom + 6}px` : 'auto';
    validation.style.bottom = rect.bottom + 70 < innerHeight ? 'auto' : `${innerHeight - rect.top + 6}px`;
    validation.showPopover();
  }, true);
  document.addEventListener('input', closeValidation, true);
  document.addEventListener('pointerdown', closeValidation, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeValidation(); }, true);
  window.addEventListener('resize', closeValidation);
  window.addEventListener('blur', closeValidation);
  document.addEventListener('scroll', closeValidation, true);
  let select: HTMLSelectElement | undefined, active = -1, search = '', searchAt = 0;
  let options: HTMLOptionElement[] = [], rows: HTMLButtonElement[] = [];
  const eligible = (target: EventTarget | null): target is HTMLSelectElement => target instanceof HTMLSelectElement && !target.disabled && !target.multiple && target.size <= 1 && !['engine','model','context-window'].includes(target.id);
  const close = (focus = false) => {
    const previous = select;
    if (menu.matches(':popover-open')) menu.hidePopover();
    previous?.setAttribute('aria-expanded', 'false'); select = undefined;
    if (focus && previous?.isConnected) previous.focus({ preventScroll:true });
  };
  const highlight = (index: number) => {
    active = index;
    rows.forEach((row, i) => row.classList.toggle('highlighted', i === index));
    const row = rows[index]; row?.focus({ preventScroll:true });
    if (row) { const top = row.offsetTop, bottom = top + row.offsetHeight; if (top < menu.scrollTop) menu.scrollTop = top; else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight; }
  };
  const choose = (index: number) => {
    const option = options[index], source = select;
    if (!option || !source || option.closest('select') !== source || option.disabled || option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled) return;
    source.selectedIndex = option.index;
    source.dispatchEvent(new Event('input', { bubbles:true })); source.dispatchEvent(new Event('change', { bubbles:true }));
    close(true);
  };
  const open = (source: HTMLSelectElement) => {
    if (select === source) { close(true); return; }
    close(); select = source; search = '';
    options = [...source.options].filter(option => !option.hidden && !(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.hidden));
    if (!options.length) { close(); return; }
    rows = []; menu.replaceChildren();
    let group: HTMLOptGroupElement | undefined;
    options.forEach((option, index) => {
      const parent = option.parentElement instanceof HTMLOptGroupElement ? option.parentElement : undefined;
      if (parent && parent !== group) { const heading = document.createElement('div'); heading.className = 'orion-select-group'; heading.textContent = parent.label; menu.append(heading); }
      group = parent;
      const row = document.createElement('button'); row.type = 'button'; row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(option.selected)); row.disabled = option.disabled || Boolean(parent?.disabled);
      const label = document.createElement('span'); label.textContent = option.label;
      const check = document.createElement('span'); check.className = 'orion-select-check'; check.textContent = option.selected ? '✓' : ''; check.setAttribute('aria-hidden', 'true');
      row.append(label, check); row.onclick = () => choose(index);
      row.onpointermove = () => { if (!row.disabled && active !== index) highlight(index); };
      rows.push(row); menu.append(row);
    });
    const rect = source.getBoundingClientRect(), below = innerHeight - rect.bottom - 12, above = rect.top - 12;
    const upward = below < Math.min(240, options.length * 34 + 12) && above > below;
    menu.style.width = `${Math.min(innerWidth - 24, Math.max(180, rect.width))}px`;
    menu.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - Math.min(innerWidth - 24, Math.max(180, rect.width)) - 12))}px`;
    menu.style.top = upward ? 'auto' : `${rect.bottom + 6}px`;
    menu.style.bottom = upward ? `${innerHeight - rect.top + 6}px` : 'auto';
    menu.style.maxHeight = `${Math.max(40, Math.min(360, (upward ? above : below) - 6))}px`;
    source.setAttribute('aria-expanded', 'true');
    menu.setAttribute('aria-label', source.getAttribute('aria-label') ?? source.labels?.[0]?.textContent?.trim() ?? 'Choose an option');
    (source.closest('dialog[open]') ?? document.body).append(menu);
    menu.showPopover();
    const selected = options.findIndex((option, index) => option.selected && !rows[index]!.disabled);
    highlight(selected >= 0 ? selected : rows.findIndex(row => !row.disabled));
  };
  document.addEventListener('pointerdown', event => {
    if (eligible(event.target)) { event.preventDefault(); open(event.target); }
    else if (!menu.contains(event.target as Node)) close();
  }, true);
  for (const name of ['mousedown','click']) document.addEventListener(name, event => { if (eligible(event.target)) event.preventDefault(); }, true);
  document.addEventListener('keydown', event => {
    if (eligible(event.target) && ['ArrowDown','ArrowUp','Enter',' ','F4','Home','End'].includes(event.key)) { event.preventDefault(); open(event.target); }
  }, true);
  menu.addEventListener('keydown', event => {
    const enabled = rows.map((row, index) => row.disabled ? -1 : index).filter(index => index >= 0);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') close(true);
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(active); }
    else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault(); const current = enabled.indexOf(active);
      const next = event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled.at(-1) : enabled[(current + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length];
      if (next !== undefined) highlight(next);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); const now = performance.now(); search = now - searchAt > 700 ? event.key : search + event.key; searchAt = now;
      const match = enabled.find(index => options[index]!.label.toLowerCase().startsWith(search.toLowerCase()));
      if (match !== undefined) highlight(match);
    }
  });
  document.addEventListener('scroll', event => { if (!menu.contains(event.target as Node)) close(); }, true);
  document.addEventListener('focusin', event => { if (select && event.target !== select && !menu.contains(event.target as Node)) close(); });
  window.addEventListener('blur', () => close()); window.addEventListener('resize', () => close());
  new MutationObserver(() => {
    if (!select) return;
    const current = [...select.options].filter(option => !option.hidden && !(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.hidden));
    if (!select.isConnected || select.disabled || !select.getBoundingClientRect().width || !select.getBoundingClientRect().height || current.length !== options.length || current.some((option, index) => option !== options[index])) close();
  }).observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['hidden','disabled'] });
}
