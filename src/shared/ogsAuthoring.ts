const types = ['diagram','mesh','line','bar','pie','radar','venn'];
export function looksLikeOgs(source: string): boolean {
  if (/^\s*(diagram|mesh|line|bar|pie|radar|venn)(?:\s|$)/i.test(source)) return true;
  return /"type"\s*:\s*"(?:diagram|mesh|line|bar|pie|radar|venn)"/i.test(source) && /"(?:nodes|sets|series|values)"\s*:/.test(source);
}
const parts = (value: string) => value.split('|').map(item=>item.trim()).filter(Boolean);
function numeric(value: string): number {
  const trimmed=value.trim();
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed))throw Error(`Expected a number, received “${trimmed.slice(0,80)}”.`);
  return Number(trimmed);
}
/** A small data language: no scripts, evaluation, or inferred numeric values. */
function shorthand(source: string): Record<string, unknown> {
  const lines=source.trim().split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const header=/^(diagram|mesh|line|bar|pie|radar|venn)(?:\s+(.*))?$/i.exec(lines.shift()??'');
  if(!header)throw Error('Start with a graph type, for example “venn Three sets”.');
  const type=header[1]!.toLowerCase(), graph:Record<string,unknown>={type,title:header[2]?.trim()||defaultTitle(type)};
  const rows=lines.map(line=>{const split=line.indexOf(':');return {raw:line,key:split<0?'':line.slice(0,split).trim(),value:split<0?line:line.slice(split+1).trim()};});
  for(const row of rows)if(['title','description','unit'].includes(row.key.toLowerCase()))graph[row.key.toLowerCase()]=row.value;
  const data=rows.filter(row=>!['title','description','unit'].includes(row.key.toLowerCase()));
  if(type==='venn'){
    const sets=data.find(row=>row.key.toLowerCase()==='sets');
    if(!sets)throw Error('A Venn graph needs “sets: Set A | Set B” on its own line.');
    graph.sets=parts(sets.value);
    graph.overlaps=data.filter(row=>row!==sets).map(row=>{
      if(!/^\d+(?:\s*&\s*\d+)+$/.test(row.key))throw Error('Use overlap lines such as “1&2: Shared items”; set numbers start at 1.');
      return {sets:row.key.split('&').map(value=>Number(value.trim())-1),label:row.value};
    });
  }else if(type==='diagram'||type==='mesh'){
    const nodes=new Set<string>(),edges:Array<[string,string,string?]>=[];
    for(const row of data){
      if(row.key.toLowerCase()==='nodes'){parts(row.value).forEach(node=>nodes.add(node));continue;}
      const route=(row.key||row.raw).split(/\s*(?:->|→|--)\s*/).filter(Boolean);
      if(route.length<2){if(row.key)throw Error('Use “Start -> Finish” for a connection.');nodes.add(row.raw);continue;}
      route.forEach(node=>nodes.add(node));for(let i=1;i<route.length;i++)edges.push([route[i-1]!,route[i]!,row.key?row.value:undefined]);
    }
    graph.nodes=[...nodes];graph.edges=edges;
  }else{
    const categories=data.find(row=>row.key.toLowerCase()==='labels');
    if(categories){graph.labels=parts(categories.value);graph.series=data.filter(row=>row!==categories).map(row=>({name:row.key||'Values',values:parts(row.value).map(numeric)}));}
    else{graph.labels=data.map(row=>row.key);graph.series=[{name:'Values',values:data.map(row=>numeric(row.value))}];}
  }
  return graph;
}
function defaultTitle(type: string): string { return ({venn:'Venn diagram',diagram:'Flow diagram',mesh:'Network',line:'Line chart',bar:'Bar chart',pie:'Pie chart',radar:'Radar chart'} as Record<string,string>)[type]??'Graph'; }

export function decodeOgsSource(source: string): Record<string,unknown> {
  let input: unknown;
  if(!source.trim().startsWith('{')&&!source.trim().startsWith('['))return shorthand(source);
  try{input=JSON.parse(source);}catch{
    // Recover only the recognizable Venn shape: exact named sets and numeric
    // index/label pairs. Never evaluate source or fabricate values/relationships.
    const type=/"type"\s*:\s*"venn"/.test(source),sets=/"sets"\s*:\s*(\[\s*"(?:\\.|[^"\\])*"(?:\s*,\s*"(?:\\.|[^"\\])*")*\s*\])/.exec(source);
    if(!type||!sets||!source.trim().endsWith('}'))throw Error('Use valid graph data, or use the simple line format instead of JSON.');
    const pairs=[...source.matchAll(/"sets"\s*:\s*(\[\s*\d+(?:\s*,\s*\d+)+\s*\])\s*,\s*"label"\s*:\s*("(?:\\.|[^"\\])*")/g)];
    if(!pairs.length)throw Error('Use Venn overlap objects, or simpler lines such as “1&2: Shared items”.');
    const title=/"title"\s*:\s*("(?:\\.|[^"\\])*")/.exec(source);
    input={type:'venn',title:title?JSON.parse(title[1]!):defaultTitle('venn'),sets:JSON.parse(sets[1]!),overlaps:pairs.map(pair=>({sets:JSON.parse(pair[1]!),label:JSON.parse(pair[2]!)}))};
  }
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Expected one graph object.');
  const graph={...input} as Record<string,unknown>;
  if(typeof graph.type==='string')graph.type=graph.type.toLowerCase();
  if(!types.includes(String(graph.type)))return graph;
  if(graph.title===undefined||graph.title===null||graph.title==='')graph.title=defaultTitle(String(graph.type));
  for(const key of ['description','unit'])if(graph[key]===''||graph[key]===null)delete graph[key];
  if(!graph.series&&Array.isArray(graph.values))graph.series=[{name:'Values',values:graph.values}];
  if(Array.isArray(graph.series))graph.series=graph.series.map(item=>item&&typeof item==='object'?{name:'Values',...item}:item);
  return graph;
}
