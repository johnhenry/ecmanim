// Mermaid → mobjects. Renders a mermaid diagram source string to SVG entirely
// headlessly (mermaid@11 + jsdom + a DOM/SVG measurement shim — no browser, no
// GPU), then feeds the SVG through SVGMobject's id-preserving loader so every
// node/edge is addressable and animatable.
//
//   const diagram = await loadMermaid("flowchart TD\n  A --> B");
//   diagram.byId("A")          // the node's shapes, as a VGroup
//   diagram.nodeIds()          // ["A", "B"]
//   diagram.edgeIds()          // ["L_A_B_0"]
//
// mermaid and jsdom are OPTIONAL dependencies (devDependencies here): both are
// lazy-imported on first use with a clear install hint if absent, so this
// module always loads (browser included) and only render calls require them.
// @napi-rs/canvas is additionally wired into the canvas shim when present
// (mindmap diagrams route through cytoscape, which probes a 2d context).
//
// Headless measurement: jsdom performs no layout, so every measurement API
// mermaid consults is shimmed:
//   - SVGElement.getBBox — GEOMETRY-AWARE: real bounds from rect/circle/
//     ellipse/line/poly attrs and path `d` data, per-glyph heuristics for
//     text/tspan, and container boxes as the union of children mapped through
//     their transform="..." attributes. (The transform-aware union is the
//     part that fixes the flowchart/state/class/er "viewBox collapse": mermaid
//     sizes the final viewBox from the root <g>'s getBBox, which is meaningless
//     unless child translate() offsets are honored.)
//   - SVGTextContentElement.getComputedTextLength — char-count heuristic.
//   - Element.getBoundingClientRect — text heuristic (html-label measurement).
//   - HTMLElement.offsetWidth/offsetHeight — fixed canvas size (gantt reads
//     parentElement.offsetWidth, which jsdom reports as 0 → zero-width chart).
// All globals installed for a render are saved and restored afterward — no
// pollution of globalThis between calls; concurrent renders are serialized.

import { SVGMobject, parseXML } from "../mobject/svg_mobject.ts";
import type { SVGMobjectConfig, XmlNode } from "../mobject/svg_mobject.ts";
import { VGroup } from "../mobject/VMobject.ts";

// ---------------------------------------------------------------------------
// Optional-dependency loading (graceful degrade, mirroring boolean_ops/three).
// Non-literal specifiers keep TypeScript from demanding type declarations
// (jsdom ships none) and keep bundlers from trying to resolve them statically.
// ---------------------------------------------------------------------------
const dynamicImport = (specifier: string): Promise<any> => import(specifier);

let depsPromise: Promise<{ JSDOM: any; VirtualConsole: any; createCanvas: any | null }> | null = null;

async function loadDeps(): Promise<{ JSDOM: any; VirtualConsole: any; createCanvas: any | null }> {
  depsPromise ??= (async () => {
    let jsdomMod: any = null;
    try { jsdomMod = await dynamicImport("jsdom"); } catch { /* not installed */ }
    // mermaid itself is imported later, under the installed DOM globals (its
    // dompurify dependency binds `window` at module-evaluation time) — but
    // verify it resolves now so the error message covers both packages.
    let mermaidResolves = true;
    try { await import.meta.resolve?.("mermaid"); } catch { mermaidResolves = false; }
    if (!jsdomMod || !mermaidResolves) {
      depsPromise = null; // allow retry after the user installs
      throw new Error(
        "loadMermaid/renderMermaidSvg require the optional packages 'mermaid' and 'jsdom'. " +
        "Install them with: npm i -D mermaid jsdom  (plus @napi-rs/canvas for mindmap diagrams).",
      );
    }
    let createCanvas: any = null;
    try { createCanvas = (await dynamicImport("@napi-rs/canvas")).createCanvas ?? null; } catch { /* optional */ }
    return { JSDOM: jsdomMod.JSDOM, VirtualConsole: jsdomMod.VirtualConsole, createCanvas };
  })();
  return depsPromise;
}

