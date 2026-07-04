// Coordinate systems: NumberLine, Axes, NumberPlane. These map "data" numbers
// onto world-space points via a simple affine mapping, and build the visible
// mobjects (axis lines, ticks, grid, labels) as submobjects of a VGroup.

import { VMobject, VGroup } from "./VMobject.ts";
import * as V from "../core/math/vector.ts";
import { Line, Arrow, Dot, Circle, Polygon, Rectangle } from "./geometry.ts";
import { Text } from "./text/Text.ts";
import { MathTex } from "./mathtex.ts";
import { LinearBase } from "./graphing_scale.ts";
import type { _ScaleBase } from "./graphing_scale.ts";
import type { Vec3, ColorLike } from "../core/types.ts";

/** A "graph" is a VMobject that carries the function that generated it. */
type Graphish = VMobject & { underlyingFunction?: (x: number) => number };

/** Config for NumberLine. */
export interface NumberLineConfig {
  xRange?: number[];
  range?: number[];
  length?: number;
  color?: ColorLike;
  tickSize?: number;
  includeNumbers?: boolean;
  includeTip?: boolean;
  fontSize?: number;
  scaling?: _ScaleBase;
  [key: string]: any;
}

/** Config for Axes. */
export interface AxesConfig {
  xRange?: number[];
  yRange?: number[];
  xLength?: number;
  yLength?: number;
  color?: ColorLike;
  axisConfig?: NumberLineConfig;
  xAxisConfig?: NumberLineConfig;
  yAxisConfig?: NumberLineConfig;
  [key: string]: any;
}

/** Config for plot / graph helpers. */
export interface PlotConfig {
  xRange?: number[];
  color?: ColorLike;
  [key: string]: any;
}

/** Config for NumberPlane. */
export interface NumberPlaneConfig extends AxesConfig {
  backgroundLineStyle?: {
    color?: ColorLike;
    strokeWidth?: number;
    strokeOpacity?: number;
    [key: string]: any;
  };
}

// Inclusive-ish range: values from start up to (and including, within eps) stop.
function makeTickRange([start, stop, step]: number[]): number[] {
  const out: number[] = [];
  if (step === 0) return out;
  const eps = 1e-6 * Math.abs(step);
  if (step > 0) for (let x = start; x <= stop + eps; x += step) out.push(x);
  else for (let x = start; x >= stop - eps; x += step) out.push(x);
  return out;
}

export class NumberLine extends VGroup {
  xMin: number;
  xMax: number;
  xStep: number;
  length: number;
  tickSize: number;
  includeNumbers: boolean;
  includeTip: boolean;
  fontSize: number;
  unit: number;
  _leftX: number;
  scaling: _ScaleBase;
  /** Position-space (post-scaling) range endpoints used for the affine map. */
  _sMin: number;
  _sMax: number;
  axisLine!: Line | Arrow;
  ticks!: VGroup;
  numbers!: VGroup;

  constructor(config: NumberLineConfig = {}) {
    super();
    const range = config.xRange ?? config.range ?? [-5, 5, 1];
    this.xMin = range[0];
    this.xMax = range[1];
    this.xStep = range[2] ?? 1;
    this.scaling = config.scaling ?? new LinearBase();
    // Position-space endpoints (identity for a linear scale).
    this._sMin = this.scaling.functionOf(this.xMin);
    this._sMax = this.scaling.functionOf(this.xMax);
    // Default: 1 world unit per position unit.
    this.length = config.length ?? (this._sMax - this._sMin);
    this.color = (config.color ?? "#FFFFFF") as any;
    this.tickSize = config.tickSize ?? 0.1;
    this.includeNumbers = config.includeNumbers ?? false;
    this.includeTip = config.includeTip ?? false;
    this.fontSize = config.fontSize ?? 0.35;

    // Unit scale: world units per position unit along this line.
    this.unit = this._sMax === this._sMin ? 1 : this.length / (this._sMax - this._sMin);
    // The line is horizontal, centered on the origin, from -length/2 to +length/2.
    this._leftX = -this.length / 2;

    this._build();
  }

  _build() {
    const start = [this._leftX, 0, 0];
    const end = [this._leftX + this.length, 0, 0];
    this.axisLine = this.includeTip
      ? new Arrow(start, end, { color: this.color, strokeColor: this.color })
      : new Line(start, end, { color: this.color, strokeColor: this.color });
    this.add(this.axisLine);

    // Tick marks.
    this.ticks = new VGroup();
    for (const x of this.getTickRange()) {
      const p = this.numberToPoint(x);
      const tick = new Line(
        [p[0], p[1] - this.tickSize, 0],
        [p[0], p[1] + this.tickSize, 0],
        { color: this.color, strokeColor: this.color }
      );
      this.ticks.add(tick);
    }
    this.add(this.ticks);

    if (this.includeNumbers) this._addNumbers();
  }

