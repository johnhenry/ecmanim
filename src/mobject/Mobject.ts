// Base class for every object in a scene. Holds a transform-able point cloud
// plus a tree of submobjects. VMobject extends this with bezier drawing.

import * as V from "../core/math/vector.ts";
import { Color } from "../core/color.ts";
import { makeAnimateBuilder } from "../animation/composition.ts";
import { copyMemberwiseStyle } from "./copy_style.ts";
import type { Vec3, ColorLike } from "../core/types.ts";

let _idCounter = 0;

/** Base configuration accepted by every Mobject constructor. */
export interface MobjectConfig {
  name?: string;
  color?: ColorLike;
  opacity?: number;
  zIndex?: number;
  [key: string]: any;
}

/** An updater callback invoked each frame with the mobject and a time delta. */
export type Updater = (mob: Mobject, dt: number) => void;

/** An axis-aligned bounding box in world space. */
export interface BoundingBox {
  min: number[];
  max: number[];
}

export class Mobject {
  id: number;
  points: number[][];
  submobjects: Mobject[];
  name: string;
  /**
   * Backing field for `.color`. Subclasses (e.g. VMobject.setColor) write
   * here directly to avoid re-entering the `color` setter below.
   */
  protected _color: Color;
  opacity: number;
  zIndex: number;
  updaters: Updater[];
  updatingSuspended: boolean;
  savedState?: Mobject;
  target?: Mobject;

  constructor(config: MobjectConfig = {}) {
    this.id = _idCounter++;
    this.points = []; // array of [x,y,z]
    this.submobjects = [];
    this.name = config.name || this.constructor.name;
    this._color = Color.parse(config.color ?? "#FFFFFF");
    this.opacity = config.opacity ?? 1;
    this.zIndex = config.zIndex ?? 0;
    this.updaters = [];
    this.updatingSuspended = false;
  }

  /**
   * Raw assignment (`mob.color = "#E8833A"`) forwards to `setColor()` so it
   * actually recolors the render (subclasses like VMobject read
   * strokeColor/fillColor, not this field, for drawing) instead of silently
   * updating a field nothing downstream looks at.
   */
  get color(): Color {
    return this._color;
  }

  set color(value: ColorLike) {
    this.setColor(value);
  }

  // --- tree ---------------------------------------------------------------
  add(...mobs: (Mobject | Mobject[])[]): this {
    for (const m of mobs.flat()) {
      if (m && !this.submobjects.includes(m)) this.submobjects.push(m);
    }
    return this;
  }

  remove(...mobs: (Mobject | Mobject[])[]): this {
    const set = new Set(mobs.flat());
    this.submobjects = this.submobjects.filter((m) => !set.has(m));
    return this;
  }

  // Iterate direct submobjects (matches Python manim's VGroup __iter__ —
  // shallow, not the recursive family). Lets `for (const m of group)` and
  // `[...group]` work directly, without needing `.submobjects`.
  [Symbol.iterator](): Iterator<Mobject> {
    return this.submobjects[Symbol.iterator]();
  }

  // All mobjects in this subtree that actually carry points (family members).
  getFamily(): Mobject[] {
    const out: Mobject[] = [this];
    for (const s of this.submobjects) out.push(...s.getFamily());
    return out;
  }

  // Every point across the whole family — the basis for transforms & bounds.
  *allPoints(): Generator<number[]> {
    for (const m of this.getFamily()) {
      for (const p of m.points) yield p;
    }
  }

  // --- transforms ---------------------------------------------------------
  applyToPoints(fn: (p: number[]) => number[]): this {
    for (const m of this.getFamily()) {
      for (let i = 0; i < m.points.length; i++) m.points[i] = fn(m.points[i]);
    }
    return this;
  }

  shift(...vectors: number[][]): this {
    const total = vectors
      .filter((v) => Array.isArray(v))
      .reduce((acc, v) => V.add(acc, v), [0, 0, 0] as number[]);
    return this.applyToPoints((p) => V.add(p, total));
  }

