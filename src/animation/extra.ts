// Extra animations: growing, spinning, indication, and movement helpers.
// Each subclasses Animation and mutates its target mobject per frame. Patterns
// mirror the core animations in Animation.js — record initial/final state in
// setup() (which runs after begin() captures this.startState), then rebuild the
// mobject's points from that recorded state in interpolateMobject(alpha).

import { Animation } from "./Animation.ts";
import * as V from "../core/math/vector.ts";
import * as rf from "./rate_functions.ts";
import { Line, Rectangle } from "../mobject/geometry.ts";
import { VGroup } from "../mobject/VMobject.ts";

// Snapshot every family member's points (deep copy) for later reconstruction.
function familyPoints(mobject) {
  return mobject.getFamily().map((m) => m.points.map((p) => [...p]));
}

// Snapshot fill/stroke opacity for each family member.
function familyOpacities(mobject) {
  return mobject.getFamily().map((m) => ({
    fill: m.fillOpacity ?? m.opacity ?? 1,
    stroke: m.strokeOpacity ?? m.opacity ?? 1,
    op: m.opacity ?? 1,
  }));
}

// --- growing ---------------------------------------------------------------

// Grow the mobject out of a single fixed point (scale 0 -> 1) while fading in.
export class GrowFromPoint extends Animation {
  constructor(mobject, point, config = {}) {
    super(mobject, { ...config, introducer: true });
    this.point = point ?? V.ORIGIN;
    this.pointColor = config.pointColor ?? null;
  }

  setup() {
    // Final geometry & opacity, captured before any interpolation runs.
    this.finalPoints = familyPoints(this.mobject);
    this.targetOpacities = familyOpacities(this.mobject);
  }

  interpolateMobject(alpha) {
    const fam = this.mobject.getFamily();
    fam.forEach((m, i) => {
      const final = this.finalPoints[i];
      // p = point + (final - point) * alpha  (scale about the grow point).
      for (let j = 0; j < m.points.length; j++) {
        m.points[j] = V.add(this.point, V.scale(V.sub(final[j], this.point), alpha));
      }
      const t = this.targetOpacities[i];
      m.fillOpacity = t.fill * alpha;
      m.strokeOpacity = t.stroke * alpha;
      m.opacity = t.op;
    });
  }

  finish() {
    this.interpolateMobject(1);
    this.finished = true;
    return this;
  }
}

// GrowFromPoint from the mobject's own center.
export class GrowFromCenter extends GrowFromPoint {
  constructor(mobject, config = {}) {
    super(mobject, mobject.getCenter(), config);
  }
}

// GrowFromPoint from a bounding-box edge point (e.g. V.UP, V.LEFT).
export class GrowFromEdge extends GrowFromPoint {
  constructor(mobject, edge, config = {}) {
    super(mobject, mobject.getBoundaryPoint(edge), config);
  }
}

// Grow from center while rotating in from `angle` (default PI/2).
export class SpinInFromNothing extends GrowFromCenter {
  constructor(mobject, config = {}) {
    super(mobject, { rateFunc: config.rateFunc ?? rf.smooth, ...config });
    this.spinAngle = config.angle ?? Math.PI / 2;
    this.spinAxis = config.axis ?? V.OUT;
  }

  interpolateMobject(alpha) {
    super.interpolateMobject(alpha);
    // Rotate from -angle*(1-alpha)... i.e. start rotated by spinAngle, unwind.
    const angle = this.spinAngle * (alpha - 1);
    this.mobject.rotate(angle, { axis: this.spinAxis, aboutPoint: this.point });
  }
}

// Reverse of GrowFromCenter: shrink into the center and remove.
export class ShrinkToCenter extends Animation {
  constructor(mobject, config = {}) {
    super(mobject, { ...config, remover: true });
    this.point = mobject.getCenter();
  }

  setup() {
    this.startPoints = familyPoints(this.mobject);
    this.startOpacities = familyOpacities(this.mobject);
  }

