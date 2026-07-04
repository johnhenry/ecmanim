// Vectorized Mobject: a shape defined by cubic bezier curves, the workhorse of
// manim. Points are a flat list where n_curves = (n_points - 1) / 3 within each
// subpath. Subpaths (for holes / disjoint strokes / glyphs) are tracked by the
// indices at which a new "moveTo" begins.

import { Mobject } from "./Mobject.ts";
import type { MobjectConfig } from "./Mobject.ts";
import { Color } from "../core/color.ts";
import * as V from "../core/math/vector.ts";
import {
  bezier,
  straightControlPoints,
  partialBezier,
  subdivideBezier,
  getSmoothCubicBezierHandlePoints,
} from "../core/math/bezier.ts";
import { shoelaceDirection } from "../core/math/vector.ts";
import type { Vec3, ColorLike } from "../core/types.ts";

/** Anchor-handling mode used by changeAnchorMode. */
export type AnchorMode = "jagged" | "smooth";

/** Configuration accepted by VMobject (extends the base Mobject config). */
export interface VMobjectConfig extends MobjectConfig {
  strokeColor?: ColorLike;
  strokeWidth?: number;
  strokeOpacity?: number;
  fillColor?: ColorLike;
  fillOpacity?: number;
  lineJoin?: CanvasLineJoin;
  lineCap?: CanvasLineCap;
  backgroundStrokeColor?: ColorLike;
  backgroundStrokeWidth?: number;
  backgroundStrokeOpacity?: number;
  sheenFactor?: number;
  sheenDirection?: number[];
}

export class VMobject extends Mobject {
  subpathStarts: number[];
  strokeColor: Color;
  strokeWidth: number;
  strokeOpacity: number;
  fillColor: Color;
  fillOpacity: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
  strokeStart: number;
  strokeEnd: number;
  _straightPath?: boolean;
  // Background stroke: a wider stroke drawn under the main stroke.
  backgroundStrokeColor: Color;
  backgroundStrokeWidth: number;
  backgroundStrokeOpacity: number;
  // Sheen / gradient: a linear gradient across the mobject's bounding box.
  sheenFactor: number;
  sheenDirection: number[];
  gradientColors?: Color[];

  constructor(config: VMobjectConfig = {}) {
    super(config);
    this.subpathStarts = []; // indices into this.points where a subpath begins

    const stroke = config.strokeColor ?? config.color ?? "#FFFFFF";
    const fill = config.fillColor ?? config.color ?? "#FFFFFF";
    this.strokeColor = Color.parse(stroke);
    this.strokeWidth = config.strokeWidth ?? 4;
    this.strokeOpacity = config.strokeOpacity ?? 1;
    this.fillColor = Color.parse(fill);
    this.fillOpacity = config.fillOpacity ?? 0;
    this.lineJoin = config.lineJoin ?? "round";
    this.lineCap = config.lineCap ?? "round";
    // Fraction of the path drawn — used by Create/Write/ShowPartial.
    this.strokeStart = 0;
    this.strokeEnd = 1;

    this.backgroundStrokeColor = Color.parse(config.backgroundStrokeColor ?? "#000000");
    this.backgroundStrokeWidth = config.backgroundStrokeWidth ?? 0;
    this.backgroundStrokeOpacity = config.backgroundStrokeOpacity ?? 1;

    this.sheenFactor = config.sheenFactor ?? 0;
    this.sheenDirection = config.sheenDirection ?? V.UL;
  }

  // --- path construction --------------------------------------------------
  startNewPath(point: number[]): this {
    this.subpathStarts.push(this.points.length);
    this.points.push(V.clone(point));
    return this;
  }

  addCubicBezier(handle1: number[], handle2: number[], anchor: number[]): this {
    this.points.push(V.clone(handle1), V.clone(handle2), V.clone(anchor));
    return this;
  }

  addLineTo(point: number[]): this {
    const last = this.points[this.points.length - 1];
    const [c1, c2] = straightControlPoints(last, point);
    return this.addCubicBezier(c1, c2, point);
  }

