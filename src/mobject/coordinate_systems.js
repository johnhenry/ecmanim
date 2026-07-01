// Coordinate systems: NumberLine, Axes, NumberPlane. These map "data" numbers
// onto world-space points via a simple affine mapping, and build the visible
// mobjects (axis lines, ticks, grid, labels) as submobjects of a VGroup.

import { VMobject, VGroup } from "./VMobject.js";
import * as V from "../core/math/vector.js";
import { Line, Arrow } from "./geometry.js";
import { Text } from "./text/Text.js";

// Inclusive-ish range: values from start up to (and including, within eps) stop.
function makeTickRange([start, stop, step]) {
  const out = [];
  if (step === 0) return out;
  const eps = 1e-6 * Math.abs(step);
  if (step > 0) for (let x = start; x <= stop + eps; x += step) out.push(x);
  else for (let x = start; x >= stop - eps; x += step) out.push(x);
  return out;
}

export class NumberLine extends VGroup {
  constructor(config = {}) {
    super();
    const range = config.xRange ?? config.range ?? [-5, 5, 1];
    this.xMin = range[0];
    this.xMax = range[1];
    this.xStep = range[2] ?? 1;
    // Default: 1 world unit per data unit.
    this.length = config.length ?? (this.xMax - this.xMin);
    this.color = config.color ?? "#FFFFFF";
    this.tickSize = config.tickSize ?? 0.1;
    this.includeNumbers = config.includeNumbers ?? false;
    this.includeTip = config.includeTip ?? false;
    this.fontSize = config.fontSize ?? 0.35;

    // Unit scale: world units per data unit along this line.
    this.unit = this.xMax === this.xMin ? 1 : this.length / (this.xMax - this.xMin);
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

  _formatNumber(x) {
    // Trim floating noise; drop trailing zeros.
    const r = Math.round(x * 1e6) / 1e6;
    return Number.isInteger(r) ? String(r) : String(parseFloat(r.toFixed(3)));
  }

  getTickRange() {
    return makeTickRange([this.xMin, this.xMax, this.xStep]);
  }

  // Data number -> world point on the line.
  numberToPoint(x) {
    return [this._leftX + (x - this.xMin) * this.unit, 0, 0];
  }
  n2p(x) { return this.numberToPoint(x); }

  // World point -> data number (projected onto the line's x-axis).
  pointToNumber(p) {
    return this.xMin + (p[0] - this._leftX) / this.unit;
  }
  p2n(p) { return this.pointToNumber(p); }
}

export class Axes extends VGroup {
  constructor(config = {}) {
    super();
    this.xRange = config.xRange ?? [-5, 5, 1];
    this.yRange = config.yRange ?? [-5, 5, 1];
    this.xLength = config.xLength ?? (this.xRange[1] - this.xRange[0]);
    this.yLength = config.yLength ?? (this.yRange[1] - this.yRange[0]);
    this.color = config.color ?? "#FFFFFF";
    const axisConfig = config.axisConfig ?? {};

    this.xAxis = new NumberLine({
      xRange: this.xRange,
      length: this.xLength,
      color: this.color,
      includeTip: axisConfig.includeTip ?? false,
      ...axisConfig,
    });
    this.yAxis = new NumberLine({
      xRange: this.yRange,
      length: this.yLength,
      color: this.color,
      includeTip: axisConfig.includeTip ?? false,
      ...axisConfig,
    });
    // Rotate the y-axis to be vertical (about the origin, its own zero-crossing).
    this.yAxis.rotate(Math.PI / 2, { axis: V.OUT, aboutPoint: V.ORIGIN });

    // Shift each axis so its zero-point sits at the origin, making the two axes
    // cross where (0,0) is.
    this.xAxis.shift(V.neg(this.xAxis.numberToPoint(0)));
    // yAxis.numberToPoint(0) is still expressed in the line's local (pre-rotate)
    // frame conceptually, but after rotation the world point of data 0 is what
    // we must cancel — recompute it via the rotated mapping.
    this.yAxis.shift(V.neg(this._rawYPoint(0)));

    this.add(this.xAxis, this.yAxis);
  }