  interpolateMobject(alpha) {
    const s = 1 - alpha; // scale 1 -> 0
    const fam = this.mobject.getFamily();
    fam.forEach((m, i) => {
      const start = this.startPoints[i];
      for (let j = 0; j < m.points.length; j++) {
        m.points[j] = V.add(this.point, V.scale(V.sub(start[j], this.point), s));
      }
      const o = this.startOpacities[i];
      m.fillOpacity = o.fill * s;
      m.strokeOpacity = o.stroke * s;
    });
  }

  finish() {
    this.interpolateMobject(1);
    this.finished = true;
    return this;
  }
}

// --- rotation --------------------------------------------------------------

// Continuous rotation by `radians` (default TAU) over runTime (default 5).
// Not a remover/introducer. Default linear rate for constant angular speed.
export class Rotating extends Animation {
  constructor(mobject, config = {}) {
    super(mobject, {
      runTime: config.runTime ?? 5,
      rateFunc: config.rateFunc ?? rf.linear,
      ...config,
    });
    this.radians = config.radians ?? V.TAU;
    this.axis = config.axis ?? V.OUT;
    this.aboutPoint = config.aboutPoint ?? null;
  }

  setup() {
    this.startPoints = familyPoints(this.mobject);
    // Fix the pivot once so it doesn't drift as points move.
    this.pivot = this.aboutPoint ?? this.mobject.getCenter();
  }

  interpolateMobject(alpha) {
    const angle = this.radians * alpha;
    const fam = this.mobject.getFamily();
    fam.forEach((m, i) => {
      const start = this.startPoints[i];
      for (let j = 0; j < m.points.length; j++) {
        m.points[j] = V.add(this.pivot, V.rotateVector(V.sub(start[j], this.pivot), angle, this.axis));
      }
    });
  }
}

// Animated fixed-angle rotation (default smooth). Duplicates the factory name
// from Animation.js intentionally — this is the class form used in this module.
export class Rotate extends Animation {
  constructor(mobject, angle, config = {}) {
    super(mobject, { rateFunc: config.rateFunc ?? rf.smooth, ...config });
    this.angle = angle ?? Math.PI;
    this.axis = config.axis ?? V.OUT;
    this.aboutPoint = config.aboutPoint ?? null;
  }

  setup() {
    this.startPoints = familyPoints(this.mobject);
    this.pivot = this.aboutPoint ?? this.mobject.getCenter();
  }

  interpolateMobject(alpha) {
    const angle = this.angle * alpha;
    const fam = this.mobject.getFamily();
    fam.forEach((m, i) => {
      const start = this.startPoints[i];
      for (let j = 0; j < m.points.length; j++) {
        m.points[j] = V.add(this.pivot, V.rotateVector(V.sub(start[j], this.pivot), angle, this.axis));
      }
    });
  }
}

// --- movement --------------------------------------------------------------

// Move the mobject so its center follows `path` (a VMobject) via
// path.pointFromProportion(alpha).
export class MoveAlongPath extends Animation {
  constructor(mobject, path, config = {}) {
    super(mobject, config);
    this.path = path;
  }

  interpolateMobject(alpha) {
    const target = this.path.pointFromProportion(alpha);
    this.mobject.moveTo(target);
  }
}

// --- indication ------------------------------------------------------------

// Briefly scale up and flash to `color`, then return, via thereAndBack.
export class Indicate extends Animation {
  constructor(mobject, config = {}) {
    super(mobject, { rateFunc: config.rateFunc ?? rf.thereAndBack, ...config });
    this.scaleFactor = config.scaleFactor ?? 1.2;
    this.flashColor = config.color ?? "#FFFF00";
  }

  setup() {
    this.startPoints = familyPoints(this.mobject);
    this.center = this.mobject.getCenter();
    // Remember original colors to blend toward the flash color and back.
    this.startColors = this.mobject.getFamily().map((m) => ({
      color: m.color,
      strokeColor: m.strokeColor ?? m.color,
      fillColor: m.fillColor ?? m.color,
    }));
  }

