// Arrow tip system — a family of small VMobject shapes that point in +X (RIGHT,
// angle 0) by default and are attached to the end of arrows/lines. Mirrors
// ManimCommunity manim/mobject/geometry/tips.py.
//
// The base ArrowTip exposes the geometry an arrow needs to orient/position a
// tip: getTipPoint() (points[0]), getBase() (midpoint of the outline), the
// vector between them, its angle and length.

import { VMobject } from "./VMobject.ts";
import type { VMobjectConfig } from "./VMobject.ts";
import * as V from "../core/math/vector.ts";
import { arcBezierPoints } from "../core/math/bezier.ts";

// manim's DEFAULT_ARROW_TIP_LENGTH.
export const DEFAULT_ARROW_TIP_LENGTH = 0.35;

/** Config accepted by every ArrowTip. */
export interface ArrowTipConfig extends VMobjectConfig {
  tipLength?: number;
  tipWidth?: number;
  length?: number;
  width?: number;
}

// Base class. Not meant to be instantiated directly (like manim), but we do not
// throw so subclasses can call super() freely.
export class ArrowTip extends VMobject {
  constructor(config: VMobjectConfig = {}) {
    super(config);
  }

  // The sharp point of the tip — always the first point of the outline.
  getTipPoint(): number[] {
    return this.points[0] ?? [0, 0, 0];
  }

  // The point where the tip attaches to the arrow line (midpoint of outline).
  getBase(): number[] {
    return this.pointFromProportion(0.5);
  }

  // Vector from base to tip.
  getVector(): number[] {
    return V.sub(this.getTipPoint(), this.getBase());
  }

  // Angle of the tip's pointing direction.
  getTipAngle(): number {
    return V.angleOf(this.getVector());
  }

  // Length of the tip (base -> tip distance).
  get length(): number {
    return V.length(this.getVector());
  }
}

// A slim kite / fighter-jet shape (manim's default-looking stealth tip).
// Explicit corner points with the tip at +X.
export class StealthTip extends ArrowTip {
  constructor(config: ArrowTipConfig = {}) {
    super({ fillOpacity: 1, strokeWidth: 3, ...config });
    const length = config.tipLength ?? config.length ?? DEFAULT_ARROW_TIP_LENGTH / 2;
    // Kite pointing +X: tip, upper wing, base notch, lower wing, back to tip.
    this.setPointsAsCorners([
      [2, 0, 0],
      [-1.2, 1.6, 0],
      [0, 0, 0],
      [-1.2, -1.6, 0],
      [2, 0, 0],
    ]);
    // manim scales by length / self.length (self.length here uses the 1.6 span).
    const cur = this.length;
    if (cur > 0) this.scale(length / cur);
  }
}

// A triangle tip pointing +X. Built from three corners (apex at +X, back edge
// centered on the y-axis) sized by tip_length (x) and tip_width (y).
export class ArrowTriangleTip extends ArrowTip {
  constructor(config: ArrowTipConfig = {}) {
    super({ fillOpacity: 0, strokeWidth: 3, ...config });
    const length = config.tipLength ?? config.length ?? DEFAULT_ARROW_TIP_LENGTH;
    const width = config.tipWidth ?? config.width ?? DEFAULT_ARROW_TIP_LENGTH;
    // Apex at +X; back edge from +y to -y so points[0] is the tip and the
    // outline midpoint sits at the center of the back edge.
    this.setPointsAsCorners([
      [length, 0, 0],
      [0, width / 2, 0],
      [0, -width / 2, 0],
      [length, 0, 0],
    ]);
  }
}

// Filled variant — manim's default arrow tip.
export class ArrowTriangleFilledTip extends ArrowTriangleTip {
  constructor(config: ArrowTipConfig = {}) {
    super({ fillOpacity: 1, strokeWidth: 0, ...config });
  }
}

// A circle tip. points[0] is placed at +X so getTipPoint() points rightward.
export class ArrowCircleTip extends ArrowTip {
  constructor(config: ArrowTipConfig = {}) {
    super({ fillOpacity: 0, strokeWidth: 3, ...config });
    const length = config.tipLength ?? config.length ?? DEFAULT_ARROW_TIP_LENGTH;
    const r = length / 2;
    // Start the circle at angle 0 (the +X point) so points[0] is at +X, and
    // center it so the outline midpoint (base) sits at the back (-X) side.
    const pts = arcBezierPoints(r, 0, 2 * Math.PI, [r, 0, 0]);
    this.appendBezierPoints(pts);
  }
}

export class ArrowCircleFilledTip extends ArrowCircleTip {
  constructor(config: ArrowTipConfig = {}) {
    super({ fillOpacity: 1, strokeWidth: 0, ...config });
  }
}

// A square tip. Its first corner is the +X (front) edge so getTipPoint()
// points rightward and the outline midpoint sits at the back edge.
export class ArrowSquareTip extends ArrowTip {
  constructor(config: ArrowTipConfig = {}) {
    super({ fillOpacity: 0, strokeWidth: 3, ...config });
    const length = config.tipLength ?? config.length ?? DEFAULT_ARROW_TIP_LENGTH;
    const s = length;
    // Corners ordered so points[0] is at +X (front) and index halfway around
    // (the base) lands on the back edge center.
    this.setPointsAsCorners([
      [s, s / 2, 0],
      [s, -s / 2, 0],
      [0, -s / 2, 0],
      [0, s / 2, 0],
      [s, s / 2, 0],
    ]);
  }

  // Front edge midpoint is the effective tip for a square; the back edge
  // midpoint is its base. (pointFromProportion(0.5) lands on a side, not the
  // back edge, so we compute these from the outline explicitly.)
  getTipPoint(): number[] {
    const front = this.points[0] ?? [0, 0, 0];
    return [front[0], 0, 0];
  }

  getBase(): number[] {
    // Back edge center: the min-x among the corner anchors, y = 0.
    let minX = Infinity;
    for (const p of this.getAnchors()) minX = Math.min(minX, p[0]);
    return [minX, 0, 0];
  }
}

export class ArrowSquareFilledTip extends ArrowSquareTip {
  constructor(config: ArrowTipConfig = {}) {
    super({ fillOpacity: 1, strokeWidth: 0, ...config });
  }
}
