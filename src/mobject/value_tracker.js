// ValueTracker holds an animatable scalar (stored as a point so the standard
// interpolate machinery tweens it). DecimalNumber/Integer render a live number.

import { Mobject } from "./Mobject.js";
import { Text } from "./text/Text.js";

export class ValueTracker extends Mobject {
  constructor(value = 0) {
    super();
    this.points = [[value, 0, 0]];
  }

  getValue() {
    return this.points[0][0];
  }

  setValue(v) {
    this.points[0][0] = v;
    return this;
  }

  increment(dv) {
    this.points[0][0] += dv;
    return this;
  }

  interpolate(start, target, alpha) {
    const a = start.points[0][0];
    const b = target.points[0][0];
    this.points[0][0] = a + (b - a) * alpha;
    return this;
  }
}

export class DecimalNumber extends Text {
  constructor(value = 0, config = {}) {
    const numDecimalPlaces = config.numDecimalPlaces ?? 2;
    super(Number(value).toFixed(numDecimalPlaces), config);
    this.numDecimalPlaces = numDecimalPlaces;
    this.value = value;
    this.unit = config.unit ?? "";
  }

  setValue(value) {
    this.value = value;
    const center = this.getCenter();
    this.text = Number(value).toFixed(this.numDecimalPlaces) + this.unit;
    this._buildBox();
    this.moveTo(center);
    return this;
  }
}

export class Integer extends DecimalNumber {
  constructor(value = 0, config = {}) {
    super(Math.round(value), { ...config, numDecimalPlaces: 0 });
  }

  setValue(value) {
    return super.setValue(Math.round(value));
  }
}

// A mobject whose geometry is rebuilt every frame by `fn` (manim's
// always_redraw). Returns a wrapper mobject carrying an updater.
export function alwaysRedraw(fn) {
  const current = fn();
  current.addUpdater((mob) => {
    const fresh = fn();
    mob.points = fresh.points;
    mob.submobjects = fresh.submobjects;
    // Copy common style fields so the redraw is visible.
    for (const k of ["fillColor", "strokeColor", "fillOpacity", "strokeOpacity", "strokeWidth", "color", "text", "opacity"]) {
      if (k in fresh) mob[k] = fresh[k];
    }
  });
  return current;
}