  // Build an open/closed path through a list of corner points using straight
  // bezier segments. This is how Line / Polygon / Rectangle are defined.
  setPointsAsCorners(corners: number[][]): this {
    this.points = [];
    this.subpathStarts = [0];
    this._straightPath = true; // segments are straight -> cheap to flatten (z-buffer)
    if (corners.length === 0) return this;
    this.points.push(V.clone(corners[0]));
    for (let i = 1; i < corners.length; i++) this.addLineTo(corners[i]);
    return this;
  }

  // Directly append a pre-computed bezier point list as one subpath. `pts` must
  // have length 1 + 3k (an anchor followed by control/control/anchor triples).
  appendBezierPoints(pts: number[][], newSubpath = true): this {
    if (pts.length === 0) return this;
    if (newSubpath || this.points.length === 0) this.subpathStarts.push(this.points.length);
    for (const p of pts) this.points.push(V.clone(p));
    return this;
  }

  close(): this {
    // Close the current subpath back to its start anchor.
    const start = this.subpathStarts[this.subpathStarts.length - 1] ?? 0;
    const first = this.points[start];
    const last = this.points[this.points.length - 1];
    if (first && last && !V.equals(first, last)) this.addLineTo(first);
    return this;
  }

  // --- smoothing ----------------------------------------------------------
  // Build a smooth cubic spline passing through the given anchor points.
  setPointsSmoothly(anchors: number[][]): this {
    this.points = [];
    this.subpathStarts = [0];
    this._straightPath = false;
    if (anchors.length === 0) return this;
    if (anchors.length === 1) {
      this.points.push(V.clone(anchors[0]));
      return this;
    }
    const [h1, h2] = getSmoothCubicBezierHandlePoints(anchors);
    this.points.push(V.clone(anchors[0]));
    for (let i = 0; i < anchors.length - 1; i++) {
      this.addCubicBezier(h1[i], h2[i], anchors[i + 1]);
    }
    return this;
  }

  // Re-derive smooth handles from the existing anchors (per subpath).
  makeSmooth(): this {
    return this.changeAnchorMode("smooth");
  }

  // Replace handles with straight (1/3, 2/3) control points (per subpath).
  makeJagged(): this {
    return this.changeAnchorMode("jagged");
  }

  // Recompute all handles in the given anchor mode, preserving anchors & subpaths.
  changeAnchorMode(mode: AnchorMode): this {
    if (mode !== "smooth" && mode !== "jagged") {
      throw new Error(`Unknown anchor mode: ${mode}`);
    }
    const newPoints: number[][] = [];
    const newStarts: number[] = [];
    for (const sp of this.getSubpaths()) {
      const nc = Math.floor((sp.length - 1) / 3);
      newStarts.push(newPoints.length);
      if (nc < 1) {
        for (const p of sp) newPoints.push(V.clone(p));
        continue;
      }
      const anchors: number[][] = [sp[0]];
      for (let i = 0; i < nc; i++) anchors.push(sp[3 * i + 3]);
      newPoints.push(V.clone(anchors[0]));
      if (mode === "smooth") {
        const [h1, h2] = getSmoothCubicBezierHandlePoints(anchors);
        for (let i = 0; i < anchors.length - 1; i++) {
          newPoints.push(V.clone(h1[i]), V.clone(h2[i]), V.clone(anchors[i + 1]));
        }
      } else {
        for (let i = 0; i < anchors.length - 1; i++) {
          const [c1, c2] = straightControlPoints(anchors[i], anchors[i + 1]);
          newPoints.push(c1, c2, V.clone(anchors[i + 1]));
        }
      }
    }
    this.points = newPoints;
    this.subpathStarts = newStarts;
    if (mode === "jagged") this._straightPath = true;
    else this._straightPath = false;
    return this;
  }

  // --- curve construction -------------------------------------------------
  // Extend the current path to `point` with a handle mirroring the previous
  // curve's outgoing tangent (manim's add_smooth_curve_to).
  addSmoothCurveTo(point: number[]): this {
    const n = this.points.length;
    if (n === 0) {
      this.startNewPath(point);
      return this;
    }
    const last = this.points[n - 1];
    // The previous handle: second-to-last control point of the last curve.
    const prevHandle = n >= 2 ? this.points[n - 2] : last;
    const handle1 = V.add(last, V.sub(last, prevHandle)); // reflect prev handle
    const handle2 = V.midpoint(handle1, point);
    return this.addCubicBezier(handle1, handle2, point);
  }

