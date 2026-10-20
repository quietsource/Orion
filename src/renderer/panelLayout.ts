import './panelLayout.css';

export function installPanelLayout() {
  const root = document.documentElement;
  const app = document.querySelector<HTMLElement>('.app')!;
  const composer = document.getElementById('composer')!;
  const chat = document.getElementById('chat')!;
  const alignWelcome = () => {
    const dock = composer.getBoundingClientRect(), area = chat.getBoundingClientRect();
    chat.style.setProperty('--welcome-center', `${dock.left + dock.width / 2 - area.left}px`);
  };
  const observer = new ResizeObserver(alignWelcome);
  observer.observe(app); observer.observe(composer); observer.observe(chat);
  for (const [id, property, minimum, fallback, direction] of [
    ['sidebar', '--sidebar-width', 200, 250, 1],
    ['canvas-sidebar', '--canvas-width', 280, 360, -1],
  ] as const) {
    const panel = document.getElementById(id)!;
    const key = `orion:${id}:width`;
    const maximum = () => Math.max(minimum, Math.min(id === 'sidebar' ? 420 : 720, innerWidth * (id === 'sidebar' ? .3 : .48)));
    let width = fallback as number;
    try { const stored = Number(localStorage.getItem(key)); if (stored >= minimum) width = stored; } catch {}
    const apply = (value: number) => { width = Math.min(maximum(), Math.max(minimum, value)); root.style.setProperty(property, `${width}px`); };
    apply(width);
    const handle = document.createElement('div');
    handle.className = `panel-resize-handle ${id === 'sidebar' ? 'resize-right' : 'resize-left'}`;
    handle.tabIndex = 0; handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', `Resize ${id === 'sidebar' ? 'sidebar' : 'canvas'}`);
    const commit = () => { try { localStorage.setItem(key, String(width)); } catch {} handle.setAttribute('aria-valuenow', String(Math.round(width))); };
    handle.setAttribute('aria-valuemin', String(minimum));
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); handle.setPointerCapture(event.pointerId);
      const start = event.clientX, original = width;
      document.body.classList.add('resizing-panels'); handle.classList.add('dragging');
      const move = (next: PointerEvent) => apply(original + (next.clientX - start) * direction);
      const end = () => { handle.removeEventListener('pointermove', move); document.body.classList.remove('resizing-panels'); handle.classList.remove('dragging'); commit(); };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('lostpointercapture', end, { once: true });
    });
    handle.addEventListener('keydown', event => { if (!['ArrowLeft','ArrowRight','Home'].includes(event.key)) return; event.preventDefault(); apply(event.key === 'Home' ? fallback : width + (event.key === 'ArrowRight' ? 16 : -16) * direction); commit(); });
    handle.addEventListener('dblclick', () => { apply(fallback); commit(); });
    panel.append(handle); commit();
    window.addEventListener('resize', () => apply(width));
  }
}
