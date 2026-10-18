/** A shared Bezier boundary prevents seams between the input and its lower flares. */
export function installComposerFrame(composer: HTMLElement) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.classList.add('composer-frame'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  const fill = document.createElementNS(ns, 'path'); fill.classList.add('composer-frame-fill');
  const outline = document.createElementNS(ns, 'path'); outline.classList.add('composer-frame-outline');
  svg.append(fill, outline); composer.prepend(svg);
  let queued = false;
  const draw = () => {
    queued = false;
    const { width, height } = composer.getBoundingClientRect(); if (!width || !height) return;
    const flare = Number.parseFloat(getComputedStyle(composer).getPropertyValue('--composer-flare')) || 34;
    const w = width + flare * 2, bottom = height + .5, left = flare + .5, right = flare + width - .5, top = .5, radius = 16;
    // Exact cubic quarter-circles have matching tangents at the upright sides.
    const k = .5522847498307936, shoulder = bottom - flare;
    const d = `M ${left - flare} ${bottom} C ${left - flare + k * flare} ${bottom}, ${left} ${shoulder + k * flare}, ${left} ${shoulder} L ${left} ${radius + top} Q ${left} ${top}, ${left + radius} ${top} L ${right - radius} ${top} Q ${right} ${top}, ${right} ${radius + top} L ${right} ${shoulder} C ${right} ${shoulder + k * flare}, ${right + flare - k * flare} ${bottom}, ${right + flare} ${bottom}`;
    svg.setAttribute('viewBox', `0 0 ${w} ${height}`);
    fill.setAttribute('d', `${d} L ${w} ${height + 1} L 0 ${height + 1} Z`);
    outline.setAttribute('d', d);
  };
  const observer = new ResizeObserver(() => { if (!queued) { queued = true; requestAnimationFrame(draw); } });
  observer.observe(composer); draw();
}
