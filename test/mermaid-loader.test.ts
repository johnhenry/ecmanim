// Mermaid loader tests: headless mermaid+jsdom rendering, the flowchart
// measurement-shim acceptance criteria (viewBox scales with content, node
// rects are nonzero and non-overlapping), DiagramMobject friendly ids per
// diagram type, and global-namespace hygiene (install/teardown around each
// render leaves globalThis untouched).
//
// Guarded like snapshot.test.ts: skipped (not failed) when the optional
// mermaid/jsdom devDependencies aren't installed. The availability check uses
// import.meta.resolve — mermaid must NOT be imported without DOM globals
// installed (its dompurify dependency binds `window` at module evaluation).

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMermaidSvg, loadMermaid, DiagramMobject } from "../src/loaders/mermaid_loader.ts";

let available = true;
try {
  import.meta.resolve("mermaid");
  import.meta.resolve("jsdom");
} catch {
  available = false;
}
const SKIP = !available && "mermaid/jsdom not installed (npm i -D mermaid jsdom)";

// -- sources --------------------------------------------------------------------

const FLOW_4 = `flowchart TD
  A[Start] --> B{Is it working?}
  B -- Yes --> C[Ship it]
  B -- No --> D[Debug]
  D --> B`;

// Same shape plus a second fan-out: strictly more parallel content, so the
// laid-out graph must be wider than FLOW_4 in the same TD direction.
const FLOW_8 = `flowchart TD
  A[Start] --> B{Is it working?}
  B -- Yes --> C[Ship it]
  B -- No --> D[Debug]
  D --> B
  B --> E[Collect logs]
  B --> F[File an issue]
  E --> G[Inspect traces]
  F --> H[Wait for triage]`;

// The 12 diagram types from the probe (examples/mermaid-parity/probe/).
const ALL_TYPES: Array<[string, string]> = [
  ["flowchart", FLOW_4],
  ["sequence", "sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi"],
  ["pie", 'pie title Pets\n  "Dogs": 40\n  "Cats": 60'],
  ["state", "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running: start\n  Running --> [*]"],
  ["class", "classDiagram\n  Animal <|-- Dog\n  Animal: +name\n  Dog: +bark()"],
  ["gantt", "gantt\n  title Plan\n  section Core\n  Task A :a1, 2024-01-01, 5d\n  Task B :after a1, 3d"],
  ["er", "erDiagram\n  USER ||--o{ ORDER : places\n  ORDER ||--|{ ITEM : contains"],
  ["journey", "journey\n  title My day\n  section Work\n    Code: 5: Me"],
  ["timeline", "timeline\n  title History\n  2020 : A\n  2021 : B"],
  ["mindmap", "mindmap\n  root((idea))\n    a\n    b"],
  ["quadrant", "quadrantChart\n  title Reach\n  x-axis Low --> High\n  y-axis Slow --> Fast\n  A: [0.3, 0.6]"],
  ["git", "gitGraph\n  commit\n  branch dev\n  commit\n  checkout main\n  merge dev"],
];

// -- helpers --------------------------------------------------------------------

function viewBoxOf(svg: string): { x: number; y: number; width: number; height: number } {
  const m = svg.match(/viewBox="([^"]+)"/);
  assert.ok(m, "svg has a viewBox");
  const [x, y, width, height] = m![1].split(/[\s,]+/).map(Number);
  return { x, y, width, height };
}

