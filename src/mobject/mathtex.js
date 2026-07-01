// LaTeX math as real cubic-Bezier glyph OUTLINES (a VGroup of VMobjects), so
// Write traces the strokes and Transform morphs the math into other shapes.
// Pure JS: MathJax (mathjax-full) converts TeX -> SVG in Node's lite-DOM (no
// browser), then the SVG glyph paths are turned into VMobjects via the shared
// svg_path parser. No LaTeX binary required.

import { VMobject, VGroup } from "./VMobject.js";
import { Color, WHITE } from "../core/color.js";
import { parsePathToSubpaths } from "./svg_path.js";

// --- lazy, cached MathJax document -----------------------------------------
let _mj = null;

// MathJax modules are imported once, lazily, and memoized. Building a MathTex
// is synchronous once this promise has resolved (it resolves fast; the first
// convert warms the font cache).
let _initPromise = null;

export function initMathTex() {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
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
  })();
  return _initPromise;
}

// --- 2x3 affine transform helpers ------------------------------------------
// Row-major [a, b, c, d, e, f] mapping (x,y) -> (a*x + c*y + e, b*x + d*y + f),
// matching SVG's transform matrix(a b c d e f).
const IDENTITY = [1, 0, 0, 1, 0, 0];

function compose(m, n) {
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

function applyAffine(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// Parse an SVG transform attribute (translate/scale/matrix, possibly chained)
// into a single composed 2x3 affine.
function parseTransform(str) {
  if (!str) return IDENTITY;
  let m = IDENTITY;
  const re = /(translate|scale|matrix)\s*\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(str)) !== null) {
    const kind = match[1];
    const nums = match[2].split(/[\s,]+/).filter((s) => s.length).map(Number);
    let t = IDENTITY;
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
function collectGlyphs(adaptor, svgNode) {
  const defs = {};

  function scanDefs(node) {
    if (adaptor.kind(node) === "path") {
      const id = adaptor.getAttribute(node, "id");
      const d = adaptor.getAttribute(node, "d");
      if (id && d) defs[id] = d;
    }
    for (const child of adaptor.childNodes(node) || []) scanDefs(child);
  }
  scanDefs(svgNode);

  const records = [];

  function walk(node, transform) {
    const kind = adaptor.kind(node);
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

    for (const child of adaptor.childNodes(node) || []) walk(child, m);
  }
  walk(svgNode, IDENTITY);
  return records;
}

// Find the <svg> element inside the returned <mjx-container>.
function findSvg(adaptor, node) {
  if (adaptor.kind(node) === "svg") return node;
  for (const child of adaptor.childNodes(node) || []) {
    const found = findSvg(adaptor, child);
    if (found) return found;
  }
  return null;
}

// --- build a VGroup from a TeX string --------------------------------------
// MathJax draws glyphs in font units (hundreds tall) with a y-UP convention,
// then wraps everything in an outer scale(1,-1). Applying the fully composed
// affine to each point yields SVG-style y-DOWN screen coordinates; we flip that
// once (negate y) to reach manim's y-UP world. No double flip.
export function texToVGroup(tex, config = {}) {
  if (!_mj) throw new Error("MathTex requires MathJax; call `await initMathTex()` once before constructing.");
  const { adaptor, doc } = _mj;

  const container = doc.convert(String(tex), { display: true });
  const svgNode = findSvg(adaptor, container);
  if (!svgNode) throw new Error("MathJax produced no <svg> for: " + tex);

  const records = collectGlyphs(adaptor, svgNode);

  const fillColor = Color.parse(config.color ?? config.fillColor ?? WHITE);
  const strokeColor = Color.parse(config.strokeColor ?? config.color ?? WHITE);
  const fillOpacity = config.fillOpacity ?? 1;
  const strokeWidth = config.strokeWidth ?? 0;
  const strokeOpacity = config.strokeOpacity ?? (strokeWidth ? 1 : 0);

  // MathJax font units are large; pre-scale to keep world numbers sane before
  // the final setHeight. y is negated to go from SVG y-down -> world y-up.
  const UNIT = 1 / 1000;
  const group = new VGroup();

  const styleMob = (mob) => {
    mob.fillColor = Color.parse(fillColor);
    mob.strokeColor = Color.parse(strokeColor);
    mob.fillOpacity = fillOpacity;
    mob.strokeWidth = strokeWidth;
    mob.strokeOpacity = strokeOpacity;
  };

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
      // Close the loop and normalize corner points into cubic segments.
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
      styleMob(mob);
      group.add(mob);
    }
  }

  // Size to world units and place. fontSize is the target math height.
  const fontSize = config.fontSize ?? 0.7;
  if (group.getHeight() > 1e-9) group.setHeight(fontSize);
  if (config.point) group.moveTo(config.point);
  else group.center();

  styleMob(group);
  return group;
}

// --- public classes ---------------------------------------------------------
export class MathTex extends VGroup {
  // new MathTex(tex, { fontSize, color, fillOpacity, strokeWidth, point })
  constructor(tex = "", config = {}) {
    super();
    this.tex = String(tex);
    this.fillColor = Color.parse(config.color ?? config.fillColor ?? WHITE);
    this.strokeColor = Color.parse(config.strokeColor ?? config.color ?? WHITE);
    const built = texToVGroup(this.tex, config);
    this.add(...built.submobjects);
    this.fillOpacity = config.fillOpacity ?? 1;
    this.strokeWidth = config.strokeWidth ?? 0;
    this.strokeOpacity = config.strokeOpacity ?? (this.strokeWidth ? 1 : 0);
  }

  setStyle(style) {
    for (const g of this.submobjects) g.setStyle(style);
    return this;
  }
}

// Tex renders the string in MathJax's default math mode (same pipeline as
// MathTex). Kept simple: pass the string through unchanged.
export class Tex extends MathTex {
  constructor(tex = "", config = {}) {
    super(tex, config);
  }
}
