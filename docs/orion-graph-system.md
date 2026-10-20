# Orion Graph System (OGS)

OGS is Orion's native visual format for chat. A model writes simple data lines in a fenced `ogs` block. Existing JSON graphs remain supported. Orion validates the data and renders an SVG locally. No remote renderer, JavaScript from the model, graph language runtime, or image generation model is needed.

Graphs remain part of their conversation's message content. They render during streaming as their data arrives and again when a saved conversation opens. Incomplete streamed graphs show a receiving state; invalid completed graphs show a specific correction and their source. Copy OGS copies the data, View data exposes the original values and relationships, and Save SVG exports a standalone vector image.

Each graph needs a type; Orion supplies a display title if one is omitted. Optional `description` explains the visual. Text is limited to 240 characters per field. Blocks are limited to 60,000 characters; diagrams support 48 nodes and 96 edges; charts support 32 categories and 6 series. Large diagrams scroll rather than clipping labels. Pie charts use one series; radar charts use 3–12 categories. Inputs are finite numbers with an absolute value no greater than one trillion. These bounds keep local rendering predictable.

## Simple format (preferred for local models)

The first line is the type and optional title. Numeric values are never invented or filled in by Orion.

```ogs
venn Three sets
sets: Set A | Set B | Set C
1&2: A and B
1&3: A and C
2&3: B and C
1&2&3: A and B and C
```

In this format, set numbers start at **1**. In existing JSON graphs, indices still start at **0**.

For charts, use a first line such as `bar Weekly counts`, then one `Label: number` per line. Replace bar with line, pie, or radar. For multiple series, use `labels: Mon | Tue` then `Team A: 10 | 20`. For connections use `diagram Request flow` or `mesh Network`, followed by lines such as `Input -> Model -> Answer`.

Graph-shaped JSON fences also render as graphs. Missing titles and empty optional display fields are normalized locally. A narrowly scoped recovery accepts recognizable malformed Venn overlap objects while preserving explicit set names and index/label pairs. Unreadable or invalid relationships still fail validation. Remaining errors trigger at most two isolated correction requests after the current model turn finishes, without prior tool-call history.

## Directed diagrams

Orion assigns layers and routes arrows. Cyclic graphs use a radial layout. Node IDs must be unique; every edge endpoint must exist. Nodes may be strings or objects with `id`, `label`, and optional `detail`. An edge is `[source, destination]` or `[source, destination, label]`.

```ogs
{"type":"diagram","title":"A local answer","nodes":[{"id":"user","label":"User request"},{"id":"memory","label":"Relevant memory","detail":"OrionFS"},{"id":"model","label":"Selected model"},{"id":"reply","label":"Response"}],"edges":[["user","model"],["memory","model","Context"],["model","reply"]]}
```

## Network meshes

The first node is the hub. Other nodes are placed in concentric rings. Only explicit edges are drawn. Mesh edges represent connections without directional arrows; use `diagram` for directed relationships.

```ogs
{"type":"mesh","title":"Local components","nodes":["Orion","Model","OrionFS","Browser","Canvas"],"edges":[["Orion","Model"],["Orion","OrionFS"],["Orion","Browser"],["Orion","Canvas"],["Model","OrionFS"]]}
```

## Line and bar charts

Each series has a `name` and `values`, with exactly one number per label. Negative numbers are supported. Bars are grouped and share a zero baseline. Lines use category positions; numeric x-axis spacing is not implied. Change `type` between `line` and `bar` for the same data. Optional `unit` annotates values.

```ogs
{"type":"line","title":"Illustrative response latency","unit":"ms","labels":["Monday","Tuesday","Wednesday","Thursday"],"series":[{"name":"Model A","values":[150,128,135,110]},{"name":"Model B","values":[175,162,147,139]}]}
```

```ogs
{"type":"bar","title":"Illustrative tasks completed","labels":["Design","Development","Review"],"series":[{"name":"This week","values":[4,12,7]},{"name":"Last week","values":[3,8,5]}]}
```

## Pie charts

One series of nonnegative values with a positive total. Orion renders a donut, total, percentages, legend, and complete data table. Zero categories remain visible in the data table.

```ogs
{"type":"pie","title":"Illustrative time allocation","unit":"hours","labels":["Research","Implementation","Review"],"series":[{"name":"Hours","values":[3,7,2]}]}
```

## Radar / spider charts

Use nonnegative values on a meaningful shared scale. Orion draws one scale from zero to the maximum value across all series. Different units should be normalized before plotting and documented in the description.

```ogs
{"type":"radar","title":"Illustrative product comparison","description":"Scores on the same 0–10 scale","labels":["Speed","Quality","Privacy","Efficiency","Usability"],"series":[{"name":"Option A","values":[8,7,10,9,8]},{"name":"Option B","values":[6,9,5,7,9]}]}
```

## Venn diagrams

Two or three sets, each a string or an object with `label` and optional nonnegative `value`. Optional `overlaps` specify two or three distinct zero-based set indices and a label. Counts annotate sets; circle areas and overlap sizes are conceptual, not proportional. Only provided overlap labels are shown. The data view preserves full labels and values.

```ogs
{"type":"venn","title":"Shared capabilities","sets":["Research","Engineering","Design"],"overlaps":[{"sets":[0,1],"label":"Experiments"},{"sets":[1,2],"label":"Prototypes"},{"sets":[0,2],"label":"Discovery"},{"sets":[0,1,2],"label":"Product"}]}
```

## Model instructions

Orion includes a compact OGS grammar in the system prompt. Models should use OGS when a visual helps answer the request, preserve actual data, clearly identify illustrative values, and explain the takeaway briefly outside the block. They use quoted JSON keys and strings with no comments or trailing commas. OGS needs no tool call. Unsupported types or invalid references produce an explicit correction instead of silently changing the user's data.