// Absolute boxes of flowchart node shapes: each node is
// <g class="node ..." transform="translate(x, y)"> containing its
// label-container <rect x y width height> (rect-shaped nodes only).
function nodeRectBoxes(svg: string): Array<{ x: number; y: number; w: number; h: number }> {
  const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
  const chunks = svg.split(/<g class="node[ "]/).slice(1);
  for (const chunk of chunks) {
    const t = chunk.match(/transform="translate\(([-\d.]+),\s*([-\d.]+)\)"/);
    const r = chunk.match(/<rect[^>]*class="basic label-container"[^>]*x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
    if (!t || !r) continue;
    boxes.push({
      x: Number(t[1]) + Number(r[1]),
      y: Number(t[2]) + Number(r[2]),
      w: Number(r[3]),
      h: Number(r[4]),
    });
  }
  return boxes;
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// -- flowchart measurement acceptance (the shim-tuning gate) ---------------------

test("flowchart viewBox scales with content", { skip: SKIP }, async () => {
  const svg4 = await renderMermaidSvg(FLOW_4);
  const svg8 = await renderMermaidSvg(FLOW_8);
  const vb4 = viewBoxOf(svg4);
  const vb8 = viewBoxOf(svg8);
  assert.ok(vb4.width >= 250, `4-node flowchart viewBox width ${vb4.width} >= 250`);
  assert.ok(vb8.width > vb4.width, `8-node width ${vb8.width} > 4-node width ${vb4.width}`);
  assert.ok(vb4.height > 100, `4-node flowchart has real height (${vb4.height})`);
});

test("flowchart node rects are nonzero and don't overlap", { skip: SKIP }, async () => {
  const svg = await renderMermaidSvg(FLOW_4);
  const boxes = nodeRectBoxes(svg);
  // A, C, D are rect-shaped (B is a decision polygon).
  assert.ok(boxes.length >= 3, `found ${boxes.length} node rects (>= 3)`);
  for (const b of boxes) {
    assert.ok(b.w > 20 && b.h > 10, `node rect ${JSON.stringify(b)} has real size`);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      assert.ok(!overlaps(boxes[i], boxes[j]), `node rects ${i} and ${j} overlap: ${JSON.stringify([boxes[i], boxes[j]])}`);
    }
  }
});

// -- all 12 diagram types ---------------------------------------------------------

test("all 12 diagram types render to nonempty SVG with real bounds", { skip: SKIP }, async () => {
  for (const [name, source] of ALL_TYPES) {
    const svg = await renderMermaidSvg(source);
    assert.ok(svg.includes("<svg"), `${name}: has <svg>`);
    assert.ok(svg.length > 500, `${name}: nonempty (${svg.length} bytes)`);
    const vb = viewBoxOf(svg);
    assert.ok(vb.width > 0 && vb.height > 0, `${name}: viewBox ${vb.width}x${vb.height} is nonzero`);
  }
});

// -- loadMermaid / DiagramMobject -------------------------------------------------

test("loadMermaid flowchart: friendly node/edge ids", { skip: SKIP }, async () => {
  const diagram = await loadMermaid(FLOW_4);
  assert.ok(diagram instanceof DiagramMobject);
  assert.equal(diagram.diagramType, "flowchart");
  assert.ok(diagram.byId("A").submobjects.length > 0, 'byId("A") is nonempty');
  assert.ok(diagram.byId("B").submobjects.length > 0, 'byId("B") is nonempty');
  assert.ok(diagram.nodeIds().length >= 4, `nodeIds() has >= 4 entries: ${diagram.nodeIds().join(", ")}`);
  assert.deepEqual(
    [...diagram.nodeIds()].sort(),
    ["A", "B", "C", "D"],
    "friendly node ids are the source names",
  );
  assert.ok(diagram.edgeIds().length >= 4, `edgeIds(): ${diagram.edgeIds().join(", ")}`);
  assert.ok(diagram.edgeIds().includes("L_A_B_0"), "edge id convention L_A_B_0");
  assert.ok(diagram.byId("L_A_B_0").submobjects.length > 0, "edge lookup works");
  assert.throws(() => diagram.byId("nope"), /no element with id "nope"/);
});

test("loadMermaid fits the diagram to world units", { skip: SKIP }, async () => {
  const diagram = await loadMermaid(FLOW_4);
  assert.ok(diagram.getWidth() <= 10.01, `width ${diagram.getWidth()} <= 10`);
  assert.ok(diagram.getHeight() <= 7.01, `height ${diagram.getHeight()} <= 7`);
  // Fit means at least one axis is pinned to the box.
  assert.ok(
    Math.abs(diagram.getWidth() - 10) < 0.01 || Math.abs(diagram.getHeight() - 7) < 0.01,
    `fit fills the 10x7 box on one axis (${diagram.getWidth()} x ${diagram.getHeight()})`,
  );
  const explicit = await loadMermaid(FLOW_4, { width: 4 });
  assert.ok(Math.abs(explicit.getWidth() - 4) < 0.01, "explicit width is honored");
});

test("sequence diagram: actors addressable by name", { skip: SKIP }, async () => {
  const diagram = await loadMermaid("sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi");
  assert.equal(diagram.diagramType, "sequence");
  assert.ok(diagram.byId("Alice").submobjects.length > 0, 'byId("Alice") is nonempty');
  assert.ok(diagram.byId("Bob").submobjects.length > 0, 'byId("Bob") is nonempty');
  assert.ok(diagram.nodeIds().includes("Alice") && diagram.nodeIds().includes("Bob"), `nodeIds: ${diagram.nodeIds().join(", ")}`);
});

