/** A shared Bezier boundary prevents seams between the input and its lower flares. */
export function installComposerFrame(composer: HTMLElement) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.classList.add('composer-frame'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  const fill = document.createElementNS(ns, 'path'); fill.classList.add('composer-frame-fill');
  const outline = document.createElementNS(ns, 'path'); outline.classList.add('composer-frame-outline');
  svg.append(fill, outline); composer.prepend(svg);
  const main = composer.closest<HTMLElement>('.main')!;
  const header = main.querySelector<HTMLElement>('.header')!;
  const shell = document.createElementNS(ns, 'svg'); shell.classList.add('chat-shell-frame'); shell.setAttribute('aria-hidden', 'true'); shell.setAttribute('focusable', 'false');
  const surface = document.createElementNS(ns, 'path'); surface.classList.add('chat-shell-surface'); shell.append(surface); main.prepend(shell);
  let queued = false;
  const draw = () => {
    queued = false;
    const { width, height } = composer.getBoundingClientRect(); if (!width || !height) return;
    const flare = Number.parseFloat(getComputedStyle(composer).getPropertyValue('--composer-flare')) || 34;
    const w = width + flare * 2, bottom = height - 7.5, left = flare + .5, right = flare + width - .5, top = .5, radius = 16;
    // Exact cubic quarter-circles have matching tangents at the upright sides.
    const k = .5522847498307936, shoulder = bottom - flare;
    const d = `M ${left - flare} ${bottom} C ${left - flare + k * flare} ${bottom}, ${left} ${shoulder + k * flare}, ${left} ${shoulder} L ${left} ${radius + top} Q ${left} ${top}, ${left + radius} ${top} L ${right - radius} ${top} Q ${right} ${top}, ${right} ${radius + top} L ${right} ${shoulder} C ${right} ${shoulder + k * flare}, ${right + flare - k * flare} ${bottom}, ${right + flare} ${bottom}`;
    svg.setAttribute('viewBox', `0 0 ${w} ${height}`);
    fill.setAttribute('d', `${d} L ${w} ${height + 1} L 0 ${height + 1} Z`);
    outline.setAttribute('d', `M ${left + radius + 4} ${top} L ${right - radius - 4} ${top}`);
    const mainRect = main.getBoundingClientRect(), composerRect = composer.getBoundingClientRect();
    const shellWidth = mainRect.width, shellHeight = mainRect.height;
    const edge = .5, far = shellWidth - .5, floor = shellHeight - 7.5;
    const ceiling = header.getBoundingClientRect().bottom - mainRect.top;
    const round = Math.min(24, (far - edge) / 4), lowerRound = Math.min(22, round);
    const dockLeft = composerRect.left - mainRect.left + .5, dockRight = composerRect.right - mainRect.left - .5;
    const dockTop = composerRect.top - mainRect.top + .5;
    const dockShoulder = floor - flare;
    // Trace a single closed surface, including the inset above the composer.
    // Both outlines use the same quarter-circle tangent and measured dock edges.
    const boundary = `M ${edge + round} ${ceiling} L ${far - round} ${ceiling} Q ${far} ${ceiling} ${far} ${ceiling + round} L ${far} ${floor - lowerRound} Q ${far} ${floor} ${far - lowerRound} ${floor} L ${dockRight + flare} ${floor} C ${dockRight + flare - k * flare} ${floor}, ${dockRight} ${dockShoulder + k * flare}, ${dockRight} ${dockShoulder} L ${dockRight} ${dockTop + radius} Q ${dockRight} ${dockTop}, ${dockRight - radius} ${dockTop} L ${dockLeft + radius} ${dockTop} Q ${dockLeft} ${dockTop}, ${dockLeft} ${dockTop + radius} L ${dockLeft} ${dockShoulder} C ${dockLeft} ${dockShoulder + k * flare}, ${dockLeft - flare + k * flare} ${floor}, ${dockLeft - flare} ${floor} L ${edge + lowerRound} ${floor} Q ${edge} ${floor} ${edge} ${floor - lowerRound} L ${edge} ${ceiling + round} Q ${edge} ${ceiling} ${edge + round} ${ceiling} Z`;
    shell.setAttribute('viewBox', `0 0 ${shellWidth} ${shellHeight}`);
    surface.setAttribute('d', boundary);
  };
  const observer = new ResizeObserver(() => { if (!queued) { queued = true; requestAnimationFrame(draw); } });
  observer.observe(composer); observer.observe(main); observer.observe(header); draw();
}
