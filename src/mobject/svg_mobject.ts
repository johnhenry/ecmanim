// Load an SVG document (as a string) into a VGroup of VMobjects — one per
// drawable element — so an SVG can be animated with Write / Create / Transform
// like any other mobject. Works in Node AND the browser: the SVG is parsed with
// a tiny built-in XML parser (no DOM / DOMParser dependency). Path data is
// turned into cubic-Bezier subpaths via the shared svg_path parser; shapes
// (rect/circle/ellipse/line/poly) are synthesized directly.

import { VMobject, VGroup } from "./VMobject.ts";
import { Color } from "../core/color.ts";
import { parsePathToSubpaths } from "./svg_path.ts";
import { arcBezierPoints } from "../core/math/bezier.ts";
import { Intersection } from "./boolean_ops.ts";
import type { ColorLike } from "../core/types.ts";

/** A parsed XML element node. */
export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

/** Configuration accepted by SVGMobject. */
export interface SVGMobjectConfig {
  height?: number;
  width?: number;
  point?: number[];
  fillColor?: ColorLike;
  strokeColor?: ColorLike;
  color?: ColorLike;
  [key: string]: any;
}

/** A row-major 2x3 affine [a,b,c,d,e,f]. */
type Affine = [number, number, number, number, number, number];

// ---------------------------------------------------------------------------
// 1. Minimal XML parser -> { tag, attrs, children } tree. Text nodes ignored.
// Handles: elements, self-closing <x/>, nesting, single/double-quoted attrs,
// comments <!-- -->, <?xml ?>, <!DOCTYPE>, and <![CDATA[ ]]> (all skipped).
// ---------------------------------------------------------------------------
export function parseXML(str: string): XmlNode {
  let i = 0;
  const n = str.length;

  // Parse an attribute list starting at i, up to (but not consuming) `>` or `/`.
  const parseAttrs = (): Record<string, string> => {
    const attrs: Record<string, string> = {};
    while (i < n) {
      // skip whitespace
      while (i < n && /\s/.test(str[i])) i++;
      if (i >= n || str[i] === ">" || str[i] === "/") break;
      // attribute name
      let name = "";
      while (i < n && !/[\s=/>]/.test(str[i])) name += str[i++];
      while (i < n && /\s/.test(str[i])) i++;
      let value = "";
      if (str[i] === "=") {
        i++; // consume '='
        while (i < n && /\s/.test(str[i])) i++;
        const q = str[i];
        if (q === '"' || q === "'") {
          i++; // opening quote
          while (i < n && str[i] !== q) value += str[i++];
          i++; // closing quote
        } else {
          while (i < n && !/[\s/>]/.test(str[i])) value += str[i++];
        }
      }
      if (name) attrs[name] = decodeEntities(value);
    }
    return attrs;
  };

  // Parse children of the current element until its matching close tag.
  const parseNodes = (): XmlNode[] => {
    const nodes: XmlNode[] = [];
    while (i < n) {
      if (str[i] === "<") {
        // Comment / declaration / CDATA — skip wholesale.
        if (str.startsWith("<!--", i)) { i = skipTo(str, i, "-->"); continue; }
        if (str.startsWith("<![CDATA[", i)) { i = skipTo(str, i, "]]>"); continue; }
        if (str[i + 1] === "?") { i = skipTo(str, i, "?>"); continue; }
        if (str[i + 1] === "!") { i = skipTo(str, i, ">"); continue; } // <!DOCTYPE ...>
        if (str[i + 1] === "/") { i = skipTo(str, i, ">"); return nodes; } // close tag
        // Opening tag.
        i++; // consume '<'
        let tag = "";
        while (i < n && !/[\s/>]/.test(str[i])) tag += str[i++];
        const attrs = parseAttrs();
        let children: XmlNode[] = [];
        if (str[i] === "/") { i = skipTo(str, i, ">"); }        // self-closing
        else { i++; children = parseNodes(); }                  // consume '>', recurse
        nodes.push({ tag, attrs, children });
      } else {
        i++; // ignore text node characters
      }
    }
    return nodes;
  };

  const roots = parseNodes();
  // Return the first real element (usually <svg>); fall back to a wrapper.
  const svg = roots.find((r) => r.tag === "svg") || roots[0];
  return svg || { tag: "svg", attrs: {}, children: [] };
}

