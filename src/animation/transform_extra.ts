// Additional transform-style animations ported from ManimCommunity's
// manim/animation/transform.py. These mostly compose the existing Transform /
// FadeIn / FadeOut primitives from Animation.ts; a few (FadeTransform,
// CyclicReplace) are thin Animation subclasses in their own right.
//
// Kept additive: this module imports from Animation.ts / composition.ts and
// does not modify them.

import { Transform, FadeToColor } from "./Animation.ts";
import type { AnimationConfig } from "./Animation.ts";
import { AnimationGroup } from "./composition.ts";
import * as V from "../core/math/vector.ts";
import type { Mobject } from "../mobject/Mobject.ts";

// Re-export FadeToColor so callers importing "extra" transforms find it here too.
// (The class itself is defined in Animation.ts; we do NOT redefine it.)
export { FadeToColor };

// --- copy / path variants --------------------------------------------------

// Transform a COPY of `mobject` into `target`, introducing the copy while the
// original stays on screen. Matches manim's TransformFromCopy.
export class TransformFromCopy extends Transform {
  constructor(mobject: Mobject, target: Mobject, config: AnimationConfig = {}) {
    // Animate the copy so the original is untouched; the copy is introduced.
    super((mobject as any).copy(), target, config);
    this.introducer = true;
  }
}

// Transform along a clockwise arc (pathArc = -PI).
export class ClockwiseTransform extends Transform {
  constructor(mobject: Mobject, target: Mobject, config: AnimationConfig = {}) {
    super(mobject, target, { pathArc: -Math.PI, ...config });
  }
}

// Transform along a counterclockwise arc (pathArc = +PI).
export class CounterclockwiseTransform extends Transform {
  constructor(mobject: Mobject, target: Mobject, config: AnimationConfig = {}) {
    super(mobject, target, { pathArc: Math.PI, ...config });
  }
}

// --- target / state transforms ---------------------------------------------

// Transform a mobject into its previously generated `.target`. Requires
// generateTarget() to have been called.
export class MoveToTarget extends Transform {
  constructor(mobject: Mobject, config: AnimationConfig = {}) {
    if (!(mobject as any).target) {
      throw new Error(
        "MoveToTarget requires a target; call mobject.generateTarget() and mutate mobject.target first.",
      );
    }
    super(mobject, (mobject as any).target, config);
  }
}

// Transform a mobject back to a previously saved state. Requires saveState().
export class Restore extends Transform {
  constructor(mobject: Mobject, config: AnimationConfig = {}) {
    if (!(mobject as any).savedState) {
      throw new Error("Restore requires a saved state; call mobject.saveState() first.");
    }
    super(mobject, (mobject as any).savedState, config);
  }
}

// --- function / matrix transforms ------------------------------------------

// Transform `mobject` into a copy with `fn` applied via applyFunction.
export class ApplyFunction extends Transform {
  constructor(fn: (p: number[]) => number[], mobject: Mobject, config: AnimationConfig = {}) {
    const target = (mobject as any).copy();
    target.applyFunction(fn);
    super(mobject, target, config);
  }
}

// Apply a pointwise function to every point (manim's ApplyPointwiseFunction).
// Semantically the same as ApplyFunction here; kept as a distinct name.
export class ApplyPointwiseFunction extends Transform {
  constructor(fn: (p: number[]) => number[], mobject: Mobject, config: AnimationConfig = {}) {
    const target = (mobject as any).copy();
    target.applyFunction(fn);
    super(mobject, target, config);
  }
}

// Move `mobject` so its center follows `fn` (manim's
// ApplyPointwiseFunctionToCenter). Only the center is transformed; the shape
// is shifted rigidly to that new center.
export class ApplyPointwiseFunctionToCenter extends Transform {
  constructor(fn: (p: number[]) => number[], mobject: Mobject, config: AnimationConfig = {}) {
    const target = (mobject as any).copy();
    const newCenter = fn(mobject.getCenter());
    target.moveTo(newCenter);
    super(mobject, target, config);
  }
}

// Transform `mobject` into a copy with `matrix` applied (about aboutPoint).
export class ApplyMatrix extends Transform {
  constructor(
    matrix: number[][],
    mobject: Mobject,
    config: AnimationConfig & { aboutPoint?: number[] } = {},
  ) {
    const target = (mobject as any).copy();
    const aboutPoint = config.aboutPoint ?? V.ORIGIN;
    target.applyMatrix(matrix, { aboutPoint });
    super(mobject, target, config);
  }
}

// Transform `mobject` into a copy with the complex function `fn` applied.
export class ApplyComplexFunction extends Transform {
  constructor(
    fn: (z: { re: number; im: number }) => { re: number; im: number } | number[],
    mobject: Mobject,
    config: AnimationConfig = {},
  ) {
    const target = (mobject as any).copy();
    target.applyComplexFunction(fn);
    super(mobject, target, config);
  }
}

// --- scale-in-place --------------------------------------------------------

