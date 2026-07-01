// Vector-style arrows. Mirrors ManimCommunity's manim/mobject/geometry/line.py
// Vector and DoubleArrow classes (the arrowhead-bearing lines).

import { VMobject } from "./VMobject.ts";
import type { VMobjectConfig } from "./VMobject.ts";
import { Arrow, Line } from "./geometry.ts";
import type { ArrowConfig } from "./geometry.ts";
import { Text } from "./text/Text.ts";
import * as V from "../core/math/vector.ts";

export interface VectorConfig extends ArrowConfig {
  buff?: number;
}

/** An Arrow from the origin to `direction`. */
export class Vector extends Arrow {
  direction: number[];

  constructor(direction: number[] = V.RIGHT, config: VectorConfig = {}) {
    // manim's Vector defaults buff to 0 so getEnd() lands exactly on `direction`.
    super(V.ORIGIN, direction, { ...config, buff: config.buff ?? 0 });
    this.direction = V.clone(direction);
  }

  /**
   * A label showing the vector's components. Returns a Text (a full Matrix is
   * out of scope here); positioned to the right of the arrow's tip.
   */
  coordinateLabel(config: { fontSize?: number } = {}): Text {
    const end = this.getEnd();
    const x = Math.round(end[0] * 100) / 100;
    const y = Math.round(end[1] * 100) / 100;
    const label = new Text(`[${x}, ${y}]`, { fontSize: config.fontSize ?? 0.4 });
    label.nextTo(this, V.RIGHT, 0.1);
    return label;
  }
}

export interface DoubleArrowConfig extends ArrowConfig {
  tipLength?: number;
}

/** A line with an arrowhead at BOTH ends. */
export class DoubleArrow extends Line {
  tipLength: number;
  tipStart: VMobject;
  tipEnd: VMobject;

  constructor(
    start: number[] = V.LEFT,
    end: number[] = V.RIGHT,
    config: DoubleArrowConfig = {},
  ) {
    super(start, end, config);
    this.tipLength = config.tipLength ?? 0.25;
    this.tipStart = this._buildTipAt(this.getStart(), this.getEnd());
    this.tipEnd = this._buildTipAt(this.getEnd(), this.getStart());
    this.add(this.tipStart, this.tipEnd);
  }

  // Build a filled triangular tip located AT `at`, pointing away from `from`.
  private _buildTipAt(at: number[], from: number[]): VMobject {
    const dir = V.normalize(V.sub(at, from));
    const back = V.scale(dir, -this.tipLength);
    const perp = [-dir[1], dir[0], 0];
    const base = V.add(at, back);
    const p1 = V.add(base, V.scale(perp, this.tipLength * 0.5));
    const p2 = V.sub(base, V.scale(perp, this.tipLength * 0.5));
    const tip = new VMobject({ fillOpacity: 1 });
    tip.setColor(this.strokeColor);
    tip.setPointsAsCorners([at, p1, p2, at]);
    tip.fillOpacity = 1;
    return tip;
  }
}