  _addNumbers() {
    this.numbers = new VGroup();
    for (const x of this.getTickRange()) {
      const p = this.numberToPoint(x);
      const label = new Text(this._formatNumber(x), {
        fontSize: this.fontSize,
        color: this.color,
        point: [p[0], p[1] - this.tickSize - this.fontSize, 0],
      });
      this.numbers.add(label);
    }
    this.add(this.numbers);
  }

  _formatNumber(x: number): string {
    // Trim floating noise; drop trailing zeros.
    const r = Math.round(x * 1e6) / 1e6;
    return Number.isInteger(r) ? String(r) : String(parseFloat(r.toFixed(3)));
  }

  getTickRange(): number[] {
    return makeTickRange([this.xMin, this.xMax, this.xStep]);
  }

  // Data number -> world point on the line. Applies the scale base first,
  // then interpolates between the axis line's CURRENT endpoints (rather than
  // the frozen construction-time _leftX/unit scalars) so the result stays in
  // sync with any shift()/rotate()/scale() applied after construction, or to
  // a parent group this NumberLine has been nested in (issue #2).
  numberToPoint(x: number): Vec3 {
    const s = this.scaling.functionOf(x);
    const alpha = this._sMax === this._sMin ? 0 : (s - this._sMin) / (this._sMax - this._sMin);
    return V.lerp(this.axisLine.getStart(), this.axisLine.getEnd(), alpha);
  }
  n2p(x: number): Vec3 { return this.numberToPoint(x); }

  // World point -> data number. Projects p onto the axis line's CURRENT
  // direction vector (not just its x-coordinate), so this works whether the
  // line is horizontal, vertical (rotated), or has been shifted/scaled.
  pointToNumber(p: number[]): number {
    const start = this.axisLine.getStart();
    const end = this.axisLine.getEnd();
    const dir = V.sub(end, start);
    const denom = V.dot(dir, dir);
    const alpha = denom === 0 ? 0 : V.dot(V.sub(p, start), dir) / denom;
    const s = this._sMin + alpha * (this._sMax - this._sMin);
    return this.scaling.inverseFunctionOf(s);
  }
  p2n(p: number[]): number { return this.pointToNumber(p); }

  getUnitSize(): number { return this.unit; }
}

export class Axes extends VGroup {
  xRange: number[];
  yRange: number[];
  xLength: number;
  yLength: number;
  xAxis: NumberLine;
  yAxis: NumberLine;

  constructor(config: AxesConfig = {}) {
    super();
    this.xRange = config.xRange ?? [-5, 5, 1];
    this.yRange = config.yRange ?? [-5, 5, 1];
    this.xLength = config.xLength ?? (this.xRange[1] - this.xRange[0]);
    this.yLength = config.yLength ?? (this.yRange[1] - this.yRange[0]);
    this.color = (config.color ?? "#FFFFFF") as any;
    const axisConfig = config.axisConfig ?? {};

    this.xAxis = new NumberLine({
      xRange: this.xRange,
      length: this.xLength,
      color: this.color,
      includeTip: axisConfig.includeTip ?? false,
      ...axisConfig,
      ...(config.xAxisConfig ?? {}),
    });
    this.yAxis = new NumberLine({
      xRange: this.yRange,
      length: this.yLength,
      color: this.color,
      includeTip: axisConfig.includeTip ?? false,
      ...axisConfig,
      ...(config.yAxisConfig ?? {}),
    });
    // Rotate the y-axis to be vertical (about the origin, its own zero-crossing).
    this.yAxis.rotate(Math.PI / 2, { axis: V.OUT, aboutPoint: V.ORIGIN });

    // Shift each axis so its origin-reference sits at the world origin, making
    // the two axes cross there. For a log axis (where value 0 has no finite
    // position) the reference falls back to the axis minimum. numberToPoint
    // reads live axisLine geometry, so this correctly accounts for the
    // rotate() just applied to yAxis.
    this.xAxis.shift(V.neg(this.xAxis.numberToPoint(this._xRef())));
    this.yAxis.shift(V.neg(this.yAxis.numberToPoint(this._yRef())));

    this.add(this.xAxis, this.yAxis);
  }

  // Data value used as each axis's crossing reference: 0 when it's actually
  // within the axis's configured range, otherwise the axis minimum.
  //
  // Bug found while fixing issue #31 (ThreeDAxes' identical problem): this
  // used to check `Number.isFinite(this.xAxis.scaling.functionOf(0))`,
  // which only catches a TRUE log-scale axis (functionOf(0) = log(0) =
  // -Infinity) -- not the far more common case of a plain LINEAR range that
  // simply doesn't straddle 0 (e.g. xRange: [1.1, 3.4]), where
  // functionOf(0) is still a perfectly finite (if off-segment) number.
  // Confirmed via direct repro: `new Axes({ xRange: [1.1, 3.4, 0.5], ... })`
  // rendered its x-axis spanning world x∈[4.07, 12.57] -- nowhere near the
  // y-axis's crossing at world x=0 -- exactly the "disconnected axes" bug
  // issue #31 reports for ThreeDAxes, just not previously noticed here.
  _xRef(): number {
    return this.xAxis.xMin <= 0 && 0 <= this.xAxis.xMax ? 0 : this.xAxis.xMin;
  }
  _yRef(): number {
    return this.yAxis.xMin <= 0 && 0 <= this.yAxis.xMax ? 0 : this.yAxis.xMin;
  }

