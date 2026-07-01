// Text rendered via the Canvas text API (identical in @napi-rs/canvas and the
// browser). Unlike manim's glyph-path text this is not a true VMobject, but it
// carries a bounding box so positioning (moveTo/nextTo/toEdge) works, and the
// renderer special-cases it.

import { Mobject } from "../Mobject.ts";
import { Color } from "../../core/color.ts";
import * as V from "../../core/math/vector.ts";

// Rough per-character width factor for layout estimation without a context.
const CHAR_ASPECT = 0.55;

export class Text extends Mobject {
  constructor(text = "", config = {}) {
    super(config);
    this._isText = true;
    this.text = String(text);
    // World-space cap height of one line.
    this.fontSize = config.fontSize ?? 0.7;
    this.font = config.font ?? "sans-serif";
    this.weight = config.weight ?? "normal";
    this.slant = config.slant ?? "normal"; // normal | italic
    this.align = config.align ?? "center"; // left | center | right
    this.fillColor = Color.parse(config.color ?? config.fillColor ?? "#FFFFFF");
    this.fillOpacity = config.fillOpacity ?? 1;
    this.strokeOpacity = 0;
    this.opacity = config.opacity ?? 1;
    this.revealFraction = 1; // typewriter reveal for Write/Create

    this._buildBox();
    const at = config.point ?? config.at;
    if (at) this.moveTo(at);
  }

  _buildBox() {
    const lines = this.text.split("\n");
    const longest = lines.reduce((m, l) => Math.max(m, l.length), 1);
    const w = longest * this.fontSize * CHAR_ASPECT;
    const h = lines.length * this.fontSize * 1.2;
    // Four corners (TL, TR, BR, BL) centered on origin — transforms act on these.
    this.points = [
      [-w / 2, h / 2, 0],
      [w / 2, h / 2, 0],
      [w / 2, -h / 2, 0],
      [-w / 2, -h / 2, 0],
    ];
    this.numLines = lines.length;
  }

  setColor(color) {
    this.fillColor = Color.parse(color);
    this.color = Color.parse(color);
    return this;
  }

  setOpacity(o) {
    this.fillOpacity = o;
    this.opacity = o;
    return this;
  }

  // The world-space font height after any scaling applied to the box.
  currentFontHeight() {
    return (this.getHeight() / Math.max(1, this.numLines)) / 1.2;
  }

  interpolate(start, target, alpha) {
    const n = Math.min(this.points.length, start.points.length, target.points.length);
    for (let i = 0; i < n; i++) this.points[i] = V.lerp(start.points[i], target.points[i], alpha);
    this.fillColor = Color.lerp(start.fillColor, target.fillColor, alpha);
    this.fillOpacity = start.fillOpacity + (target.fillOpacity - start.fillOpacity) * alpha;
    this.opacity = start.opacity + (target.opacity - start.opacity) * alpha;
    return this;
  }

  copy() {
    const c = super.copy();
    c.fillColor = Color.parse(this.fillColor);
    return c;
  }
}

// Alias; markup parsing is not implemented, treated as plain text.
export class MarkupText extends Text {}