test("state/class/er: friendly ids for the unified-renderer family", { skip: SKIP }, async () => {
  const state = await loadMermaid("stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running: start\n  Running --> [*]");
  assert.equal(state.diagramType, "state");
  assert.ok(state.byId("Idle").submobjects.length > 0, "state node by name");
  assert.ok(state.byId("Running").submobjects.length > 0);
  assert.ok(state.edgeIds().includes("edge0"), `state edges: ${state.edgeIds().join(", ")}`);

  const cls = await loadMermaid("classDiagram\n  Animal <|-- Dog\n  Animal: +name\n  Dog: +bark()");
  assert.equal(cls.diagramType, "class");
  assert.ok(cls.byId("Animal").submobjects.length > 0, "class box by name");
  assert.ok(cls.byId("Dog").submobjects.length > 0);

  const er = await loadMermaid("erDiagram\n  USER ||--o{ ORDER : places\n  ORDER ||--|{ ITEM : contains");
  assert.equal(er.diagramType, "er");
  assert.ok(er.byId("USER").submobjects.length > 0, "er entity by name");
  assert.deepEqual([...er.nodeIds()].sort(), ["ITEM", "ORDER", "USER"]);
  assert.ok(er.byId("USER_ORDER").submobjects.length > 0, "er relationship by entity pair");
});

// -- global-namespace hygiene ------------------------------------------------------

test("render teardown leaves globalThis clean", { skip: SKIP }, async () => {
  await renderMermaidSvg(FLOW_4);
  await loadMermaid("pie\n  \"a\": 1\n  \"b\": 2");
  assert.ok(!("window" in globalThis), "no window global after render");
  assert.ok(!("document" in globalThis), "no document global after render");
  assert.ok(!("SVGElement" in globalThis), "no SVGElement global after render");
  assert.ok(!("HTMLElement" in globalThis), "no HTMLElement global after render");
  assert.ok(!("DOMParser" in globalThis), "no DOMParser global after render");
  assert.ok(!("CSSStyleSheet" in globalThis), "no CSSStyleSheet global after render");
  // Node's own navigator must be back (not jsdom's).
  assert.ok(!/jsdom/i.test(String((globalThis as any).navigator?.userAgent ?? "")), "navigator restored to Node's");
});

// -- campaign 4 / M1.5: CSS inlining, text extraction, viewBox cropping -----------

test("flowchart loads with mermaid's palette (CSS <style> inlined, not black)", { skip: SKIP }, async () => {
  const diagram = await loadMermaid(FLOW_4);
  const fills = new Set<string>();
  for (const m of diagram.submobjects as any[]) {
    if (m.fillOpacity > 0 && m.getWidth() > 0.3 && !m.__isDiagramLabel) fills.add(m.fillColor?.toHex?.());
  }
  assert.ok(!fills.has("#000000"), `no black-defaulted region: ${[...fills].join(", ")}`);
  // mermaid's default theme node fill.
  assert.ok(fills.has("#ececff"), `node fill is mermaid's #ececff: ${[...fills].join(", ")}`);
});

test("authored SVG <style> rules inline into presentation attributes", { skip: SKIP }, async () => {
  const { JSDOM } = await import("jsdom");
  const { inlineSvgStyles } = await import("../src/loaders/mermaid_loader.ts");
  const { SVGMobject } = await import("../src/mobject/svg_mobject.ts");
  const dom = new JSDOM(
    `<body><svg viewBox="0 0 10 10"><style>.x { fill: hsl(0, 100%, 50%) } .x rect { stroke: #00ff00 }</style>` +
    `<g class="x"><rect x="1" y="1" width="8" height="8"/></g>` +
    `<rect class="x" x="0" y="0" width="2" height="2" fill="#123456" style="fill:#0000ff"/>` +
    `<rect class="y" x="4" y="4" width="2" height="2" fill="#123456"/></svg></body>`,
  );
  const svgEl = dom.window.document.querySelector("svg");
  inlineSvgStyles(svgEl);
  const svg = new SVGMobject(svgEl!.outerHTML);
  const [inGroup, inlineStyled, untouched] = svg.submobjects as any[];
  assert.equal(inGroup.fillColor.toHex(), "#ff0000", "hsl() class fill inlined as red");
  assert.equal(inGroup.strokeColor.toHex(), "#00ff00", "descendant selector (.x rect) stroke applied");
  // CSS cascade: inline style beats the stylesheet rule; the stylesheet rule
  // beats a presentation attribute; unmatched elements keep their attributes.
  assert.equal(inlineStyled.fillColor.toHex(), "#0000ff", "inline style wins over CSS");
  assert.equal(untouched.fillColor.toHex(), "#123456", "unmatched element keeps its attribute");
});