  // Elevate a quadratic bezier (handle, anchor) to a cubic and append it.
  addQuadraticBezierCurveTo(handle: number[], anchor: number[]): this {
    const start = this.points[this.points.length - 1] ?? handle;
    // Degree elevation: cubic controls = start + 2/3(q-start), end + 2/3(q-end).
    const c1 = V.add(start, V.scale(V.sub(handle, start), 2 / 3));
    const c2 = V.add(anchor, V.scale(V.sub(handle, anchor), 2 / 3));
    return this.addCubicBezier(c1, c2, anchor);
  }

  // --- anchor / handle accessors ------------------------------------------
  // All anchors across subpaths: start anchor of each subpath, plus every curve end.
  getAnchors(): number[][] {
    const out: number[][] = [];
    for (const sp of this.getSubpaths()) {
      const nc = Math.floor((sp.length - 1) / 3);
      if (sp.length) out.push(sp[0]);
      for (let i = 0; i < nc; i++) out.push(sp[3 * i + 3]);
    }
    return out;
  }

  // Start anchor of every curve (indices 0, 3, 6, ... within each subpath).
  getStartAnchors(): number[][] {
    const out: number[][] = [];
    for (const sp of this.getSubpaths()) {
      const nc = Math.floor((sp.length - 1) / 3);
      for (let i = 0; i < nc; i++) out.push(sp[3 * i]);
    }
    return out;
  }

  // End anchor of every curve (indices 3, 6, 9, ...).
  getEndAnchors(): number[][] {
    const out: number[][] = [];
    for (const sp of this.getSubpaths()) {
      const nc = Math.floor((sp.length - 1) / 3);
      for (let i = 0; i < nc; i++) out.push(sp[3 * i + 3]);
    }
    return out;
  }

  // [startAnchors, handles1, handles2, endAnchors] — one entry per curve.
  getAnchorsAndHandles(): [number[][], number[][], number[][], number[][]] {
    const a0s: number[][] = [], h1s: number[][] = [], h2s: number[][] = [], a1s: number[][] = [];
    for (const sp of this.getSubpaths()) {
      const nc = Math.floor((sp.length - 1) / 3);
      for (let i = 0; i < nc; i++) {
        a0s.push(sp[3 * i]);
        h1s.push(sp[3 * i + 1]);
        h2s.push(sp[3 * i + 2]);
        a1s.push(sp[3 * i + 3]);
      }
    }
    return [a0s, h1s, h2s, a1s];
  }

  // --- direction / winding ------------------------------------------------
  // "CW" or "CCW" for the (first) subpath, via the shoelace formula on anchors.
  getDirection(): "CW" | "CCW" {
    const anchors = this.getAnchors();
    if (anchors.length < 3) return "CCW";
    return shoelaceDirection(anchors);
  }

  // Reverse the order of every point (and the anchor/handle sense) per subpath.
  reversePoints(): this {
    const newPoints: number[][] = [];
    const newStarts: number[] = [];
    for (const sp of this.getSubpaths()) {
      newStarts.push(newPoints.length);
      for (let i = sp.length - 1; i >= 0; i--) newPoints.push(V.clone(sp[i]));
    }
    this.points = newPoints;
    this.subpathStarts = newStarts;
    return this;
  }

  // Alias mirroring manim's reverse_direction.
  reverseDirection(): this {
    return this.reversePoints();
  }

  // --- per-curve access ---------------------------------------------------
  // Flat list of every curve as [a0, h1, h2, a1].
  private _allCurves(): number[][][] {
    const curves: number[][][] = [];
    for (const sp of this.getSubpaths()) {
      const nc = Math.floor((sp.length - 1) / 3);
      for (let i = 0; i < nc; i++) {
        curves.push([sp[3 * i], sp[3 * i + 1], sp[3 * i + 2], sp[3 * i + 3]]);
      }
    }
    return curves;
  }

  getNthCurvePoints(n: number): number[][] {
    return this._allCurves()[n];
  }

  getNthCurveFunction(n: number): (t: number) => Vec3 {
    const [a, b, c, d] = this._allCurves()[n];
    return (t: number) => bezier(a, b, c, d, t);
  }

  getCurveFunctions(): Array<(t: number) => Vec3> {
    return this._allCurves().map(([a, b, c, d]) => (t: number) => bezier(a, b, c, d, t));
  }

