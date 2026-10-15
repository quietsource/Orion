import type { ExtractedKnowledge, MemoryType } from './ofs';

export const OFS_ENCODING_VERSION = 'distributed-local-v1';
export const OFS_DIMENSIONS = 1024;
const ignored = new Set('a an the is are was were be been being to of for on in at by with from and or but that this these those it its as do does did what which who how when where why can could would should please tell me about my i you your we our have has had'.split(' '));
// A small, explicit concept vocabulary, not a trained model or downloaded dictionary.
const concepts = new Map<string, string>();
for (const group of [
  'prefer prefers preference favorite favourite like likes enjoy enjoys',
  'dislike dislikes hate hates avoid avoids', 'live lives living reside resides residence home',
  'work works working job employment occupation', 'buy bought purchase purchased shopping',
  'car cars automobile vehicle vehicles', 'phone phones mobile smartphone',
  'fast faster speed performance latency quick efficient efficiency',
  'memory memories remember recall remembered', 'setting settings configure configuration',
  'build builds building compile compiled compilation', 'error errors failure failed broken',
  'close closed closing quit exit shutdown', 'model models llm llms',
  'project projects repository repo repositories', 'use uses using used',
  'need needs require required requires', 'want wants wish wishes',
  'plan plans planned planning intend intention', 'cost costs price prices budget',
  'dog dogs canine', 'cat cats feline', 'food foods meal meals',
  'vegetarian meatless', 'vegan plantbased', 'allergy allergies allergic',
  'name named called', 'birthday birthdate born', 'address location located',
]) { const words = group.split(' '); for (const word of words) concepts.set(word, words[0]!); }

function hash(value: string): number {
  let state = 2166136261;
  for (let i = 0; i < value.length; i++) state = Math.imul(state ^ value.charCodeAt(i), 16777619);
  return state >>> 0;
}
function mix(value: number): number {
  value = Math.imul(value ^ value >>> 16, 0x7feb352d);
  value = Math.imul(value ^ value >>> 15, 0x846ca68b);
  return (value ^ value >>> 16) >>> 0;
}
export function localTerms(text: string): string[] {
  return (text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_]+(?:[./:-][\p{L}\p{N}_]+)*/gu) ?? [])
    .filter(word => word.length > 1 && !ignored.has(word)).slice(0, 2048);
}

/** Distributed sparse hypervectors bind concepts, order, polarity and character shape. */
export function encodeLocal(text: string): Float32Array {
  const vector = new Float32Array(OFS_DIMENSIONS);
  const add = (feature: string, weight: number) => {
    const seed = hash(feature);
    for (let i = 0; i < 16; i++) {
      const projection = mix(seed + Math.imul(i + 1, 0x9e3779b9));
      const index = projection % OFS_DIMENSIONS;
      vector[index] = (vector[index] ?? 0) + (projection & 0x80000000 ? -weight : weight);
    }
  };
  const terms = localTerms(text);
  const counts = new Map<string, number>();
  for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
  for (const [term, count] of counts) {
    const weight = 1 + Math.log(count);
    add(`concept:${concepts.get(term) ?? term}`, weight);
    if (concepts.has(term)) add(`surface:${term}`, weight * 0.15);
    const shape = `^${term}$`;
    for (let i = 0; i + 3 <= shape.length; i++) add(`shape:${shape.slice(i, i + 3)}`, weight * 0.06);
  }
  for (let i = 0; i + 1 < terms.length; i++) {
    const left = concepts.get(terms[i]!) ?? terms[i]!;
    const right = concepts.get(terms[i + 1]!) ?? terms[i + 1]!;
    add(`order:${left}>${right}`, 0.28);
    if (/^(?:not|never|no|avoid|dislike|hate)$/.test(left)) add(`negative:${right}`, 1.2);
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm) for (let i = 0; i < vector.length; i++) vector[i] = vector[i]! / norm;
  return vector;
}

/** Preserve statements verbatim with provenance; never invent facts from a turn. */
export function extractLocal(text: string, role: 'user' | 'assistant' = 'user'): ExtractedKnowledge {
  const facts: ExtractedKnowledge['facts'] = [];
  const relations: ExtractedKnowledge['relations'] = [];
  // Bound node size without dropping long paragraphs or code blocks.
  const segments = text.split(/\r?\n|(?<=[.!?])\s+/u);
  for (const segment of segments) for (let start = 0; start < segment.length; start += 1400) {
    const content = segment.slice(start, start + 1400).trim();
    if (content.length < 12 || localTerms(content).length < 2) continue;
    const terms = localTerms(content);
    const entities = [...new Set(terms.map(term => concepts.get(term) ?? term))].slice(0, 8);
    const personal = role === 'user' && /\b(?:i|my|we|our)\b/i.test(content);
    const durable = personal && /\b(?:prefer|favorite|favourite|live|work|name|allergic|birthday|always|never|need|want|plan)\b/i.test(content);
    const type: MemoryType = role === 'assistant' || /\?\s*$/.test(content) ? 'episodic' : durable ? 'entity_state' : 'fact';
    const state = role === 'user' ? /^I (?:now )?(live in|work at|am named|am called)\s+(.+?)[.!]?$/i.exec(content) : null;
    facts.push({ content: `${role === 'user' ? 'User' : 'Assistant'}: ${content}`, type, entities,
      importance: durable ? 0.85 : role === 'user' ? 0.6 : 0.35,
      ...(state ? { supersedesEntityAttribute: { entity: 'user', attribute: state[1]!.toLowerCase() } } : {}) });
    // Ordered entity links carry relationships beyond single-node similarity.
    for (let i = 0; i + 1 < entities.length; i++) relations.push({ source: entities[i]!, relation: 'sequence', target: entities[i + 1]!, weight: durable ? 1.5 : 1 });
  }
  return { facts, relations };
}