// ---------------------------------------------------------------------------
// Geometry-aware bounding boxes for the getBBox shim.
// ---------------------------------------------------------------------------
type Box = { x: number; y: number; width: number; height: number };
type Affine6 = [number, number, number, number, number, number];

// Elements that contribute nothing to a container's rendered bounds.
const NON_RENDERED_TAGS = new Set([
  "defs", "marker", "style", "title", "desc", "clippath", "mask", "pattern", "symbol", "metadata", "script",
]);

function parseTransformAttr(s: string | null | undefined): Affine6 {
  let m: Affine6 = [1, 0, 0, 1, 0, 0];
  if (!s) return m;
  const mul = (t: number[]) => {
    m = [
      m[0] * t[0] + m[2] * t[1], m[1] * t[0] + m[3] * t[1],
      m[0] * t[2] + m[2] * t[3], m[1] * t[2] + m[3] * t[3],
      m[0] * t[4] + m[2] * t[5] + m[4], m[1] * t[4] + m[3] * t[5] + m[5],
    ];
  };
  const re = /(translate|scale|rotate|matrix)\s*\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(s)) !== null) {
    const nums = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (match[1] === "translate") mul([1, 0, 0, 1, nums[0] || 0, nums[1] || 0]);
    else if (match[1] === "scale") mul([nums[0] ?? 1, 0, 0, nums[1] ?? nums[0] ?? 1, 0, 0]);
    else if (match[1] === "matrix" && nums.length === 6) mul(nums);
    else if (match[1] === "rotate") {
      const r = ((nums[0] || 0) * Math.PI) / 180, c = Math.cos(r), si = Math.sin(r);
      if (nums.length >= 3) { mul([1, 0, 0, 1, nums[1], nums[2]]); mul([c, si, -si, c, 0, 0]); mul([1, 0, 0, 1, -nums[1], -nums[2]]); }
      else mul([c, si, -si, c, 0, 0]);
    }
  }
  return m;
}

// Coarse, command-aware path bounds: control points included (slight
// over-estimate for curves — the right bias for a viewBox fit).
function pathBounds(d: string): Box | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let cx = 0, cy = 0, sawAny = false;
  const add = (x: number, y: number) => {
    sawAny = true;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  let i = 0, cmd = "";
  const next = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[a-zA-Z]/.test(t)) {
      cmd = t;
      i++;
      if (cmd.toUpperCase() === "Z") continue;
    }
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case "M": case "L": case "T": {
        const x = next(), y = next();
        cx = rel ? cx + x : x; cy = rel ? cy + y : y;
        add(cx, cy);
        break;
      }
      case "H": { const x = next(); cx = rel ? cx + x : x; add(cx, cy); break; }
      case "V": { const y = next(); cy = rel ? cy + y : y; add(cx, cy); break; }
      case "C": {
        for (let k = 0; k < 2; k++) { const x = next(), y = next(); add(rel ? cx + x : x, rel ? cy + y : y); }
        const x = next(), y = next();
        cx = rel ? cx + x : x; cy = rel ? cy + y : y;
        add(cx, cy);
        break;
      }
      case "S": case "Q": {
        { const x = next(), y = next(); add(rel ? cx + x : x, rel ? cy + y : y); }
        const x = next(), y = next();
        cx = rel ? cx + x : x; cy = rel ? cy + y : y;
        add(cx, cy);
        break;
      }
      case "A": {
        next(); next(); next(); next(); next();
        const x = next(), y = next();
        cx = rel ? cx + x : x; cy = rel ? cy + y : y;
        add(cx, cy);
        break;
      }
      default: i++; break;
    }
  }
  return sawAny ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
}

function attrNum(el: any, name: string, d = 0): number {
  const v = parseFloat(el.getAttribute?.(name));
  return Number.isFinite(v) ? v : d;
}