  // Numerically integrate the arc length of the nth curve.
  getNthCurveLength(n: number, samples = 10): number {
    const f = this.getNthCurveFunction(n);
    let length = 0;
    let prev = f(0);
    for (let i = 1; i <= samples; i++) {
      const cur = f(i / samples);
      length += V.distance(prev, cur);
      prev = cur;
    }
    return length;
  }

  // Total arc length of the whole outline.
  getArcLength(samples = 10): number {
    let total = 0;
    const nc = this._allCurves().length;
    for (let i = 0; i < nc; i++) total += this.getNthCurveLength(i, samples);
    return total;
  }

  // [[function, length], ...] for every curve.
  getCurveFunctionsWithLengths(samples = 10): Array<[(t: number) => Vec3, number]> {
    const curves = this._allCurves();
    return curves.map(([a, b, c, d], i) => {
      const f = (t: number) => bezier(a, b, c, d, t);
      return [f, this.getNthCurveLength(i, samples)] as [(t: number) => Vec3, number];
    });
  }

  // Approximate proportion along the outline nearest to a given point.
  proportionFromPoint(point: number[], samples = 100): number {
    const nc = this._allCurves().length;
    if (nc === 0) return 0;
    let best = Infinity;
    let bestAlpha = 0;
    const steps = nc * samples;
    for (let i = 0; i <= steps; i++) {
      const alpha = i / steps;
      const p = this.pointFromProportion(alpha);
      const d = V.distance(p, point);
      if (d < best) { best = d; bestAlpha = alpha; }
    }
    return bestAlpha;
  }

  // --- partial outlines ---------------------------------------------------
  // Make this VMobject the [a, b] slice of `vmobject`'s outline (curve-wise).
  pointwiseBecomePartial(vmobject: VMobject, a: number, b: number): this {
    a = Math.max(0, Math.min(1, a));
    b = Math.max(0, Math.min(1, b));
    const curves = vmobject._allCurves();
    const nc = curves.length;
    if (nc === 0) {
      this.points = vmobject.points.map((p) => V.clone(p));
      this.subpathStarts = [...vmobject.subpathStarts];
      return this;
    }
    if (b <= a) {
      // Degenerate: collapse to the single point at proportion a.
      const p = vmobject.pointFromProportion(a);
      this.points = [V.clone(p)];
      this.subpathStarts = [0];
      return this;
    }
    const lowerIndex = Math.floor(a * nc);
    const upperIndex = Math.floor(b * nc);
    const lowerResidue = a * nc - lowerIndex;
    const upperResidue = b * nc - upperIndex;

    const newPoints: number[][] = [];
    const li = Math.min(lowerIndex, nc - 1);
    const ui = Math.min(upperIndex, nc - 1);

    if (li === ui) {
      const [p0, p1, p2, p3] = curves[li];
      const seg = partialBezier(p0, p1, p2, p3, lowerResidue, upperResidue);
      newPoints.push(seg[0], seg[1], seg[2], seg[3]);
    } else {
      // First (partial) curve: [lowerResidue, 1].
      {
        const [p0, p1, p2, p3] = curves[li];
        const seg = partialBezier(p0, p1, p2, p3, lowerResidue, 1);
        newPoints.push(seg[0], seg[1], seg[2], seg[3]);
      }
      // Whole middle curves.
      for (let i = li + 1; i < ui; i++) {
        const [, p1, p2, p3] = curves[i];
        newPoints.push(V.clone(p1), V.clone(p2), V.clone(p3));
      }
      // Last (partial) curve: [0, upperResidue].
      if (ui < nc && upperResidue > 0) {
        const [p0, p1, p2, p3] = curves[ui];
        const seg = partialBezier(p0, p1, p2, p3, 0, upperResidue);
        newPoints.push(V.clone(seg[1]), V.clone(seg[2]), V.clone(seg[3]));
      }
    }
    this.points = newPoints;
    this.subpathStarts = [0];
    this._straightPath = false;
    return this;
  }

  // Return a NEW VMobject that is the [a, b] slice of this one's outline.
  getSubcurve(a: number, b: number): VMobject {
    const vm = new VMobject();
    vm.setStyle({
      fillColor: this.fillColor,
      fillOpacity: this.fillOpacity,
      strokeColor: this.strokeColor,
      strokeWidth: this.strokeWidth,
      strokeOpacity: this.strokeOpacity,
    });
    vm.pointwiseBecomePartial(this, a, b);
    return vm;
  }

