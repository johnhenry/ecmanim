// Base class for every object in a scene. Holds a transform-able point cloud
// plus a tree of submobjects. VMobject extends this with bezier drawing.

import * as V from "../core/math/vector.js";
import { Color } from "../core/color.js";
import { makeAnimateBuilder } from "../animation/composition.js";

let _idCounter = 0;

export class Mobject {
  constructor(config = {}) {
    this.id = _idCounter++;
    this.points = []; // array of [x,y,z]
    this.submobjects = [];
    this.name = config.name || this.constructor.name;
    this.color = Color.parse(config.color ?? "#FFFFFF");
    this.opacity = config.opacity ?? 1;
    this.zIndex = config.zIndex ?? 0;
    this.updaters = [];
  }

  // --- tree ---------------------------------------------------------------
  add(...mobs) {
    for (const m of mobs.flat()) {
      if (m && !this.submobjects.includes(m)) this.submobjects.push(m);
    }
    return this;
  }

  remove(...mobs) {
    const set = new Set(mobs.flat());
    this.submobjects = this.submobjects.filter((m) => !set.has(m));
    return this;
  }

  // All mobjects in this subtree that actually carry points (family members).
  getFamily() {
    const out = [this];
    for (const s of this.submobjects) out.push(...s.getFamily());
    return out;
  }

  // Every point across the whole family — the basis for transforms & bounds.
  *allPoints() {
    for (const m of this.getFamily()) {
      for (const p of m.points) yield p;
    }
  }

  // --- transforms ---------------------------------------------------------
  applyToPoints(fn) {
    for (const m of this.getFamily()) {
      for (let i = 0; i < m.points.length; i++) m.points[i] = fn(m.points[i]);
    }
    return this;
  }

  shift(...vectors) {
    const total = vectors
      .filter((v) => Array.isArray(v))
      .reduce((acc, v) => V.add(acc, v), [0, 0, 0]);
    return this.applyToPoints((p) => V.add(p, total));
  }

  moveTo(pointOrMobject, aboutEdge = V.ORIGIN) {
    const target = pointOrMobject instanceof Mobject
      ? pointOrMobject.getCenter()
      : pointOrMobject;
    const ref = this.getBoundaryPoint(aboutEdge);
    return this.shift(V.sub(target, ref));
  }

  scale(factor, { aboutPoint } = {}) {
    const center = aboutPoint ?? this.getCenter();
    return this.applyToPoints((p) => V.add(center, V.scale(V.sub(p, center), factor)));
  }

  stretch(factor, dim, { aboutPoint } = {}) {
    const center = aboutPoint ?? this.getCenter();
    return this.applyToPoints((p) => {
      const q = V.clone(p);
      q[dim] = center[dim] + (q[dim] - center[dim]) * factor;
      return q;
    });
  }

  rotate(angle, { axis = V.OUT, aboutPoint } = {}) {
    const center = aboutPoint ?? this.getCenter();
    return this.applyToPoints((p) =>
      V.add(center, V.rotateVector(V.sub(p, center), angle, axis)));
  }

  flip(axis = V.UP, opts = {}) {
    return this.rotate(Math.PI, { axis, ...opts });
  }

  // --- bounds -------------------------------------------------------------
  getBoundingBox() {
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    let any = false;
    for (const p of this.allPoints()) {
      any = true;
      for (let i = 0; i < 3; i++) {
        if (p[i] < min[i]) min[i] = p[i];
        if (p[i] > max[i]) max[i] = p[i];
      }
    }
    if (!any) return { min: [0, 0, 0], max: [0, 0, 0] };
    return { min, max };
  }

  getCenter() {
    const { min, max } = this.getBoundingBox();
    return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  }

  // A point on the bounding box in the given direction (e.g. UP-edge, corner).
  getBoundaryPoint(direction) {
    const { min, max } = this.getBoundingBox();
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    return [
      direction[0] === 0 ? center[0] : direction[0] > 0 ? max[0] : min[0],
      direction[1] === 0 ? center[1] : direction[1] > 0 ? max[1] : min[1],
      direction[2] === 0 ? center[2] : direction[2] > 0 ? max[2] : min[2],
    ];
  }

  getWidth() {
    const { min, max } = this.getBoundingBox();
    return max[0] - min[0];
  }