// Effective font size: nearest inline style / font-size attribute up the
// tree, defaulting to mermaid's 16px body font.
function fontSizeOf(el: any): number {
  for (let e = el; e; e = e.parentElement) {
    const style = e.getAttribute?.("style") ?? "";
    const m = /font-size:\s*([\d.]+)/.exec(style);
    if (m) return parseFloat(m[1]);
    const fs = parseFloat(e.getAttribute?.("font-size"));
    if (Number.isFinite(fs)) return fs;
  }
  return 16;
}

// Text measurement heuristic: ~0.6em average glyph advance, 1.2em line box.
const GLYPH_WIDTH_EM = 0.6;
const LINE_HEIGHT_EM = 1.2;

function textBounds(el: any): Box {
  const fontSize = fontSizeOf(el);
  const lines = String(el.textContent ?? "").split("\n");
  const longest = Math.max(...lines.map((l: string) => l.length), 0);
  const width = longest * fontSize * GLYPH_WIDTH_EM;
  const height = Math.max(1, lines.length) * fontSize * LINE_HEIGHT_EM;
  let x = attrNum(el, "x", 0);
  const y = attrNum(el, "y", 0);
  const anchor = el.getAttribute?.("text-anchor") ?? "";
  if (anchor === "middle") x -= width / 2;
  else if (anchor === "end") x -= width;
  return { x, y: y - height * 0.8, width, height };
}

