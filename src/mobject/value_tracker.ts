// ValueTracker holds an animatable scalar (stored as a point so the standard
// interpolate machinery tweens it). DecimalNumber/Integer render a live number.

import { Mobject } from "./Mobject.ts";
import { RasterText } from "./text/Text.ts";
import { copyMemberwiseStyle } from "./copy_style.ts";
import type { Vec3 } from "../core/types.ts";

/** Config accepted by DecimalNumber/Integer (extends Text's config loosely). */
export interface DecimalNumberConfig {
  numDecimalPlaces?: number;
  unit?: string;
  includeSign?: boolean;
  groupWithCommas?: boolean;
  showEllipsis?: boolean;
  edgeToFix?: number[];
  point?: number[];
  at?: number[];
  [key: string]: any;
}

export class ValueTracker extends Mobject {
  constructor(value = 0) {
    super();
    this.points = [[value, 0, 0]];
  }

  getValue(): number {
    return this.points[0][0];
  }

  setValue(v: number): this {
    this.points[0][0] = v;
    return this;
  }

  increment(dv: number): this {
    this.points[0][0] += dv;
    return this;
  }

  /** manim parity alias (increment_value). */
  incrementValue(dv: number): this {
    return this.increment(dv);
  }

  interpolate(start: ValueTracker, target: ValueTracker, alpha: number): this {
    const a = start.points[0][0];
    const b = target.points[0][0];
    this.points[0][0] = a + (b - a) * alpha;
    return this;
  }
}

export class DecimalNumber extends RasterText {
  numDecimalPlaces: number;
  unit: string;
  includeSign: boolean;
  groupWithCommas: boolean;
  showEllipsis: boolean;
  edgeToFix: number[];
  value: number;

  constructor(value = 0, config: DecimalNumberConfig = {}) {
    const numDecimalPlaces = config.numDecimalPlaces ?? 2;
    const cfg = { ...config };
    // Temporarily construct with a placeholder; _format needs the fields below.
    super("0", cfg);
    this.numDecimalPlaces = numDecimalPlaces;
    this.unit = config.unit ?? "";
    this.includeSign = config.includeSign ?? false;
    this.groupWithCommas = config.groupWithCommas ?? true; // manim default
    this.showEllipsis = config.showEllipsis ?? false;
    // Which edge stays pinned as the value's width changes (manim default LEFT).
    this.edgeToFix = config.edgeToFix ?? [-1, 0, 0];
    this.value = value;
    this.text = this._format(value);
    this._buildBox();
    const at = config.point ?? config.at;
    if (at) this.moveTo(at);
  }

  _format(value: number): string {
    const neg = value < 0;
    let s = Math.abs(value).toFixed(this.numDecimalPlaces);
    if (this.groupWithCommas) {
      const parts = s.split(".");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      s = parts.join(".");
    }
    const sign = neg ? "-" : this.includeSign ? "+" : "";
    return sign + s + (this.showEllipsis ? "…" : "") + this.unit;
  }

  getValue(): number {
    return this.value;
  }

  incrementValue(delta = 1): this {
    return this.setValue(this.value + delta);
  }

  setValue(value: number): this {
    this.value = value;
    // Pin the configured edge so a changing width doesn't shift the number.
    const anchor = this.getBoundaryPoint(this.edgeToFix);
    this.text = this._format(value);
    this._buildBox();
    this.moveTo(anchor, this.edgeToFix);
    return this;
  }
}

export class Integer extends DecimalNumber {
  constructor(value = 0, config: DecimalNumberConfig = {}) {
    super(Math.round(value), { ...config, numDecimalPlaces: 0 });
  }

  setValue(value: number): this {
    return super.setValue(Math.round(value));
  }
}

// A mobject whose geometry is rebuilt every frame by `fn` (manim's
// always_redraw). Returns a wrapper mobject carrying an updater.
export function alwaysRedraw(fn: () => Mobject): Mobject {
  const current = fn();
  current.addUpdater((mob: Mobject) => {
    const fresh = fn();
    mob.points = fresh.points;
    mob.submobjects = fresh.submobjects;
    // Copy every style field (not a hardcoded allowlist) so custom fields on
    // a user's Mobject subclass redraw correctly too.
    copyMemberwiseStyle(mob, fresh);
  });
  return current;
}