  // --- curve insertion ----------------------------------------------------
  // Insert n additional curves by subdividing existing ones (manim's insert_n_curves).
  insertNCurves(n: number): this {
    if (n <= 0) return this;
    const newPoints: number[][] = [];
    const newStarts: number[] = [];
    const subpaths = this.getSubpaths();
    const totalCurves = this.getNumCurves();
    if (totalCurves === 0) {
      // No curves: repeat the single point so counts still grow.
      const only = this.points[0] ?? [0, 0, 0];
      newStarts.push(0);
      newPoints.push(V.clone(only));
      for (let i = 0; i < n; i++) {
        newPoints.push(V.clone(only), V.clone(only), V.clone(only));
      }
      this.points = newPoints;
      this.subpathStarts = newStarts;
      return this;
    }

    // Distribute the n new curves proportionally across subpaths by curve count.
    const perSubpath: number[] = [];
    let assigned = 0;
    for (let s = 0; s < subpaths.length; s++) {
      const nc = Math.floor((subpaths[s].length - 1) / 3);
      const share = s === subpaths.length - 1
        ? n - assigned
        : Math.round((nc / totalCurves) * n);
      perSubpath.push(Math.max(0, share));
      assigned += Math.max(0, share);
    }

    for (let s = 0; s < subpaths.length; s++) {
      const sp = subpaths[s];
      const nc = Math.floor((sp.length - 1) / 3);
      newStarts.push(newPoints.length);
      if (nc < 1) {
        for (const p of sp) newPoints.push(V.clone(p));
        continue;
      }
      const add = perSubpath[s];
      const target = nc + add;
      // Split factor per existing curve, spreading `add` as evenly as possible.
      const factors = new Array(nc).fill(1);
      for (let i = 0; i < add; i++) factors[i % nc] += 1;

      newPoints.push(V.clone(sp[0]));
      for (let i = 0; i < nc; i++) {
        const curve = [sp[3 * i], sp[3 * i + 1], sp[3 * i + 2], sp[3 * i + 3]];
        const f = factors[i];
        if (f <= 1) {
          newPoints.push(V.clone(curve[1]), V.clone(curve[2]), V.clone(curve[3]));
        } else {
          const sub = subdivideBezier(curve, f);
          for (let k = 0; k < f; k++) {
            newPoints.push(sub[4 * k + 1], sub[4 * k + 2], sub[4 * k + 3]);
          }
        }
      }
      void target;
    }
    this.points = newPoints;
    this.subpathStarts = newStarts;
    return this;
  }

  // --- queries ------------------------------------------------------------
  getSubpaths(): number[][][] {
    if (this.points.length === 0) return [];
    const starts = this.subpathStarts.length ? [...this.subpathStarts] : [0];
    const paths: number[][][] = [];
    for (let i = 0; i < starts.length; i++) {
      const s = starts[i];
      const e = i + 1 < starts.length ? starts[i + 1] : this.points.length;
      const seg = this.points.slice(s, e);
      if (seg.length >= 1) paths.push(seg);
    }
    return paths;
  }

  getNumCurves(): number {
    let n = 0;
    for (const sp of this.getSubpaths()) n += Math.max(0, Math.floor((sp.length - 1) / 3));
    return n;
  }

  // Point at proportion alpha in [0,1] along the whole (multi-subpath) outline.
  pointFromProportion(alpha: number): number[] {
    const curves: number[][][] = [];
    for (const sp of this.getSubpaths()) {
      const nc = Math.floor((sp.length - 1) / 3);
      for (let i = 0; i < nc; i++) curves.push([sp[3 * i], sp[3 * i + 1], sp[3 * i + 2], sp[3 * i + 3]]);
    }
    if (curves.length === 0) return this.points[0] ?? [0, 0, 0];
    const scaled = Math.max(0, Math.min(1, alpha)) * curves.length;
    const idx = Math.min(curves.length - 1, Math.floor(scaled));
    const t = scaled - idx;
    const [a, b, c, d] = curves[idx];
    return bezier(a, b, c, d, t);
  }

