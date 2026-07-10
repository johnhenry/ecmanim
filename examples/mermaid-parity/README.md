# Mermaid parity suite

**Your Mermaid diagrams, animated.** All 12 Mermaid diagram types load
headlessly (mermaid@11 + jsdom — no browser, no GPU) into addressable
`DiagramMobject`s, get staged topological reveals, and — the flagship —
**diagram DIFFS**: two Mermaid sources morph into each other with kept
nodes travelling, added nodes fading in, and labels riding the morph.

```bash
ECMANIM_DEMO_QUALITY=low npx tsx examples/mermaid-parity/13-diagram-diff.ts
npm run demos:mermaid   # everything
```

Corpus: each type's canonical example from the official syntax docs
([`ref/`](./ref/), MIT, provenance in ref/README.md), quoted verbatim in
each demo header.

## Scorecard — 13/13 pass

| # | Demo | Type | Proves |
|---|------|------|--------|
| 01 | flowchart | flowchart | topological reveal (nodes before edges), byId Indicate |
| 02 | sequence | sequenceDiagram | actors+lifelines first, messages top-to-bottom |
| 03 | class | classDiagram | compartmented boxes, member rows, Circumscribe byId |
| 04 | state | stateDiagram-v2 | [*] markers, spatial edge fallback |
| 05 | er | erDiagram | entities + relationship-word plates |
| 06 | gantt | gantt | bars grow left-to-right; off-canvas "today" cropped |
| 07 | pie | pie | ROUND slices (real SVG arcs), GrowFromCenter, palette |
| 08 | journey | userJourney | sections/faces/legend at ex-unit font sizes |
| 09 | timeline | timeline | year columns sweep in |
| 10 | mindmap | mindmap | radial reveal from root (cytoscape under canvas shim) |
| 11 | quadrant | quadrantChart | full text extraction, point beats |
| 12 | gitgraph | gitGraph | branch-colored commits, merge ring |
| 13 | **diagram-diff** | flowchart × 2 | kept nodes MORPH between layouts (keyMap renames: Deploy→Ship glyph-morphs), adds/removes fade |

## The pipeline (all library, campaign 4)

`loadMermaid(source)` → jsdom DOM shim (geometry-aware getBBox, CSS
cascade inlined, text extracted as positioned labels, viewBox-cropped,
markers stripped) → `DiagramMobject` with per-type friendly ids
(`byId("A")`, `nodeIds()`, `edgeIds()`, `labels()`) →
`revealDiagram(d, {order: "topological" | "source" | "spatial"})` →
`diffDiagrams(v1, v2, {keyMap})`.

Fixes this campaign contributed to EVERY SVG consumer: real elliptical
arc (`A`) support in the path parser (arcs used to flatten to chords)
and `hsl()/rgb()` color parsing (used to come out black).

## Honest divergences

- Text metrics are heuristic (~0.6em/char) — layout is close to browser
  mermaid, not pixel-identical; long multiline notes can overflow their
  boxes.
- `<marker>` arrowheads/crow's feet are stripped (edge lines are bare).
- Text rotation isn't reproduced (rotated axis labels render horizontal;
  gitgraph hashes hidden).
- Interactivity (clicks, tooltips) out of scope; themes = mermaid's
  built-ins.
