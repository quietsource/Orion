export type ContextAction = { label: string; run: () => void | Promise<void>; danger?: boolean };

/** Native WebView menus never provide a fallback for Orion's own interface. */
document.addEventListener('contextmenu', event => event.preventDefault(), true);

export function installOrionContextMenus(show: (x: number, y: number, actions: ContextAction[]) => void) {
  document.addEventListener('contextmenu', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('.conversation')) return;
    const actions: ContextAction[] = [];
    const input = target.closest('textarea,input');
    if ((input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) && !input.disabled && input.selectionStart !== null) {
      const start = input.selectionStart ?? 0, end = input.selectionEnd ?? start;
      const selected = input.value.slice(start, end);
      const replace = (text: string) => {
        input.focus(); input.setRangeText(text, start, end, 'end');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      if (selected && input.type !== 'password') actions.push({ label: 'Copy', run: () => navigator.clipboard.writeText(selected) });
      if (!input.readOnly) {
        if (selected && input.type !== 'password') actions.push({ label: 'Cut', run: async () => { await navigator.clipboard.writeText(selected); replace(''); } });
        actions.push({ label: 'Paste', run: async () => replace(await navigator.clipboard.readText()) });
      }
      if (input.value) actions.push({ label: 'Select all', run: () => { input.focus(); input.select(); } });
    } else if (input instanceof HTMLInputElement && input.type === 'number' && !input.disabled) {
      if (input.value) actions.push({ label:'Copy value', run:() => navigator.clipboard.writeText(input.value) });
      if (!input.readOnly) actions.push({ label:'Paste value', run:async () => { input.value = (await navigator.clipboard.readText()).trim(); input.dispatchEvent(new Event('input', { bubbles:true })); input.dispatchEvent(new Event('change', { bubbles:true })); } });
    } else if (target.closest('[contenteditable="true"]')) {
      const editor = target.closest<HTMLElement>('[contenteditable="true"]')!;
      const selection = window.getSelection();
      const range = selection?.rangeCount && editor.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : undefined;
      const selected = range?.toString() ?? '';
      const replace = (text: string) => {
        editor.focus(); const insertion = range ?? document.createRange();
        if (!range) { insertion.selectNodeContents(editor); insertion.collapse(false); }
        insertion.deleteContents(); const node = document.createTextNode(text); insertion.insertNode(node); insertion.setStartAfter(node); insertion.collapse(true);
        selection?.removeAllRanges(); selection?.addRange(insertion); editor.dispatchEvent(new Event('input', { bubbles:true }));
      };
      if (selected) actions.push({ label:'Copy', run:() => navigator.clipboard.writeText(selected) }, { label:'Cut', run:async () => { await navigator.clipboard.writeText(selected); replace(''); } });
      actions.push({ label:'Paste', run:async () => replace(await navigator.clipboard.readText()) }, { label:'Select all', run:() => { editor.focus(); const all = document.createRange(); all.selectNodeContents(editor); selection?.removeAllRanges(); selection?.addRange(all); } });
    } else {
      const selection = window.getSelection()?.toString();
      if (selection) actions.push({ label: 'Copy', run: () => navigator.clipboard.writeText(selection) });
      const link = target.closest<HTMLAnchorElement>('a[href]');
      if (link && ['https:', 'http:', 'mailto:'].includes(link.protocol)) {
        actions.push({ label: 'Open link', run: () => link.click() }, { label: 'Copy link', run: () => navigator.clipboard.writeText(link.href) });
      }
      const media = target.closest<HTMLImageElement | HTMLVideoElement>('img,video');
      if (media?.currentSrc) actions.push({ label: 'Copy media location', run: () => navigator.clipboard.writeText(media.currentSrc) });
      const code = target.closest('pre');
      const message = target.closest('.message-body');
      if (code) actions.push({ label: 'Copy code', run: () => navigator.clipboard.writeText(code.querySelector('code')?.textContent ?? code.textContent ?? '') });
      else if (message && !selection) actions.push({ label: 'Copy message', run: () => navigator.clipboard.writeText(message.textContent ?? '') });
    }
    const rect = target.getBoundingClientRect();
    show(event.clientX || rect.left + 12, event.clientY || rect.top + 12, actions);
  });
}