  // World point of data value y on the (rotated) y-axis, before origin shift.
  _rawYPoint(y) {
    // The unrotated point is [leftX + (y-min)*unit, 0, 0]; a +90deg rotation
    // about origin maps [a,0,0] -> [0,a,0].
    const a = this.yAxis._leftX + (y - this.yAxis.xMin) * this.yAxis.unit;
    return [0, a, 0];
  }

  // Data coords (x,y) -> world point. Composes the two axis mappings.
  coordsToPoint(x, y) {
    const px = this.xAxis.numberToPoint(x);
    const py = this.yAxis.numberToPoint(0); // reference (origin) on y-axis
    // xAxis contributes horizontal offset, yAxis contributes vertical offset.
    const xWorld = px[0];
    const yWorld = this._yWorld(y);
    return [xWorld, yWorld, 0];
  }
  c2p(x, y) { return this.coordsToPoint(x, y); }

  // Vertical world coordinate for data value y (after the y-axis was rotated
  // and shifted so its zero sits at the origin).
  _yWorld(y) {
    return (y - this.yAxis.xMin) * this.yAxis.unit - (0 - this.yAxis.xMin) * this.yAxis.unit;
  }

  // World point -> data coords (inverts coordsToPoint).
  pointToCoords(p) {
    const x = this.xAxis.xMin + (p[0] - this.xAxis.numberToPoint(this.xAxis.xMin)[0]) / this.xAxis.unit;
    const y = p[1] / this.yAxis.unit; // _yWorld(y) == y * unit
    return [x, y];
  }
  p2c(p) { return this.pointToCoords(p); }

  // Sample y=fn(x) across the x range and build a poly-line curve.
  plot(fn, config = {}) {
    const range = config.xRange ?? this.xRange;
    const color = config.color ?? "#FFFF00";
    const start = range[0];
    const stop = range[1];
    const step = range[2] ?? (stop - start) / 200;
    const corners = [];
    const eps = 1e-6 * Math.abs(step || 1);
    for (let x = start; x <= stop + eps; x += step) {
      const y = fn(x);
      if (Number.isFinite(y)) corners.push(this.coordsToPoint(x, y));
    }
    const graph = new VMobject({ strokeColor: color, color });
    graph.setPointsAsCorners(corners);
    graph.fillOpacity = 0;
    graph.underlyingFunction = fn;
    return graph;
  }

  getGraph(fn, config = {}) { return this.plot(fn, config); }

  // A straight line in data space between two coord pairs.
  plotLine([x1, y1], [x2, y2], config = {}) {
    const color = config.color ?? this.color;
    return new Line(this.coordsToPoint(x1, y1), this.coordsToPoint(x2, y2), {
      color,
      strokeColor: color,
    });
  }

  // Vertical segment from the x-axis up to the graph at data-x.
  getVerticalLine(x, graphOrY, config = {}) {
    const y = typeof graphOrY === "function"
      ? graphOrY(x)
      : (graphOrY?.underlyingFunction ? graphOrY.underlyingFunction(x) : graphOrY);
    const color = config.color ?? this.color;
    return new Line(this.coordsToPoint(x, 0), this.coordsToPoint(x, y), {
      color,
      strokeColor: color,
    });
  }
}

export class NumberPlane extends Axes {
  constructor(config = {}) {
    super(config);
    const bg = config.backgroundLineStyle ?? {};
    this.bgColor = bg.color ?? "#29ABCA";
    this.bgStrokeWidth = bg.strokeWidth ?? 1;
    this.bgStrokeOpacity = bg.strokeOpacity ?? 0.3;

    this._buildGrid();
  }

  _buildGrid() {
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

  _faintLine(start, end) {
    const line = new Line(start, end, {
      strokeColor: this.bgColor,
      color: this.bgColor,
      strokeWidth: this.bgStrokeWidth,
    });
    line.strokeOpacity = this.bgStrokeOpacity;
    return line;
  }
}