  // Data coords (x,y) -> world point. Mirrors upstream manim's
  // CoordinateSystem.coords_to_point: sum each axis's displacement from its
  // own reference point onto a shared origin. Since every piece is read from
  // the axes' CURRENT (possibly shifted/rotated/scaled/nested) geometry via
  // numberToPoint, this stays correct after any transform applied post
  // construction — see issue #2 — not just the constructor's own shift.
  coordsToPoint(x: number, y: number): Vec3 {
    const origin = this.xAxis.numberToPoint(this._xRef());
    const dx = V.sub(this.xAxis.numberToPoint(x), origin);
    const dy = V.sub(this.yAxis.numberToPoint(y), this.yAxis.numberToPoint(this._yRef()));
    return V.add(origin, V.add(dx, dy));
  }
  c2p(x: number, y: number): Vec3 { return this.coordsToPoint(x, y); }

  // Horizontal/vertical world coordinate for data value x/y, i.e. the point
  // on that axis's own current line (used by labels/grid, which anchor
  // directly on an axis rather than needing a full (x,y) pair).
  _xWorld(x: number): number { return this.xAxis.numberToPoint(x)[0]; }
  _yWorld(y: number): number { return this.yAxis.numberToPoint(y)[1]; }

  // World point -> data coords: project onto each axis independently.
  pointToCoords(p: number[]): number[] {
    return [this.xAxis.pointToNumber(p), this.yAxis.pointToNumber(p)];
  }
  p2c(p: number[]): number[] { return this.pointToCoords(p); }

  // Sample y=fn(x) across the x range and build a poly-line curve.
  plot(fn: (x: number) => number, config: PlotConfig = {}): VMobject {
    const range = config.xRange ?? this.xRange;
    const color = config.color ?? "#FFFF00";
    const start = range[0];
    const stop = range[1];
    const step = range[2] ?? (stop - start) / 200;
    const corners: number[][] = [];
    const domainSamples: Array<[number, number]> = [];
    const eps = 1e-6 * Math.abs(step || 1);
    for (let x = start; x <= stop + eps; x += step) {
      const y = fn(x);
      if (Number.isFinite(y)) {
        corners.push(this.coordsToPoint(x, y));
        domainSamples.push([x, y]);
      }
    }
    const graph = new VMobject({ strokeColor: color, color });
    graph.setPointsAsCorners(corners);
    graph.fillOpacity = 0;
    (graph as any).underlyingFunction = fn;
    // Hidden tag (mirrors the matchId/autoId convention elsewhere) recording
    // the domain-space samples that produced this curve, so
    // reprojectCurve(curve, targetSystem) can rebuild it against a different
    // coordinate system without the caller having to re-supply the samples.
    (graph as any)._domainSamples = domainSamples;
    return graph;
  }

  getGraph(fn: (x: number) => number, config: PlotConfig = {}): VMobject { return this.plot(fn, config); }

  // A straight line in data space between two coord pairs.
  plotLine([x1, y1]: number[], [x2, y2]: number[], config: PlotConfig = {}): Line {
    const color = config.color ?? this.color;
    return new Line(this.coordsToPoint(x1, y1), this.coordsToPoint(x2, y2), {
      color,
      strokeColor: color,
    });
  }

  // Vertical segment from the x-axis up to the graph at data-x.
  getVerticalLine(x: number, graphOrY: number | ((x: number) => number) | any, config: PlotConfig = {}): Line {
    const y = typeof graphOrY === "function"
      ? graphOrY(x)
      : (graphOrY?.underlyingFunction ? graphOrY.underlyingFunction(x) : graphOrY);
    const color = config.color ?? this.color;
    return new Line(this.coordsToPoint(x, 0), this.coordsToPoint(x, y), {
      color,
      strokeColor: color,
    });
  }

  // --- Axis accessors ------------------------------------------------------
  getAxes(): VGroup { const g = new VGroup(); g.add(this.xAxis, this.yAxis); return g; }
  getXAxis(): NumberLine { return this.xAxis; }
  getYAxis(): NumberLine { return this.yAxis; }
  getOrigin(): Vec3 { return this.coordsToPoint(0, 0); }
  getXUnitSize(): number { return this.xAxis.unit; }
  getYUnitSize(): number { return this.yAxis.unit; }

