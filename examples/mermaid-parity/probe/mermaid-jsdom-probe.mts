// Probe: mermaid@11 headless under jsdom. Known hazards: getBBox missing,
// DOMPurify wiring, getComputedTextLength.
import { JSDOM } from "jsdom";

const dom = new JSDOM(`<!DOCTYPE html><body><div id="container"></div></body>`, {
  pretendToBeVisual: true,
  url: "http://localhost/",
});
const { window } = dom;
const g: any = globalThis;
g.window = window;
g.document = window.document;
try { g.navigator = window.navigator; } catch { Object.defineProperty(g, "navigator", { value: window.navigator, configurable: true }); }
g.DOMParser = window.DOMParser;
g.XMLSerializer = window.XMLSerializer;
g.SVGElement = window.SVGElement;
g.HTMLElement = window.HTMLElement;
g.Element = window.Element;
g.Node = window.Node;
g.location = window.location;
g.CSSStyleSheet = (window as any).CSSStyleSheet ?? class CSSStyleSheet {
  cssRules: any[] = [];
  insertRule(rule: string, index = 0) { this.cssRules.splice(index, 0, { cssText: rule }); return index; }
  replaceSync() {}
};

// jsdom has no SVG layout: stub getBBox/getComputedTextLength with
// char-count heuristics (the mermaid-cli-less trick).
const proto: any = (window as any).SVGElement.prototype;
proto.getBBox = function () {
  const tag = (this.tagName ?? "").toLowerCase();
  const fontSize = 16;
  if (tag === "text" || tag === "tspan") {
    const text = this.textContent ?? "";
    const lines = text.split("\n");
    const longest = Math.max(...lines.map((l: string) => l.length), 1);
    return { x: 0, y: 0, width: longest * fontSize * 0.6, height: lines.length * fontSize * 1.2 };
  }
  // Containers: union of children's boxes (no real layout in jsdom; treat
  // children as stacked at origin — mermaid mostly wants text sizes).
  let w = 0, h = 0;
  for (const child of this.children ?? []) {
    const b = child.getBBox?.();
    if (b) { w = Math.max(w, b.width); h = Math.max(h, b.height); }
  }
  return { x: 0, y: 0, width: w || 10, height: h || fontSize * 1.2 };
};
proto.getComputedTextLength = function () {
  return (this.textContent ?? "").length * 9.6;
};

// getBoundingClientRect: jsdom returns zeros; text-heuristic stub (html
// labels measure through it).
const elProto: any = (window as any).Element.prototype;
const origGBCR = elProto.getBoundingClientRect;
elProto.getBoundingClientRect = function () {
  const text = this.textContent ?? "";
  const lines = String(text).split("\n");
  const longest = Math.max(...lines.map((l: string) => l.length), 1);
  const width = longest * 9.6;
  const height = Math.max(1, lines.length) * 19.2;
  return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON() { return this; } };
};
void origGBCR;

// Canvas 2d for mindmap (cytoscape probes it): wire @napi-rs/canvas.
const { createCanvas } = await import("@napi-rs/canvas");
(window as any).HTMLCanvasElement.prototype.getContext = function (kind: string) {
  if (kind !== "2d") return null;
  this.__napi ??= createCanvas(this.width || 300, this.height || 150);
  return this.__napi.getContext("2d");
};

const { default: mermaid } = await import("mermaid");
mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  flowchart: { htmlLabels: false },
  class: { htmlLabels: false } as any,
  state: { htmlLabels: false } as any,
  er: { useMaxWidth: false } as any,
  securityLevel: "loose",
});

const src = `flowchart TD
  A[Start] --> B{Is it working?}
  B -- Yes --> C[Ship it]
  B -- No --> D[Debug]
  D --> B`;

try {
  const { svg } = await mermaid.render("probe1", src);
  console.log("RENDER OK, svg length:", svg.length);
  console.log("has <rect>:", svg.includes("<rect"), "| has <path>:", svg.includes("<path"));
  console.log("node ids present:", /flowchart-A-/.test(svg), /flowchart-B-/.test(svg));
  const vb = svg.match(/viewBox="([^"]+)"/);
  console.log("viewBox:", vb?.[1]);
  // Try more diagram types quickly:
  for (const [name, source] of [
    ["sequence", "sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi"],
    ["pie", "pie title Pets\n  \"Dogs\": 40\n  \"Cats\": 60"],
    ["state", "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running: start\n  Running --> [*]"],
    ["class", "classDiagram\n  Animal <|-- Dog\n  Animal: +name\n  Dog: +bark()"],
    ["gantt", "gantt\n  title Plan\n  section Core\n  Task A :a1, 2024-01-01, 5d\n  Task B :after a1, 3d"],
    ["er", "erDiagram\n  USER ||--o{ ORDER : places\n  ORDER ||--|{ ITEM : contains"],
    ["journey", "journey\n  title My day\n  section Work\n    Code: 5: Me"],
    ["timeline", "timeline\n  title History\n  2020 : A\n  2021 : B"],
    ["mindmap", "mindmap\n  root((idea))\n    a\n    b"],
    ["quadrant", "quadrantChart\n  title Reach\n  x-axis Low --> High\n  y-axis Slow --> Fast\n  A: [0.3, 0.6]"],
    ["git", "gitGraph\n  commit\n  branch dev\n  commit\n  checkout main\n  merge dev"],
  ] as Array<[string, string]>) {
    try {
      const r = await mermaid.render("probe_" + name, source);
      const v = r.svg.match(/viewBox="([^"]+)"/)?.[1] ?? "?";
      console.log(name + ": OK (" + r.svg.length + " bytes, viewBox " + v + ")");
    } catch (e: any) {
      console.log(name + ": FAILED — " + String(e.message).slice(0, 90));
    }
  }
} catch (e: any) {
  console.log("RENDER FAILED:", e.message);
  console.log(e.stack?.split("\n").slice(0, 5).join("\n"));
}