// Advance past the next occurrence of `end`, returning the index after it.
function skipTo(str: string, from: number, end: string): number {
  const idx = str.indexOf(end, from);
  return idx === -1 ? str.length : idx + end.length;
}

// Decode the handful of XML entities that appear in attribute values.
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// ---------------------------------------------------------------------------
// 2. Transform parsing. Affines are row-major [a,b,c,d,e,f] mapping
//    (x,y) -> (a*x + c*y + e, b*x + d*y + f) — matching SVG matrix(a b c d e f).
// ---------------------------------------------------------------------------
const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

// Multiply two affines: apply `child` first, then `parent` (result = parent*child).
export function compose(parent: Affine, child: Affine): Affine {
  const [a, b, c, d, e, f] = parent;
  const [a2, b2, c2, d2, e2, f2] = child;
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

// Parse an SVG transform attribute (chained translate/scale/rotate/matrix) into
// one composed affine.
export function parseTransform(str: string): Affine {
  if (!str) return IDENTITY.slice() as Affine;
  let m = IDENTITY.slice() as Affine;
  const re = /(translate|scale|rotate|matrix)\s*\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(str)) !== null) {
    const kind = match[1];
    const nums = match[2].split(/[\s,]+/).filter((s) => s.length).map(Number);
    let t: Affine = IDENTITY.slice() as Affine;
    if (kind === "translate") {
      t = [1, 0, 0, 1, nums[0] || 0, nums[1] || 0];
    } else if (kind === "scale") {
      const sx = nums[0] ?? 1;
      const sy = nums[1] ?? sx;
      t = [sx, 0, 0, sy, 0, 0];
    } else if (kind === "rotate") {
      const rad = ((nums[0] || 0) * Math.PI) / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const rot: Affine = [cos, sin, -sin, cos, 0, 0];
      if (nums.length >= 3) {
        // rotate(deg, cx, cy) = translate(cx,cy) * rot * translate(-cx,-cy)
        const cx = nums[1], cy = nums[2];
        t = compose(compose([1, 0, 0, 1, cx, cy], rot), [1, 0, 0, 1, -cx, -cy]);
      } else {
        t = rot;
      }
    } else if (kind === "matrix") {
      t = [nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]];
    }
    m = compose(m, t);
  }
  return m;
}

// ---------------------------------------------------------------------------
// 3. Style handling. SVG defaults: fill black (opaque), no stroke. Presentation
//    attributes are overridden by inline `style="..."`. Style inherits down the
//    tree; children override parents.
// ---------------------------------------------------------------------------
const DRAWABLE = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);

// Definition-only containers: their contents are referenced (by id, via
// url(#id)/clip-path) rather than rendered in place. Previously NOT excluded
// from the render walk, so e.g. a <rect> inside a <clipPath> was incorrectly
// drawn as ordinary visible content.
const NON_RENDERING_CONTAINERS = new Set([
  "defs", "clipPath", "linearGradient", "radialGradient", "symbol", "mask", "pattern",
]);

// Walk the whole tree once (regardless of tag) recording every id'd node, so
// url(#id)/clip-path references can resolve regardless of document order
// (SVG allows a reference to appear before its <defs> definition).
function collectDefs(root: XmlNode): Map<string, XmlNode> {
  const defs = new Map<string, XmlNode>();
  const visit = (node: XmlNode) => {
    if (node.attrs?.id) defs.set(node.attrs.id, node);
    for (const child of node.children || []) visit(child);
  };
  visit(root);
  return defs;
}

