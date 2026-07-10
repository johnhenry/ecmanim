// LaTeX math as real cubic-Bezier glyph OUTLINES (a VGroup of VMobjects), so
// Write traces the strokes and Transform morphs the math into other shapes.
// Pure JS: MathJax (mathjax-full) converts TeX -> SVG in Node's lite-DOM (no
// browser), then the SVG glyph paths are turned into VMobjects via the shared
// svg_path parser. No LaTeX binary required.
//
// This module mirrors ManimCommunity's mobject/text/tex_mobject.py at the
// glyph level:
//   - SingleStringMathTex : atomic unit, one tex string -> glyph VMobjects.
//   - MathTex             : *many* tex strings -> addressable PART VGroups,
//                           split by the isolated substrings / individual args.
//   - Tex                 : text mode (upright prose wrapped in \text{...}).

import { VMobject, VGroup } from "./VMobject.ts";
import { TransformMatchingTex } from "../animation/transform_matching.ts";
import { Color, WHITE } from "../core/color.ts";
import { parsePathToSubpaths } from "./svg_path.ts";
import type { ColorLike } from "../core/types.ts";

/** Configuration accepted by MathTex / Tex / texToVGroup. */
export interface MathTexConfig {
  color?: ColorLike;
  fillColor?: ColorLike;
  strokeColor?: ColorLike;
  fillOpacity?: number;
  strokeWidth?: number;
  strokeOpacity?: number;
  fontSize?: number;
  point?: number[];
  /** Environment the string is wrapped in, e.g. "align*" (math) or "center". */
  texEnvironment?: string;
  /** Substrings that MathTex should isolate as their own addressable parts. */
  substringsToIsolate?: string[];
  /** Alias accepted by manim; merged with substringsToIsolate. */
  isolate?: string[];
  /** Map of tex substring -> color, applied to matching parts on construction. */
  texToColorMap?: Record<string, ColorLike>;
  /** Separator joined between the individual tex string args. */
  argSeparator?: string;
  [key: string]: any;
}

// --- lazy, cached MathJax document -----------------------------------------
let _mj: any = null;

// MathJax modules are imported once, lazily, and memoized. Building a MathTex
// is synchronous once this promise has resolved (it resolves fast; the first
// convert warms the font cache).
let _initPromise: Promise<any> | null = null;

// True once we have fallen back to the browser CDN MathJax (window.MathJax).
// In that mode `_mj` stays null (there is no liteAdaptor / lite-DOM), and the
// glyph builder uses the browser DOM to walk the produced <svg> instead.
let _cdnMathJax: any = null;

function isNode(): boolean {
  return typeof process !== "undefined" && !!(process as any).versions?.node
    && typeof document === "undefined";
}

export function initMathTex(): Promise<any> {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    // --- Node path (primary): mathjax-full + liteAdaptor, unchanged. ---------
    // Only attempt the bundler-style npm import when we're clearly in Node. In
    // the browser this import needs a bundler and MathJax's global handler
    // registration can be broken by code-splitting, so we prefer the CDN there.
    if (isNode()) {
      const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }, { AllPackages }] =
        await Promise.all([
          import("mathjax-full/js/mathjax.js"),
          import("mathjax-full/js/input/tex.js"),
          import("mathjax-full/js/output/svg.js"),
          import("mathjax-full/js/adaptors/liteAdaptor.js"),
          import("mathjax-full/js/handlers/html.js"),
          import("mathjax-full/js/input/tex/AllPackages.js"),
        ]);
      const adaptor = liteAdaptor();
      RegisterHTMLHandler(adaptor);
      const input = new TeX({ packages: AllPackages });
      // fontCache "local" emits per-equation <defs><path> glyph definitions.
      const output = new SVG({ fontCache: "local" });
      const doc = mathjax.document("", { InputJax: input, OutputJax: output });
      _mj = { adaptor, doc };
      return _mj;
    }

    // --- Browser path: try the bundled npm import first, then CDN. -----------
    // If a bundler resolved mathjax-full, we can still use the liteAdaptor in
    // the browser. But bundler code-splitting is a known footgun: MathJax
    // registers its handler on a module-level singleton, and if that singleton
    // is duplicated/reset by chunk boundaries, `RegisterHTMLHandler` silently
    // fails to register and `mathjax.document(...)` throws "Handler ... not
    // found". So after wiring it up we verify by producing a trivial SVG; if
    // that fails, we discard it and fall back to the CDN <script> path.
    try {
      const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }, { AllPackages }] =
        await Promise.all([
          import("mathjax-full/js/mathjax.js"),
          import("mathjax-full/js/input/tex.js"),
          import("mathjax-full/js/output/svg.js"),
          import("mathjax-full/js/adaptors/liteAdaptor.js"),
          import("mathjax-full/js/handlers/html.js"),
          import("mathjax-full/js/input/tex/AllPackages.js"),
        ]);
      const adaptor = liteAdaptor();
      RegisterHTMLHandler(adaptor);
      const input = new TeX({ packages: AllPackages });
      const output = new SVG({ fontCache: "local" });
      const doc = mathjax.document("", { InputJax: input, OutputJax: output });
      // VERIFY the handler/singleton actually registered before trusting it.
      const probe = doc.convert("x", { display: true });
      if (!probe || !findSvg(adaptor, probe)) {
        throw new Error("MathJax handler not registered (code-splitting)");
      }
      _mj = { adaptor, doc };
      return _mj;
    } catch {
      // Fall through to the CDN loader below.
    }

    _cdnMathJax = await loadCdnMathJax();
    return { cdn: _cdnMathJax };
  })();
  return _initPromise;
}