  interpolateMobject(alpha) {
    const s = 1 + (this.scaleFactor - 1) * alpha;
    const fam = this.mobject.getFamily();
    fam.forEach((m, i) => {
      const start = this.startPoints[i];
      for (let j = 0; j < m.points.length; j++) {
        m.points[j] = V.add(this.center, V.scale(V.sub(start[j], this.center), s));
      }
      if (alpha >= 0.5) {
        m.setColor(this.flashColor);
      } else {
        const c = this.startColors[i];
        m.color = c.color;
        if (m.strokeColor != null) m.strokeColor = c.strokeColor;
        if (m.fillColor != null) m.fillColor = c.fillColor;
      }
    });
  }

  finish() {
    // Restore original geometry and colors.
    const fam = this.mobject.getFamily();
    fam.forEach((m, i) => {
      m.points = this.startPoints[i].map((p) => [...p]);
      const c = this.startColors[i];
      m.color = c.color;
      if (m.strokeColor != null) m.strokeColor = c.strokeColor;
      if (m.fillColor != null) m.fillColor = c.fillColor;
    });
    this.finished = true;
    return this;
  }
}

// --- flash / focus ---------------------------------------------------------

// Emit short lines radiating from a point, fading out over the animation.
// Builds a temporary VGroup of Lines; introducer + remover.
export class Flash extends Animation {
  constructor(point, config = {}) {
    const color = config.color ?? "#FFFFFF";
    const numLines = config.numLines ?? 12;
    const lineLength = config.lineLength ?? 0.2;
    const flashRadius = config.flashRadius ?? 0.3;
    const center = point ?? V.ORIGIN;

    const lines = new VGroup();
    for (let i = 0; i < numLines; i++) {
      const angle = (V.TAU * i) / numLines;
      const dir = [Math.cos(angle), Math.sin(angle), 0];
      const start = V.add(center, V.scale(dir, flashRadius));
      const end = V.add(center, V.scale(dir, flashRadius + lineLength));
      const line = new Line(start, end);
      line.setColor(color);
      lines.add(line);
    }

    super(lines, { ...config, introducer: true, remover: true });
    this.point = center;
    this.lines = lines;
  }

  setup() {
    this.startOpacities = familyOpacities(this.mobject);
  }

  interpolateMobject(alpha) {
    // Fade out the rays over the animation.
    const fade = 1 - alpha;
    this.mobject.getFamily().forEach((m, i) => {
      const s = this.startOpacities[i];
      m.strokeOpacity = s.stroke * fade;
      m.fillOpacity = s.fill * fade;
    });
  }

  finish() {
    this.interpolateMobject(1);
    this.finished = true;
    return this;
  }
}

// A small rotational + scale wobble that restores the original state.
export class Wiggle extends Animation {
  constructor(mobject, config = {}) {
    super(mobject, { rateFunc: config.rateFunc ?? rf.linear, ...config });
    this.scaleValue = config.scaleValue ?? 1.1;
    this.rotationAngle = config.rotationAngle ?? 0.01 * V.TAU;
    this.nWiggles = config.nWiggles ?? 6;
    this.axis = config.axis ?? V.OUT;
  }

  setup() {
    this.startPoints = familyPoints(this.mobject);
    this.center = this.mobject.getCenter();
  }

  interpolateMobject(alpha) {
    // Scale envelope peaks at the middle (thereAndBack), and rotation
    // oscillates nWiggles times, both damped to zero at the ends.
    const s = 1 + (this.scaleValue - 1) * rf.thereAndBack(alpha);
    const wiggle = rf.thereAndBack(alpha) * Math.sin(this.nWiggles * Math.PI * alpha);
    const angle = this.rotationAngle * wiggle;
    const fam = this.mobject.getFamily();
    fam.forEach((m, i) => {
      const start = this.startPoints[i];
      for (let j = 0; j < m.points.length; j++) {
        const scaled = V.add(this.center, V.scale(V.sub(start[j], this.center), s));
        m.points[j] = V.add(this.center, V.rotateVector(V.sub(scaled, this.center), angle, this.axis));
      }
    });
  }