  // --- style --------------------------------------------------------------
  // `opacity`/`width` also accept a trailing options object (in addition to
  // the plain-positional form), matching the config-object convention the
  // rest of the API uses -- e.g. `setFill(RED, { opacity: 0.3 })`, not just
  // `setFill(RED, 0.3)`. Needed because py2ts folds ALL keyword args from
  // Python's `set_fill(color, opacity=0.3)` into one trailing object; a
  // plain-number-only signature silently assigns that object where a number
  // was expected (`this.fillOpacity` becomes `{opacity: 0.3}`, not `0.3`).
  setFill(color: ColorLike | null, opacity: number | { opacity?: number } = 1): this {
    if (color != null) this.fillColor = Color.parse(color);
    this.fillOpacity = typeof opacity === "object" ? (opacity.opacity ?? this.fillOpacity) : opacity;
    return this;
  }

  setStroke(
    color: ColorLike | null,
    width?: number | { width?: number; opacity?: number } | null,
    opacity = 1,
  ): this {
    if (color != null) this.strokeColor = Color.parse(color);
    if (width != null && typeof width === "object") {
      if (width.width != null) this.strokeWidth = width.width;
      if (width.opacity != null) this.strokeOpacity = width.opacity;
    } else {
      if (width != null) this.strokeWidth = width;
      this.strokeOpacity = opacity;
    }
    return this;
  }

  setColor(color: ColorLike): this {
    this._color = Color.parse(color);
    this.strokeColor = Color.parse(color);
    this.fillColor = Color.parse(color);
    for (const m of this.submobjects) m.setColor(color);
    return this;
  }

  setStyle({ fillColor, fillOpacity, strokeColor, strokeWidth, strokeOpacity }: {
    fillColor?: ColorLike;
    fillOpacity?: number;
    strokeColor?: ColorLike;
    strokeWidth?: number;
    strokeOpacity?: number;
  } = {}): this {
    if (fillColor != null) this.fillColor = Color.parse(fillColor);
    if (fillOpacity != null) this.fillOpacity = fillOpacity;
    if (strokeColor != null) this.strokeColor = Color.parse(strokeColor);
    if (strokeWidth != null) this.strokeWidth = strokeWidth;
    if (strokeOpacity != null) this.strokeOpacity = strokeOpacity;
    return this;
  }

  setOpacity(o: number): this {
    this.fillOpacity = o;
    this.strokeOpacity = o;
    this.opacity = o;
    for (const m of this.submobjects) m.setOpacity(o);
    return this;
  }

  // Background stroke drawn under the main stroke (manim's set_background_stroke).
  setBackgroundStroke({ color, width, opacity }: {
    color?: ColorLike;
    width?: number;
    opacity?: number;
  } = {}): this {
    if (color != null) this.backgroundStrokeColor = Color.parse(color);
    if (width != null) this.backgroundStrokeWidth = width;
    if (opacity != null) this.backgroundStrokeOpacity = opacity;
    return this;
  }

  // Add a linear sheen (gradient) from the base color toward a lightened tint.
  setSheen(factor: number, direction?: number[]): this {
    this.sheenFactor = factor;
    if (direction != null) this.sheenDirection = direction;
    if (factor === 0) {
      this.gradientColors = undefined;
      return this;
    }
    // Two-stop gradient: base color -> color scaled by (1 + factor).
    const base = this.fillOpacity > 0 ? this.fillColor : this.strokeColor;
    const lighten = (c: Color, f: number): Color =>
      new Color(
        Math.max(0, Math.min(1, c.r * (1 + f))),
        Math.max(0, Math.min(1, c.g * (1 + f))),
        Math.max(0, Math.min(1, c.b * (1 + f))),
        c.a,
      );
    this.gradientColors = [base, lighten(base, factor)];
    return this;
  }

  setSheenDirection(dir: number[]): this {
    this.sheenDirection = dir;
    return this;
  }

  // Fill/stroke with a gradient across the mobject; stored for the renderer.
  setColorByGradient(...colors: ColorLike[]): this {
    this.gradientColors = colors.map((c) => Color.parse(c));
    if (colors.length > 0) {
      this.fillColor = Color.parse(colors[0]);
      this.strokeColor = Color.parse(colors[0]);
    }
    return this;
  }