// Load MathJax v3 (tex-svg) from a CDN <script> tag and wait until its startup
// document is ready. Returns the global `window.MathJax`. Used only in the
// browser when mathjax-full can't be resolved or its handler registration is
// broken by bundling.
function loadCdnMathJax(
  url = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js",
): Promise<any> {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("CDN MathJax requires a browser DOM (document is undefined)."));
  }
  const w = window as any;
  if (w.MathJax?.startup?.document) return Promise.resolve(w.MathJax);

  return new Promise((resolve, reject) => {
    // Configure MathJax before the script evaluates (v3 reads window.MathJax).
    if (!w.MathJax) {
      w.MathJax = { startup: { typeset: false } };
    }
    const finish = () => {
      const ready = w.MathJax?.startup?.promise ?? Promise.resolve();
      ready.then(() => {
        if (w.MathJax?.tex2svg || w.MathJax?.startup?.document) resolve(w.MathJax);
        else reject(new Error("MathJax loaded but tex2svg/startup.document is unavailable."));
      }).catch(reject);
    };
    // Reuse an existing tag if present.
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`);
    if (existing) {
      if (w.MathJax?.startup?.document) resolve(w.MathJax);
      else existing.addEventListener("load", finish, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => reject(new Error("Failed to load MathJax from " + url)));
    document.head.appendChild(script);
  });
}

// Produce a raw MathJax SVG string for a tex expression. This is the shared
// entry point used by the raster (mathtex_image) and dvisvgm backends. It works
// in Node (liteAdaptor) and the browser (bundled liteAdaptor OR CDN tex2svg).
// `await initMathTex()` must have resolved first.
export async function texToSVG(tex: string, config: MathTexConfig = {}): Promise<string> {
  await initMathTex();
  const wrapped = String(wrapEnvironment(String(tex), config.texEnvironment));

  // Node / bundled-liteAdaptor path.
  if (_mj) {
    const { adaptor, doc } = _mj;
    const container = doc.convert(wrapped, { display: true });
    const svgNode = findSvg(adaptor, container);
    if (!svgNode) throw new Error("MathJax produced no <svg> for: " + tex);
    return adaptor.outerHTML(svgNode);
  }

  // Browser CDN path: window.MathJax.tex2svg returns an mjx-container element.
  if (_cdnMathJax) {
    const container = _cdnMathJax.tex2svg(wrapped, { display: true });
    const svgEl = container?.querySelector?.("svg") ?? container;
    if (!svgEl) throw new Error("CDN MathJax produced no <svg> for: " + tex);
    return svgEl.outerHTML as string;
  }

  throw new Error("MathTex: no MathJax backend available; call `await initMathTex()` first.");
}

// --- 2x3 affine transform helpers ------------------------------------------
// Row-major [a, b, c, d, e, f] mapping (x,y) -> (a*x + c*y + e, b*x + d*y + f),
// matching SVG's transform matrix(a b c d e f).
type Affine = [number, number, number, number, number, number];
const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

function compose(m: Affine, n: Affine): Affine {
  // Apply n then m (m is the outer/parent transform): result = m * n.
  const [a, b, c, d, e, f] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * e2 + c * f2 + e,
    b * e2 + d * f2 + f,
  ];
}

function applyAffine(m: Affine, x: number, y: number): number[] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// Parse an SVG transform attribute (translate/scale/matrix, possibly chained)
// into a single composed 2x3 affine.
function parseTransform(str: string): Affine {
  if (!str) return IDENTITY;
  let m = IDENTITY;
  const re = /(translate|scale|matrix)\s*\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(str)) !== null) {
    const kind = match[1];
    const nums = match[2].split(/[\s,]+/).filter((s) => s.length).map(Number);
    let t: Affine = IDENTITY;
    if (kind === "translate") {
      t = [1, 0, 0, 1, nums[0] || 0, nums[1] || 0];
    } else if (kind === "scale") {
      const sx = nums[0] ?? 1;
      const sy = nums[1] ?? sx;
      t = [sx, 0, 0, sy, 0, 0];
    } else if (kind === "matrix") {
      t = [nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]];
    }
    m = compose(m, t);
  }
  return m;
}

// --- lite-DOM walk ----------------------------------------------------------
// Collect id -> path `d` from all <defs><path>, then instantiate every <use>
// and <rect> under the accumulated transform. Emits {type, ...} draw records.
function collectGlyphs(adaptor: any, svgNode: any): any[] {
  const defs: Record<string, string> = {};

  // liteAdaptor's childNodes() THROWS on text nodes (LiteText has no children
  // array) rather than returning [] -- and MathJax output can contain text
  // nodes (e.g. inside <merror> or title elements). Guard every descent.
  const kids = (node: any): any[] => {
    const kind = adaptor.kind(node);
    if (kind === "#text" || kind === "#comment" || kind === "#cdata") return [];
    try { return adaptor.childNodes(node) || []; } catch { return []; }
  };

  function scanDefs(node: any) {
    if (adaptor.kind(node).startsWith("#")) return;
    if (adaptor.kind(node) === "path") {
      const id = adaptor.getAttribute(node, "id");
      const d = adaptor.getAttribute(node, "d");
      if (id && d) defs[id] = d;
    }
    for (const child of kids(node)) scanDefs(child);
  }
  scanDefs(svgNode);

  const records: any[] = [];

  function walk(node: any, transform: Affine) {
    const kind = adaptor.kind(node);
    if (kind.startsWith("#")) return; // text/comment nodes: no attrs, no children
    // Accumulate this node's own transform (present on <g> and sometimes <use>).
    let m = transform;
    const tAttr = adaptor.getAttribute(node, "transform");
    if (tAttr) m = compose(m, parseTransform(tAttr));

    if (kind === "use") {
      // <use> may carry x/y offsets in addition to (or instead of) transform.
      const x = Number(adaptor.getAttribute(node, "x") || 0);
      const y = Number(adaptor.getAttribute(node, "y") || 0);
      if (x || y) m = compose(m, [1, 0, 0, 1, x, y]);
      let href = adaptor.getAttribute(node, "xlink:href") || adaptor.getAttribute(node, "href");
      if (href) {
        const id = href.replace(/^#/, "");
        const d = defs[id];
        if (d) records.push({ type: "path", d, m });
      }
    } else if (kind === "rect") {
      const x = Number(adaptor.getAttribute(node, "x") || 0);
      const y = Number(adaptor.getAttribute(node, "y") || 0);
      const w = Number(adaptor.getAttribute(node, "width") || 0);
      const h = Number(adaptor.getAttribute(node, "height") || 0);
      records.push({ type: "rect", x, y, w, h, m });
    }

    for (const child of kids(node)) walk(child, m);
  }
  walk(svgNode, IDENTITY);
  return records;
}

// Find the <svg> element inside the returned <mjx-container>.
function findSvg(adaptor: any, node: any): any {
  const kind = adaptor.kind(node);
  if (kind === "svg") return node;
  if (kind === "#text" || kind === "#comment") return null;
  let children: any[];
  try { children = adaptor.childNodes(node) || []; } catch { return null; }
  for (const child of children) {
    const found = findSvg(adaptor, child);
    if (found) return found;
  }
  return null;
}

// A DOMAdaptor-shaped shim (kind/getAttribute/childNodes -- the only three
// methods collectGlyphs()/findSvg() actually call) over a REAL browser
// Element tree, for CDN-loaded MathJax's output. mathjax-full's own
// liteAdaptor (used by `_mj`) is a *virtual* lite-DOM; CDN MathJax
// (`_cdnMathJax`, loaded via loadCdnMathJax() below) hands back genuine
// `HTMLElement`s from `tex2svg()`, which don't share that interface --
// this shim lets collectGlyphs()/findSvg() work unmodified against either.
// Exported so the glyph-building path is testable with a hand-built fake
// element tree, without needing jsdom or a real browser (see
// test/mathtex-cdn-glyphs.test.ts).
export const domAdaptor = {
  kind: (n: any): string | undefined => (n?.tagName ? String(n.tagName).toLowerCase() : undefined),
  getAttribute: (n: any, name: string): string | null => n?.getAttribute?.(name) ?? null,
  childNodes: (n: any): any[] => Array.from(n?.children ?? []),
};

// --- environment wrapping ----------------------------------------------------
// manim wraps the tex string in an environment (default "align*") before
// handing it to LaTeX. MathJax doesn't need the environment for plain math,
// but honoring it keeps alignment (`&`, `\\`) and text environments working.
function wrapEnvironment(texString: string, env?: string): string {
  if (!env) return texString;
  // "align*" et al. are math environments MathJax understands; "center" and
  // friends are text environments used by Tex — MathJax has no \begin{center},
  // so we degrade those to a bare \text{...} at the call site (see Tex).
  const mathEnvs = new Set([
    "align", "align*", "aligned", "gather", "gather*", "gathered",
    "equation", "equation*", "array", "matrix", "cases",
  ]);
  if (mathEnvs.has(env)) {
    return `\\begin{${env}}${texString}\\end{${env}}`;
  }
  return texString;
}

// --- raw glyph builder -------------------------------------------------------
// Render one tex string to a FLAT list of glyph VMobjects in raw font units
// (y already negated to world y-up, but NOT scaled or centered). Keeping this
// unscaled and uncentered is what makes glyph *counts* stable across separate
// renders, which is how MathTex slices the full expression into parts.
const UNIT = 1 / 1000;

function styleGlyph(mob: VMobject, fill: Color, stroke: Color, fo: number, sw: number, so: number) {
  mob.fillColor = Color.parse(fill);
  mob.strokeColor = Color.parse(stroke);
  mob.fillOpacity = fo;
  mob.strokeWidth = sw;
  mob.strokeOpacity = so;
}

// Turn structural glyph records (from collectGlyphs, either lite-adaptor or
// real-DOM sourced -- the records are backend-agnostic {type, ...} shapes)
// into styled VMobjects. Shared by both the Node/lite-adaptor and browser/CDN
// paths in texToGlyphList() below, and independently unit-testable.
function recordsToGlyphs(records: any[], config: MathTexConfig): VMobject[] {
  const fillColor = Color.parse(config.color ?? config.fillColor ?? WHITE);
  const strokeColor = Color.parse(config.strokeColor ?? config.color ?? WHITE);
  const fillOpacity = config.fillOpacity ?? 1;
  const strokeWidth = config.strokeWidth ?? 0;
  const strokeOpacity = config.strokeOpacity ?? (strokeWidth ? 1 : 0);

  const glyphs: VMobject[] = [];
  for (const rec of records) {
    const mob = new VMobject();
    if (rec.type === "path") {
      const subs = parsePathToSubpaths(rec.d);
      for (const sp of subs) {
        if (sp.length < 1) continue;
        mob.subpathStarts.push(mob.points.length);
        for (const p of sp) {
          const [x, y] = applyAffine(rec.m, p[0], p[1]);
          mob.points.push([x * UNIT, -y * UNIT, 0]);
        }
      }
    } else if (rec.type === "rect") {
      // Filled rectangle (fraction bar, sqrt vinculum) as a 4-corner subpath.
      const corners = [
        [rec.x, rec.y],
        [rec.x + rec.w, rec.y],
        [rec.x + rec.w, rec.y + rec.h],
        [rec.x, rec.y + rec.h],
      ].map(([cx, cy]) => applyAffine(rec.m, cx, cy));
      const pts = corners.map(([x, y]) => [x * UNIT, -y * UNIT, 0]);
      const loop = [...pts, pts[0]];
      mob.subpathStarts.push(0);
      mob.points.push(loop[0]);
      for (let i = 1; i < loop.length; i++) {
        const a = loop[i - 1], b = loop[i];
        const c1 = [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3, 0];
        const c2 = [a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3, 0];
        mob.points.push(c1, c2, b);
      }
    }
    if (mob.points.length) {
      styleGlyph(mob, fillColor, strokeColor, fillOpacity, strokeWidth, strokeOpacity);
      glyphs.push(mob);
    }
  }
  return glyphs;
}

/**
 * Build glyph VMobjects directly from a real browser `<svg>` Element (as
 * produced by CDN MathJax's `tex2svg()`), via the domAdaptor shim above.
 * Exported so this is independently testable with a hand-built fake element
 * tree -- see test/mathtex-cdn-glyphs.test.ts.
 */
export function glyphsFromDomSvg(svgElement: any, config: MathTexConfig = {}): VMobject[] {
  return recordsToGlyphs(collectGlyphs(domAdaptor, svgElement), config);
}

function texToGlyphList(texString: string, config: MathTexConfig): VMobject[] {
  const wrapped = wrapEnvironment(texString, config.texEnvironment);

  if (_mj) {
    const { adaptor, doc } = _mj;
    const container = doc.convert(String(wrapped), { display: true });
    const svgNode = findSvg(adaptor, container);
    if (!svgNode) throw new Error("MathJax produced no <svg> for: " + texString);
    return recordsToGlyphs(collectGlyphs(adaptor, svgNode), config);
  }

  if (_cdnMathJax) {
    // CDN MathJax's tex2svg() returns a real <mjx-container> HTMLElement (not
    // a lite-adaptor virtual node) -- find its <svg> with a plain DOM query
    // rather than the adaptor-based findSvg(), then hand it to the same
    // glyph builder every other path uses via the domAdaptor shim.
    const container = _cdnMathJax.tex2svg(String(wrapped), { display: true });
    const svgEl = container?.querySelector?.("svg") ?? null;
    if (!svgEl) throw new Error("MathJax produced no <svg> for: " + texString);
    return glyphsFromDomSvg(svgEl, config);
  }

  throw new Error("MathTex requires MathJax; call `await initMathTex()` once before constructing.");
}

// --- legacy public helper: build a scaled/centered VGroup from a tex string --
// Retained for backwards compatibility (index.ts re-exports it). Delegates to
// the raw glyph builder, then scales + positions like before.
export function texToVGroup(tex: string, config: MathTexConfig = {}): VGroup {
  const glyphs = texToGlyphList(String(tex), config);
  const group = new VGroup();
  group.add(...glyphs);

  const fillColor = Color.parse(config.color ?? config.fillColor ?? WHITE);
  const strokeColor = Color.parse(config.strokeColor ?? config.color ?? WHITE);
  const fillOpacity = config.fillOpacity ?? 1;
  const strokeWidth = config.strokeWidth ?? 0;
  const strokeOpacity = config.strokeOpacity ?? (strokeWidth ? 1 : 0);

  const fontSize = config.fontSize ?? 0.7;
  if (group.getHeight() > 1e-9) group.setHeight(fontSize);
  if (config.point) group.moveTo(config.point);
  else group.center();

  styleGlyph(group as any, fillColor, strokeColor, fillOpacity, strokeWidth, strokeOpacity);
  return group;
}

// --- SingleStringMathTex -----------------------------------------------------
// The atomic unit (manim: SingleStringMathTex). Renders exactly one tex string
// to glyph VMobjects. It is itself a VGroup whose submobjects are the glyphs.
export class SingleStringMathTex extends VGroup {
  tex: string;
  texEnvironment: string;

  constructor(texString = "", config: MathTexConfig = {}) {
    super();
    this.tex = String(texString);
    this.texEnvironment = config.texEnvironment ?? "align*";
    this.fillColor = Color.parse(config.color ?? config.fillColor ?? WHITE);
    this.strokeColor = Color.parse(config.strokeColor ?? config.color ?? WHITE);
    const glyphs = texToGlyphList(this.tex, { ...config, texEnvironment: this.texEnvironment });
    this.add(...glyphs);
    this.fillOpacity = config.fillOpacity ?? 1;
    this.strokeWidth = config.strokeWidth ?? 0;
    this.strokeOpacity = config.strokeOpacity ?? (this.strokeWidth ? 1 : 0);
  }

  setStyle(style: any): this {
    for (const g of this.submobjects) (g as any).setStyle?.(style);
    return this;
  }
}

// --- MathTex (multi-string, part-addressable) --------------------------------
// Separate the trailing config object (if any) from the variadic tex strings.
function splitArgs(args: any[]): { texStrings: string[]; config: MathTexConfig } {
  let config: MathTexConfig = {};
  const strs = args.slice();
  const last = strs[strs.length - 1];
  if (strs.length > 0 && last !== null && typeof last === "object" && !Array.isArray(last)) {
    config = last as MathTexConfig;
    strs.pop();
  }
  return { texStrings: strs.map((s) => String(s)), config };
}

// Given the ordered break-substrings, count how many glyphs each one renders
// to on its own; those counts slice the full glyph list into parts. This
// mirrors manim's break_up_by_substrings, but at the glyph level: instead of
// SVG-path matching we render each part independently and trust MathJax to be
// deterministic about glyph counts.
function countGlyphs(texString: string, config: MathTexConfig): number {
  if (texString.trim().length === 0) return 0;
  try {
    return texToGlyphList(texString, config).length;
  } catch {
    return 0;
  }
}

export class MathTex extends VGroup {
  tex: string;
  texStrings: string[];
  texEnvironment: string;
  argSeparator: string;
  substringsToIsolate: string[];
  texToColorMap: Record<string, ColorLike>;
  /** Each entry is a VGroup of the glyphs belonging to one addressable part. */
  parts: VGroup[];
  private _partTex: string[];

  // Backwards compatible: `new MathTex("x^2", { fontSize })` still works.
  // New:                  `new MathTex("x^2", "+", "1", { texToColorMap })`.
  constructor(...args: any[]) {
    super();
    const { texStrings, config } = splitArgs(args);

    this.texEnvironment = config.texEnvironment ?? "align*";
    this.argSeparator = config.argSeparator ?? this.defaultArgSeparator();
    this.substringsToIsolate = [
      ...(config.substringsToIsolate ?? []),
      ...(config.isolate ?? []),
    ];
    this.texToColorMap = config.texToColorMap ?? {};
    this.texStrings = texStrings.length ? texStrings : [""];

    // Full combined tex string (what actually gets rendered).
    this.tex = this.texStrings.join(this.argSeparator);

    this.fillColor = Color.parse(config.color ?? config.fillColor ?? WHITE);
    this.strokeColor = Color.parse(config.strokeColor ?? config.color ?? WHITE);

    // 1. Render the full expression to a flat glyph list.
    const renderConfig: MathTexConfig = { ...config, texEnvironment: this.texEnvironment };
    const allGlyphs = texToGlyphList(this.preprocessTex(this.tex), renderConfig);

    // 2. Determine the ordered list of "parts" (the break-substrings). Start
    //    from the individual tex string args, then further split each by the
    //    isolated substrings + texToColorMap keys.
    const isolateKeys = [
      ...this.substringsToIsolate,
      ...Object.keys(this.texToColorMap),
    ].filter((k) => k.length > 0);
    const partTex: string[] = [];
    for (const s of this.texStrings) {
      for (const piece of breakBySubstrings(s, isolateKeys)) {
        if (piece.length) partTex.push(piece);
      }
    }
    if (partTex.length === 0) partTex.push(this.tex);

    // 3. Count each part's glyphs by rendering it independently, then slice
    //    the full glyph list by those counts. If the counts don't line up with
    //    the full render (spacing/kerning glyphs, \text runs, etc.), fall back
    //    to a single part holding all glyphs so nothing is dropped.
    const counts = partTex.map((p) => countGlyphs(this.preprocessTex(p), renderConfig));
    const total = counts.reduce((a, b) => a + b, 0);

    this.parts = [];
    this._partTex = [];
    if (total === allGlyphs.length && partTex.length > 0) {
      let idx = 0;
      for (let i = 0; i < partTex.length; i++) {
        const part = new VGroup();
        part.add(...allGlyphs.slice(idx, idx + counts[i]));
        idx += counts[i];
        this.parts.push(part);
        this._partTex.push(partTex[i]);
      }
    } else {
      // Counts didn't reconcile: keep one part per tex-string arg if we can,
      // else a single all-glyph part. Glyphs are distributed proportionally.
      const part = new VGroup();
      part.add(...allGlyphs);
      this.parts.push(part);
      this._partTex.push(this.tex);
    }

    // 4. Attach the glyphs. For a SINGLE part (the common `new MathTex("x^2")`
    //    case) keep the legacy behavior: `submobjects` are the flat glyphs, so
    //    existing code / tests that index glyphs directly keep working. For
    //    multiple parts, `submobjects` are the part VGroups. Either way the
    //    part API (getPartByTex, ...) works off `this.parts`, and flat glyph
    //    access is available via `glyphs()`.
    if (this.parts.length <= 1) {
      this.add(...allGlyphs);
    } else {
      this.add(...this.parts);
    }

    this.fillOpacity = config.fillOpacity ?? 1;
    this.strokeWidth = config.strokeWidth ?? 0;
    this.strokeOpacity = config.strokeOpacity ?? (this.strokeWidth ? 1 : 0);

    // 5. Scale + position (was previously done inside texToVGroup).
    const fontSize = config.fontSize ?? 0.7;
    if (this.getHeight() > 1e-9) this.setHeight(fontSize);
    if (config.point) this.moveTo(config.point);
    else this.center();

    // 6. Apply colors from texToColorMap on construction.
    if (Object.keys(this.texToColorMap).length) {
      this.setColorByTexToColorMap(this.texToColorMap);
    }
  }

  // Overridden by Tex (text mode) to wrap prose in \text{...}.
  protected defaultArgSeparator(): string {
    return " ";
  }

  // Hook for subclasses (Tex) to transform a tex piece before rendering.
  protected preprocessTex(tex: string): string {
    return tex;
  }

  // --- flat glyph access (kept for compatibility & animations) --------------
  glyphs(): VMobject[] {
    const out: VMobject[] = [];
    for (const part of this.parts) {
      for (const g of part.submobjects) out.push(g as VMobject);
    }
    return out;
  }

  // --- part API (mirrors manim) ---------------------------------------------
  getPartsByTex(tex: string): VGroup[] {
    const needle = String(tex);
    const out: VGroup[] = [];
    for (let i = 0; i < this.parts.length; i++) {
      if (this._partTex[i].includes(needle)) out.push(this.parts[i]);
    }
    return out;
  }

  getPartByTex(tex: string, config: { substringToIsolate?: string } = {}): VGroup | null {
    const needle = config.substringToIsolate ?? String(tex);
    for (let i = 0; i < this.parts.length; i++) {
      if (this._partTex[i].includes(needle)) return this.parts[i];
    }
    return null;
  }

  indexOfPart(part: VGroup): number {
    return this.parts.indexOf(part);
  }

  indexOfPartByTex(tex: string): number {
    const part = getFirstMatch(this._partTex, String(tex));
    return part;
  }

  setColorByTex(tex: string, color: ColorLike): this {
    for (const part of this.getPartsByTex(tex)) {
      (part as any).setColor(color);
    }
    return this;
  }

  setColorByTexToColorMap(map: Record<string, ColorLike>): this {
    for (const [tex, color] of Object.entries(map)) {
      this.setColorByTex(tex, color);
    }
    return this;
  }

  setOpacityByTex(tex: string, opacity = 0.5): this {
    for (const part of this.getPartsByTex(tex)) {
      (part as any).setOpacity(opacity);
    }
    return this;
  }

  sortAlphabetically(): this {
    const order = this.parts
      .map((p, i) => ({ p, t: this._partTex[i] }))
      .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
    this.parts = order.map((o) => o.p);
    this._partTex = order.map((o) => o.t);
    if (this.parts.length > 1) this.submobjects = this.parts.slice();
    return this;
  }

  setStyle(style: any): this {
    for (const part of this.parts) (part as any).setStyle?.(style);
    return this;
  }
}

// index of the first part whose tex contains `needle`, or -1.
function getFirstMatch(partTex: string[], needle: string): number {
  for (let i = 0; i < partTex.length; i++) {
    if (partTex[i].includes(needle)) return i;
  }
  return -1;
}

// Break a single tex string into ordered pieces at the given substrings,
// keeping the substrings themselves as pieces (manim: break_up_by_substrings).
function breakBySubstrings(texString: string, substrings: string[]): string[] {
  // Longest-first so nested/overlapping isolate keys match greedily.
  const keys = substrings.filter((s) => s.length).sort((a, b) => b.length - a.length);
  if (keys.length === 0) return [texString];

  const pieces: string[] = [];
  let i = 0;
  let buffer = "";
  while (i < texString.length) {
    let matched = "";
    for (const k of keys) {
      if (texString.startsWith(k, i)) { matched = k; break; }
    }
    if (matched) {
      if (buffer) { pieces.push(buffer); buffer = ""; }
      pieces.push(matched);
      i += matched.length;
    } else {
      buffer += texString[i];
      i++;
    }
  }
  if (buffer) pieces.push(buffer);
  return pieces;
}

// --- Tex (text mode) ---------------------------------------------------------
// Renders content as upright PROSE rather than italic math. MathJax has no
// LaTeX text mode of its own, so we wrap plain runs in \text{...} (which uses
// the upright roman font) and leave $...$ / \(...\) math untouched.
export class Tex extends MathTex {
  constructor(...args: any[]) {
    super(...args);
  }

  protected defaultArgSeparator(): string {
    return "";
  }

  // Wrap prose in \text{...} so it renders upright. Runs already inside math
  // delimiters ($...$) or already \text{...} are left as-is.
  protected preprocessTex(tex: string): string {
    return toTextMode(tex);
  }
}

// Wrap a command-free prose run in \text{...}, hoisting TeX control
// sequences (\LaTeX, \alpha, ...) OUT of the wrapper -- base MathJax does
// not expand macros inside \text{} (that needs the textmacros extension),
// so \text{This is some \LaTeX} renders an error box instead of the logo.
function wrapProse(run: string): string {
  const parts = run.split(/(\\[a-zA-Z]+\s*)/);
  return parts
    .filter((part) => part.length)
    .map((part) => (part.startsWith("\\") ? part : `\\text{${part}}`))
    .join("");
}

// Convert a Tex string to something MathJax renders upright. If the string has
// no math delimiters and isn't already a \text/\mathrm command, wrap the whole
// thing in \text{...}. If it contains $...$ segments, wrap only the non-math
// runs.
function toTextMode(tex: string): string {
  if (tex.length === 0) return tex;
  if (/^\s*\\(text|mathrm|mbox|textrm)\s*\{/.test(tex)) return tex;

  if (!tex.includes("$")) {
    return wrapProse(tex);
  }

  // Mixed prose + inline math: split on $...$ and wrap prose runs only.
  const out: string[] = [];
  let inMath = false;
  let buf = "";
  for (let i = 0; i < tex.length; i++) {
    const ch = tex[i];
    if (ch === "$") {
      if (inMath) {
        out.push(buf); // math run, verbatim
      } else if (buf.length) {
        out.push(wrapProse(buf));
      }
      buf = "";
      inMath = !inMath;
    } else {
      buf += ch;
    }
  }
  if (buf.length) out.push(inMath ? buf : wrapProse(buf));
  return out.join("");
}

// ---------------------------------------------------------------------------
// matchTex — Motion Canvas parity (MC6): MC's `Latex.tex(newStr, duration)`
// animates a LaTeX string in place, treating `{{...}}` as match groups. Here
// the `{{...}}` groups become substringsToIsolate on a fresh MathTex and the
// morph is a TransformMatchingTex. Play the returned animation, then keep
// using `anim.target` (the old mobject is replaced on screen by the match).
// ---------------------------------------------------------------------------

/** Parse MC-style `{{group}}` markers: returns the tex with markers stripped
 *  plus the list of isolated group strings. */
export function parseTexGroups(tex: string): { tex: string; isolate: string[] } {
  const isolate: string[] = [];
  const stripped = tex.replace(/\{\{(.*?)\}\}/g, (_m, inner: string) => {
    const t = inner.trim();
    if (t.length) isolate.push(t);
    return inner;
  });
  return { tex: stripped, isolate };
}

export interface MatchTexResult {
  animation: TransformMatchingTex;
  target: MathTex;
}

/**
 * Build the target MathTex for `newTexString` (with `{{...}}` groups
 * isolated, MC-style) and a TransformMatchingTex morphing `old` into it.
 * Extra isolate keys and the old mobject's isolate list are honored so
 * shared substrings pair up. Usage:
 *
 * ```ts
 * const { animation, target } = matchTex(eq, "{{a^2}} + {{b^2}} = c^2");
 * await scene.play(animation);   // `target` is now on screen
 * ```
 */
export function matchTex(
  old: MathTex,
  newTexString: string,
  config: MathTexConfig & { keyMap?: Record<string, string>; runTime?: number } = {},
): MatchTexResult {
  const { keyMap, runTime, ...texConfig } = config as any;
  const parsed = parseTexGroups(newTexString);
  const target = new MathTex(parsed.tex, {
    ...texConfig,
    substringsToIsolate: [
      ...parsed.isolate,
      ...(texConfig.substringsToIsolate ?? []),
      ...old.substringsToIsolate,
    ],
  });
  // Keep the new expression where the old one sits (MC edits in place).
  target.moveTo(old.getCenter());
  const animation = new TransformMatchingTex(old, target, { keyMap, runTime });
  return { animation, target };
}