function unionBoxes(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return {
    x, y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function transformBox(b: Box, m: Affine6): Box {
  const corners = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of corners) {
    const tx = m[0] * px + m[2] * py + m[4];
    const ty = m[1] * px + m[3] * py + m[5];
    if (tx < minX) minX = tx;
    if (tx > maxX) maxX = tx;
    if (ty < minY) minY = ty;
    if (ty > maxY) maxY = ty;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// getBBox semantics: an element's box in its OWN coordinate system — children's
// transforms apply, the element's own does not.
function bboxOf(el: any): Box | null {
  const tag = String(el.tagName ?? "").toLowerCase();
  if (NON_RENDERED_TAGS.has(tag)) return null;
  switch (tag) {
    case "rect": case "image": case "foreignobject":
      return { x: attrNum(el, "x"), y: attrNum(el, "y"), width: attrNum(el, "width"), height: attrNum(el, "height") };
    case "circle": {
      const r = attrNum(el, "r");
      return { x: attrNum(el, "cx") - r, y: attrNum(el, "cy") - r, width: 2 * r, height: 2 * r };
    }
    case "ellipse": {
      const rx = attrNum(el, "rx"), ry = attrNum(el, "ry");
      return { x: attrNum(el, "cx") - rx, y: attrNum(el, "cy") - ry, width: 2 * rx, height: 2 * ry };
    }
    case "line": {
      const x1 = attrNum(el, "x1"), y1 = attrNum(el, "y1"), x2 = attrNum(el, "x2"), y2 = attrNum(el, "y2");
      return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
    }
    case "polyline": case "polygon": {
      const nums = String(el.getAttribute("points") ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
      if (nums.length < 2) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let k = 0; k + 1 < nums.length; k += 2) {
        if (nums[k] < minX) minX = nums[k];
        if (nums[k] > maxX) maxX = nums[k];
        if (nums[k + 1] < minY) minY = nums[k + 1];
        if (nums[k + 1] > maxY) maxY = nums[k + 1];
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    case "path":
      return pathBounds(String(el.getAttribute("d") ?? ""));
    case "text": case "tspan":
      return textBounds(el);
    default: {
      let box: Box | null = null;
      for (const child of el.children ?? []) {
        const b = bboxOf(child);
        if (!b) continue;
        box = unionBoxes(box, transformBox(b, parseTransformAttr(child.getAttribute?.("transform"))));
      }
      return box;
    }
  }
}

// ---------------------------------------------------------------------------
// DOM shim: one persistent JSDOM per process (mermaid's dompurify binds the
// window it saw at import time, so the window must outlive the module), with
// globals installed around each render and fully restored afterward.
// ---------------------------------------------------------------------------
let sharedDom: any = null;
let mermaidModule: any = null;

function makeDom(JSDOM: any, VirtualConsole: any, createCanvas: any | null): any {
  // A silent VirtualConsole: cytoscape (mindmap) fires a benign async
  // drawImage error in a requestAnimationFrame AFTER its SVG is produced;
  // jsdom would otherwise print it as a "jsdomError" on every mindmap render.
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(`<!DOCTYPE html><body></body>`, {
    pretendToBeVisual: true,
    url: "http://localhost/",
    virtualConsole,
  });
  const { window } = dom;

  // SVG measurement shims.
  const svgProto: any = window.SVGElement.prototype;
  svgProto.getBBox = function () {
    const b = bboxOf(this);
    if (b) return b;
    // mermaid's calculateTextDimensions throws on an all-zero text bbox
    // ("svg element not in render tree") — keep text nonzero.
    const tag = String(this.tagName ?? "").toLowerCase();
    if (tag === "text" || tag === "tspan") return { x: 0, y: 0, width: 1, height: 16 * LINE_HEIGHT_EM };
    return { x: 0, y: 0, width: 0, height: 0 };
  };
  svgProto.getComputedTextLength = function () {
    return String(this.textContent ?? "").length * fontSizeOf(this) * GLYPH_WIDTH_EM;
  };
  (window.Element.prototype as any).getBoundingClientRect = function () {
    const lines = String(this.textContent ?? "").split("\n");
    const longest = Math.max(...lines.map((l: string) => l.length), 1);
    const fontSize = 16;
    const width = longest * fontSize * GLYPH_WIDTH_EM;
    const height = Math.max(1, lines.length) * fontSize * LINE_HEIGHT_EM;
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON() { return this; } };
  };
  // gantt sizes its canvas from parentElement.offsetWidth (0 in jsdom → a
  // zero-width chart); give block elements a fixed virtual viewport.
  Object.defineProperty(window.HTMLElement.prototype, "offsetWidth", { get() { return 1200; }, configurable: true });
  Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", { get() { return 800; }, configurable: true });

  // requestAnimationFrame: cytoscape (mindmap) runs a SELF-PERPETUATING rAF
  // render loop that never stops — under jsdom's pretendToBeVisual scheduler
  // it keeps the process's event loop alive forever after the SVG is done.
  // Replace it with Node-timer-backed callbacks tracked in a map, so teardown
  // can cancel the whole pending chain (new frames are only scheduled from
  // inside callbacks, so cancelling the pending ones kills the loop).
  // Callback errors are swallowed like a browser console would show-and-carry-
  // on (cytoscape throws a benign drawImage type error after rendering).
  const pendingRaf = new Map<number, ReturnType<typeof setTimeout>>();
  let rafId = 0;
  window.requestAnimationFrame = (cb: (t: number) => void) => {
    const id = ++rafId;
    pendingRaf.set(id, setTimeout(() => {
      pendingRaf.delete(id);
      try { cb(window.performance?.now?.() ?? Date.now()); } catch { /* benign: post-render draw errors */ }
    }, 16));
    return id;
  };
  window.cancelAnimationFrame = (id: number) => {
    const t = pendingRaf.get(id);
    if (t) clearTimeout(t);
    pendingRaf.delete(id);
  };
  (dom as any).__cancelPendingRaf = () => {
    for (const t of pendingRaf.values()) clearTimeout(t);
    pendingRaf.clear();
  };

  // Canvas 2d for cytoscape (mindmap). drawImage is wrapped because cytoscape
  // hands it jsdom canvas elements @napi-rs/canvas can't ingest — that draw
  // happens after the SVG is complete, so a no-op is harmless.
  if (createCanvas) {
    (window.HTMLCanvasElement.prototype as any).getContext = function (kind: string) {
      if (kind !== "2d") return null;
      if (!this.__napiCtx) {
        const canvas = createCanvas(this.width || 300, this.height || 150);
        const ctx = canvas.getContext("2d");
        const origDrawImage = ctx.drawImage.bind(ctx);
        ctx.drawImage = (...args: any[]) => { try { return origDrawImage(...args); } catch { /* benign: non-napi image source */ } };
        this.__napiCtx = ctx;
      }
      return this.__napiCtx;
    };
  }
  return dom;
}

const GLOBAL_KEYS = [
  "window", "document", "navigator", "DOMParser", "XMLSerializer",
  "SVGElement", "HTMLElement", "Element", "Node", "location", "CSSStyleSheet",
] as const;

// Install the jsdom window's globals, returning a restore function that puts
// every original descriptor back (or deletes what didn't exist).
function installGlobals(window: any): () => void {
  const saved = GLOBAL_KEYS.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);
  const values: Record<string, any> = {
    window,
    document: window.document,
    navigator: window.navigator,
    DOMParser: window.DOMParser,
    XMLSerializer: window.XMLSerializer,
    SVGElement: window.SVGElement,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    location: window.location,
    // jsdom@29 has no constructable-stylesheets support.
    CSSStyleSheet: window.CSSStyleSheet ?? class CSSStyleSheet {
      cssRules: any[] = [];
      insertRule(rule: string, index = 0) { this.cssRules.splice(index, 0, { cssText: rule }); return index; }
      replaceSync() { /* no-op */ }
    },
  };
  for (const k of GLOBAL_KEYS) {
    // defineProperty throughout: `navigator` is a getter-only accessor on
    // Node's globalThis, so plain assignment would throw in strict mode.
    Object.defineProperty(globalThis, k, { value: values[k], configurable: true, writable: true, enumerable: false });
  }
  return () => {
    for (const [k, desc] of saved) {
      if (desc) Object.defineProperty(globalThis, k, desc);
      else delete (globalThis as any)[k];
    }
  };
}

// Renders share process-wide globals — serialize them.
let renderChain: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = renderChain.then(job, job);
  renderChain = run.catch(() => { /* keep the chain alive */ });
  return run;
}

let renderCounter = 0;

// ---------------------------------------------------------------------------
// Public rendering API.
// ---------------------------------------------------------------------------

/** Options for headless mermaid rendering. */
export interface MermaidRenderConfig {
  /** mermaid theme name ("default", "dark", "forest", "neutral", "base"). */
  theme?: string;
  /** Extra options merged into mermaid.initialize(). Note htmlLabels is
   *  forced OFF: the headless pipeline measures/loads svg-text labels only. */
  mermaidConfig?: Record<string, unknown>;
}

async function renderMermaidInternal(
  source: string,
  config: MermaidRenderConfig,
): Promise<{ svg: string; renderId: string }> {
  const { JSDOM, VirtualConsole, createCanvas } = await loadDeps();
  return enqueue(async () => {
    sharedDom ??= makeDom(JSDOM, VirtualConsole, createCanvas);
    const restore = installGlobals(sharedDom.window);
    try {
      if (!mermaidModule) {
        // Import under installed globals: dompurify captures `window` at
        // module-evaluation time.
        mermaidModule = (await dynamicImport("mermaid")).default;
      }
      const mermaid = mermaidModule;
      mermaid.initialize({
        startOnLoad: false,
        theme: config.theme ?? "default",
        securityLevel: "loose",
        ...(config.mermaidConfig ?? {}),
        // svg-text label measurement is what the shim satisfies; html labels
        // (foreignObject) can't be measured headlessly nor drawn by SVGMobject.
        htmlLabels: false,
        flowchart: { ...((config.mermaidConfig as any)?.flowchart ?? {}), htmlLabels: false },
        class: { ...((config.mermaidConfig as any)?.class ?? {}), htmlLabels: false },
        state: { ...((config.mermaidConfig as any)?.state ?? {}), htmlLabels: false },
      });
      const renderId = `mmd${renderCounter++}`;
      const { svg } = await mermaid.render(renderId, source);
      // mermaid removes its temp element, but failed renders can leave error
      // divs behind; keep the persistent body clean between calls.
      const body = sharedDom.window.document.body;
      while (body.firstChild) body.removeChild(body.firstChild);
      return { svg, renderId };
    } finally {
      // Kill any rAF chain a diagram renderer (cytoscape) left running, so
      // the render never leaks timers that keep the host process alive.
      (sharedDom as any).__cancelPendingRaf?.();
      restore();
    }
  });
}

/** Render mermaid source to a raw SVG string, fully headless (no browser).
 *  Requires the optional 'mermaid' and 'jsdom' packages. */
export async function renderMermaidSvg(source: string, config: MermaidRenderConfig = {}): Promise<string> {
  const { svg } = await renderMermaidInternal(source, config);
  return svg;
}

// ---------------------------------------------------------------------------
// DiagramMobject: SVGMobject + mermaid-aware friendly ids.
// ---------------------------------------------------------------------------

/** Normalized diagram type names. */
export type MermaidDiagramType =
  | "flowchart" | "sequence" | "state" | "class" | "er" | "pie" | "gantt"
  | "git" | "journey" | "timeline" | "mindmap" | "quadrant" | "unknown";

// aria-roledescription (mermaid's own diagram tag on the root <svg>) → type.
const ARIA_TO_TYPE: Record<string, MermaidDiagramType> = {
  "flowchart-v2": "flowchart",
  flowchart: "flowchart",
  sequence: "sequence",
  stateDiagram: "state",
  class: "class",
  classDiagram: "class",
  er: "er",
  pie: "pie",
  gantt: "gantt",
  gitGraph: "git",
  journey: "journey",
  timeline: "timeline",
  mindmap: "mindmap",
  quadrantChart: "quadrant",
};

// First keyword of the source → type (fallback when aria is missing).
const KEYWORD_TO_TYPE: Record<string, MermaidDiagramType> = {
  graph: "flowchart",
  flowchart: "flowchart",
  sequencediagram: "sequence",
  statediagram: "state",
  "statediagram-v2": "state",
  classdiagram: "class",
  erdiagram: "er",
  pie: "pie",
  gantt: "gantt",
  gitgraph: "git",
  journey: "journey",
  timeline: "timeline",
  mindmap: "mindmap",
  quadrantchart: "quadrant",
};

interface IdRecord {
  /** Raw id as it appears in the SVG (with render-instance prefix). */
  raw: string;
  /** Raw id with the `<renderId>-`/`<renderId>_` prefix stripped. */
  short: string;
  attrs: Record<string, string>;
}

// Friendly-id conventions, per diagram type (see buildAliases):
//   flowchart:  node  `mmdN-flowchart-A-0`       → "A"
//               edge  `mmdN-L_A_B_0`             → "L_A_B_0" and "A_B"
//   state:      node  `mmdN-state-Idle-1`        → "Idle"  ([*] → "root_start"/"root_end")
//               edge  `mmdN-edge0`               → "edge0"
//   class:      node  `mmdN-classId-Animal-2`    → "Animal"
//               edge  `mmdN-id_Animal_Dog_1`     → "id_Animal_Dog_1" and "Animal_Dog"
//   er:         node  `mmdN-entity-USER-0`       → "USER"
//               edge  `mmdN-id_entity-USER-0_entity-ORDER-1_0` → that short and "USER_ORDER"
//   sequence:   actors carry data-id/name attributes ("Alice") on the
//               `root-N` participant group and `actorN` lifeline → "Alice".
//               Messages have no ids in mermaid's output → edgeIds() is [].
//   gantt:      task bars `mmdN-<taskId>` → "<taskId>" (label ids `*-text` skipped)
//   journey:    `mmdN-taskN` → "taskN"
//   timeline:   `mmdN-node-N` → "node-N"
//   mindmap:    node `mmdN-node_N` → "node_N"; edge `mmdN-edge_I_J` → "edge_I_J"
//   pie/quadrant/git: mermaid emits no per-element ids → nodeIds()/edgeIds() empty.
function buildAliases(
  type: MermaidDiagramType,
  records: IdRecord[],
): { aliases: Map<string, string[]>; nodeIds: string[]; edgeIds: string[] } {
  const aliases = new Map<string, string[]>();
  const nodeIds: string[] = [];
  const edgeIds: string[] = [];
  const addAlias = (friendly: string, raw: string) => {
    const list = aliases.get(friendly) ?? [];
    if (!list.includes(raw)) list.push(raw);
    aliases.set(friendly, list);
  };
  const addNode = (friendly: string, raw: string) => {
    addAlias(friendly, raw);
    if (!nodeIds.includes(friendly)) nodeIds.push(friendly);
  };
  const addEdge = (friendly: string, raw: string) => {
    addAlias(friendly, raw);
    if (!edgeIds.includes(friendly)) edgeIds.push(friendly);
  };

  for (const { raw, short, attrs } of records) {
    // Every element is addressable by its prefix-stripped short id too.
    if (short !== raw) addAlias(short, raw);
    let m: RegExpExecArray | null;
    switch (type) {
      case "flowchart":
        if ((m = /^flowchart-(.+)-\d+$/.exec(short))) addNode(m[1], raw);
        else if ((m = /^L[-_](.+)[-_]\d+$/.exec(short))) { addEdge(short, raw); addAlias(m[1].replace(/-/g, "_"), raw); }
        break;
      case "state":
        if ((m = /^state-(.+)-\d+$/.exec(short))) addNode(m[1], raw);
        else if (/^edge\d+$/.test(short)) addEdge(short, raw);
        break;
      case "class":
        if ((m = /^classId-(.+)-\d+$/.exec(short))) addNode(m[1], raw);
        else if ((m = /^id_(.+)_\d+$/.exec(short))) { addEdge(short, raw); addAlias(m[1], raw); }
        break;
      case "er":
        if ((m = /^entity-(.+)-\d+$/.exec(short))) addNode(m[1], raw);
        else if (/^id_.+_\d+$/.test(short)) {
          addEdge(short, raw);
          const pair = /entity-(.+)-\d+_entity-(.+)-\d+/.exec(short);
          if (pair) addAlias(`${pair[1]}_${pair[2]}`, raw);
        }
        break;
      case "sequence": {
        const name = attrs["data-id"] ?? attrs["name"];
        if (name && (attrs["data-et"] === "participant" || /^root-\d+$/.test(short) || /^actor\d+$/.test(short))) {
          addNode(name, raw);
        }
        break;
      }
      case "gantt":
        if (!short.endsWith("-text")) addNode(short, raw);
        break;
      case "journey":
        if (/^task\d+$/.test(short)) addNode(short, raw);
        break;
      case "timeline":
        if (/^node-\d+$/.test(short)) addNode(short, raw);
        break;
      case "mindmap":
        if (/^node_\d+$/.test(short)) addNode(short, raw);
        else if (/^edge_\d+_\d+$/.test(short)) addEdge(short, raw);
        break;
      default:
        break;
    }
  }
  return { aliases, nodeIds, edgeIds };
}

/** Extra options for loadMermaid / DiagramMobject. */
export interface MermaidLoadConfig extends SVGMobjectConfig, MermaidRenderConfig {}

/** A rendered mermaid diagram as an SVGMobject, with mermaid-aware friendly
 *  ids layered over the raw SVG element ids. */
export class DiagramMobject extends SVGMobject {
  /** Normalized diagram type ("flowchart", "sequence", "state", ...). */
  readonly diagramType: MermaidDiagramType;
  /** friendly id → raw SVG ids (render-instance prefixes intact). */
  readonly friendlyIds = new Map<string, string[]>();
  private readonly _nodeIds: string[];
  private readonly _edgeIds: string[];

  constructor(
    svgString: string,
    config: SVGMobjectConfig = {},
    options: { renderId?: string; sourceKeyword?: string } = {},
  ) {
    // Strip <marker> definitions before SVGMobject parses: mermaid emits them
    // as siblings (not inside <defs>), and SVGMobject would otherwise render
    // every arrowhead prototype as stray geometry near the origin.
    const cleaned = svgString.replace(/<marker\b[\s\S]*?<\/marker>/g, "");
    super(cleaned, config);

    const tree = parseXML(cleaned);
    const aria = tree.attrs?.["aria-roledescription"] ?? "";
    this.diagramType =
      ARIA_TO_TYPE[aria] ??
      KEYWORD_TO_TYPE[(options.sourceKeyword ?? "").toLowerCase()] ??
      "unknown";

    // Collect every id'd element (with attributes) in document order.
    const renderId = options.renderId ?? tree.attrs?.id ?? "";
    const prefixRe = renderId ? new RegExp(`^${renderId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[-_]`) : null;
    const records: IdRecord[] = [];
    const visit = (node: XmlNode) => {
      const id = node.attrs?.id;
      if (id && id !== renderId) {
        records.push({ raw: id, short: prefixRe ? id.replace(prefixRe, "") : id, attrs: node.attrs });
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);

    const { aliases, nodeIds, edgeIds } = buildAliases(this.diagramType, records);
    this.friendlyIds = aliases;
    // Only ids that resolved to actual drawable geometry are reported.
    const resolvable = (friendly: string) =>
      (aliases.get(friendly) ?? []).some((rawId) => this.ids.has(rawId)) || this.ids.has(friendly);
    this._nodeIds = nodeIds.filter(resolvable);
    this._edgeIds = edgeIds.filter(resolvable);

    // Default world sizing: fit within ~10 units wide x 7 tall (preserving
    // aspect), unless the caller pinned an explicit width/height.
    if (config.width == null && config.height == null) {
      const w = this.getWidth(), h = this.getHeight();
      if (w > 1e-9 && h > 1e-9) this.scale(Math.min(10 / w, 7 / h));
    }
  }

  /** Friendly node ids for this diagram (see the per-type conventions). */
  nodeIds(): string[] {
    return [...this._nodeIds];
  }

  /** Friendly edge ids for this diagram (empty for types without edge ids). */
  edgeIds(): string[] {
    return [...this._edgeIds];
  }

  override hasId(id: string): boolean {
    if (super.hasId(id)) return true;
    return (this.friendlyIds.get(id) ?? []).some((raw) => super.hasId(raw));
  }

  /** Look up by raw SVG id OR friendly mermaid id ("A", "Alice", "L_A_B_0"). */
  override byId(id: string): VGroup {
    if (this.ids.has(id)) return super.byId(id);
    const raws = (this.friendlyIds.get(id) ?? []).filter((raw) => this.ids.has(raw));
    if (raws.length > 0) {
      const group = new VGroup();
      for (const raw of raws) group.add(...(this.ids.get(raw) ?? []));
      return group;
    }
    const available = [...new Set([...this.friendlyIds.keys(), ...this.ids.keys()])].join(", ") || "(none)";
    throw new Error(`DiagramMobject.byId: no element with id "${id}". Available ids: ${available}`);
  }
}

/** Render mermaid source headlessly and load it as a DiagramMobject. */
export async function loadMermaid(source: string, config: MermaidLoadConfig = {}): Promise<DiagramMobject> {
  const { theme, mermaidConfig, ...svgConfig } = config;
  const { svg, renderId } = await renderMermaidInternal(source, { theme, mermaidConfig });
  const keyword = source.trim().split(/\s/, 1)[0] ?? "";
  return new DiagramMobject(svg, svgConfig, { renderId, sourceKeyword: keyword });
}

export default loadMermaid;