  moveTo(pointOrMobject: Mobject | number[], aboutEdge: number[] = V.ORIGIN): this {
    const target = pointOrMobject instanceof Mobject
      ? pointOrMobject.getCenter()
      : pointOrMobject;
    const ref = this.getBoundaryPoint(aboutEdge);
    return this.shift(V.sub(target, ref));
  }

  scale(factor: number, { aboutPoint }: { aboutPoint?: number[] } = {}): this {
    const center = aboutPoint ?? this.getCenter();
    return this.applyToPoints((p) => V.add(center, V.scale(V.sub(p, center), factor)));
  }

  stretch(factor: number, dim: number, { aboutPoint }: { aboutPoint?: number[] } = {}): this {
    const center = aboutPoint ?? this.getCenter();
    return this.applyToPoints((p) => {
      const q = V.clone(p);
      q[dim] = center[dim] + (q[dim] - center[dim]) * factor;
      return q;
    });
  }

  rotate(angle: number, { axis = V.OUT, aboutPoint }: { axis?: number[]; aboutPoint?: number[] } = {}): this {
    const center = aboutPoint ?? this.getCenter();
    return this.applyToPoints((p) =>
      V.add(center, V.rotateVector(V.sub(p, center), angle, axis)));
  }

  flip(axis: number[] = V.UP, opts: { aboutPoint?: number[] } = {}): this {
    return this.rotate(Math.PI, { axis, ...opts });
  }