// Parse a CSS style string ("fill:#f00;stroke:none") into a plain object.
function parseStyleString(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s) return out;
  for (const decl of s.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const k = decl.slice(0, idx).trim();
    const v = decl.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

// Collect the style-relevant props for a node, folding presentation attributes
// and inline style together (style wins). Only defined keys are returned so
// they can be layered over the inherited parent style.
function readStyleProps(attrs: Record<string, string>): Record<string, string> {
  const inline = parseStyleString(attrs.style);
  const props: Record<string, string> = {};
  const KEYS = ["fill", "stroke", "stroke-width", "fill-opacity", "stroke-opacity", "opacity"];
  for (const k of KEYS) {
    if (inline[k] !== undefined) props[k] = inline[k];
    else if (attrs[k] !== undefined) props[k] = attrs[k];
  }
  return props;
}

// Parse a color token: none / #rgb / #rrggbb / rgb(r,g,b) / named-ish hex.
// Returns { color, isNone }.
function parseColorToken(tok: string | null | undefined): { color: Color | null; isNone: boolean } {
  if (tok == null) return { color: null, isNone: false };
  const t = String(tok).trim().toLowerCase();
  if (t === "none" || t === "transparent") return { color: null, isNone: true };
  const rgb = t.match(/^rgba?\(([^)]*)\)/);
  if (rgb) {
    const parts = rgb[1].split(",").map((s) => parseFloat(s.trim()));
    const [r, g, b] = parts;
    return { color: new Color((r || 0) / 255, (g || 0) / 255, (b || 0) / 255, 1), isNone: false };
  }
  // Hex (with or without '#'); Color.parse handles #rgb and #rrggbb.
  return { color: Color.parse(t.startsWith("#") ? t : "#" + t.replace(/^#/, "")), isNone: false };
}

// Turn an inherited+merged style object into VMobject fill/stroke values.
function resolveStyle(
  style: Record<string, string>,
  overrideFill: ColorLike | null,
  overrideStroke: ColorLike | null,
): { fillColor: Color; fillOpacity: number; strokeColor: Color; strokeWidth: number; strokeOpacity: number } {
  const fillTok = style.fill;                       // may be undefined -> SVG default black
  const strokeTok = style.stroke;                   // undefined -> no stroke
  const groupOpacity = style.opacity !== undefined ? Number(style.opacity) : 1;

  // Fill: default is black & opaque. `none` -> transparent.
  let fillColor = Color.parse("#000000");
  let fillOpacity = 1;
  const f = parseColorToken(fillTok === undefined ? "#000000" : fillTok);
  if (f.isNone) { fillOpacity = 0; }
  else if (f.color) { fillColor = f.color; fillOpacity = 1; }
  if (style["fill-opacity"] !== undefined) fillOpacity = Number(style["fill-opacity"]);

  // Stroke: default is none.
  let strokeColor = Color.parse("#000000");
  let strokeOpacity = 0;
  let strokeWidth = 0;
  if (strokeTok !== undefined) {
    const s = parseColorToken(strokeTok);
    if (s.isNone) { strokeOpacity = 0; strokeWidth = 0; }
    else if (s.color) { strokeColor = s.color; strokeOpacity = 1; strokeWidth = 4; }
  }
  if (style["stroke-width"] !== undefined) strokeWidth = parseFloat(style["stroke-width"]);
  if (style["stroke-opacity"] !== undefined) strokeOpacity = Number(style["stroke-opacity"]);

  // Config-level overrides win over the SVG's own colors.
  if (overrideFill != null) { fillColor = Color.parse(overrideFill); if (fillOpacity === 0) fillOpacity = 1; }
  if (overrideStroke != null) { strokeColor = Color.parse(overrideStroke); }

  // Group opacity multiplies both channels.
  fillOpacity *= groupOpacity;
  strokeOpacity *= groupOpacity;

  return { fillColor, fillOpacity, strokeColor, strokeWidth, strokeOpacity };
}

// ---------------------------------------------------------------------------
// Geometry helpers: build flat cubic-Bezier subpaths (y-down space) for each
// primitive, so the same "apply affine + flip Y" path handles everything.
// ---------------------------------------------------------------------------
const num = (v: string | undefined, d = 0): number => { const x = parseFloat(v as string); return Number.isFinite(x) ? x : d; };

// Corner list -> single closed/open cubic subpath (straight segments).
function cornersToSubpath(corners: number[][], close: boolean): number[][] {
  if (corners.length === 0) return [];
  const pts = corners.map((c) => [c[0], c[1], 0]);
  const loop = close ? [...pts, pts[0]] : pts;
  const sp = [loop[0]];
  for (let k = 1; k < loop.length; k++) {
    const a = loop[k - 1], b = loop[k];
    sp.push(
      [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3, 0],
      [a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3, 0],
      [b[0], b[1], 0],
    );
  }
  return sp;
}

// Parse a "x,y x,y ..." points string into [[x,y],...].
function parsePoints(s: string): number[][] {
  const nums = (s || "").split(/[\s,]+/).filter((t) => t.length).map(Number);
  const pts: number[][] = [];
  for (let k = 0; k + 1 < nums.length; k += 2) pts.push([nums[k], nums[k + 1]]);
  return pts;
}

// Build the y-down subpaths for one drawable element (before any transform).
function elementSubpaths(tag: string, attrs: Record<string, string>): number[][][] {
  switch (tag) {
    case "path":
      return parsePathToSubpaths(attrs.d || "");
    case "rect": {
      const x = num(attrs.x), y = num(attrs.y), w = num(attrs.width), h = num(attrs.height);
      // Rounded corners approximated as sharp.
      return [cornersToSubpath([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true)];
    }
    case "circle": {
      const cx = num(attrs.cx), cy = num(attrs.cy), r = num(attrs.r);
      return [arcBezierPoints(r, 0, 2 * Math.PI, [cx, cy, 0])];
    }
    case "ellipse": {
      const cx = num(attrs.cx), cy = num(attrs.cy), rx = num(attrs.rx), ry = num(attrs.ry);
      // Unit circle then stretch to (rx, ry) about the center.
      const sp = arcBezierPoints(1, 0, 2 * Math.PI, [0, 0, 0]);
      return [sp.map((p) => [cx + p[0] * rx, cy + p[1] * ry, 0])];
    }
    case "line": {
      const x1 = num(attrs.x1), y1 = num(attrs.y1), x2 = num(attrs.x2), y2 = num(attrs.y2);
      return [cornersToSubpath([[x1, y1], [x2, y2]], false)];
    }
    case "polyline":
      return [cornersToSubpath(parsePoints(attrs.points), false)];
    case "polygon":
      return [cornersToSubpath(parsePoints(attrs.points), true)];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// 3.5 Gradient (<linearGradient> fill) and <clipPath> resolution.
// ---------------------------------------------------------------------------

// Gradient x1/y1/x2/y2 (and clipPath content) commonly use bare fractions or
// percentages of the referencing element's bounding box -- unlike num()'s
// plain parseFloat, "50%" here must become 0.5, not 50.
function pctOrFrac(v: string | undefined, d: number): number {
  if (v == null) return d;
  const s = v.trim();
  if (s.endsWith("%")) { const x = parseFloat(s); return Number.isFinite(x) ? x / 100 : d; }
  const x = parseFloat(s);
  return Number.isFinite(x) ? x : d;
}

// Apply only the linear (rotation/scale/skew) part of an affine to a
// direction vector -- no translation, since a direction isn't a position.
function applyAffineLinear(m: Affine, dx: number, dy: number): number[] {
  return [m[0] * dx + m[2] * dy, m[1] * dx + m[3] * dy];
}

// A <stop>'s color: stop-color/stop-opacity are their own attributes (or
// inline style), not part of readStyleProps' fill/stroke key set.
function parseStopColor(attrs: Record<string, string>): Color {
  const inline = parseStyleString(attrs.style || "");
  const tok = inline["stop-color"] ?? attrs["stop-color"] ?? "#000000";
  const { color } = parseColorToken(tok);
  return color ?? Color.parse("#000000");
}

// Resolve a `fill: url(#id)` reference to a <linearGradient>'s stop colors
// and a direction vector (world/VMobject sheen-direction convention). Scope:
// <linearGradient> only (no <radialGradient> -- no renderer anywhere has
// createRadialGradient support yet, a separate, bigger follow-up) and
// objectBoundingBox-style fractional x1/y1/x2/y2 (gradientTransform and
// gradientUnits="userSpaceOnUse" aren't handled -- direction-only, not a
// full coordinate remap, is enough to make most authored gradients render
// with plausible orientation rather than not at all).
function resolveGradientFill(
  fillTok: string,
  defs: Map<string, XmlNode>,
  m: Affine,
): { colors: Color[]; direction: number[] } | null {
  const match = /^url\(#([^)]+)\)$/.exec(fillTok.trim());
  if (!match) return null;
  const node = defs.get(match[1]);
  if (!node || node.tag !== "linearGradient") return null;
  const stops = (node.children || []).filter((c) => c.tag === "stop");
  if (stops.length === 0) return null;
  const colors = stops.map((s) => parseStopColor(s.attrs || {}));
  const x1 = pctOrFrac(node.attrs.x1, 0), y1 = pctOrFrac(node.attrs.y1, 0);
  const x2 = pctOrFrac(node.attrs.x2, 1), y2 = pctOrFrac(node.attrs.y2, 0);
  const [dx, dy] = applyAffineLinear(m, x2 - x1, y2 - y1);
  // Pre-negate y: this direction is stored on the mobject separately from
  // .points, so it isn't touched by SVGMobject's later single global Y-flip
  // of all point geometry -- negating now keeps it consistent with the
  // (soon-to-be-flipped) visible shape.
  return { colors, direction: [dx, -dy] };
}

// Build a clip VMobject from a <clipPath>'s drawable children (rect/circle
// scope, matching elementSubpaths' own coverage) and intersect `mob` with
// it. clipPathUnits defaults to userSpaceOnUse, so the clip content shares
// the SAME accumulated transform `m` as whatever references it.
function applyClipPath(
  mob: VMobject,
  clipPathAttr: string,
  defs: Map<string, XmlNode>,
  m: Affine,
): VMobject {
  const match = /^url\(#([^)]+)\)$/.exec(clipPathAttr.trim());
  if (!match) return mob;
  const node = defs.get(match[1]);
  if (!node || node.tag !== "clipPath") return mob;

  const clipMob = new VMobject();
  for (const child of node.children || []) {
    if (!DRAWABLE.has(child.tag)) continue;
    let childM = m;
    if (child.attrs?.transform) childM = compose(m, parseTransform(child.attrs.transform));
    for (const sp of elementSubpaths(child.tag, child.attrs || {})) {
      if (!sp || sp.length < 1) continue;
      clipMob.subpathStarts.push(clipMob.points.length);
      for (const p of sp) {
        const [x, y] = applyAffine(childM, p[0], p[1]);
        clipMob.points.push([x, y, 0]);
      }
    }
  }
  if (clipMob.points.length === 0) return mob;
  return new Intersection(mob, clipMob);
}

// ---------------------------------------------------------------------------
// 4. SVGMobject: walk the tree with accumulated transform + inherited style,
//    build a VMobject per drawable element, flip Y once, then size & place.
// ---------------------------------------------------------------------------
export class SVGMobject extends VGroup {
  config: SVGMobjectConfig;
  /** Drawable mobjects keyed by their SVG element id (or nearest ancestor
   *  <g id>). One id can map to several mobjects (a <g id> containing many
   *  drawables). Ids inside <defs>/<clipPath>/... never appear here -- those
   *  are consumed for url(#id) resolution, not rendered content. */
  readonly ids = new Map<string, VMobject[]>();

  // new SVGMobject(svgString, { height, width, point, fillColor, strokeColor, color })
  constructor(svgString = "", config: SVGMobjectConfig = {}) {
    super();
    this.config = config;
    const tree = parseXML(String(svgString));
    const defs = collectDefs(tree);

    const overrideFill = config.fillColor ?? config.color ?? null;
    const overrideStroke = config.strokeColor ?? null;

    const mobs: VMobject[] = [];

    // Depth-first walk accumulating transform (parent->child), style, and the
    // nearest id (an element's own id wins over an inherited <g id>).
    const walk = (node: XmlNode, transform: Affine, parentStyle: Record<string, string>, inheritedId: string | null) => {
      // Definition-only containers (<defs>, <clipPath>, <linearGradient>,
      // ...): their contents are referenced by id elsewhere, not rendered
      // in place -- don't descend into them at all.
      if (NON_RENDERING_CONTAINERS.has(node.tag)) return;

      const attrs = node.attrs || {};
      const effectiveId = attrs.id || inheritedId;
      // Accumulate this node's own transform (present on <g> and any element).
      let m = transform;
      if (attrs.transform) m = compose(m, parseTransform(attrs.transform));
      // Merge inherited style with this node's props (child overrides).
      const style = { ...parentStyle, ...readStyleProps(attrs) };

      if (DRAWABLE.has(node.tag)) {
        const subpaths = elementSubpaths(node.tag, attrs);
        let mob = new VMobject();
        for (const sp of subpaths) {
          if (!sp || sp.length < 1) continue;
          mob.subpathStarts.push(mob.points.length);
          for (const p of sp) {
            const [x, y] = applyAffine(m, p[0], p[1]);
            mob.points.push([x, y, 0]); // still y-down; flipped globally later
          }
        }
        if (mob.points.length) {
          const gradient = style.fill ? resolveGradientFill(style.fill, defs, m) : null;
          // A url(#...) fill isn't a color resolveStyle understands; resolve
          // stroke/opacity normally, then layer the gradient's colors on top
          // (config-level overrideFill still wins over an SVG-authored fill,
          // gradient or otherwise -- matching the existing override contract).
          let styleForResolve = style;
          if (gradient) { const { fill: _fill, ...rest } = style; styleForResolve = rest; }
          const s = resolveStyle(styleForResolve, overrideFill, overrideStroke);
          mob.fillColor = s.fillColor;
          mob.fillOpacity = s.fillOpacity;
          mob.strokeColor = s.strokeColor;
          mob.strokeWidth = s.strokeWidth;
          mob.strokeOpacity = s.strokeOpacity;
          if (gradient && overrideFill == null) {
            mob.fillColor = gradient.colors[0];
            mob.gradientColors = gradient.colors;
            mob.sheenDirection = gradient.direction;
          }
          if (attrs["clip-path"]) mob = applyClipPath(mob, attrs["clip-path"], defs, m);
          if (mob.points.length) {
            mobs.push(mob);
            // Record on the FINAL mob (applyClipPath may have replaced it).
            if (effectiveId) {
              const list = this.ids.get(effectiveId) ?? [];
              list.push(mob);
              this.ids.set(effectiveId, list);
            }
          }
        }
      }

      for (const child of node.children || []) walk(child, m, style, effectiveId);
    };

    // Root style seeds the SVG defaults (fill black, no stroke) plus any style
    // declared on the <svg> element itself.
    walk(tree, IDENTITY.slice() as Affine, readStyleProps(tree.attrs || {}), null);

    this.add(...mobs);

    // The SVG coordinate space is y-DOWN. Flip Y exactly once so the result is
    // upright in manim's y-UP world. (Small SVG-y -> large world-y.)
    this.applyToPoints((p) => [p[0], -p[1], p[2]]);

    // Size to world units (preserve aspect) and place.
    if (config.width != null && this.getWidth() > 1e-9) {
      this.setWidth(config.width);
    } else {
      const h = config.height ?? 2;
      if (this.getHeight() > 1e-9) this.setHeight(h);
      else if (this.getWidth() > 1e-9) this.setWidth(h);
    }

    if (config.point) this.moveTo(config.point);
    else this.center();
  }

  hasId(id: string): boolean {
    return this.ids.has(id);
  }

  /** The mobjects for an SVG element id (or nearest <g id>), wrapped in a
   *  VGroup so `svg.byId("sun").setColor(...)` / `.animate` compose
   *  naturally. The children are the SAME instances already in this
   *  SVGMobject's tree -- style/transform mutations show up in place. */
  byId(id: string): VGroup {
    const list = this.ids.get(id);
    if (!list) {
      const available = [...this.ids.keys()].join(", ") || "(none)";
      throw new Error(`SVGMobject.byId: no drawable element with id "${id}". Available ids: ${available}`);
    }
    return new VGroup(...list);
  }
}

export default SVGMobject;