  getHeight() {
    const { min, max } = this.getBoundingBox();
    return max[1] - min[1];
  }

  getTop() { return this.getBoundaryPoint(V.UP); }
  getBottom() { return this.getBoundaryPoint(V.DOWN); }
  getLeft() { return this.getBoundaryPoint(V.LEFT); }
  getRight() { return this.getBoundaryPoint(V.RIGHT); }
  getCorner(dir) { return this.getBoundaryPoint(dir); }

  setWidth(w) {
    const cur = this.getWidth();
    return cur === 0 ? this : this.scale(w / cur);
  }

  setHeight(h) {
    const cur = this.getHeight();
    return cur === 0 ? this : this.scale(h / cur);
  }

  // --- positioning helpers ------------------------------------------------
  toEdge(edge, buff = 0.5, frame = { width: 14.222, height: 8 }) {
    const target = [
      edge[0] * (frame.width / 2 - buff),
      edge[1] * (frame.height / 2 - buff),
      0,
    ];
    const ref = this.getBoundaryPoint(edge);
    // Only shift along the non-zero components of edge.
    const delta = V.sub(target, ref);
    for (let i = 0; i < 3; i++) if (edge[i] === 0) delta[i] = 0;
    return this.shift(delta);
  }

  toCorner(corner, buff = 0.5, frame) {
    return this.toEdge(corner, buff, frame);
  }

  center() {
    return this.shift(V.neg(this.getCenter()));
  }

  nextTo(mobjectOrPoint, direction = V.RIGHT, buff = 0.25, aligned = null) {
    const anchor = mobjectOrPoint instanceof Mobject
      ? mobjectOrPoint.getBoundaryPoint(direction)
      : mobjectOrPoint;
    const ref = this.getBoundaryPoint(V.neg(direction));
    const target = V.add(anchor, V.scale(direction, buff));
    let delta = V.sub(target, ref);
    // Keep the perpendicular components aligned to the anchor's center.
    return this.shift(delta);
  }

  // --- style --------------------------------------------------------------
  setColor(color) {
    this.color = Color.parse(color);
    for (const m of this.submobjects) m.setColor(color);
    return this;
  }

  setOpacity(o) {
    this.opacity = o;
    for (const m of this.submobjects) m.setOpacity(o);
    return this;
  }

  fade(darkness = 0.5) {
    return this.setOpacity(this.opacity * (1 - darkness));
  }

  // Ergonomic animation builder: `scene.play(mob.animate.shift(RIGHT).scale(2))`.
  get animate() {
    return makeAnimateBuilder(this);
  }

  // --- updaters (for continuous animation) --------------------------------
  addUpdater(fn) {
    this.updaters.push(fn);
    return this;
  }

  clearUpdaters() {
    this.updaters = [];
    for (const m of this.submobjects) m.clearUpdaters();
    return this;
  }

  update(dt) {
    for (const fn of this.updaters) fn(this, dt);
    return this;
  }

  hasUpdaters() {
    if (this.updaters.length) return true;
    return this.submobjects.some((m) => m.hasUpdaters());
  }

  // --- copy / interpolate -------------------------------------------------
  copy() {
    const c = Object.create(Object.getPrototypeOf(this));
    Object.assign(c, this);
    c.id = _idCounter++;
    c.points = this.points.map((p) => [p[0], p[1], p[2]]);
    c.color = Color.parse(this.color);
    c.updaters = [];
    c.submobjects = this.submobjects.map((m) => m.copy());
    return c;
  }

  // Blend this mobject's state from `start` toward `target` by alpha in [0,1].
  // Base class handles points, color and opacity; VMobject extends for fill.
  interpolate(start, target, alpha) {
    const n = Math.min(this.points.length, start.points.length, target.points.length);
    for (let i = 0; i < n; i++) {
      this.points[i] = V.lerp(start.points[i], target.points[i], alpha);
    }
    this.color = Color.lerp(start.color, target.color, alpha);
    this.opacity = start.opacity + (target.opacity - start.opacity) * alpha;
    const sn = Math.min(this.submobjects.length, start.submobjects.length, target.submobjects.length);
    for (let i = 0; i < sn; i++) {
      this.submobjects[i].interpolate(start.submobjects[i], target.submobjects[i], alpha);
    }
    return this;
  }
}