  // --- Polar / cartesian conversions ---------------------------------------
  polarToPoint(radius: number, azimuth: number): Vec3 {
    return this.coordsToPoint(radius * Math.cos(azimuth), radius * Math.sin(azimuth));
  }
  pr2pt(radius: number, azimuth: number): Vec3 { return this.polarToPoint(radius, azimuth); }

  pointToPolar(point: number[]): [number, number] {
    const [x, y] = this.pointToCoords(point);
    return [Math.hypot(x, y), Math.atan2(y, x)];
  }
  pt2pr(point: number[]): [number, number] { return this.pointToPolar(point); }

  // --- Graph sampling helpers ----------------------------------------------
  /** Resolve the underlying y=f(x) for a graph mobject (or a bare function). */
  _funcOf(graph: any): (x: number) => number {
    if (typeof graph === "function") return graph;
    if (graph && typeof graph.underlyingFunction === "function") return graph.underlyingFunction;
    throw new Error("graph has no underlyingFunction");
  }

  inputToGraphCoords(x: number, graph: any): [number, number] {
    return [x, this._funcOf(graph)(x)];
  }
  i2gc(x: number, graph: any): [number, number] { return this.inputToGraphCoords(x, graph); }

  inputToGraphPoint(x: number, graph: any): Vec3 {
    const [gx, gy] = this.inputToGraphCoords(x, graph);
    return this.coordsToPoint(gx, gy);
  }
  i2gp(x: number, graph: any): Vec3 { return this.inputToGraphPoint(x, graph); }

  slopeOfTangent(x: number, graph: any, dx = 1e-6): number {
    const f = this._funcOf(graph);
    return (f(x + dx) - f(x - dx)) / (2 * dx);
  }

  angleOfTangent(x: number, graph: any, dx = 1e-6): number {
    // Angle in *world* space, accounting for the axes' unit scaling.
    const f = this._funcOf(graph);
    const p0 = this.coordsToPoint(x, f(x));
    const p1 = this.coordsToPoint(x + dx, f(x + dx));
    return Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
  }

  // --- Labels --------------------------------------------------------------
  private _mkLabel(label: any, color?: ColorLike): VMobject {
    if (label instanceof VMobject) return label;
    if (typeof label === "string") {
      return new MathTex(label, { color: color ?? (this.color as any) }) as unknown as VMobject;
    }
    return new Text(String(label), { color: color ?? (this.color as any) }) as unknown as VMobject;
  }

  getGraphLabel(
    graph: any,
    label: any,
    opts: { x?: number; direction?: number[]; buff?: number; color?: ColorLike; dotColor?: ColorLike } = {}
  ): VMobject {
    const lbl = this._mkLabel(label, opts.color);
    const direction = opts.direction ?? V.RIGHT;
    const buff = opts.buff ?? 0.25;
    let x = opts.x;
    if (x == null) {
      // Default near the right end of the graph's x-range.
      x = this.xRange[1] - 0.1 * (this.xRange[1] - this.xRange[0]);
    }
    const anchor = this.inputToGraphPoint(x, graph);
    lbl.nextTo(anchor, direction, buff);
    return lbl;
  }

  getAxisLabels(xLabel: any = "x", yLabel: any = "y"): VGroup {
    const g = new VGroup();
    g.add(this.getXAxisLabel(xLabel), this.getYAxisLabel(yLabel));
    return g;
  }

  getXAxisLabel(label: any, opts: { direction?: number[]; buff?: number } = {}): VMobject {
    const lbl = this._mkLabel(label);
    const end: Vec3 = [this._xWorld(this.xRange[1]), 0, 0];
    lbl.nextTo(end, opts.direction ?? V.UR, opts.buff ?? 0.2);
    return lbl;
  }

  getYAxisLabel(label: any, opts: { direction?: number[]; buff?: number } = {}): VMobject {
    const lbl = this._mkLabel(label);
    const end = [0, this._yWorld(this.yRange[1]), 0];
    lbl.nextTo(end, opts.direction ?? V.UR, opts.buff ?? 0.2);
    return lbl;
  }

  /** Attach number labels to the axes (via each NumberLine's numbers). */
  addCoordinates(...args: any[]): this {
    this.xAxis.includeNumbers = true;
    if (!this.xAxis.numbers) this.xAxis._addNumbers();
    this.yAxis.includeNumbers = true;
    if (!this.yAxis.numbers) {
      // Build y numbers as free labels positioned by the axes mapping (the
      // y-axis was rotated, so its own _addNumbers would place them wrong).
      const numbers = new VGroup();
      for (const y of makeTickRange(this.yRange)) {
        if (Math.abs(y) < 1e-9) continue;
        const p = this.coordsToPoint(0, y);
        const t = new Text(this.xAxis._formatNumber(y), {
          fontSize: this.yAxis.fontSize,
          color: this.yAxis.color,
          point: [p[0] - 0.3, p[1], 0],
        });
        numbers.add(t);
      }
      this.yAxis.numbers = numbers;
      this.yAxis.add(numbers);
    }
    return this;
  }

