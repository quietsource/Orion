import { parseOgs, type OgsGraph } from '../shared/ogs';
import './ogs.css';

const NS = 'http://www.w3.org/2000/svg';
const colors = ['#a69aff', '#63cabb', '#f0b875', '#eb92b0', '#78b5ef', '#b8cf7a'];
const expandedData = new Set<string>();
type Point = { x: number; y: number };
function element<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number> = {}, content?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (content !== undefined) node.textContent = content;
  return node;
}
function svgRoot(width: number, height: number, title: string) {
  const svg = element('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': title, xmlns: NS });
  svg.append(element('title', {}, title)); return svg;
}
const compact = (value: number) => new Intl.NumberFormat(undefined, { notation: Math.abs(value) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 3 }).format(value);
function label(svg: SVGElement, x: number, y: number, value: string, options: Record<string, string | number> = {}) {
  const text = element('text', { x, y, fill: 'var(--ogs-ink)', 'font-size': 12, ...options }, value); svg.append(text); return text;
}
function wrappedLabel(svg: SVGElement, x: number, y: number, value: string, length: number, options: Record<string, string | number> = {}, maxLines = 3) {
  const words = value.split(/\s+/), lines: string[] = []; let line = '';
  for (const word of words) {
    const parts = word.match(new RegExp(`.{1,${length}}`, 'gu')) ?? [word];
    for (const part of parts) { if (line && line.length + part.length + 1 > length) { lines.push(line); line = ''; } line += `${line ? ' ' : ''}${part}`; }
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, maxLines); if (lines.length > maxLines) shown[maxLines - 1] = shown[maxLines - 1]!.slice(0, length - 1) + '…';
  const text = element('text', { x, y, fill: 'var(--ogs-ink)', 'font-size': 12, ...options });
  shown.forEach((value, index) => text.append(element('tspan', { x, dy: index ? 15 : 0 }, value)));
  text.append(element('title', {}, value)); svg.append(text); return text;
}
function titled<T extends SVGElement>(node: T, title: string): T { node.append(element('title', {}, title)); return node; }
function legend(graph: OgsGraph) {
  const list = document.createElement('div'); list.className = 'ogs-legend';
  const names = graph.type === 'pie' ? graph.labels : graph.type === 'venn' ? graph.sets.map(set => set.label) : graph.series.map(series => series.name);
  names.forEach((name, index) => { const item = document.createElement('span'), dot = document.createElement('i'); dot.style.background = colors[index % colors.length]!; item.append(dot, name); list.append(item); }); return list;
}
function cartesian(graph: OgsGraph) {
  const W = Math.max(860, graph.labels.length * (graph.type === 'bar' ? Math.max(46, graph.series.length * 19) : 38) + 130), H = 390;
  const svg = svgRoot(W, H, graph.title), left = 76, right = W - 30, top = 28, bottom = H - 92, values = graph.series.flatMap(series => series.values);
  let min = graph.type === 'bar' ? Math.min(0, ...values) : Math.min(...values), max = Math.max(0, ...values);
  if (min === max) { const span = Math.max(1e-9, Math.abs(min) * .1, min === 0 ? 1 : 0); min -= span; max += span; }
  const padding = (max - min) * .08; if (max > 0) max += padding; if (min < 0) min -= padding;
  const y = (value: number) => bottom - (value - min) / (max - min) * (bottom - top);
  const slot = (right - left) / graph.labels.length, x = (index: number) => left + slot * (index + .5);
  for (let tick = 0; tick <= 4; tick++) {
    const value = min + (max - min) * tick / 4, yy = y(value);
    svg.append(element('line', { x1: left, x2: right, y1: yy, y2: yy, stroke: 'var(--ogs-grid)', 'stroke-dasharray': '3 5' }));
    label(svg, left - 12, yy + 4, compact(value), { 'text-anchor': 'end', fill: 'var(--ogs-muted)', 'font-size': 11 });
  }
  if (min <= 0 && max >= 0) svg.append(element('line', { x1: left, x2: right, y1: y(0), y2: y(0), stroke: 'var(--ogs-grid)' }));
  graph.labels.forEach((value, index) => wrappedLabel(svg, x(index), bottom + 24, value, Math.max(5, Math.floor(slot / 6)), { 'text-anchor': 'middle', fill: 'var(--ogs-muted)', 'font-size': 11 }));
  graph.series.forEach((series, index) => {
    const color = colors[index % colors.length]!;
    if (graph.type === 'bar') {
      const width = Math.min(42, slot * .72 / graph.series.length), offset = graph.series.length * width / 2;
      series.values.forEach((value, i) => {
        const bar = element('rect', { x: x(i) - offset + index * width + 1, y: Math.min(y(0), y(value)), width: Math.max(1, width - 3), height: Math.max(1, Math.abs(y(value) - y(0))), rx: 4, fill: color, opacity: .9, class: 'ogs-mark', tabindex: 0 });
        svg.append(titled(bar, `${graph.labels[i]} · ${series.name}: ${value}${graph.unit ? ` ${graph.unit}` : ''}`));
      });
    } else {
      svg.append(element('polyline', { points: series.values.map((value, i) => `${x(i)},${y(value)}`).join(' '), fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      series.values.forEach((value, i) => svg.append(titled(element('circle', { cx: x(i), cy: y(value), r: 4.5, fill: color, stroke: 'var(--ogs-surface)', 'stroke-width': 2, tabindex: 0, class: 'ogs-mark' }), `${graph.labels[i]} · ${series.name}: ${value}${graph.unit ? ` ${graph.unit}` : ''}`)));
    }
  });
  if (graph.unit) label(svg, left, 14, graph.unit, { fill: 'var(--ogs-muted)', 'font-size': 11 });
  return svg;
}
function pie(graph: OgsGraph) {
  const svg = svgRoot(860, 370, graph.title), cx = 255, cy = 183, r = 136, inner = 87, values = graph.series[0]!.values, total = values.reduce((a, b) => a + b, 0);
  let angle = -Math.PI / 2;
  values.forEach((value, index) => {
    const next = angle + value / total * Math.PI * 2, color = colors[index % colors.length]!;
    if (value > 0) {
      const point = (a: number, radius: number) => `${cx + Math.cos(a) * radius},${cy + Math.sin(a) * radius}`;
      const end = Math.min(next, angle + Math.PI * 2 - 0.00001), large = end - angle > Math.PI ? 1 : 0;
      const path = `M${point(angle, r)} A${r},${r} 0 ${large} 1 ${point(end, r)} L${point(end, inner)} A${inner},${inner} 0 ${large} 0 ${point(angle, inner)} Z`;
      svg.append(titled(element('path', { d: path, fill: color, stroke: 'var(--ogs-surface)', 'stroke-width': 3, tabindex: 0, class: 'ogs-mark' }), `${graph.labels[index]}: ${value} (${(value / total * 100).toFixed(1)}%)`));
    }
    angle = next;
  });
  label(svg, cx, cy - 3, compact(total), { 'font-size': 30, 'font-weight': 600, 'text-anchor': 'middle' });
  wrappedLabel(svg, cx, cy + 24, graph.unit || graph.series[0]!.name, 20, { 'text-anchor': 'middle', fill: 'var(--ogs-muted)' }, 2);
  // A complete value table below the chart retains all categories, including zero slices.
  const ranked = values.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value).slice(0, 8);
  ranked.forEach(({ value, index }, row) => {
    const y = 53 + row * 36;
    svg.append(element('circle', { cx: 463, cy: y - 4, r: 4, fill: colors[index % colors.length]! }));
    wrappedLabel(svg, 478, y, graph.labels[index]!, 27, {}, 1);
    label(svg, 810, y, `${(value / total * 100).toFixed(1)}%`, { 'text-anchor': 'end', fill: 'var(--ogs-muted)' });
  });
  if (values.length > 8) label(svg, 478, 350, `All ${values.length} categories in the data table`, { 'font-size': 11, fill: 'var(--ogs-muted)' });
  return svg;
}
function radar(graph: OgsGraph) {
  const svg = svgRoot(860, 420, graph.title), cx = 430, cy = 205, radius = 142, count = graph.labels.length, max = Math.max(1, ...graph.series.flatMap(series => series.values));
  const point = (index: number, value: number): Point => { const angle = index / count * 2 * Math.PI - Math.PI / 2; return { x: cx + Math.cos(angle) * radius * value / max, y: cy + Math.sin(angle) * radius * value / max }; };
  for (let ring = 1; ring <= 4; ring++) {
    svg.append(element('polygon', { points: graph.labels.map((_, index) => { const p = point(index, max * ring / 4); return `${p.x},${p.y}`; }).join(' '), fill: 'none', stroke: 'var(--ogs-grid)' }));
    label(svg, cx + 6, cy - radius * ring / 4 + 4, compact(max * ring / 4), { 'font-size': 10, fill: 'var(--ogs-muted)' });
  }
  graph.labels.forEach((value, index) => {
    const p = point(index, max), text = point(index, max * 1.2);
    svg.append(element('line', { x1: cx, y1: cy, x2: p.x, y2: p.y, stroke: 'var(--ogs-grid)' }));
    wrappedLabel(svg, text.x, text.y, value, 20, { 'text-anchor': Math.abs(text.x - cx) < 5 ? 'middle' : text.x < cx ? 'end' : 'start', 'font-size': 11 }, 2);
  });
  graph.series.forEach((series, index) => {
    const color = colors[index % colors.length]!;
    svg.append(element('polygon', { points: series.values.map((value, i) => { const p = point(i, value); return `${p.x},${p.y}`; }).join(' '), fill: color, 'fill-opacity': .12, stroke: color, 'stroke-width': 2 }));
    series.values.forEach((value, i) => { const p = point(i, value); svg.append(titled(element('circle', { cx: p.x, cy: p.y, r: 4, fill: color, class: 'ogs-mark', tabindex: 0 }), `${graph.labels[i]} · ${series.name}: ${value}${graph.unit ? ` ${graph.unit}` : ''}`)); });
  });
  return svg;
}
function venn(graph: OgsGraph) {
  const svg = svgRoot(860, graph.sets.length === 3 ? 480 : 350, graph.title), three = graph.sets.length === 3;
  const centers: Point[] = three ? [{ x: 350, y: 177 }, { x: 510, y: 177 }, { x: 430, y: 302 }] : [{ x: 352, y: 165 }, { x: 508, y: 165 }];
  graph.sets.forEach((set, index) => {
    const center = centers[index]!, color = colors[index]!;
    svg.append(titled(element('circle', { cx: center.x, cy: center.y, r: three ? 132 : 136, fill: color, 'fill-opacity': .14, stroke: color, 'stroke-opacity': .7, 'stroke-width': 1.5 }), `${set.label}${set.value === undefined ? '' : `: ${set.value}`}`));
    const x = index === 0 ? center.x - 66 : index === 1 ? center.x + 66 : center.x, y = index === 2 ? center.y + 70 : center.y - (three ? 36 : 8);
    wrappedLabel(svg, x, y, set.label, 16, { 'text-anchor': 'middle', 'font-weight': 500 }, 2);
    if (set.value !== undefined) label(svg, x, y + 38, compact(set.value), { 'text-anchor': 'middle', fill: 'var(--ogs-muted)' });
  });
  graph.overlaps.forEach(overlap => {
    const key = [...overlap.sets].sort().join('');
    const positions: Record<string, Point> = three ? { '01': { x: 430, y: 120 }, '02': { x: 350, y: 280 }, '12': { x: 510, y: 280 }, '012': { x: 430, y: 220 } } : { '01': { x: 430, y: 165 } };
    const p = positions[key]!; wrappedLabel(svg, p.x, p.y, overlap.label, 12, { 'text-anchor': 'middle', 'font-size': 11 }, 3);
  });
  label(svg, 430, three ? 465 : 338, 'Conceptual overlap · circle areas are not proportional', { 'text-anchor': 'middle', fill: 'var(--ogs-muted)', 'font-size': 10 });
  return svg;
}
function network(graph: OgsGraph) {
  const ranks = new Map(graph.nodes.map(node => [node.id, 0])), incoming = new Map(graph.nodes.map(node => [node.id, 0]));
  for (const [, to] of graph.edges) incoming.set(to, incoming.get(to)! + 1);
  const queue = graph.nodes.filter(node => incoming.get(node.id) === 0).map(node => node.id); let visited = 0;
  while (queue.length) {
    const id = queue.shift()!; visited++;
    for (const [from, to] of graph.edges) if (from === id) { ranks.set(to, Math.max(ranks.get(to)!, ranks.get(from)! + 1)); incoming.set(to, incoming.get(to)! - 1); if (incoming.get(to) === 0) queue.push(to); }
  }
  const radial = graph.type === 'mesh' || visited !== graph.nodes.length, positions = new Map<string, Point>();
  let W = 860, H = 350;
  if (radial) {
    const ringCount = Math.max(1, Math.ceil(Math.max(0, graph.nodes.length - 1) / 10));
    W = Math.max(860, (300 + (ringCount - 1) * 240) * 2 + 220); H = Math.max(390, (250 + (ringCount - 1) * 200) * 2 + 130);
    graph.nodes.forEach((node, index) => {
      if (index === 0) positions.set(node.id, { x: W / 2, y: H / 2 });
      else { const ring = Math.floor((index - 1) / 10) + 1, within = (index - 1) % 10, size = Math.min(10, graph.nodes.length - 1 - (ring - 1) * 10), angle = within / size * Math.PI * 2 - Math.PI / 2;
        positions.set(node.id, { x: W / 2 + Math.cos(angle) * (300 + (ring - 1) * 240), y: H / 2 + Math.sin(angle) * (250 + (ring - 1) * 200) }); }
    });
  } else {
    const columns = Math.min(6, Math.max(...ranks.values()) + 1), rows: string[][] = Array.from({ length: columns }, () => []);
    graph.nodes.forEach(node => rows[ranks.get(node.id)! % columns]!.push(node.id));
    W = Math.max(860, columns * 224 + 50); H = Math.max(330, Math.max(...rows.map(row => row.length)) * 110 + 54);
    rows.forEach((row, column) => row.forEach((id, index) => positions.set(id, { x: 112 + column * 224, y: (H - (row.length - 1) * 110) / 2 + index * 110 })));
  }
  const svg = svgRoot(W, H, graph.title);
  const edgeLayer = element('g'), nodeLayer = element('g'); svg.append(edgeLayer, nodeLayer);
  graph.edges.forEach(([from, to, caption]) => {
    const a = positions.get(from)!, b = positions.get(to)!;
    if (from === to) {
      edgeLayer.append(titled(element('path', { d: `M${a.x + 55} ${a.y - 27} C${a.x + 145} ${a.y - 100},${a.x + 145} ${a.y + 90},${a.x + 78} ${a.y + 18}`, fill: 'none', stroke: 'var(--ogs-link)', 'stroke-width': 1.6 }), caption || `${from} → ${to}`)); return;
    }
    const dx = b.x - a.x, dy = b.y - a.y, scaleA = 1 / Math.max(Math.abs(dx) / 87, Math.abs(dy) / 37), scaleB = 1 / Math.max(Math.abs(dx) / 92, Math.abs(dy) / 42);
    const start = { x: a.x + dx * scaleA, y: a.y + dy * scaleA }, end = { x: b.x - dx * scaleB, y: b.y - dy * scaleB }, bend = Math.max(24, Math.abs(end.x - start.x) * .45);
    edgeLayer.append(titled(element('path', { d: radial ? `M${start.x},${start.y} L${end.x},${end.y}` : `M${start.x},${start.y} C${start.x + bend},${start.y} ${end.x - bend},${end.y} ${end.x},${end.y}`, fill: 'none', stroke: 'var(--ogs-link)', 'stroke-width': 1.6 }), caption || `${from} → ${to}`));
    if (graph.type === 'diagram') {
      const angle = radial ? Math.atan2(dy, dx) : 0;
      const tip = `${end.x},${end.y}`, left = `${end.x - Math.cos(angle - .5) * 9},${end.y - Math.sin(angle - .5) * 9}`, right = `${end.x - Math.cos(angle + .5) * 9},${end.y - Math.sin(angle + .5) * 9}`;
      edgeLayer.append(element('polygon', { points: `${tip} ${left} ${right}`, fill: 'var(--ogs-link)' }));
    }
    if (caption) {
      const x = (start.x + end.x) / 2, y = (start.y + end.y) / 2;
      edgeLayer.append(element('rect', { x: x - 54, y: y - 11, width: 108, height: 22, rx: 7, fill: 'var(--ogs-surface)' }));
      wrappedLabel(edgeLayer, x, y + 4, caption, 16, { 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--ogs-muted)' }, 1);
    }
  });
  graph.nodes.forEach((node, index) => {
    const p = positions.get(node.id)!, color = colors[index % colors.length]!, group = element('g', { class: 'ogs-node', tabindex: 0 });
    group.append(element('title', {}, `${node.label}${node.detail ? `: ${node.detail}` : ''}`));
    group.append(element('rect', { x: p.x - 86, y: p.y - 36, width: 172, height: 72, rx: 13, fill: 'var(--ogs-surface)', stroke: color, 'stroke-opacity': .48 }));
    group.append(element('rect', { x: p.x - 85, y: p.y - 17, width: 3, height: 34, rx: 2, fill: color, opacity: .9 }));
    wrappedLabel(group, p.x, p.y - (node.detail ? 9 : 3), node.label, 22, { 'text-anchor': 'middle', 'font-weight': 500 }, 2);
    if (node.detail) wrappedLabel(group, p.x, p.y + 22, node.detail, 26, { 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--ogs-muted)' }, 1);
    nodeLayer.append(group);
  });
  return svg;
}
function dataTable(graph: OgsGraph) {
  const details = document.createElement('details'); details.className = 'ogs-data';
  const summary = document.createElement('summary'); summary.textContent = 'View data'; details.append(summary);
  const table = document.createElement('table'), head = document.createElement('tr');
  const cell = (row: HTMLTableRowElement, tag: 'td' | 'th', value: string) => { const node = document.createElement(tag); node.textContent = value; row.append(node); };
  if (graph.series.length) {
    cell(head, 'th', graph.unit ? `Label · ${graph.unit}` : 'Label'); graph.series.forEach(series => cell(head, 'th', series.name));
    const thead = document.createElement('thead'); thead.append(head); table.append(thead);
    const body = document.createElement('tbody'); graph.labels.forEach((name, index) => { const row = document.createElement('tr'); cell(row, 'td', name); graph.series.forEach(series => cell(row, 'td', String(series.values[index]))); body.append(row); }); table.append(body);
  } else if (graph.sets.length) {
    graph.sets.forEach(set => { const row = document.createElement('tr'); cell(row, 'td', set.label); cell(row, 'td', set.value === undefined ? 'Not specified' : String(set.value)); table.append(row); });
    graph.overlaps.forEach(overlap => { const row = document.createElement('tr'); cell(row, 'td', overlap.sets.map(index => graph.sets[index]!.label).join(' ∩ ')); cell(row, 'td', overlap.label); table.append(row); });
  } else {
    graph.nodes.forEach(node => { const row = document.createElement('tr'); cell(row, 'td', node.id); cell(row, 'td', node.label + (node.detail ? ` — ${node.detail}` : '')); table.append(row); });
    graph.edges.forEach(([from, to, label]) => { const row = document.createElement('tr'); cell(row, 'td', `${from} → ${to}`); cell(row, 'td', label || 'Connection'); table.append(row); });
  }
  details.append(table); return details;
}
export function renderOgs(source: string, streaming: boolean) {
  const figure = document.createElement('figure'); figure.className = 'ogs-figure'; figure.dataset.ogsSource = source;
  try {
    const graph = parseOgs(source), header = document.createElement('figcaption'), heading = document.createElement('div'), eyebrow = document.createElement('span'), title = document.createElement('strong');
    header.className = 'ogs-header'; eyebrow.className = 'ogs-eyebrow'; eyebrow.textContent = `ORION GRAPH SYSTEM · ${graph.type}`; title.textContent = graph.title; heading.append(eyebrow, title);
    if (graph.description) { const description = document.createElement('p'); description.textContent = graph.description; heading.append(description); }
    const actions = document.createElement('div'); actions.className = 'ogs-actions';
    for (const [action, text] of [['copy', 'Copy OGS'], ['export', 'Save SVG']]) { const button = document.createElement('button'); button.type = 'button'; button.dataset.ogsAction = action; button.textContent = text!; actions.append(button); }
    header.append(heading, actions); figure.append(header);
    const viewport = document.createElement('div'); viewport.className = 'ogs-viewport'; viewport.tabIndex = 0; viewport.setAttribute('aria-label', 'Graph; scroll horizontally for large diagrams');
    const svg = graph.type === 'diagram' || graph.type === 'mesh' ? network(graph) : graph.type === 'pie' ? pie(graph) : graph.type === 'radar' ? radar(graph) : graph.type === 'venn' ? venn(graph) : cartesian(graph);
    const width = Number(svg.viewBox.baseVal.width || svg.getAttribute('viewBox')!.split(' ')[2]);
    if (width > 1000) svg.style.minWidth = `${width}px`;
    const data = dataTable(graph); data.open = expandedData.has(source);
    viewport.append(svg); figure.append(viewport, legend(graph), data);
  } catch (error) {
    figure.classList.add(streaming ? 'ogs-pending' : 'ogs-invalid');
    const title = document.createElement('strong'); title.textContent = streaming ? 'Drawing graph…' : 'This graph needs a correction';
    const detail = document.createElement('p'); detail.textContent = streaming ? 'Orion is receiving the graph’s data and relationships.' : error instanceof Error ? error.message : String(error);
    figure.append(title, detail);
    if (!streaming) { const sourceView = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre'); summary.textContent = 'View OGS source'; pre.textContent = source.slice(0, 60_000); sourceView.append(summary, pre); figure.append(sourceView); }
  }
  return figure;
}
export function hydrateOgs(root: DocumentFragment, streaming: boolean) {
  root.querySelectorAll<HTMLElement>('[data-ogs]').forEach(node => {
    try { node.replaceWith(renderOgs(decodeURIComponent(node.dataset.ogs ?? ''), streaming)); }
    catch { node.textContent = 'The graph source could not be read.'; }
  });
}
export function installOgsActions() {
  document.addEventListener('toggle', event => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement) || !details.classList.contains('ogs-data')) return;
    const source = details.closest<HTMLElement>('.ogs-figure')?.dataset.ogsSource;
    if (!source) return;
    if (details.open) { expandedData.add(source); if (expandedData.size > 64) expandedData.delete(expandedData.values().next().value!); }
    else expandedData.delete(source);
  }, true);
  document.addEventListener('click', async event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-ogs-action]'), figure = button?.closest<HTMLElement>('.ogs-figure');
    if (!button || !figure) return;
    try {
      if (button.dataset.ogsAction === 'copy') { await navigator.clipboard.writeText(figure.dataset.ogsSource ?? ''); button.textContent = 'Copied'; setTimeout(() => { if (button.isConnected) button.textContent = 'Copy OGS'; }, 1400); return; }
      const svg = figure.querySelector('svg'); if (!svg) return;
      const exported = svg.cloneNode(true) as SVGSVGElement, style = getComputedStyle(svg);
      for (const name of ['--ogs-ink', '--ogs-muted', '--ogs-grid', '--ogs-surface', '--ogs-link']) exported.style.setProperty(name, style.getPropertyValue(name));
      exported.style.fontFamily = 'system-ui, sans-serif'; exported.style.background = style.getPropertyValue('--ogs-surface');
      exported.setAttribute('width', svg.viewBox.baseVal.width.toString()); exported.setAttribute('height', svg.viewBox.baseVal.height.toString());
      const blob = new Blob([new XMLSerializer().serializeToString(exported)], { type: 'image/svg+xml;charset=utf-8' }), url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${(figure.querySelector('strong')?.textContent || 'orion-graph').replace(/[^\w -]/g, '').slice(0, 80) || 'orion-graph'}.svg`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { button.textContent = 'Try again'; }
  });
}
