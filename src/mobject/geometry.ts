// Geometric VMobjects: Arc, Circle, Dot, Ellipse, Annulus, Line, Arrow,
// Polygon, Rectangle, Square, RegularPolygon, Triangle.

import { VMobject } from "./VMobject.ts";
import * as V from "../core/math/vector.ts";
import { arcBezierPoints } from "../core/math/bezier.ts";
import { RED, WHITE } from "../core/color.ts";

export class Arc extends VMobject {
  constructor(config = {}) {
    super(config);
    this.radius = config.radius ?? 1;
    this.startAngle = config.startAngle ?? 0;
    this.angle = config.angle ?? Math.PI / 2;
    this.arcCenter = config.arcCenter ?? V.ORIGIN;
    const pts = arcBezierPoints(this.radius, this.startAngle, this.angle, this.arcCenter);
    this.appendBezierPoints(pts);
  }
}

export class Circle extends Arc {
  constructor(config = {}) {
    // manim's Circle defaults to a RED stroke with no fill.
    super({ angle: 2 * Math.PI, fillOpacity: 0, ...config, color: config.color ?? RED });
    if (config.fillColor != null && config.fillOpacity == null) this.fillOpacity = 1;
  }
}

export class Dot extends Circle {
  constructor(config = {}) {
    const point = config.point ?? V.ORIGIN;
    // manim's Dot defaults to a filled WHITE dot (radius 0.08, no stroke).
    super({ radius: config.radius ?? 0.08, fillOpacity: 1, strokeWidth: 0, ...config, color: config.color ?? WHITE });
    this.moveTo(point);
  }
}

export class Ellipse extends VMobject {
  constructor(config = {}) {
    super({ ...config, color: config.color ?? RED }); // manim: Ellipse(Circle) -> RED
    const w = config.width ?? 2;
    const h = config.height ?? 1;
    const pts = arcBezierPoints(1, 0, 2 * Math.PI);
    this.appendBezierPoints(pts);
    this.stretch(w / 2, 0);
    this.stretch(h / 2, 1);
    this.fillOpacity = config.fillOpacity ?? 0;
  }
}

export class Annulus extends VMobject {
  constructor(config = {}) {
    super({ fillOpacity: 1, strokeWidth: 0, ...config });
    // manim defaults: inner_radius=1, outer_radius=2.
    const outer = config.outerRadius ?? 2;
    const inner = config.innerRadius ?? 1;
    const center = config.arcCenter ?? V.ORIGIN;
    // Outer ring CCW, inner ring CW — even-odd fill leaves the hole.
    this.appendBezierPoints(arcBezierPoints(outer, 0, 2 * Math.PI, center), true);
    this.appendBezierPoints(arcBezierPoints(inner, 0, -2 * Math.PI, center), true);
  }
}

export class Line extends VMobject {
  constructor(start = V.LEFT, end = V.RIGHT, config = {}) {
    // Allow Line({start, end, ...}) style too.
    if (start && typeof start === "object" && !Array.isArray(start) && start.start) {
      config = start;
      start = config.start;
      end = config.end;
    }
    super(config);
    this.start = start ?? V.LEFT;
    this.end = end ?? V.RIGHT;
    this.fillOpacity = 0;
    this.setPointsAsCorners([this.start, this.end]);
  }

  getStart() { return this.points[0]; }
  getEnd() { return this.points[this.points.length - 1]; }
  getLength() { return V.distance(this.getStart(), this.getEnd()); }
  getAngle() { return V.angleOf(V.sub(this.getEnd(), this.getStart())); }

  putStartAndEndOn(start, end) {
    this.setPointsAsCorners([start, end]);
    return this;
  }
}

export class DashedLine extends Line {
  constructor(start, end, config = {}) {
    super(start, end, config);
    this.numDashes = config.numDashes ?? 15;
    this.dashedRatio = config.dashedRatio ?? config.dashRatio ?? 0.5;
    this._dashed = true;
    this._dashify(this.numDashes, this.dashedRatio);
  }

  // Rebuild the path as `n` short straight dash subpaths so it actually renders
  // dashed. Each dash covers `ratio/n` of the line; the gaps make up the rest.
  _dashify(n, ratio) {
    const start = this.start, end = this.end;
    this.points = [];
    this.subpathStarts = [];
    if (n <= 0) return this.setPointsAsCorners([start, end]);
    const period = 1 / n;
    const dash = ratio * period;
    for (let i = 0; i < n; i++) {
      const a0 = i * period;
      const a1 = Math.min(1, a0 + dash);
      const p0 = V.lerp(start, end, a0);
      const p1 = V.lerp(start, end, a1);
      this.subpathStarts.push(this.points.length);
      this.points.push([...p0], V.lerp(p0, p1, 1 / 3), V.lerp(p0, p1, 2 / 3), [...p1]);
    }
    return this;
  }

  getStart() { return this.start; }
  getEnd() { return this.end; }
}

export class Arrow extends Line {
  constructor(start = V.LEFT, end = V.RIGHT, config = {}) {
    super(start, end, config);
    this.tipLength = config.tipLength ?? 0.25;
    this._hasTip = true;
    this.buildTip();
  }

  buildTip() {
    const s = this.getStart();
    const e = this.getEnd();
    const dir = V.normalize(V.sub(e, s));
    const back = V.scale(dir, -this.tipLength);
    const perp = [-dir[1], dir[0], 0];
    const base = V.add(e, back);
    const p1 = V.add(base, V.scale(perp, this.tipLength * 0.5));
    const p2 = V.sub(base, V.scale(perp, this.tipLength * 0.5));
    const tip = new VMobject({ fillOpacity: 1 });
    tip.setColor(this.strokeColor);
    tip.setPointsAsCorners([e, p1, p2, e]);
    tip.fillOpacity = 1;
    this.tip = tip;
    this.add(tip);
    return this;
  }
}

export class Polygon extends VMobject {
  constructor(vertices = [], config = {}) {
    super(config);
    this.vertices = vertices;
    this.fillOpacity = config.fillOpacity ?? 0;
    const closed = [...vertices, vertices[0]];
    this.setPointsAsCorners(closed);
  }

  getVertices() { return this.vertices; }
}

export class RegularPolygon extends Polygon {
  constructor(n = 6, config = {}) {
    const radius = config.radius ?? 1;
    const start = config.startAngle ?? (n % 2 === 0 ? Math.PI / n : Math.PI / 2);
    const verts = [];
    for (let i = 0; i < n; i++) {
      const a = start + (2 * Math.PI * i) / n;
      verts.push([radius * Math.cos(a), radius * Math.sin(a), 0]);
    }
    super(verts, config);
  }
}

export class Triangle extends RegularPolygon {
  constructor(config = {}) {
    super(3, config);
  }
}

export class Rectangle extends Polygon {
  constructor(config = {}) {
    const w = config.width ?? 4;
    const h = config.height ?? 2;
    const verts = [
      [w / 2, h / 2, 0],
      [-w / 2, h / 2, 0],
      [-w / 2, -h / 2, 0],
      [w / 2, -h / 2, 0],
    ];
    super(verts, config);
    this.width = w;
    this.height = h;
  }
}

export class Square extends Rectangle {
  constructor(config = {}) {
    const side = config.sideLength ?? config.side ?? 2;
    super({ ...config, width: side, height: side });
    this.sideLength = side;
  }
}