  finish() {
    const fam = this.mobject.getFamily();
    fam.forEach((m, i) => {
      m.points = this.startPoints[i].map((p) => [...p]);
    });
    this.finished = true;
    return this;
  }
}

// Briefly draw a rectangle around the mobject's bounds, then fade.
// introducer + remover.
export class Circumscribe extends Animation {
  constructor(mobject, config = {}) {
    const target = mobject;
    const buff = config.buff ?? 0.1;
    const w = target.getWidth() + 2 * buff;
    const h = target.getHeight() + 2 * buff;
    const rect = new Rectangle({ width: Math.max(w, 1e-3), height: Math.max(h, 1e-3) });
    rect.setColor(config.color ?? "#FFFF00");
    rect.fillOpacity = 0;
    rect.moveTo(target.getCenter());

    super(rect, {
      rateFunc: config.rateFunc ?? rf.smooth,
      ...config,
      introducer: true,
      remover: true,
    });
    this.rect = rect;
    this.fadeOut = config.fadeOut ?? true;
  }

  setup() {
    this.startOpacities = familyOpacities(this.mobject);
  }

  interpolateMobject(alpha) {
    // First half: draw the outline. Second half: fade it out.
    if (alpha <= 0.5) {
      this.mobject.getFamily().forEach((m) => {
        m.strokeEnd = alpha * 2;
      });
    } else {
      this.mobject.getFamily().forEach((m, i) => {
        m.strokeEnd = 1;
        if (this.fadeOut) {
          const s = this.startOpacities[i];
          m.strokeOpacity = s.stroke * (1 - (alpha - 0.5) * 2);
        }
      });
    }
  }

  finish() {
    this.interpolateMobject(1);
    this.finished = true;
    return this;
  }
}

// A shrinking spotlight circle converging on a point. introducer + remover.
export class FocusOn extends Animation {
  constructor(point, config = {}) {
    const target = point instanceof Object && !Array.isArray(point) && point.getCenter
      ? point.getCenter()
      : (point ?? V.ORIGIN);
    // Build the spotlight ring lazily via Circle-like bezier points using Line
    // segments would be lossy; import Circle here to keep the shape true.
    // (Imported below to avoid a circular concern at module top.)
    const { Circle } = FocusOn._geometry();
    const startRadius = config.startRadius ?? config.flashRadius ?? 2;
    const circle = new Circle({ radius: startRadius });
    circle.setColor(config.color ?? "#808080");
    circle.fillOpacity = config.fillOpacity ?? 0.2;
    circle.strokeWidth = config.strokeWidth ?? 0;
    circle.moveTo(target);

    super(circle, {
      rateFunc: config.rateFunc ?? rf.smooth,
      ...config,
      introducer: true,
      remover: true,
    });
    this.point = target;
    this.circle = circle;
    this.startRadius = startRadius;
  }

  static _geometry() {
    // Local require-style import to keep the top-of-file import list minimal.
    return _geometryModule;
  }

  setup() {
    this.startPoints = familyPoints(this.mobject);
    this.startOpacities = familyOpacities(this.mobject);
  }

  interpolateMobject(alpha) {
    // Shrink the ring toward the point (scale startRadius -> ~0).
    const s = 1 - alpha;
    const fam = this.mobject.getFamily();
    fam.forEach((m, i) => {
      const start = this.startPoints[i];
      for (let j = 0; j < m.points.length; j++) {
        m.points[j] = V.add(this.point, V.scale(V.sub(start[j], this.point), s));
      }
      const o = this.startOpacities[i];
      m.fillOpacity = o.fill * alpha;
      m.strokeOpacity = o.stroke * alpha;
    });
  }

  finish() {
    this.interpolateMobject(1);
    this.finished = true;
    return this;
  }
}

// Bind Circle for FocusOn without adding it to the eager import block that the
// task specified; imported statically here so it is available synchronously.
import { Circle as _Circle } from "../mobject/geometry.ts";
const _geometryModule = { Circle: _Circle };
