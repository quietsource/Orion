/** Chat, Create, and Swarm share the same lower-flare composer and inset shell. */
const composers = new Set<HTMLElement>();
let shellSurface: SVGPathElement | undefined;
let shellSvg: SVGSVGElement | undefined;
let sharedMain: HTMLElement | undefined;
let sharedHeader: HTMLElement | undefined;
let queued = false;
const ns = 'http://www.w3.org/2000/svg';
const resizeObserver = new ResizeObserver(scheduleDraw);
const mutationObserver = new MutationObserver(scheduleDraw);

function scheduleDraw() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(draw);
}

function draw() {
  queued = false;
  if (!sharedMain || !sharedHeader || !shellSvg || !shellSurface) return;
  if (document.body.classList.contains('models-view')) {
    const { width, height } = sharedMain.getBoundingClientRect();
    const edge = .5, far = width - .5, floor = height - 7.5;
    const ceiling = sharedHeader.getBoundingClientRect().bottom - sharedMain.getBoundingClientRect().top;
    const round = Math.min(24, (far - edge) / 4), lowerRound = Math.min(22, round);
    shellSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    shellSurface.setAttribute('d', `M ${edge + round} ${ceiling} L ${far - round} ${ceiling} Q ${far} ${ceiling} ${far} ${ceiling + round} L ${far} ${floor - lowerRound} Q ${far} ${floor} ${far - lowerRound} ${floor} L ${edge + lowerRound} ${floor} Q ${edge} ${floor} ${edge} ${floor - lowerRound} L ${edge} ${ceiling + round} Q ${edge} ${ceiling} ${edge + round} ${ceiling} Z`);
    return;
  }
  let composer: HTMLElement | undefined;
  let composerRect: DOMRect | undefined;
  for (const candidate of [...composers].reverse()) {
    const rect = candidate.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && getComputedStyle(candidate).visibility !== 'hidden') {
      composer = candidate; composerRect = rect; break;
    }
  }
  if (!composer || !composerRect) return;
  const main = sharedMain, header = sharedHeader;
  const { width, height } = composerRect;
  if (!width || !height) return;
  const flare = Number.parseFloat(getComputedStyle(composer).getPropertyValue('--composer-flare')) || 34;
  const w = width + flare * 2, bottom = height - 7.5, left = flare + .5, right = flare + width - .5, top = .5, radius = 16;
  const k = .5522847498307936, shoulder = bottom - flare;
  const d = `M ${left - flare} ${bottom} C ${left - flare + k * flare} ${bottom}, ${left} ${shoulder + k * flare}, ${left} ${shoulder} L ${left} ${radius + top} Q ${left} ${top}, ${left + radius} ${top} L ${right - radius} ${top} Q ${right} ${top}, ${right} ${radius + top} L ${right} ${shoulder} C ${right} ${shoulder + k * flare}, ${right + flare - k * flare} ${bottom}, ${right + flare} ${bottom}`;
  const composerSvg = composer.querySelector<SVGSVGElement>(':scope > .composer-frame');
  if (composerSvg) {
    const fill = composerSvg.querySelector<SVGPathElement>('.composer-frame-fill');
    const outline = composerSvg.querySelector<SVGPathElement>('.composer-frame-outline');
    composerSvg.setAttribute('viewBox', `0 0 ${w} ${height}`);
    fill?.setAttribute('d', `${d} L ${w} ${height + 1} L 0 ${height + 1} Z`);
    outline?.setAttribute('d', `M ${left + radius + 4} ${top} L ${right - radius - 4} ${top}`);
    const lowerOutline = composerSvg.querySelector<SVGPathElement>('.composer-frame-side-outline');
    lowerOutline?.setAttribute('d', `M ${left - flare} ${bottom} C ${left - flare + k * flare} ${bottom}, ${left} ${shoulder + k * flare}, ${left} ${shoulder} M ${right} ${shoulder} C ${right} ${shoulder + k * flare}, ${right + flare - k * flare} ${bottom}, ${right + flare} ${bottom}`);
  }
  const mainRect = main.getBoundingClientRect(), shellWidth = mainRect.width, shellHeight = mainRect.height;
  const edge = .5, far = shellWidth - .5, floor = shellHeight - 7.5;
  const ceiling = header.getBoundingClientRect().bottom - mainRect.top;
  const round = Math.min(24, (far - edge) / 4), lowerRound = Math.min(22, round);
  const dockLeft = composerRect.left - mainRect.left + .5, dockRight = composerRect.right - mainRect.left - .5;
  const dockTop = composerRect.top - mainRect.top + .5, dockShoulder = floor - flare;
  const boundary = `M ${edge + round} ${ceiling} L ${far - round} ${ceiling} Q ${far} ${ceiling} ${far} ${ceiling + round} L ${far} ${floor - lowerRound} Q ${far} ${floor} ${far - lowerRound} ${floor} L ${dockRight + flare} ${floor} C ${dockRight + flare - k * flare} ${floor}, ${dockRight} ${dockShoulder + k * flare}, ${dockRight} ${dockShoulder} L ${dockRight} ${dockTop + radius} Q ${dockRight} ${dockTop}, ${dockRight - radius} ${dockTop} L ${dockLeft + radius} ${dockTop} Q ${dockLeft} ${dockTop}, ${dockLeft} ${dockTop + radius} L ${dockLeft} ${dockShoulder} C ${dockLeft} ${dockShoulder + k * flare}, ${dockLeft - flare + k * flare} ${floor}, ${dockLeft - flare} ${floor} L ${edge + lowerRound} ${floor} Q ${edge} ${floor} ${edge} ${floor - lowerRound} L ${edge} ${ceiling + round} Q ${edge} ${ceiling} ${edge + round} ${ceiling} Z`;
  shellSvg.setAttribute('viewBox', `0 0 ${shellWidth} ${shellHeight}`);
  shellSurface.setAttribute('d', boundary);
}

export function installComposerFrame(composer: HTMLElement) {
  if (!composer.querySelector(':scope > .composer-frame')) {
    const svg = document.createElementNS(ns, 'svg'); svg.classList.add('composer-frame'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    const fill = document.createElementNS(ns, 'path'); fill.classList.add('composer-frame-fill');
    const outline = document.createElementNS(ns, 'path'); outline.classList.add('composer-frame-outline'); svg.append(fill, outline); composer.prepend(svg);
    const lowerOutline = document.createElementNS(ns, 'path'); lowerOutline.classList.add('composer-frame-side-outline'); svg.append(lowerOutline);
  }
  composers.delete(composer); composers.add(composer);
  if (!sharedMain) {
    sharedMain = composer.closest<HTMLElement>('.main')!;
    sharedHeader = sharedMain.querySelector<HTMLElement>('.header')!;
    shellSvg = sharedMain.querySelector<SVGSVGElement>(':scope > .chat-shell-frame') ?? document.createElementNS(ns, 'svg');
    shellSvg.classList.add('chat-shell-frame'); shellSvg.setAttribute('aria-hidden', 'true'); shellSvg.setAttribute('focusable', 'false');
    shellSurface = shellSvg.querySelector<SVGPathElement>('.chat-shell-surface') ?? document.createElementNS(ns, 'path');
    shellSurface.classList.add('chat-shell-surface');
    if (!shellSurface.parentElement) shellSvg.append(shellSurface);
    if (!shellSvg.parentElement) sharedMain.prepend(shellSvg);
    resizeObserver.observe(sharedMain); if (sharedHeader) resizeObserver.observe(sharedHeader);
    mutationObserver.observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ['hidden','class','style'] });
  }
  resizeObserver.observe(composer);
  scheduleDraw();
}