  // --- Area under a graph --------------------------------------------------
  getArea(
    graph: any,
    opts: { xRange?: number[]; color?: ColorLike; opacity?: number; boundedGraph?: any } = {}
  ): Polygon {
    const f = this._funcOf(graph);
    const xr = opts.xRange ?? [this.xRange[0], this.xRange[1]];
    const x0 = xr[0], x1 = xr[1];
    const n = 60;
    const g = opts.boundedGraph ? this._funcOf(opts.boundedGraph) : null;
    const top: number[][] = [];
    const bottom: number[][] = [];
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * (i / n);
      top.push(this.coordsToPoint(x, f(x)));
      bottom.push(this.coordsToPoint(x, g ? g(x) : 0));
    }
    const verts = [...top, ...bottom.reverse()];
    const color = opts.color ?? "#58C4DD";
    const poly = new Polygon(verts, { color, fillColor: color, strokeWidth: 0 });
    poly.fillOpacity = opts.opacity ?? 0.75;
    return poly;
  }

  // --- Riemann rectangles --------------------------------------------------
  getRiemannRectangles(
    graph: any,
    opts: {
      xRange?: number[];
      dx?: number;
      inputSampleType?: "left" | "right" | "center";
      stroke?: number;
      strokeWidth?: number;
      fillOpacity?: number;
      color?: ColorLike | ColorLike[];
      showSignedArea?: boolean;
    } = {}
  ): VGroup {
    const f = this._funcOf(graph);
    const xr = opts.xRange ?? [this.xRange[0], this.xRange[1]];
    const dx = opts.dx ?? this.xRange[2] ?? 0.1;
    const sample = opts.inputSampleType ?? "left";
    const strokeWidth = opts.strokeWidth ?? opts.stroke ?? 1;
    const fillOpacity = opts.fillOpacity ?? 1;
    const colors: ColorLike[] = Array.isArray(opts.color)
      ? (opts.color as ColorLike[])
      : [(opts.color as ColorLike) ?? "#58C4DD"];
    const group = new VGroup();
    const eps = 1e-9;
    let i = 0;
    for (let x = xr[0]; x < xr[1] - eps; x += dx, i++) {
      const xr2 = Math.min(x + dx, xr[1]);
      const sx = sample === "left" ? x : sample === "right" ? xr2 : (x + xr2) / 2;
      const y = f(sx);
      const p0 = this.coordsToPoint(x, 0);
      const p1 = this.coordsToPoint(xr2, y);
      const w = Math.abs(p1[0] - p0[0]);
      const h = Math.abs(p1[1] - p0[1]);
      if (w === 0 || h === 0) continue;
      const color = colors[i % colors.length];
      const rect = new Rectangle({ width: w, height: h, color, fillColor: color, strokeWidth });
      rect.fillOpacity = fillOpacity;
      rect.moveTo([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, 0]);
      group.add(rect);
    }
    return group;
  }

  // --- Secant slope group --------------------------------------------------
  getSecantSlopeGroup(
    x: number,
    graph: any,
    opts: {
      dx?: number;
      secantLineLength?: number;
      secantLineColor?: ColorLike;
      dxLineColor?: ColorLike;
      dfLineColor?: ColorLike;
      dxLabel?: any;
      dfLabel?: any;
    } = {}
  ): VGroup {
    const f = this._funcOf(graph);
    const dx = opts.dx ?? 0.1;
    const secantColor = opts.secantLineColor ?? "#83C167";
    const p1 = this.coordsToPoint(x, f(x));
    const p2 = this.coordsToPoint(x + dx, f(x + dx));
    const group = new VGroup();

    // dx segment (horizontal) and df segment (vertical) forming the triangle.
    const corner = [p2[0], p1[1], 0];
    const dxLine = new Line(p1, corner, { color: opts.dxLineColor ?? "#8888ff" });
    const dfLine = new Line(corner, p2, { color: opts.dfLineColor ?? "#8888ff" });
    group.add(dxLine, dfLine);

    // Extend the secant to the requested length.
    const len = opts.secantLineLength ?? 3;
    const dir = V.normalize(V.sub(p2, p1));
    const mid = V.midpoint(p1, p2);
    const a = V.sub(mid, V.scale(dir, len / 2));
    const b = V.add(mid, V.scale(dir, len / 2));
    const secant = new Line(a, b, { color: secantColor });
    group.add(secant);

    if (opts.dxLabel != null) {
      const lbl = this._mkLabel(opts.dxLabel);
      lbl.nextTo(dxLine, V.DOWN, 0.1);
      group.add(lbl);
    }
    if (opts.dfLabel != null) {
      const lbl = this._mkLabel(opts.dfLabel);
      lbl.nextTo(dfLine, V.RIGHT, 0.1);
      group.add(lbl);
    }
    return group;
  }

  // --- Assorted line helpers -----------------------------------------------
  getVerticalLinesToGraph(
    graph: any,
    opts: { xRange?: number[]; numLines?: number; color?: ColorLike } = {}
  ): VGroup {
    const xr = opts.xRange ?? [this.xRange[0], this.xRange[1]];
    const n = opts.numLines ?? 20;
    const group = new VGroup();
    for (let i = 0; i < n; i++) {
      const x = xr[0] + (xr[1] - xr[0]) * (i / Math.max(1, n - 1));
      group.add(this.getVerticalLine(x, graph, { color: opts.color }));
    }
    return group;
  }

  getHorizontalLine(point: number[], opts: { color?: ColorLike } = {}): Line {
    const [, y] = this.pointToCoords(point);
    const start = this.coordsToPoint(0, y);
    const color = opts.color ?? this.color;
    return new Line(start, [point[0], start[1], 0], { color, strokeColor: color });
  }

  getVerticalLineToPoint(point: number[], opts: { color?: ColorLike } = {}): Line {
    const [x] = this.pointToCoords(point);
    const start = this.coordsToPoint(x, 0);
    const color = opts.color ?? this.color;
    return new Line(start, [start[0], point[1], 0], { color, strokeColor: color });
  }

  getLinesToPoint(point: number[], opts: { color?: ColorLike } = {}): VGroup {
    const g = new VGroup();
    g.add(this.getHorizontalLine(point, opts), this.getVerticalLineToPoint(point, opts));
    return g;
  }

  getTLabel(x: number, graph: any, label: any): VMobject {
    const lbl = this._mkLabel(label);
    lbl.nextTo(this.inputToGraphPoint(x, graph), V.UR, 0.2);
    return lbl;
  }

  // --- Extra plotting variants ---------------------------------------------
  plotParametricCurve(
    fn: (t: number) => number[],
    opts: { tRange?: number[]; color?: ColorLike } = {}
  ): VMobject {
    const tr = opts.tRange ?? [0, 2 * Math.PI, 0.02];
    const step = tr[2] ?? (tr[1] - tr[0]) / 200;
    const corners: number[][] = [];
    const eps = 1e-6 * Math.abs(step || 1);
    for (let t = tr[0]; t <= tr[1] + eps; t += step) {
      const [x, y] = fn(t);
      if (Number.isFinite(x) && Number.isFinite(y)) corners.push(this.coordsToPoint(x, y));
    }
    const color = opts.color ?? "#FFFF00";
    const graph = new VMobject({ strokeColor: color, color });
    graph.setPointsAsCorners(corners);
    graph.fillOpacity = 0;
    (graph as any).underlyingParametric = fn;
    return graph;
  }

  plotPolarGraph(
    rFn: (theta: number) => number,
    opts: { thetaRange?: number[]; color?: ColorLike } = {}
  ): VMobject {
    const tr = opts.thetaRange ?? [0, 2 * Math.PI, 0.02];
    return this.plotParametricCurve(
      (theta) => {
        const r = rFn(theta);
        return [r * Math.cos(theta), r * Math.sin(theta)];
      },
      { tRange: tr, color: opts.color }
    );
  }

  plotImplicitCurve(
    fn: (x: number, y: number) => number,
    opts: { color?: ColorLike; n?: number } = {}
  ): VGroup {
    // Marching squares over the plane: emit a short segment in every grid cell
    // that the zero contour of fn crosses.
    const n = opts.n ?? 60;
    const [xa, xb] = [this.xRange[0], this.xRange[1]];
    const [ya, yb] = [this.yRange[0], this.yRange[1]];
    const dx = (xb - xa) / n;
    const dy = (yb - ya) / n;
    const color = opts.color ?? "#FFFF00";
    const group = new VGroup();
    const interp = (xA: number, yA: number, vA: number, xB: number, yB: number, vB: number): number[] => {
      const t = vA === vB ? 0.5 : vA / (vA - vB);
      return this.coordsToPoint(xA + (xB - xA) * t, yA + (yB - yA) * t);
    };
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x0 = xa + i * dx, x1 = x0 + dx;
        const y0 = ya + j * dy, y1 = y0 + dy;
        const v00 = fn(x0, y0), v10 = fn(x1, y0), v11 = fn(x1, y1), v01 = fn(x0, y1);
        const edges: number[][] = [];
        if ((v00 > 0) !== (v10 > 0)) edges.push(interp(x0, y0, v00, x1, y0, v10));
        if ((v10 > 0) !== (v11 > 0)) edges.push(interp(x1, y0, v10, x1, y1, v11));
        if ((v11 > 0) !== (v01 > 0)) edges.push(interp(x1, y1, v11, x0, y1, v01));
        if ((v01 > 0) !== (v00 > 0)) edges.push(interp(x0, y1, v01, x0, y0, v00));
        if (edges.length >= 2) {
          const seg = new Line(edges[0], edges[1], { color, strokeColor: color });
          group.add(seg);
        }
      }
    }
    return group;
  }

  plotLineGraph(
    xValues: number[],
    yValues: number[],
    opts: {
      addVertexDots?: boolean;
      vertexDotStyle?: { color?: ColorLike; radius?: number };
      lineColor?: ColorLike;
    } = {}
  ): VGroup {
    const color = opts.lineColor ?? "#FFFF00";
    const points = xValues.map((x, i) => this.coordsToPoint(x, yValues[i]));
    const line = new VMobject({ strokeColor: color, color });
    line.setPointsAsCorners(points);
    line.fillOpacity = 0;
    const group = new VGroup();
    group.add(line);
    if (opts.addVertexDots ?? true) {
      const dots = new VGroup();
      const style = opts.vertexDotStyle ?? {};
      for (const p of points) {
        dots.add(new Dot({ point: p, color: style.color ?? color, radius: style.radius ?? 0.06 }));
      }
      group.add(dots);
    }
    (group as any).lineGraphPoints = points;
    return group;
  }
}

