// The embedded browser keeps its menus inside Orion rather than exposing WebView chrome.
(() => {
  let host, menu, previous;
  const dismiss = () => { host?.remove(); host = menu = undefined; };
  document.addEventListener('contextmenu', event => {
    event.preventDefault();
    if (host && event.composedPath().includes(host)) return;
    dismiss();
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    previous = document.activeElement;
    const items = [];
    const input = target.closest('input,textarea');
    if (input && !input.disabled && input.selectionStart !== null) {
      const start = input.selectionStart ?? 0, end = input.selectionEnd ?? start, value = input.value.slice(start, end);
      const replace = text => { input.focus(); input.setRangeText(text, start, end, 'end'); input.dispatchEvent(new Event('input', { bubbles:true })); };
      if (value && input.type !== 'password') items.push(['Copy', () => navigator.clipboard.writeText(value)]);
      if (!input.readOnly) {
        if (value && input.type !== 'password') items.push(['Cut', async () => { await navigator.clipboard.writeText(value); replace(''); }]);
        items.push(['Paste', async () => replace(await navigator.clipboard.readText())]);
      }
      items.push(['Select all', () => { input.focus(); input.select(); }]);
    } else {
      const selected = window.getSelection()?.toString();
      if (selected) items.push(['Copy', () => navigator.clipboard.writeText(selected)]);
      const link = target.closest('a[href]');
      if (link && ['https:','http:'].includes(link.protocol)) items.push(['Open link in new tab', () => window.open(link.href, '_blank', 'noopener')], ['Copy link', () => navigator.clipboard.writeText(link.href)]);
      const media = target.closest('img,video');
      if (media?.currentSrc) items.push(['Copy media location', () => navigator.clipboard.writeText(media.currentSrc)]);
      items.push(['Back', () => history.back()], ['Forward', () => history.forward()], ['Reload', () => location.reload()]);
    }
    host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    const shadow = host.attachShadow({ mode:'closed' });
    const style = document.createElement('style'); style.textContent = ':host{color-scheme:dark}div{position:fixed;min-width:176px;max-height:calc(100vh - 16px);overflow:auto;padding:6px;border:1px solid #414147;border-radius:14px;background:#242428;color:#f2f0f4;pointer-events:auto;box-sizing:border-box}button{display:block;width:100%;min-height:32px;padding:7px 10px;border:0;border-radius:8px;background:transparent;color:#c0bdc8;text-align:left;font:12px system-ui;cursor:pointer}button:hover,button:focus-visible{outline:0;background:#323237;color:#f2f0f4}';
    menu = document.createElement('div'); menu.setAttribute('role', 'menu');
    for (const [label, run] of items) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.setAttribute('role','menuitem');
      button.onclick = () => { dismiss(); previous?.focus({preventScroll:true}); Promise.resolve().then(run).catch(() => {}); }; menu.append(button);
    }
    shadow.append(style, menu); document.documentElement.append(host);
    const rect = target.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(event.clientX || rect.left + 12, innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(event.clientY || rect.top + 12, innerHeight - menu.offsetHeight - 8)) + 'px';
    menu.firstElementChild?.focus({preventScroll:true});
    menu.addEventListener('keydown', e => {
      const rows = [...menu.querySelectorAll('button')], index = rows.indexOf(shadow.activeElement);
      if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); dismiss(); previous?.focus({preventScroll:true}); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); rows[(index + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus(); }
    });
  }, true);
  document.addEventListener('pointerdown', event => { if (host && !event.composedPath().includes(host)) dismiss(); }, true);
  document.addEventListener('scroll', event => { if (host && !event.composedPath().includes(host)) dismiss(); }, true);
  window.addEventListener('blur', dismiss); window.addEventListener('resize', dismiss);
})();
