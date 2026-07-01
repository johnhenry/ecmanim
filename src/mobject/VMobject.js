// Vectorized Mobject: a shape defined by cubic bezier curves, the workhorse of
// manim. Points are a flat list where n_curves = (n_points - 1) / 3 within each
// subpath. Subpaths (for holes / disjoint strokes / glyphs) are tracked by the
// indices at which a new "moveTo" begins.

import { Mobject } from "./Mobject.js";
import { Color } from "../core/color.js";
import * as V from "../core/math/vector.js";
import { bezier, straightControlPoints, partialBezier } from "../core/math/bezier.js";

export class VMobject extends Mobject {
  constructor(config = {}) {
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
  }

  // --- path construction --------------------------------------------------
  startNewPath(point) {
    this.subpathStarts.push(this.points.length);
    this.points.push(V.clone(point));
    return this;
  }

  addCubicBezier(handle1, handle2, anchor) {
    this.points.push(V.clone(handle1), V.clone(handle2), V.clone(anchor));
    return this;
  }

  addLineTo(point) {
    const last = this.points[this.points.length - 1];
    const [c1, c2] = straightControlPoints(last, point);
    return this.addCubicBezier(c1, c2, point);
  }

  // Build an open/closed path through a list of corner points using straight
  // bezier segments. This is how Line / Polygon / Rectangle are defined.
  setPointsAsCorners(corners) {
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
  appendBezierPoints(pts, newSubpath = true) {
    if (pts.length === 0) return this;
    if (newSubpath || this.points.length === 0) this.subpathStarts.push(this.points.length);
    for (const p of pts) this.points.push(V.clone(p));
    return this;
  }

  close() {
    // Close the current subpath back to its start anchor.
    const start = this.subpathStarts[this.subpathStarts.length - 1] ?? 0;
    const first = this.points[start];
    const last = this.points[this.points.length - 1];
    if (first && last && !V.equals(first, last)) this.addLineTo(first);
    return this;
  }

  // --- queries ------------------------------------------------------------
  getSubpaths() {
    if (this.points.length === 0) return [];
    const starts = this.subpathStarts.length ? [...this.subpathStarts] : [0];
    const paths = [];
    for (let i = 0; i < starts.length; i++) {
      const s = starts[i];
      const e = i + 1 < starts.length ? starts[i + 1] : this.points.length;
      const seg = this.points.slice(s, e);
      if (seg.length >= 1) paths.push(seg);
    }
    return paths;
  }

  getNumCurves() {
    let n = 0;
    for (const sp of this.getSubpaths()) n += Math.max(0, Math.floor((sp.length - 1) / 3));
    return n;
  }

  // Point at proportion alpha in [0,1] along the whole (multi-subpath) outline.
  pointFromProportion(alpha) {
    const curves = [];
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
  setFill(color, opacity = 1) {
    if (color != null) this.fillColor = Color.parse(color);
    this.fillOpacity = opacity;
    return this;
  }

  setStroke(color, width, opacity = 1) {
    if (color != null) this.strokeColor = Color.parse(color);
    if (width != null) this.strokeWidth = width;
    this.strokeOpacity = opacity;
    return this;
  }

  setColor(color) {
    this.color = Color.parse(color);
    this.strokeColor = Color.parse(color);
    this.fillColor = Color.parse(color);
    for (const m of this.submobjects) m.setColor(color);
    return this;
  }

  setStyle({ fillColor, fillOpacity, strokeColor, strokeWidth, strokeOpacity } = {}) {
    if (fillColor != null) this.fillColor = Color.parse(fillColor);
    if (fillOpacity != null) this.fillOpacity = fillOpacity;
    if (strokeColor != null) this.strokeColor = Color.parse(strokeColor);
    if (strokeWidth != null) this.strokeWidth = strokeWidth;
    if (strokeOpacity != null) this.strokeOpacity = strokeOpacity;
    return this;
  }

  setOpacity(o) {
    this.fillOpacity = o;
    this.strokeOpacity = o;
    this.opacity = o;
    for (const m of this.submobjects) m.setOpacity(o);
    return this;
  }

  // --- transform support: make two vmobjects have matching point counts ---
  // Resample this subpath's bezier list to exactly `nCurves` curves.
  static _resampleSubpath(sp, nCurves) {
    const curves = [];
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
  alignPointsWith(other) {
    const a = this.getSubpaths();
    const b = other.getSubpaths();
    const nSub = Math.max(a.length, b.length);
    const newPoints = [];
    const newStarts = [];
    const lastOf = (arr) => (arr.length ? arr[arr.length - 1] : [0, 0, 0]);
    for (let i = 0; i < nSub; i++) {
      const sa = a[i] ?? [lastOf(a[a.length - 1] ?? [])];
      const sb = b[i] ?? [lastOf(b[b.length - 1] ?? [])];
      const nc = Math.max(1, Math.floor((sa.length - 1) / 3), Math.floor((sb.length - 1) / 3));
      const resampled = VMobject._resampleSubpath(sa, nc);
      newStarts.push(newPoints.length);
      for (const p of resampled) newPoints.push(p);
    }
    this.points = newPoints;
    this.subpathStarts = newStarts;
    return this;
  }

  interpolate(start, target, alpha) {
    const n = Math.min(this.points.length, start.points.length, target.points.length);
    for (let i = 0; i < n; i++) this.points[i] = V.lerp(start.points[i], target.points[i], alpha);
    this.fillColor = Color.lerp(start.fillColor, target.fillColor, alpha);
    this.strokeColor = Color.lerp(start.strokeColor, target.strokeColor, alpha);
    this.fillOpacity = start.fillOpacity + (target.fillOpacity - start.fillOpacity) * alpha;
    this.strokeOpacity = start.strokeOpacity + (target.strokeOpacity - start.strokeOpacity) * alpha;
    this.strokeWidth = start.strokeWidth + (target.strokeWidth - start.strokeWidth) * alpha;
    const sn = Math.min(this.submobjects.length, start.submobjects.length, target.submobjects.length);
    for (let i = 0; i < sn; i++) this.submobjects[i].interpolate(start.submobjects[i], target.submobjects[i], alpha);
    return this;
  }

  copy() {
    const c = super.copy();
    c.strokeColor = Color.parse(this.strokeColor);
    c.fillColor = Color.parse(this.fillColor);
    c.subpathStarts = [...this.subpathStarts];
    return c;
  }
}

// A plain container of VMobjects (manim's VGroup).
export class VGroup extends VMobject {
  constructor(...mobs) {
    super();
    this.add(...mobs);
  }

  arrange(direction = V.RIGHT, buff = 0.25) {
    for (let i = 1; i < this.submobjects.length; i++) {
      this.submobjects[i].nextTo(this.submobjects[i - 1], direction, buff);
    }
    return this;
  }

  get(i) { return this.submobjects[i]; }
}