test("flowchart text extraction: labels once, inside their nodes, byId includes them", { skip: SKIP }, async () => {
  const diagram = await loadMermaid(FLOW_4);
  const texts = diagram.labels().submobjects.map((t: any) => t.text);
  for (const caption of ["Start", "Is it working?", "Ship it", "Debug"]) {
    assert.equal(texts.filter((s: string) => s === caption).length, 1, `caption "${caption}" present exactly once: ${texts.join(" | ")}`);
  }
  // Every label is marked, and a node's byId group includes its label.
  for (const t of diagram.labels().submobjects as any[]) assert.ok(t.__isDiagramLabel, "label marked __isDiagramLabel");
  const a = diagram.byId("A").submobjects as any[];
  const label = a.find((m) => m.__isDiagramLabel);
  assert.ok(label && label.text === "Start", 'byId("A") includes its "Start" label');
  // Label world position sits inside the node's shape bounds (tolerance 15%).
  const shapes = a.filter((m) => !m.__isDiagramLabel);
  const xs = shapes.flatMap((m: any) => [m.getCenter()[0] - m.getWidth() / 2, m.getCenter()[0] + m.getWidth() / 2]);
  const ys = shapes.flatMap((m: any) => [m.getCenter()[1] - m.getHeight() / 2, m.getCenter()[1] + m.getHeight() / 2]);
  const [cx, cy] = label.getCenter();
  const padX = (Math.max(...xs) - Math.min(...xs)) * 0.15, padY = (Math.max(...ys) - Math.min(...ys)) * 0.15;
  assert.ok(cx > Math.min(...xs) - padX && cx < Math.max(...xs) + padX, `label x ${cx} inside node [${Math.min(...xs)}, ${Math.max(...xs)}]`);
  assert.ok(cy > Math.min(...ys) - padY && cy < Math.max(...ys) + padY, `label y ${cy} inside node [${Math.min(...ys)}, ${Math.max(...ys)}]`);
});

test("gantt: off-canvas today line cropped — fit is not collapsed, bars preserved", { skip: SKIP }, async () => {
  // The corpus example: 2014 dates put mermaid's "today" line ~96000px right
  // of a ~1200px chart, which used to collapse the world fit to a sliver.
  const diagram = await loadMermaid(`gantt
    title A Gantt Diagram
    dateFormat YYYY-MM-DD
    section Section
        A task          :a1, 2014-01-01, 30d
        Another task    :after a1, 20d
    section Another
        Task in Another :2014-01-12, 12d
        another task    :24d`);
  assert.ok(diagram.getHeight() > 0.5, `height ${diagram.getHeight()} > 0.5 world units at default fit`);
  assert.ok(diagram.getWidth() / diagram.getHeight() < 10, `aspect ${(diagram.getWidth() / diagram.getHeight()).toFixed(1)} is sane`);
  // All four task bars survive the crop.
  for (const id of ["a1", "task1", "task2", "task3"]) {
    assert.ok(diagram.nodeIds().includes(id), `bar ${id} preserved: ${diagram.nodeIds().join(", ")}`);
    assert.ok(diagram.byId(id).submobjects.length > 0, `bar ${id} has geometry`);
  }
});

test("pie: slices carry the theme palette and labels are extracted", { skip: SKIP }, async () => {
  const diagram = await loadMermaid('pie title Pets\n  "Dogs": 40\n  "Cats": 60');
  const fills = new Set(
    (diagram.submobjects as any[])
      .filter((m) => m.fillOpacity > 0 && !m.__isDiagramLabel && m.getWidth() > 0.3)
      .map((m) => m.fillColor?.toHex?.()),
  );
  assert.ok(!fills.has("#000000"), `no black slice/circle: ${[...fills].join(", ")}`);
  const texts = diagram.labels().submobjects.map((t: any) => t.text);
  assert.ok(texts.includes("Dogs") && texts.includes("Cats") && texts.includes("Pets"), `pie labels: ${texts.join(" | ")}`);
});