  // --- bounds -------------------------------------------------------------
  getBoundingBox(): BoundingBox {
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

  getCenter(): Vec3 {
    const { min, max } = this.getBoundingBox();
    return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  }

  // A point on the bounding box in the given direction (e.g. UP-edge, corner).
  getBoundaryPoint(direction: number[]): Vec3 {
    const { min, max } = this.getBoundingBox();
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    return [
      direction[0] === 0 ? center[0] : direction[0] > 0 ? max[0] : min[0],
      direction[1] === 0 ? center[1] : direction[1] > 0 ? max[1] : min[1],
      direction[2] === 0 ? center[2] : direction[2] > 0 ? max[2] : min[2],
    ];
  }

  getWidth(): number {
    const { min, max } = this.getBoundingBox();
    return max[0] - min[0];
  }

  getHeight(): number {
    const { min, max } = this.getBoundingBox();
    return max[1] - min[1];
  }

  getDepth(): number {
    const { min, max } = this.getBoundingBox();
    return max[2] - min[2];
  }

  getTop(): Vec3 { return this.getBoundaryPoint(V.UP); }
  getBottom(): Vec3 { return this.getBoundaryPoint(V.DOWN); }
  getLeft(): Vec3 { return this.getBoundaryPoint(V.LEFT); }
  getRight(): Vec3 { return this.getBoundaryPoint(V.RIGHT); }
  getCorner(dir: number[]): Vec3 { return this.getBoundaryPoint(dir); }

  setWidth(w: number, stretch = false): this {
    return this.rescaleToFit(w, 0, stretch);
  }

  setHeight(h: number, stretch = false): this {
    return this.rescaleToFit(h, 1, stretch);
  }

  // --- positioning helpers ------------------------------------------------
  toEdge(edge: number[], buff = 0.5, frame: { width: number; height: number } = { width: 14.222, height: 8 }): this {
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

  toCorner(corner: number[], buff = 0.5, frame?: { width: number; height: number }): this {
    return this.toEdge(corner, buff, frame);
  }

  center(): this {
    return this.shift(V.neg(this.getCenter()));
  }

  nextTo(mobjectOrPoint: Mobject | number[], direction: number[] = V.RIGHT, buff = 0.25, aligned: any = null): this {
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
  setColor(color: ColorLike): this {
    this._color = Color.parse(color);
    for (const m of this.submobjects) m.setColor(color);
    return this;
  }

  setOpacity(o: number): this {
    this.opacity = o;
    for (const m of this.submobjects) m.setOpacity(o);
    return this;
  }

  fade(darkness = 0.5): this {
    return this.setOpacity(this.opacity * (1 - darkness));
  }

  // Ergonomic animation builder: `scene.play(mob.animate.shift(RIGHT).scale(2))`.
  get animate(): any {
    return makeAnimateBuilder(this);
  }

  // --- updaters (for continuous animation) --------------------------------
  addUpdater(fn: Updater): this {
    this.updaters.push(fn);
    return this;
  }

  clearUpdaters(): this {
    this.updaters = [];
    for (const m of this.submobjects) m.clearUpdaters();
    return this;
  }

  update(dt: number): this {
    if (this.updatingSuspended) return this;
    for (const fn of this.updaters) fn(this, dt);
    for (const m of this.submobjects) m.update(dt);
    return this;
  }

  hasUpdaters(): boolean {
    if (this.updaters.length) return true;
    return this.submobjects.some((m) => m.hasUpdaters());
  }

  // --- become / state -----------------------------------------------------
  // Make this mobject become a deep copy of another's geometry & style. This is
  // the primitive behind always_redraw and transform-less morphs.
  become(
    mobject: Mobject,
    {
      matchHeight = false,
      matchWidth = false,
      matchDepth = false,
      matchCenter = false,
      stretch = false,
    }: {
      matchHeight?: boolean;
      matchWidth?: boolean;
      matchDepth?: boolean;
      matchCenter?: boolean;
      stretch?: boolean;
    } = {},
  ): this {
    const src = mobject.copy();
    if (stretch) {
      if (matchHeight) src.matchHeight(this);
      if (matchWidth) src.matchWidth(this);
      if (matchDepth) src.matchDepth(this);
    } else {
      const dims = [matchWidth, matchHeight, matchDepth];
      for (let dim = 0; dim < 3; dim++) {
        if (dims[dim]) src.rescaleToFit(this.lengthOverDim(dim), dim, false);
      }
    }
    if (matchCenter) src.moveTo(this.getCenter());

    // Copy geometry/style member-wise across the family, growing/shrinking the
    // submobject list to match.
    this.points = src.points.map((p) => [p[0], p[1], p[2]]);
    this._color = Color.parse(src.color);
    this.opacity = src.opacity;
    this.zIndex = src.zIndex;
    // Copy any extra style fields subclasses added (fill/stroke/etc.) --
    // the primitive behind always_redraw and transform-less morphs.
    copyMemberwiseStyle(this, src);
    this.submobjects = src.submobjects;
    return this;
  }

  // Store a deep copy of the current state; restore() reverts to it.
  saveState(): this {
    this.savedState = this.copy();
    return this;
  }

  restore(): this {
    if (!this.savedState) throw new Error("Trying to restore without having saved.");
    return this.become(this.savedState);
  }

  // Create and store a copy to be mutated as an animation target.
  generateTarget(useDeepcopy = true): Mobject {
    this.target = useDeepcopy ? this.copy() : this;
    return this.target;
  }

  // --- alignment ----------------------------------------------------------
  private lengthOverDim(dim: number): number {
    const { min, max } = this.getBoundingBox();
    return max[dim] - min[dim];
  }

  // Align this mobject's edge in `direction` to the other's same edge (or point).
  alignTo(mobjectOrPoint: Mobject | number[], direction: number[] = V.UP): this {
    for (let dim = 0; dim < 3; dim++) {
      if (direction[dim] !== 0) {
        this.setCoord(this.getCoordFromRef(mobjectOrPoint, dim, direction), dim, direction);
      }
    }
    return this;
  }

  private getCoordFromRef(mobjectOrPoint: Mobject | number[], dim: number, direction: number[]): number {
    if (mobjectOrPoint instanceof Mobject) return mobjectOrPoint.getBoundaryPoint(direction)[dim];
    return mobjectOrPoint[dim];
  }

  // --- match family -------------------------------------------------------
  matchColor(mobject: Mobject): this {
    return this.setColor(mobject.color);
  }

  matchDimSize(mobject: Mobject, dim: number): this {
    return this.rescaleToFit(mobject.lengthOverDim(dim), dim, false);
  }

  matchWidth(mobject: Mobject): this {
    return this.matchDimSize(mobject, 0);
  }

  matchHeight(mobject: Mobject): this {
    return this.matchDimSize(mobject, 1);
  }

  matchDepth(mobject: Mobject): this {
    return this.matchDimSize(mobject, 2);
  }

  matchCoord(mobject: Mobject, dim: number, direction: number[] = V.ORIGIN): this {
    return this.setCoord(mobject.getCoord(dim, direction), dim, direction);
  }

  matchX(mobject: Mobject, direction: number[] = V.ORIGIN): this {
    return this.matchCoord(mobject, 0, direction);
  }

  matchY(mobject: Mobject, direction: number[] = V.ORIGIN): this {
    return this.matchCoord(mobject, 1, direction);
  }

  matchZ(mobject: Mobject, direction: number[] = V.ORIGIN): this {
    return this.matchCoord(mobject, 2, direction);
  }

  matchPoints(mobject: Mobject): this {
    this.points = mobject.points.map((p) => [p[0], p[1], p[2]]);
    return this;
  }

  // --- coordinates --------------------------------------------------------
  getCoord(dim: number, direction: number[] = V.ORIGIN): number {
    return this.getBoundaryPoint(direction)[dim];
  }

  setCoord(value: number, dim: number, direction: number[] = V.ORIGIN): this {
    const cur = this.getCoord(dim, direction);
    const shift = [0, 0, 0];
    shift[dim] = value - cur;
    return this.shift(shift);
  }

  getX(direction: number[] = V.ORIGIN): number {
    return this.getCoord(0, direction);
  }

  getY(direction: number[] = V.ORIGIN): number {
    return this.getCoord(1, direction);
  }

  getZ(direction: number[] = V.ORIGIN): number {
    return this.getCoord(2, direction);
  }

  setX(x: number, direction: number[] = V.ORIGIN): this {
    return this.setCoord(x, 0, direction);
  }

  setY(y: number, direction: number[] = V.ORIGIN): this {
    return this.setCoord(y, 1, direction);
  }

  setZ(z: number, direction: number[] = V.ORIGIN): this {
    return this.setCoord(z, 2, direction);
  }

  // --- scale/stretch to fit ----------------------------------------------
  rescaleToFit(length: number, dim: number, stretch: boolean): this {
    const oldLength = this.lengthOverDim(dim);
    if (oldLength === 0) return this;
    if (stretch) {
      this.stretch(length / oldLength, dim);
    } else {
      this.scale(length / oldLength);
    }
    return this;
  }

  scaleToFitWidth(w: number): this {
    return this.rescaleToFit(w, 0, false);
  }

  scaleToFitHeight(h: number): this {
    return this.rescaleToFit(h, 1, false);
  }

  scaleToFitDepth(d: number): this {
    return this.rescaleToFit(d, 2, false);
  }

  stretchToFitWidth(w: number): this {
    return this.rescaleToFit(w, 0, true);
  }

  stretchToFitHeight(h: number): this {
    return this.rescaleToFit(h, 1, true);
  }

  stretchToFitDepth(d: number): this {
    return this.rescaleToFit(d, 2, true);
  }

  // --- point functions ----------------------------------------------------
  applyPointsFunctionAboutPoint(
    fn: (points: number[][]) => number[][],
    aboutPoint?: number[],
  ): this {
    const about = aboutPoint ?? this.getCenter();
    for (const m of this.getFamily()) {
      if (!m.points.length) continue;
      const shifted = m.points.map((p) => V.sub(p, about));
      const transformed = fn(shifted);
      for (let i = 0; i < m.points.length; i++) m.points[i] = V.add(transformed[i], about);
    }
    return this;
  }

  applyFunction(fn: (p: number[]) => number[]): this {
    return this.applyToPoints((p) => {
      const r = fn(p);
      return [r[0], r[1] ?? 0, r[2] ?? 0];
    });
  }

  // Apply a 2x2 or 3x3 matrix (about a point, default center).
  applyMatrix(matrix: number[][], { aboutPoint }: { aboutPoint?: number[] } = {}): this {
    // Normalize a 2x2 matrix into 3x3.
    let m3: number[][];
    if (matrix.length === 2) {
      m3 = [
        [matrix[0][0], matrix[0][1], 0],
        [matrix[1][0], matrix[1][1], 0],
        [0, 0, 1],
      ];
    } else {
      m3 = matrix;
    }
    return this.applyPointsFunctionAboutPoint(
      (points) => points.map((p) => V.matrixVectorProduct(m3, p)),
      aboutPoint ?? this.getCenter(),
    );
  }

  // Treat (x, y) as a complex number and apply fn; z stays fixed.
  applyComplexFunction(
    fn: (z: { re: number; im: number }) => { re: number; im: number } | number[],
    { aboutPoint }: { aboutPoint?: number[] } = {},
  ): this {
    return this.applyFunction((p) => {
      const z = V.R3ToComplex(p);
      const w = fn(z);
      const out = V.complexToR3(w as any);
      return [out[0], out[1], p[2]];
    });
  }

  // --- submobject ops -----------------------------------------------------
  addToBack(...mobs: (Mobject | Mobject[])[]): this {
    const flat = mobs.flat().filter((m) => m && !this.submobjects.includes(m));
    this.submobjects = [...flat, ...this.submobjects];
    return this;
  }

  insert(index: number, mob: Mobject): this {
    this.submobjects.splice(index, 0, mob);
    return this;
  }

  sort(fn?: (mob: Mobject) => number): this {
    const key = fn ?? ((m: Mobject) => {
      const c = m.getCenter();
      return c[0] * 1e6 + c[1];
    });
    this.submobjects.sort((a, b) => key(a) - key(b));
    return this;
  }

  shuffle(): this {
    for (let i = this.submobjects.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.submobjects[i], this.submobjects[j]] = [this.submobjects[j], this.submobjects[i]];
    }
    return this;
  }

  invert(): this {
    this.submobjects.reverse();
    return this;
  }

  // Lay out submobjects in a line along `direction`, then (by default) recenter.
  arrange(direction: number[] = V.RIGHT, buff = 0.25, { center = true }: { center?: boolean } = {}): this {
    for (let i = 1; i < this.submobjects.length; i++) {
      this.submobjects[i].nextTo(this.submobjects[i - 1], direction, buff);
    }
    if (center) this.center();
    return this;
  }

  arrangeInGrid(
    {
      rows,
      cols,
      buff = 0.25,
      rowHeights,
      colWidths,
      flowOrder = "rd",
    }: {
      rows?: number;
      cols?: number;
      buff?: number | [number, number];
      rowHeights?: number[];
      colWidths?: number[];
      flowOrder?: string;
    } = {},
  ): this {
    const mobs = this.submobjects;
    const n = mobs.length;
    if (n === 0) return this;

    // Resolve rows/cols.
    let r = rows;
    let c = cols;
    if (r === undefined && c === undefined) {
      c = Math.ceil(Math.sqrt(n));
      r = Math.ceil(n / c);
    } else if (r === undefined) {
      r = Math.ceil(n / (c as number));
    } else if (c === undefined) {
      c = Math.ceil(n / r);
    }

    const [bx, by] = Array.isArray(buff) ? buff : [buff, buff];

    // Cell sizes: use max width/height of submobjects (or provided arrays).
    let cellW = 0;
    let cellH = 0;
    for (const m of mobs) {
      cellW = Math.max(cellW, m.getWidth());
      cellH = Math.max(cellH, m.getHeight());
    }
    const stepX = (colWidths ? undefined : cellW + bx);
    const stepY = (rowHeights ? undefined : cellH + by);

    // Precompute column x-offsets and row y-offsets (top-to-bottom).
    const colX: number[] = [];
    let acc = 0;
    for (let j = 0; j < (c as number); j++) {
      colX.push(acc);
      acc += colWidths ? (colWidths[j] ?? cellW) + bx : (stepX as number);
    }
    const rowY: number[] = [];
    acc = 0;
    for (let i = 0; i < (r as number); i++) {
      rowY.push(acc);
      acc += rowHeights ? (rowHeights[i] ?? cellH) + by : (stepY as number);
    }

    for (let k = 0; k < n; k++) {
      let row: number;
      let col: number;
      if (flowOrder[0] === "d" || flowOrder[0] === "u") {
        // column-major
        col = Math.floor(k / (r as number));
        row = k % (r as number);
      } else {
        // row-major (default "rd")
        row = Math.floor(k / (c as number));
        col = k % (c as number);
      }
      mobs[k].moveTo([colX[col], -rowY[row], 0]);
    }
    this.center();
    return this;
  }

  // --- queries ------------------------------------------------------------
  getAllPoints(): number[][] {
    const out: number[][] = [];
    for (const p of this.allPoints()) out.push(p);
    return out;
  }

  getStartAndEnd(): [Vec3, Vec3] {
    const pts = this.getAllPoints();
    if (!pts.length) return [[0, 0, 0], [0, 0, 0]];
    const s = pts[0];
    const e = pts[pts.length - 1];
    return [[s[0], s[1], s[2]], [e[0], e[1], e[2]]];
  }

  getMidpoint(): Vec3 {
    const p = this.pointFromProportion(0.5);
    return [p[0], p[1], p[2] ?? 0];
  }

  // Fallback proportion: linear interpolation over the ordered point list.
  pointFromProportion(alpha: number): number[] {
    const pts = this.getAllPoints();
    if (!pts.length) return [0, 0, 0];
    if (pts.length === 1) return [pts[0][0], pts[0][1], pts[0][2]];
    const a = Math.max(0, Math.min(1, alpha));
    const scaled = a * (pts.length - 1);
    const i = Math.floor(scaled);
    if (i >= pts.length - 1) {
      const last = pts[pts.length - 1];
      return [last[0], last[1], last[2]];
    }
    return V.lerp(pts[i], pts[i + 1], scaled - i);
  }

  getCenterOfMass(): Vec3 {
    return V.centerOfMass(this.getAllPoints());
  }

  // --- updaters (extended) ------------------------------------------------
  removeUpdater(fn: Updater): this {
    this.updaters = this.updaters.filter((u) => u !== fn);
    return this;
  }

  getUpdaters(): Updater[] {
    return this.updaters;
  }

  suspendUpdating(): this {
    this.updatingSuspended = true;
    for (const m of this.submobjects) m.suspendUpdating();
    return this;
  }

  resumeUpdating(): this {
    this.updatingSuspended = false;
    for (const m of this.submobjects) m.resumeUpdating();
    return this;
  }

  // --- z-index ------------------------------------------------------------
  setZIndex(value: number): this {
    this.zIndex = value;
    for (const m of this.submobjects) m.setZIndex(value);
    return this;
  }

  // --- copy / interpolate -------------------------------------------------
  copy(): this {
    const c = Object.create(Object.getPrototypeOf(this));
    Object.assign(c, this);
    c.id = _idCounter++;
    c.points = this.points.map((p) => [p[0], p[1], p[2]]);
    c._color = Color.parse(this.color);
    c.updaters = [];
    c.submobjects = this.submobjects.map((m) => m.copy());
    return c;
  }

  // Blend this mobject's state from `start` toward `target` by alpha in [0,1].
  // Base class handles points, color and opacity; VMobject extends for fill.
  interpolate(start: Mobject, target: Mobject, alpha: number): this {
    const n = Math.min(this.points.length, start.points.length, target.points.length);
    for (let i = 0; i < n; i++) {
      this.points[i] = V.lerp(start.points[i], target.points[i], alpha);
    }
    this._color = Color.lerp(start.color, target.color, alpha);
    this.opacity = start.opacity + (target.opacity - start.opacity) * alpha;
    const sn = Math.min(this.submobjects.length, start.submobjects.length, target.submobjects.length);
    for (let i = 0; i < sn; i++) {
      this.submobjects[i].interpolate(start.submobjects[i], target.submobjects[i], alpha);
    }
    return this;
  }
}

// A plain (non-vector) container. Groups several mobjects so they can be
// transformed and arranged together, without any drawing of its own.
export class Group extends Mobject {
  constructor(...mobs: (Mobject | Mobject[])[]) {
    super();
    this.add(...mobs);
  }
}