  // Scale, optionally scaling the stroke width alongside the geometry.
  scale(factor: number, opts: { aboutPoint?: number[]; scaleStroke?: boolean } = {}): this {
    super.scale(factor, opts);
    if (opts.scaleStroke) {
      this.strokeWidth *= Math.abs(factor);
      this.backgroundStrokeWidth *= Math.abs(factor);
    }
    return this;
  }

  // --- transform support: make two vmobjects have matching point counts ---
  // Resample this subpath's bezier list to exactly `nCurves` curves.
  static _resampleSubpath(sp: number[][], nCurves: number): number[][] {
    const curves: number[][][] = [];
    const existing = Math.floor((sp.length - 1) / 3);
    if (existing === 0) {
      const only = sp[0] ?? [0, 0, 0];
      for (let i = 0; i < nCurves; i++) curves.push([only, only, only, only]);
    } else {
      // Distribute target curves across existing curves as evenly as possible.
      for (let i = 0; i < nCurves; i++) {
        const g = (i / nCurves) * existing;
        const gi = Math.min(existing - 1, Math.floor(g));
        const t0 = g - gi;
        const t1 = ((i + 1) / nCurves) * existing - gi;
        const seg = [sp[3 * gi], sp[3 * gi + 1], sp[3 * gi + 2], sp[3 * gi + 3]];
        curves.push(partialBezier(seg[0], seg[1], seg[2], seg[3], t0, Math.min(1, t1)));
      }
    }
    const out = [curves[0][0]];
    for (const c of curves) out.push(c[1], c[2], c[3]);
    return out;
  }

  // Rebuild this VMobject so its points align 1:1 with `other` for interpolation.
  // For each subpath the target curve count is max(thisCurves, otherCurves);
  // existing curves are subdivided (insertNCurves) rather than resampled so the
  // shape is preserved. Empty subpaths fall back to point-repetition.
  alignPointsWith(other: VMobject): this {
    const a = this.getSubpaths();
    const bRaw = other.getSubpaths();
    const nSub = Math.max(a.length, bRaw.length);
    const lastOf = (arr: number[][]): number[] => (arr.length ? arr[arr.length - 1] : [0, 0, 0]);
    const padTo = (subpaths: number[][][], padSource: number[][][]): number[][][] => {
      const out = subpaths.slice();
      while (out.length < nSub) out.push([lastOf(padSource[padSource.length - 1] ?? [])]);
      return out;
    };
    const aPadded = padTo(a, a);
    const bPadded = padTo(bRaw, bRaw);
    // Cyclic-rotation correspondence search: a shape whose subpaths were
    // authored/traversed starting from a different point in the cycle (e.g.
    // the same polygon's outline walked from a different vertex) still gets
    // matched subpath-for-subpath by position, not by original array order.
    // nSub<=1 (the dominant case -- simple shapes, single glyphs) is a
    // zero-cost no-op, skipped entirely.
    const b = nSub > 1 ? VMobject._bestSubpathRotation(aPadded, bPadded) : bPadded;

    const newPoints: number[][] = [];
    const newStarts: number[] = [];
    for (let i = 0; i < nSub; i++) {
      const sa = aPadded[i];
      const sb = b[i];
      const ncA = Math.floor((sa.length - 1) / 3);
      const ncB = Math.floor((sb.length - 1) / 3);
      const nc = Math.max(1, ncA, ncB);
      newStarts.push(newPoints.length);
      const resampled = VMobject._growSubpath(sa, nc);
      for (const p of resampled) newPoints.push(p);
    }
    this.points = newPoints;
    this.subpathStarts = newStarts;
    return this;
  }

