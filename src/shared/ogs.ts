/** Orion Graph System v1: data and relationships, never executable markup. */
export const OGS_TYPES = ['diagram', 'mesh', 'line', 'bar', 'pie', 'radar', 'venn'] as const;
export type OgsType = typeof OGS_TYPES[number];
export interface OgsNode { id: string; label: string; detail?: string }
export interface OgsSeries { name: string; values: number[] }
export interface OgsGraph {
  type: OgsType; title: string; description?: string; unit?: string;
  labels: string[]; series: OgsSeries[]; nodes: OgsNode[]; edges: Array<[string, string, string?]>;
  sets: Array<{ label: string; value?: number }>; overlaps: Array<{ sets: number[]; label: string }>;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.');
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, optional = false): string {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > 240) throw new Error(`${field} must be text between 1 and 240 characters.`);
  return value.trim();
}
function array(value: unknown, field: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${field} needs ${min}–${max} items.`);
  return value;
}
function number(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) throw new Error(`${field} must be a finite number between -1 trillion and 1 trillion.`);
  return value;
}
export function parseOgs(source: string): OgsGraph {
  if (source.length > 60_000) throw new Error('OGS blocks must be smaller than 60 KB. Split large graphs into focused views.');
  let input: Record<string, unknown>;
  try { input = record(JSON.parse(source)); } catch (error) { throw new Error(error instanceof SyntaxError ? 'Use valid JSON: quote keys and text, and omit trailing commas.' : String(error)); }
  const type = input.type as OgsType;
  if (!OGS_TYPES.includes(type)) throw new Error(`type must be ${OGS_TYPES.join(', ')}.`);
  const graph: OgsGraph = { type, title: text(input.title, 'title'), description: text(input.description, 'description', true), unit: text(input.unit, 'unit', true), labels: [], series: [], nodes: [], edges: [], sets: [], overlaps: [] };
  if (type === 'diagram' || type === 'mesh') {
    graph.nodes = array(input.nodes, 'nodes', 1, 48).map((item, index) => {
      if (typeof item === 'string') return { id: text(item, `nodes[${index}]`), label: item };
      const node = record(item); return { id: text(node.id, 'node.id'), label: text(node.label ?? node.id, 'node.label'), detail: text(node.detail, 'node.detail', true) };
    });
    const ids = new Set(graph.nodes.map(node => node.id));
    if (ids.size !== graph.nodes.length) throw new Error('Each node needs a unique id.');
    graph.edges = array(input.edges ?? [], 'edges', 0, 96).map(item => {
      const edge = array(item, 'edge', 2, 3), from = text(edge[0], 'edge source'), to = text(edge[1], 'edge destination');
      if (!ids.has(from) || !ids.has(to)) throw new Error(`Edge ${from} → ${to} references a missing node.`);
      return [from, to, edge[2] === undefined ? undefined : text(edge[2], 'edge label')];
    });
  } else if (type === 'venn') {
    graph.sets = array(input.sets, 'sets', 2, 3).map(item => {
      if (typeof item === 'string') return { label: text(item, 'set label') };
      const set = record(item), value = set.value === undefined ? undefined : number(set.value, 'set value');
      if (value !== undefined && value < 0) throw new Error('Set values cannot be negative.');
      return { label: text(set.label, 'set label'), value };
    });
    graph.overlaps = array(input.overlaps ?? [], 'overlaps', 0, 4).map(item => {
      const overlap = record(item), indices = array(overlap.sets, 'overlap sets', 2, graph.sets.length).map(index => number(index, 'set index'));
      if (indices.some(index => !Number.isInteger(index) || index < 0 || index >= graph.sets.length) || new Set(indices).size !== indices.length) throw new Error('Overlap sets use distinct zero-based set indices.');
      return { sets: indices, label: text(overlap.label, 'overlap label') };
    });
    if (new Set(graph.overlaps.map(overlap => [...overlap.sets].sort().join(','))).size !== graph.overlaps.length) throw new Error('Describe each overlap once.');
  } else {
    graph.labels = array(input.labels, 'labels', type === 'radar' ? 3 : 1, type === 'radar' ? 12 : 32).map(label => text(label, 'label'));
    graph.series = array(input.series, 'series', 1, type === 'pie' ? 1 : 6).map(item => {
      const series = record(item), values = array(series.values, 'series.values', graph.labels.length, graph.labels.length).map(value => number(value, 'series value'));
      return { name: text(series.name, 'series.name'), values };
    });
    if ((type === 'pie' || type === 'radar') && graph.series.some(series => series.values.some(value => value < 0))) throw new Error(`${type} values cannot be negative.`);
    if (type === 'pie' && graph.series[0]!.values.reduce((a, b) => a + b, 0) <= 0) throw new Error('A pie chart needs a positive total.');
  }
  return graph;
}

// Small shared grammar: keep model instructions and renderer capabilities aligned.
export const OGS_PROMPT = `<orion_graph_system>
For diagrams and data visualizations, use Orion Graph System (OGS), rendered natively in chat. Write a fenced code block with language ogs containing one JSON object. Describe data and connections; Orion handles layout, colors, labels, and interaction. Use it when a visual helps answer the user's request. Supply real provided data or clearly label illustrative data. Explain the takeaway briefly outside the block. Never call create_image for an OGS visual.
Every graph has "type", "title", and optional "description". Supported types and exact fields:
- diagram or mesh: "nodes":["id",{"id":"b","label":"Display text","detail":"Optional detail"}], "edges":[["id","b","optional label"]]. Diagram lays out directed steps; mesh arranges a network. Reference existing node ids only. Max 48 nodes / 96 edges.
- line, bar, pie, radar: "labels":["A","B"], "series":[{"name":"Series","values":[10,20]}], optional "unit":"ms". Each series needs one finite number per label. Max 32 labels / 6 series. Pie uses exactly one series with nonnegative values and a positive total. Radar (spider chart) uses 3–12 labels and nonnegative values on a shared scale.
- venn: "sets":["A","B"], optional "overlaps":[{"sets":[0,1],"label":"Shared items"}]. Use 2–3 sets. Set objects may include "label" and numeric "value". Overlaps use zero-based indices. Venn circles show conceptual relationships, not proportional areas.
Example:
\`\`\`ogs
{"type":"bar","title":"Illustrative latency","unit":"ms","labels":["Before","After"],"series":[{"name":"Latency","values":[120,65]}]}
\`\`\`
Use JSON with quoted keys, double-quoted strings, and no comments or trailing commas. The ogs block is the visual itself; no separate rendering tool is required.
</orion_graph_system>`;
