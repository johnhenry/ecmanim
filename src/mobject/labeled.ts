// Labeled lines/arrows: a Line or Arrow carrying a label at a proportion along
// it, inside a small background frame. Mirrors ManimCommunity's
// manim/mobject/geometry/labeled.py (LabeledLine, LabeledArrow).

import type { VMobjectConfig } from "./VMobject.ts";
import { Line, Arrow } from "./geometry.ts";
import type { LineConfig, ArrowConfig } from "./geometry.ts";
import { Text } from "./text/Text.ts";
import { BackgroundRectangle } from "./shape_matchers.ts";
import * as V from "../core/math/vector.ts";

export interface LabeledLineConfig extends LineConfig {
  label?: string;
  labelPosition?: number; // proportion along the line, 0..1
  fontSize?: number;
  frameFill?: string;
  frameFillOpacity?: number;
  labelBuff?: number;
}

/** A Line with a framed text label placed at a proportion along its length. */
export class LabeledLine extends Line {
  label: Text;
  frame: BackgroundRectangle;
  labelPosition: number;

  constructor(
    start: number[] = V.LEFT,
    end: number[] = V.RIGHT,
    config: LabeledLineConfig = {},
  ) {
    super(start, end, config);
    this.labelPosition = config.labelPosition ?? 0.5;
    const text = config.label ?? "";
    this.label = new Text(text, { fontSize: config.fontSize ?? 0.4 });
    this.frame = new BackgroundRectangle(this.label, {
      buff: config.labelBuff ?? 0.05,
      color: config.frameFill ?? "#000000",
      fillOpacity: config.frameFillOpacity ?? 0.75,
    });
    this._placeLabel();
    this.add(this.frame, this.label);
  }

  protected _placeLabel(): this {
    const point = this.pointFromProportion(this.labelPosition);
    this.label.moveTo(point);
    this.frame.moveTo(point);
    return this;
  }
}

export interface LabeledArrowConfig extends ArrowConfig, LabeledLineConfig {}

/** An Arrow with a framed text label placed at a proportion along its length. */
export class LabeledArrow extends Arrow {
  label: Text;
  frame: BackgroundRectangle;
  labelPosition: number;

  constructor(
    start: number[] = V.LEFT,
    end: number[] = V.RIGHT,
    config: LabeledArrowConfig = {},
  ) {
    super(start, end, config);
    this.labelPosition = config.labelPosition ?? 0.5;
    const text = config.label ?? "";
    this.label = new Text(text, { fontSize: config.fontSize ?? 0.4 });
    this.frame = new BackgroundRectangle(this.label, {
      buff: config.labelBuff ?? 0.05,
      color: config.frameFill ?? "#000000",
      fillOpacity: config.frameFillOpacity ?? 0.75,
    });
    const point = this.pointFromProportion(this.labelPosition);
    this.label.moveTo(point);
    this.frame.moveTo(point);
    this.add(this.frame, this.label);
  }
}

// Keep the config interface referenced so it isn't flagged as unused.
export type { VMobjectConfig };