export class NumberPlane extends Axes {
  bgColor: ColorLike;
  bgStrokeWidth: number;
  bgStrokeOpacity: number;
  backgroundLines!: VGroup;

  constructor(config: NumberPlaneConfig = {}) {
    super(config);
    const bg = config.backgroundLineStyle ?? {};
    this.bgColor = bg.color ?? "#29ABCA";
    this.bgStrokeWidth = bg.strokeWidth ?? 1;
    this.bgStrokeOpacity = bg.strokeOpacity ?? 0.3;

    this._buildGrid();
  }

  _buildGrid(): void {
    const grid = new VGroup();
    const yTop = this._yWorld(this.yRange[1]);
    const yBot = this._yWorld(this.yRange[0]);
    const xLeft = this.coordsToPoint(this.xRange[0], 0)[0];
    const xRight = this.coordsToPoint(this.xRange[1], 0)[0];

    // Vertical grid lines at each x step.
    for (const x of makeTickRange(this.xRange)) {
      const px = this.coordsToPoint(x, 0)[0];
      grid.add(this._faintLine([px, yBot, 0], [px, yTop, 0]));
    }
    // Horizontal grid lines at each y step.
    for (const y of makeTickRange(this.yRange)) {
      const py = this._yWorld(y);
      grid.add(this._faintLine([xLeft, py, 0], [xRight, py, 0]));
    }

    this.backgroundLines = grid;
    // Insert grid behind the axes.
    this.submobjects = [grid, ...this.submobjects];
  }