  // Try each of the nSub cyclic rotations of `b`'s subpath order, scoring by
  // total centroid-to-centroid travel distance against `a`'s order, and keep
  // the minimum -- O(n^2), capped at nSub<=32 (falls back to identity order
  // above that, avoiding a perf blowup on pathological many-subpath shapes).
  // Scope is deliberately narrow: subpath ORDER only, not a full permutation/
  // Hungarian assignment, and not the deeper within-subpath starting-vertex
  // twist (a separate, not-yet-scoped follow-up).
  static _bestSubpathRotation(a: number[][][], b: number[][][]): number[][][] {
    const nSub = a.length;
    if (nSub > 32) return b;
    const aCentroids = a.map((sp) => V.centerOfMass(sp));
    const bCentroids = b.map((sp) => V.centerOfMass(sp));
    const dist = (p: number[], q: number[]): number => {
      const dx = p[0] - q[0], dy = p[1] - q[1], dz = (p[2] ?? 0) - (q[2] ?? 0);
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    };
    let bestRotation = 0;
    let bestScore = Infinity;
    for (let r = 0; r < nSub; r++) {
      let score = 0;
      for (let i = 0; i < nSub; i++) score += dist(aCentroids[i], bCentroids[(i + r) % nSub]);
      if (score < bestScore) { bestScore = score; bestRotation = r; }
    }
    if (bestRotation === 0) return b;
    const rotated: number[][][] = [];
    for (let i = 0; i < nSub; i++) rotated.push(b[(i + bestRotation) % nSub]);
    return rotated;
  }

  // Grow a single subpath's bezier list to exactly `nCurves` curves by
  // subdividing existing curves (shape-preserving); pads empty subpaths.
  static _growSubpath(sp: number[][], nCurves: number): number[][] {
    const existing = Math.floor((sp.length - 1) / 3);
    if (existing === 0) {
      const only = sp[0] ?? [0, 0, 0];
      const out: number[][] = [V.clone(only)];
      for (let i = 0; i < nCurves; i++) out.push(V.clone(only), V.clone(only), V.clone(only));
      return out;
    }
    if (existing >= nCurves) {
      return sp.map((p) => V.clone(p));
    }
    const add = nCurves - existing;
    const factors = new Array(existing).fill(1);
    for (let i = 0; i < add; i++) factors[i % existing] += 1;
    const out: number[][] = [V.clone(sp[0])];
    for (let i = 0; i < existing; i++) {
      const curve = [sp[3 * i], sp[3 * i + 1], sp[3 * i + 2], sp[3 * i + 3]];
      const f = factors[i];
      if (f <= 1) {
        out.push(V.clone(curve[1]), V.clone(curve[2]), V.clone(curve[3]));
      } else {
        const sub = subdivideBezier(curve, f);
        for (let k = 0; k < f; k++) out.push(sub[4 * k + 1], sub[4 * k + 2], sub[4 * k + 3]);
      }
    }
    return out;
  }

  interpolate(start: any, target: any, alpha: number): this {
    const n = Math.min(this.points.length, start.points.length, target.points.length);
    for (let i = 0; i < n; i++) this.points[i] = V.lerp(start.points[i] as number[], target.points[i] as number[], alpha);
    this.fillColor = Color.lerp(start.fillColor, target.fillColor, alpha);
    this.strokeColor = Color.lerp(start.strokeColor, target.strokeColor, alpha);
    this.fillOpacity = start.fillOpacity + (target.fillOpacity - start.fillOpacity) * alpha;
    this.strokeOpacity = start.strokeOpacity + (target.strokeOpacity - start.strokeOpacity) * alpha;
    this.strokeWidth = start.strokeWidth + (target.strokeWidth - start.strokeWidth) * alpha;
    const sn = Math.min(this.submobjects.length, start.submobjects.length, target.submobjects.length);
    for (let i = 0; i < sn; i++) this.submobjects[i].interpolate(start.submobjects[i], target.submobjects[i], alpha);
    return this;
  }

  copy(): this {
    const c = super.copy();
    c.strokeColor = Color.parse(this.strokeColor);
    c.fillColor = Color.parse(this.fillColor);
    c.backgroundStrokeColor = Color.parse(this.backgroundStrokeColor);
    c.subpathStarts = [...this.subpathStarts];
    c.sheenDirection = [...this.sheenDirection];
    c.gradientColors = this.gradientColors
      ? this.gradientColors.map((g) => Color.parse(g))
      : undefined;
    return c;
  }
}

// A plain container of VMobjects (manim's VGroup).
export class VGroup extends VMobject {
  constructor(...mobs: (Mobject | Mobject[])[]) {
    super();
    this.add(...mobs);
  }

  arrange(direction: number[] = V.RIGHT, buff = 0.25): this {
    for (let i = 1; i < this.submobjects.length; i++) {
      this.submobjects[i].nextTo(this.submobjects[i - 1], direction, buff);
    }
    return this;
  }

  get(i: number): Mobject { return this.submobjects[i]; }
}
