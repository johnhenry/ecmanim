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

// ---------------------------------------------------------------------------
// 1. Minimal XML parser -> { tag, attrs, children } tree. Text nodes ignored.
// Handles: elements, self-closing <x/>, nesting, single/double-quoted attrs,
// comments <!-- -->, <?xml ?>, <!DOCTYPE>, and <![CDATA[ ]]> (all skipped).
// ---------------------------------------------------------------------------
export function parseXML(str) {
  let i = 0;
  const n = str.length;

  // Parse an attribute list starting at i, up to (but not consuming) `>` or `/`.
  const parseAttrs = () => {
    const attrs = {};
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
  const parseNodes = () => {
    const nodes = [];
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
        let children = [];
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
function skipTo(str, from, end) {
  const idx = str.indexOf(end, from);
  return idx === -1 ? str.length : idx + end.length;
}

// Decode the handful of XML entities that appear in attribute values.
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// ---------------------------------------------------------------------------
// 2. Transform parsing. Affines are row-major [a,b,c,d,e,f] mapping
//    (x,y) -> (a*x + c*y + e, b*x + d*y + f) — matching SVG matrix(a b c d e f).
// ---------------------------------------------------------------------------
const IDENTITY = [1, 0, 0, 1, 0, 0];

// Multiply two affines: apply `child` first, then `parent` (result = parent*child).
export function compose(parent, child) {
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

function applyAffine(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// Parse an SVG transform attribute (chained translate/scale/rotate/matrix) into
// one composed affine.
export function parseTransform(str) {
  if (!str) return IDENTITY.slice();
  let m = IDENTITY.slice();
  const re = /(translate|scale|rotate|matrix)\s*\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(str)) !== null) {
    const kind = match[1];
    const nums = match[2].split(/[\s,]+/).filter((s) => s.length).map(Number);
    let t = IDENTITY.slice();
    if (kind === "translate") {
      t = [1, 0, 0, 1, nums[0] || 0, nums[1] || 0];
    } else if (kind === "scale") {
      const sx = nums[0] ?? 1;
      const sy = nums[1] ?? sx;
      t = [sx, 0, 0, sy, 0, 0];
    } else if (kind === "rotate") {
      const rad = ((nums[0] || 0) * Math.PI) / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const rot = [cos, sin, -sin, cos, 0, 0];
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

// Parse a CSS style string ("fill:#f00;stroke:none") into a plain object.
function parseStyleString(s) {
  const out = {};
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
function readStyleProps(attrs) {
  const inline = parseStyleString(attrs.style);
  const props = {};
  const KEYS = ["fill", "stroke", "stroke-width", "fill-opacity", "stroke-opacity", "opacity"];
  for (const k of KEYS) {
    if (inline[k] !== undefined) props[k] = inline[k];
    else if (attrs[k] !== undefined) props[k] = attrs[k];
  }
  return props;
}

// Parse a color token: none / #rgb / #rrggbb / rgb(r,g,b) / named-ish hex.
// Returns { color, isNone }.
function parseColorToken(tok) {
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
function resolveStyle(style, overrideFill, overrideStroke) {
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
const num = (v, d = 0) => { const x = parseFloat(v); return Number.isFinite(x) ? x : d; };

// Corner list -> single closed/open cubic subpath (straight segments).
function cornersToSubpath(corners, close) {
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
function parsePoints(s) {
  const nums = (s || "").split(/[\s,]+/).filter((t) => t.length).map(Number);
  const pts = [];
  for (let k = 0; k + 1 < nums.length; k += 2) pts.push([nums[k], nums[k + 1]]);
  return pts;
}

// Build the y-down subpaths for one drawable element (before any transform).
function elementSubpaths(tag, attrs) {
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
// 4. SVGMobject: walk the tree with accumulated transform + inherited style,
//    build a VMobject per drawable element, flip Y once, then size & place.
// ---------------------------------------------------------------------------
export class SVGMobject extends VGroup {
  // new SVGMobject(svgString, { height, width, point, fillColor, strokeColor, color })
  constructor(svgString = "", config = {}) {
    super();
    this.config = config;
    const tree = parseXML(String(svgString));

    const overrideFill = config.fillColor ?? config.color ?? null;
    const overrideStroke = config.strokeColor ?? null;

    const mobs = [];

    // Depth-first walk accumulating transform (parent->child) and style.
    const walk = (node, transform, parentStyle) => {
      const attrs = node.attrs || {};
      // Accumulate this node's own transform (present on <g> and any element).
      let m = transform;
      if (attrs.transform) m = compose(m, parseTransform(attrs.transform));
      // Merge inherited style with this node's props (child overrides).
      const style = { ...parentStyle, ...readStyleProps(attrs) };

      if (DRAWABLE.has(node.tag)) {
        const subpaths = elementSubpaths(node.tag, attrs);
        const mob = new VMobject();
        for (const sp of subpaths) {
          if (!sp || sp.length < 1) continue;
          mob.subpathStarts.push(mob.points.length);
          for (const p of sp) {
            const [x, y] = applyAffine(m, p[0], p[1]);
            mob.points.push([x, y, 0]); // still y-down; flipped globally later
          }
        }
        if (mob.points.length) {
          const s = resolveStyle(style, overrideFill, overrideStroke);
          mob.fillColor = s.fillColor;
          mob.fillOpacity = s.fillOpacity;
          mob.strokeColor = s.strokeColor;
          mob.strokeWidth = s.strokeWidth;
          mob.strokeOpacity = s.strokeOpacity;
          mobs.push(mob);
        }
      }

      for (const child of node.children || []) walk(child, m, style);
    };

    // Root style seeds the SVG defaults (fill black, no stroke) plus any style
    // declared on the <svg> element itself.
    walk(tree, IDENTITY.slice(), readStyleProps(tree.attrs || {}));

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
}

export default SVGMobject;
