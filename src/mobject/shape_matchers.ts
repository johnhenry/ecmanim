// Shape matchers: mobjects that size/position themselves relative to another
// mobject. Mirrors ManimCommunity's manim/mobject/geometry/shape_matchers.py:
// SurroundingRectangle, BackgroundRectangle, Cross, Underline.

import { VMobject } from "./VMobject.ts";
import type { VMobjectConfig } from "./VMobject.ts";
import { Mobject } from "./Mobject.ts";
import { Rectangle, Line } from "./geometry.ts";
import { RoundedRectangle } from "./polygram.ts";
import * as V from "../core/math/vector.ts";
import { YELLOW, BLACK, RED } from "../core/color.ts";

export interface SurroundingRectangleConfig extends VMobjectConfig {
  buff?: number;
  cornerRadius?: number;
}

/** A Rectangle sized to enclose `mobject`'s bounds, expanded by `buff`. */
export class SurroundingRectangle extends Rectangle {
  buff: number;

  constructor(mobject: Mobject, config: SurroundingRectangleConfig = {}) {
    const buff = config.buff ?? 0.1;
    const cornerRadius = config.cornerRadius ?? 0;
    const width = mobject.getWidth() + 2 * buff;
    const height = mobject.getHeight() + 2 * buff;
    super({ color: config.color ?? YELLOW, ...config, width, height, fillOpacity: config.fillOpacity ?? 0 });
    this.buff = buff;
    if (cornerRadius > 0) {
      // Replace the sharp corners with rounded ones in place.
      const rr = new RoundedRectangle({ width, height, cornerRadius });
      this.points = rr.points.map((p) => V.clone(p));
      this.subpathStarts = [...rr.subpathStarts];
    }
    this.moveTo(mobject.getCenter());
  }
}

export interface BackgroundRectangleConfig extends VMobjectConfig {
  buff?: number;
}

/** A filled rectangle placed behind `mobject` (default translucent black). */
export class BackgroundRectangle extends SurroundingRectangle {
  originalFillOpacity: number;

  constructor(mobject: Mobject, config: BackgroundRectangleConfig = {}) {
    const fillOpacity = config.fillOpacity ?? 0.75;
    super(mobject, {
      buff: config.buff ?? 0,
      color: config.color ?? BLACK,
      ...config,
      fillOpacity,
      strokeWidth: config.strokeWidth ?? 0,
    });
    this.fillOpacity = fillOpacity;
    this.originalFillOpacity = fillOpacity;
    this.strokeWidth = config.strokeWidth ?? 0;
  }

  setStyleForFadeIn(): this { this.fillOpacity = 0; return this; }
  getFillOpacity(): number { return this.fillOpacity; }
}

export interface CrossConfig extends VMobjectConfig {
  stroke_width?: number;
  strokeWidth?: number;
  scaleFactor?: number;
}

/** An "X" (two crossing lines) sized to `mobject` (or unit size if none). */
export class Cross extends VMobject {
  constructor(mobject?: Mobject | null, config: CrossConfig = {}) {
    super({ color: config.color ?? RED, ...config });
    const scaleFactor = config.scaleFactor ?? 1;
    const strokeWidth = config.stroke_width ?? config.strokeWidth ?? 6;
    const color = config.color ?? RED;
    // Two diagonal lines across a unit square, then fit to the mobject.
    const l1 = new Line([-1, 1, 0], [1, -1, 0], { color, strokeWidth });
    const l2 = new Line([-1, -1, 0], [1, 1, 0], { color, strokeWidth });
    this.add(l1, l2);
    this.strokeColor = l1.strokeColor;
    this.strokeWidth = strokeWidth;
    if (mobject) {
      // Match width & height of the target, then scale by scaleFactor.
      const w = Math.max(mobject.getWidth(), 1e-6);
      const h = Math.max(mobject.getHeight(), 1e-6);
      this.stretch(w / 2, 0);
      this.stretch(h / 2, 1);
      this.moveTo(mobject.getCenter());
    }
    if (scaleFactor !== 1) this.scale(scaleFactor);
  }
}

export interface UnderlineConfig extends VMobjectConfig {
  buff?: number;
}

/** A horizontal Line placed just under `mobject`, spanning its width. */
export class Underline extends Line {
  constructor(mobject: Mobject, config: UnderlineConfig = {}) {
    const buff = config.buff ?? 0.1;
    super([-1, 0, 0], [1, 0, 0], config);
    const w = mobject.getWidth();
    this.setPointsAsCorners([[-w / 2, 0, 0], [w / 2, 0, 0]]);
    this.start = [-w / 2, 0, 0];
    this.end = [w / 2, 0, 0];
    const bottom = mobject.getBottom();
    this.moveTo([bottom[0], bottom[1] - buff, bottom[2]]);
  }
}