  _faintLine(start: number[], end: number[]): Line {
    const line = new Line(start, end, {
      strokeColor: this.bgColor,
      color: this.bgColor,
      strokeWidth: this.bgStrokeWidth,
    });
    line.strokeOpacity = this.bgStrokeOpacity;
    return line;
  }
}

/** Config for PolarPlane. */
export interface PolarPlaneConfig {
  size?: number;
  radiusMax?: number;
  radius_max?: number;
  radiusStep?: number;
  azimuthUnits?: "PI radians" | "TAU radians" | "degrees" | "gradians" | null;
  azimuth_units?: "PI radians" | "TAU radians" | "degrees" | "gradians" | null;
  azimuthStep?: number;
  azimuth_step?: number;
  color?: ColorLike;
  faintColor?: ColorLike;
  includeAzimuthLabels?: boolean;
  fontSize?: number;
  [key: string]: any;
}

/**
 * A polar coordinate grid: concentric circles at each radius step and radial
 * spokes at each azimuth step, plus optional azimuth labels. `c2p` interprets
 * (radius, azimuth) pairs.
 */
export class PolarPlane extends VGroup {
  size: number;
  radiusMax: number;
  radiusStep: number;
  azimuthUnits: string | null;
  azimuthStep: number;
  lineColor: ColorLike;
  faintColor: ColorLike;
  fontSize: number;
  circles!: VGroup;
  radialLines!: VGroup;
  azimuthLabels!: VGroup;

  constructor(config: PolarPlaneConfig = {}) {
    super();
    this.size = config.size ?? 6;
    this.radiusMax = config.radiusMax ?? config.radius_max ?? this.size / 2;
    this.radiusStep = config.radiusStep ?? 1;
    this.azimuthUnits = config.azimuthUnits ?? config.azimuth_units ?? "PI radians";
    this.azimuthStep =
      config.azimuthStep ?? config.azimuth_step ?? (this.azimuthUnits === "degrees" ? 12 : 20);
    this.lineColor = (config.color ?? "#FFFFFF") as any;
    this.faintColor = (config.faintColor ?? "#888888") as any;
    this.fontSize = config.fontSize ?? 0.3;

    // World units per radius unit.
    this._unit = this.radiusMax === 0 ? 1 : this.size / 2 / this.radiusMax;

    this._build(config.includeAzimuthLabels ?? true);
  }

  _unit: number;