// Scale a mobject by `scaleFactor` about its own center (manim's
// ScaleInPlace). ShrinkToCenter already lives in extra.ts — do not redefine.
export class ScaleInPlace extends Transform {
  constructor(mobject: Mobject, scaleFactor: number, config: AnimationConfig = {}) {
    const target = (mobject as any).copy();
    target.scale(scaleFactor, { aboutPoint: mobject.getCenter() });
    super(mobject, target, config);
  }
}

// --- fade transform --------------------------------------------------------

// Fade `mobject` out while `target` fades in, morphing their bounding boxes so
// each appears to become the other. Mirrors manim's FadeTransform. Introduces
// the target and removes the source.
export class FadeTransform extends Transform {
  toFadeOut: any;
  toFadeIn: any;
  stretch: boolean;
  dimToMatch: number;
  group: any;
  startFillOut!: number;
  startStrokeOut!: number;
  startFillIn!: number;
  startStrokeIn!: number;

  constructor(
    mobject: Mobject,
    target: Mobject,
    config: AnimationConfig & { stretch?: boolean; dimToMatch?: number } = {},
  ) {
    // The animated mobject is `mobject`; `target` is faded in on top.
    super(mobject, mobject, config);
    this.toFadeOut = mobject;
    this.toFadeIn = target;
    this.stretch = config.stretch ?? true;
    this.dimToMatch = config.dimToMatch ?? 1;
    this.introducer = true;
    this.remover = true;
  }

  begin(): this {
    this.started = true;
    this.startState = this.mobject.copy();
    this.startFillOut = this.toFadeOut.fillOpacity ?? this.toFadeOut.opacity ?? 1;
    this.startStrokeOut = this.toFadeOut.strokeOpacity ?? this.toFadeOut.opacity ?? 1;
    this.startFillIn = this.toFadeIn.fillOpacity ?? this.toFadeIn.opacity ?? 1;
    this.startStrokeIn = this.toFadeIn.strokeOpacity ?? this.toFadeIn.opacity ?? 1;
    // Start the incoming mobject invisible.
    this.setOpacity(this.toFadeIn, 0, 0);
    this.interpolate(0);
    return this;
  }

  setup(): void {}

  private setOpacity(m: any, fill: number, stroke: number): void {
    if (m.fillOpacity != null) m.fillOpacity = fill;
    if (m.strokeOpacity != null) m.strokeOpacity = stroke;
    m.opacity = Math.max(fill, stroke);
  }

  interpolate(alpha: number): void {
    const a = this.rateFunc(Math.max(0, Math.min(1, alpha)));
    // Cross-fade: source out, target in.
    this.setOpacity(this.toFadeOut, this.startFillOut * (1 - a), this.startStrokeOut * (1 - a));
    this.setOpacity(this.toFadeIn, this.startFillIn * a, this.startStrokeIn * a);
  }

  finish(): this {
    this.interpolate(1);
    this.finished = true;
    return this;
  }

  getMobjectsToIntroduce(): Mobject[] {
    return [this.toFadeIn];
  }

  getMobjectsToRemove(): Mobject[] {
    return [this.toFadeOut];
  }
}

// Per-submobject FadeTransform: pairs up submobjects of source and target and
// cross-fades each pair. Built as an AnimationGroup of FadeTransforms.
export class FadeTransformPieces extends AnimationGroup {
  constructor(
    mobject: Mobject,
    target: Mobject,
    config: AnimationConfig & { stretch?: boolean; dimToMatch?: number } = {},
  ) {
    const src = (mobject as any).submobjects?.length ? (mobject as any).submobjects : [mobject];
    const tgt = (target as any).submobjects?.length ? (target as any).submobjects : [target];
    const n = Math.min(src.length, tgt.length);
    const pieces: any[] = [];
    for (let i = 0; i < n; i++) pieces.push(new FadeTransform(src[i], tgt[i], config));
    super(pieces, config);
  }
}

// --- cyclic replace --------------------------------------------------------

// Each mobject moves to the position of the next one, cyclically (the last
// moves to the first). Movement follows an arc (pathArc default PI/2). Built as
// an AnimationGroup of Transforms toward copies at the next positions.
export class CyclicReplace extends AnimationGroup {
  constructor(...args: any[]) {
    // Optional trailing config object (detected by a `pathArc`/anim key).
    let config: AnimationConfig & { pathArc?: number } = {};
    if (
      args.length &&
      typeof args[args.length - 1] === "object" &&
      args[args.length - 1] != null &&
      !(args[args.length - 1] as any).getFamily
    ) {
      config = args.pop();
    }
    const mobjects: any[] = args.flat().filter(Boolean);
    const pathArc = config.pathArc ?? Math.PI / 2;
    const centers = mobjects.map((m) => m.getCenter());
    const anims: any[] = [];
    for (let i = 0; i < mobjects.length; i++) {
      const next = centers[(i + 1) % mobjects.length];
      const target = mobjects[i].copy();
      target.moveTo(next);
      anims.push(new Transform(mobjects[i], target, { pathArc, ...config }));
    }
    super(anims, config);
  }
}

// Swap two mobjects' positions (CyclicReplace of exactly two).
export class Swap extends CyclicReplace {
  constructor(a: Mobject, b: Mobject, config: AnimationConfig & { pathArc?: number } = {}) {
    super(a, b, config);
  }
}