  /** (radius, azimuth) -> world point. */
  polarToPoint(radius: number, azimuth: number): Vec3 {
    const r = radius * this._unit;
    return [r * Math.cos(azimuth), r * Math.sin(azimuth), 0];
  }
  pr2pt(radius: number, azimuth: number): Vec3 { return this.polarToPoint(radius, azimuth); }
  coordsToPoint(radius: number, azimuth: number): Vec3 { return this.polarToPoint(radius, azimuth); }
  c2p(radius: number, azimuth: number): Vec3 { return this.polarToPoint(radius, azimuth); }

  pointToPolar(point: number[]): [number, number] {
    const r = Math.hypot(point[0], point[1]) / this._unit;
    return [r, Math.atan2(point[1], point[0])];
  }
  pt2pr(point: number[]): [number, number] { return this.pointToPolar(point); }

  _build(includeLabels: boolean): void {
    // Concentric circles.
    this.circles = new VGroup();
    for (let r = this.radiusStep; r <= this.radiusMax + 1e-9; r += this.radiusStep) {
      this.circles.add(
        new Circle({ radius: r * this._unit, color: this.faintColor, strokeColor: this.faintColor })
      );
    }
    this.add(this.circles);

    // Radial spokes.
    this.radialLines = new VGroup();
    const n = Math.max(1, Math.round(this.azimuthStep));
    for (let i = 0; i < n; i++) {
      const theta = (2 * Math.PI * i) / n;
      this.radialLines.add(
        new Line(V.ORIGIN, this.polarToPoint(this.radiusMax, theta), {
          color: this.faintColor,
          strokeColor: this.faintColor,
        })
      );
    }
    this.add(this.radialLines);

    // Azimuth labels.
    this.azimuthLabels = new VGroup();
    if (includeLabels) {
      for (let i = 0; i < n; i++) {
        const theta = (2 * Math.PI * i) / n;
        const p = this.polarToPoint(this.radiusMax + 0.5, theta);
        this.azimuthLabels.add(
          new Text(this._azimuthLabel(theta, n, i), {
            fontSize: this.fontSize,
            color: this.lineColor,
            point: p,
          })
        );
      }
      this.add(this.azimuthLabels);
    }
  }

  _azimuthLabel(theta: number, n: number, i: number): string {
    if (this.azimuthUnits === "degrees") return `${Math.round((theta * 180) / Math.PI)}`;
    if (this.azimuthUnits === "gradians") return `${Math.round((theta * 200) / Math.PI)}`;
    if (this.azimuthUnits === "TAU radians") return `${(i / n).toFixed(2)}`;
    // PI radians (default).
    return `${(theta / Math.PI).toFixed(2)}π`;
  }
}

/** Config for ComplexPlane (same shape as NumberPlane). */
export type ComplexNumber = { re: number; im: number } | [number, number];

/**
 * A NumberPlane whose points are complex numbers. `numberToPoint` maps a
 * complex value to a world point; `pointToNumber` recovers it.
 */
export class ComplexPlane extends NumberPlane {
  constructor(config: NumberPlaneConfig = {}) {
    super(config);
  }

  private _reIm(z: ComplexNumber): [number, number] {
    if (Array.isArray(z)) return [z[0], z[1]];
    return [z.re, z.im];
  }

  numberToPoint(z: ComplexNumber): Vec3 {
    const [re, im] = this._reIm(z);
    return this.coordsToPoint(re, im);
  }
  n2p(z: ComplexNumber): Vec3 { return this.numberToPoint(z); }

  pointToNumber(point: number[]): { re: number; im: number } {
    const [re, im] = this.pointToCoords(point);
    return { re, im };
  }
  p2n(point: number[]): { re: number; im: number } { return this.pointToNumber(point); }

  /** Add real-axis numbers and imaginary-axis (i-suffixed) labels. */
  addCoordinates(): this {
    // Real axis: reuse NumberLine numbers.
    this.xAxis.includeNumbers = true;
    if (!this.xAxis.numbers) this.xAxis._addNumbers();

    // Imaginary axis: `k i` labels placed along the (rotated) y-axis.
    const numbers = new VGroup();
    for (const y of makeTickRange(this.yRange)) {
      if (Math.abs(y) < 1e-9) continue;
      const p = this.coordsToPoint(0, y);
      const txt = `${this.xAxis._formatNumber(y)}i`;
      numbers.add(
        new Text(txt, { fontSize: this.yAxis.fontSize, color: this.yAxis.color, point: [p[0] - 0.3, p[1], 0] })
      );
    }
    this.yAxis.numbers = numbers;
    this.yAxis.add(numbers);
    return this;
  }
}

/** A NumberLine over [0, 1] with 0.1 ticks — manim's UnitInterval preset. */
export class UnitInterval extends NumberLine {
  constructor(config: NumberLineConfig = {}) {
    super({ xRange: [0, 1, 0.1], length: 6, includeNumbers: true, ...config });
  }
}
