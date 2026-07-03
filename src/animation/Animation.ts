// Animation base class plus the core concrete animations. An Animation mutates
// its target mobject each frame given interpolated alpha in [0,1].

import { smooth, linear, running } from "./rate_functions.ts";
import { Color } from "../core/color.ts";
import * as V from "../core/math/vector.ts";
import { pathAlongArc, straightPath, type PathFunc } from "../core/math/paths.ts";
import type { Mobject } from "../mobject/Mobject.ts";
import type { RateFunc } from "../core/types.ts";

/** Configuration accepted by Animation constructors. */
export interface AnimationConfig {
  runTime?: number;
  rateFunc?: RateFunc;
  remover?: boolean;
  introducer?: boolean;
  lagRatio?: number;
  /** When true, wrap the rate function as t => rate(1 - t) (manim's reverse_rate_function). */
  reverseRateFunc?: boolean;
  /** Arc angle (radians) along which Transform-style animations move points. Default 0 (straight). */
  pathArc?: number;
  /** Explicit path function; overrides pathArc when given. */
  pathFunc?: PathFunc;
  /** When true (default), Scene.play suspends the mobject's updaters while the anim runs. */
  suspendMobjectUpdating?: boolean;
  [key: string]: any;
}

// Duck-typed rather than `instanceof Mobject` to avoid adding a value import
// of Mobject here (Mobject.ts -> composition.ts -> Animation.ts is already a
// cycle; a value import back to Mobject would close a second loop through
// this file). Most Animation subclasses build their super() config via
// `{ ...config, introducer: true }` before this constructor ever runs, and a
// plain-object spread only copies OWN enumerable properties -- prototype
// methods like shift()/getCenter() don't survive it, but Mobject's own
// instance fields (set via `this.foo = ...` in its constructor) do. So this
// checks those own fields instead of methods, to still catch the corrupted
// value after it's been spread into a fresh plain object.
function isMobjectLike(v: any): boolean {
  return v != null && typeof v === "object" &&
    Array.isArray(v.points) &&
    Array.isArray(v.submobjects) &&
    typeof v.opacity === "number";
}

export class Animation {
  // Typed `any` because animations reach into VMobject-specific fields
  // (alignPointsWith, strokeEnd, fillOpacity, _isText, ...) heterogeneously.
  mobject: any;
  runTime: number;
  rateFunc: RateFunc;
  remover: boolean;
  introducer: boolean;
  lagRatio: number;
  suspendMobjectUpdating: boolean;
  started: boolean;
  finished: boolean;
  startState: any;

  // `null` is allowed for group/composite animations whose own mobject is a
  // stand-in (AnimationGroup delegates all real work to its children).
  constructor(mobject: Mobject | null, config: AnimationConfig = {}) {
    if (isMobjectLike(config)) {
      throw new TypeError(
        "Animation constructors take a single Mobject; to animate multiple " +
        "mobjects together, wrap them in a Group: new FadeIn(new Group(a, b, c))",
      );
    }
    this.mobject = mobject;
    this.runTime = config.runTime ?? 1;
    let rate = running(config.rateFunc ?? smooth);
    // reverse_rate_function: play the eased curve backwards (manim semantics).
    if (config.reverseRateFunc) {
      const base = rate;
      rate = (t: number) => base(1 - t);
    }
    this.rateFunc = rate;
    this.remover = config.remover ?? false; // remove mobject from scene when done
    this.introducer = config.introducer ?? false; // add mobject to scene at start
    this.lagRatio = config.lagRatio ?? 0;
    this.suspendMobjectUpdating = config.suspendMobjectUpdating ?? true;
    this.started = false;
    this.finished = false;
  }

  // manim's Animation.get_sub_alpha. With lag L and n submobjects the total
  // "length" of the staggered window is (n-1)*L + 1; each submobject i occupies
  // a unit-width slice starting at i*L. Returns the local alpha for submobject
  // `index` given the global `alpha`.
  getSubAlpha(alpha: number, index: number, numSubmobjects: number): number {
    const lag = this.lagRatio;
    const fullLength = (numSubmobjects - 1) * lag + 1;
    const value = alpha * fullLength;
    const lower = index * lag;
    return Math.max(0, Math.min(1, value - lower));
  }

  // Called once when the animation starts playing.
  begin(): this {
    this.started = true;
    this.startState = this.mobject.copy();
    this.setup();
    this.interpolate(0);
    return this;
  }

  setup(): void {}

  finish(): this {
    this.interpolate(1);
    this.finished = true;
    return this;
  }

  // alpha is raw progress in [0,1]; subclasses override interpolateMobject.
  // When lagRatio > 0 and the animation opts into staggering (interpolateSubmobject
  // is overridden), walk the mobject family applying a per-member sub-alpha.
  interpolate(alpha: number): void {
    const eased = this.rateFunc(Math.max(0, Math.min(1, alpha)));
    if (this.lagRatio > 0 && this.usesSubmobjectStagger()) {
      const fam = this.mobject.getFamily();
      const n = fam.length;
      for (let i = 0; i < n; i++) {
        this.interpolateSubmobject(fam[i], this.getSubAlpha(eased, i, n), i);
      }
      return;
    }
    this.interpolateMobject(eased);
  }

  // Subclasses that stagger override this; the default (returns false) keeps the
  // global single-alpha path so lagRatio has no effect unless opted in.
  usesSubmobjectStagger(): boolean {
    return false;
  }

  // Per-family-member hook used only on the staggered path. `subAlpha` is the
  // already-eased local alpha for `submob` (family member at `index`).
  interpolateSubmobject(_submob: any, _subAlpha: number, _index: number): void {}

  interpolateMobject(_alpha: number): void {}

  getMobjectsToIntroduce(): Mobject[] {
    return this.introducer ? [this.mobject] : [];
  }

  getMobjectsToRemove(): Mobject[] {
    return this.remover ? [this.mobject] : [];
  }
}

// --- transform-style animations -------------------------------------------
export class Transform extends Animation {
  target: any;
  replace: boolean;
  targetCopy: any;
  startCopy: any;
  pathArc: number;
  pathFunc: PathFunc | null;

  constructor(mobject: Mobject, target: Mobject, config: AnimationConfig & { replace?: boolean } = {}) {
    super(mobject, config);
    this.target = target;
    this.replace = config.replace ?? false;
    this.pathArc = config.pathArc ?? 0;
    // Explicit pathFunc wins; else derive from pathArc (straight when 0).
    this.pathFunc = config.pathFunc ?? (this.pathArc !== 0 ? pathAlongArc(this.pathArc) : null);
  }

  setup(): void {
    // Align point counts so interpolation is well defined.
    if (this.mobject.alignPointsWith && this.target.alignPointsWith) {
      this.targetCopy = this.target.copy();
      this.startCopy = this.startState.copy();
      this.startCopy.alignPointsWith(this.targetCopy);
      this.targetCopy.alignPointsWith(this.startCopy);
      // Reset the live mobject to the aligned start geometry.
      this.mobject.points = this.startCopy.points.map((p: number[]) => [...p]);
      this.mobject.subpathStarts = [...(this.startCopy.subpathStarts ?? [])];
      this.startState = this.startCopy;
    } else {
      this.targetCopy = this.target.copy();
    }
  }

  interpolateMobject(alpha: number): void {
    // Interpolate color/opacity/etc. via the mobject's own blend...
    this.mobject.interpolate(this.startState, this.targetCopy, alpha);
    // ...then, when a curved path is active, override the point positions so
    // each point travels along the path function rather than a straight line.
    if (this.pathFunc) {
      const live = this.mobject.getFamily();
      const starts = this.startState.getFamily();
      const targets = this.targetCopy.getFamily();
      const nm = Math.min(live.length, starts.length, targets.length);
      for (let k = 0; k < nm; k++) {
        const lp = live[k].points;
        const sp = starts[k].points;
        const tp = targets[k].points;
        const n = Math.min(lp.length, sp.length, tp.length);
        if (n === 0) continue;
        const moved = this.pathFunc(sp.slice(0, n), tp.slice(0, n), alpha);
        for (let i = 0; i < n; i++) lp[i] = moved[i] as number[];
      }
    }
  }
}

export class ReplacementTransform extends Transform {
  introduced: any;

  constructor(mobject: Mobject, target: Mobject, config: AnimationConfig = {}) {
    super(mobject, target, { ...config, replace: true });
    this.remover = true;
    this.introducer = true;
    this.introduced = target;
  }

  finish(): this {
    super.finish();
    // Leave the target geometry in place under the original mobject.
    return this;
  }
}

// --- creation animations ---------------------------------------------------
export class Create extends Animation {
  origFill!: number[]; // assigned in setup() (begin() guarantees it runs first)

  constructor(mobject: Mobject, config: AnimationConfig = {}) {
    super(mobject, { rateFunc: config.rateFunc ?? smooth, ...config, introducer: true });
  }

  setup(): void {
    this.origFill = this.mobject.getFamily().map((m: any) => m.fillOpacity ?? 0);
  }

  // Draw a single family member at its local alpha. Shared by the global and
  // the per-submobject (staggered) code paths so behavior is identical for a
  // single mobject (family length 1) regardless of lagRatio.
  protected drawMember(m: any, index: number, a: number): void {
    if (m._isText) {
      m.revealFraction = a; // typewriter reveal for Text
      return;
    }
    m.strokeEnd = a;
    // Fade fill in only over the final stretch so the outline draws first.
    if (m.fillOpacity != null) m.fillOpacity = this.origFill[index] * Math.max(0, (a - 0.5) * 2);
  }

  usesSubmobjectStagger(): boolean {
    return true;
  }

  interpolateSubmobject(submob: any, subAlpha: number, index: number): void {
    this.drawMember(submob, index, subAlpha);
  }

  interpolateMobject(alpha: number): void {
    const fam = this.mobject.getFamily();
    fam.forEach((m: any, i: number) => this.drawMember(m, i, alpha));
  }

  finish(): this {
    const fam = this.mobject.getFamily();
    fam.forEach((m: any, i: number) => {
      if (m._isText) { m.revealFraction = 1; return; }
      m.strokeEnd = 1;
      if (m.fillOpacity != null) m.fillOpacity = this.origFill[i];
    });
    this.finished = true;
    return this;
  }
}

export class Write extends Create {
  constructor(mobject: Mobject, config: AnimationConfig = {}) {
    // Small default lag so multi-glyph / multi-submobject Write draws
    // progressively; a single-submobject mobject still animates 0->1 exactly.
    super(mobject, {
      runTime: config.runTime ?? 1.5,
      rateFunc: config.rateFunc ?? linear,
      lagRatio: config.lagRatio ?? 0.1,
      ...config,
    });
  }
}

export class Uncreate extends Create {
  constructor(mobject: Mobject, config: AnimationConfig = {}) {
    // reverse_rate_function turns the 0->1 Create draw into a 1->0 erase.
    super(mobject, { ...config, reverseRateFunc: true });
    this.remover = true;
    this.introducer = false;
  }

  finish(): this {
    this.mobject.getFamily().forEach((m: any) => (m.strokeEnd = 0));
    this.finished = true;
    return this;
  }
}

// --- fading ----------------------------------------------------------------
export class FadeIn extends Animation {
  shiftVec: number[];
  scaleFactor: number;
  targetOpacities!: Array<{ fill: number; stroke: number; op: number }>;
  finalPoints!: number[][][];
  startPoints!: number[][][];

  constructor(mobject: Mobject, config: AnimationConfig & { shift?: number[]; scale?: number } = {}) {
    super(mobject, { ...config, introducer: true });
    this.shiftVec = config.shift ?? [0, 0, 0];
    this.scaleFactor = config.scale ?? 1;
  }

  setup(): void {
    const fam = this.mobject.getFamily();
    this.targetOpacities = fam.map((m: any) => ({
      fill: m.fillOpacity ?? m.opacity ?? 1,
      stroke: m.strokeOpacity ?? m.opacity ?? 1,
      op: m.opacity ?? 1,
    }));
    this.finalPoints = fam.map((m: any) => m.points.map((p: number[]) => [...p]));
    // The mobject fades in from a state scaled by `scale` about its center and
    // shifted by `-shift` (manim's _Fade). Precompute that start geometry.
    const c = this.mobject.getCenter();
    const s = this.scaleFactor;
    this.startPoints = this.finalPoints.map((pts) => pts.map((p) => [
      c[0] + (p[0] - c[0]) * s - this.shiftVec[0],
      c[1] + (p[1] - c[1]) * s - this.shiftVec[1],
      c[2] + (p[2] - c[2]) * s - this.shiftVec[2],
    ]));
  }

  protected fadeMember(m: any, i: number, a: number): void {
    const t = this.targetOpacities[i];
    m.fillOpacity = t.fill * a;
    m.strokeOpacity = t.stroke * a;
    m.opacity = t.op;
    const start = this.startPoints[i];
    const final = this.finalPoints[i];
    for (let j = 0; j < m.points.length; j++) m.points[j] = V.lerp(start[j], final[j], a);
  }

  usesSubmobjectStagger(): boolean {
    return true;
  }

  interpolateSubmobject(submob: any, subAlpha: number, index: number): void {
    this.fadeMember(submob, index, subAlpha);
  }

  interpolateMobject(alpha: number): void {
    const fam = this.mobject.getFamily();
    fam.forEach((m: any, i: number) => this.fadeMember(m, i, alpha));
  }

  finish(): this {
    // Force the fully-faded-in end state regardless of lag windows.
    const fam = this.mobject.getFamily();
    fam.forEach((m: any, i: number) => this.fadeMember(m, i, 1));
    this.finished = true;
    return this;
  }
}

export class FadeOut extends Animation {
  shiftVec: number[];
  scaleFactor: number;
  startOpacities!: Array<{ fill: number; stroke: number }>;
  startPoints!: number[][][];
  endPoints!: number[][][];

  constructor(mobject: Mobject, config: AnimationConfig & { shift?: number[]; scale?: number } = {}) {
    super(mobject, { ...config, remover: true });
    this.shiftVec = config.shift ?? [0, 0, 0];
    this.scaleFactor = config.scale ?? 1;
  }

  setup(): void {
    const fam = this.mobject.getFamily();
    this.startOpacities = fam.map((m: any) => ({
      fill: m.fillOpacity ?? m.opacity ?? 1,
      stroke: m.strokeOpacity ?? m.opacity ?? 1,
    }));
    this.startPoints = fam.map((m: any) => m.points.map((p: number[]) => [...p]));
    // Fades out toward a state scaled by `scale` about center and shifted by `shift`.
    const c = this.mobject.getCenter();
    const s = this.scaleFactor;
    this.endPoints = this.startPoints.map((pts) => pts.map((p) => [
      c[0] + (p[0] - c[0]) * s + this.shiftVec[0],
      c[1] + (p[1] - c[1]) * s + this.shiftVec[1],
      c[2] + (p[2] - c[2]) * s + this.shiftVec[2],
    ]));
  }

  interpolateMobject(alpha: number): void {
    const fam = this.mobject.getFamily();
    fam.forEach((m: any, i: number) => {
      const s = this.startOpacities[i];
      m.fillOpacity = s.fill * (1 - alpha);
      m.strokeOpacity = s.stroke * (1 - alpha);
      const start = this.startPoints[i];
      const end = this.endPoints[i];
      for (let j = 0; j < m.points.length; j++) m.points[j] = V.lerp(start[j], end[j], alpha);
    });
  }

  finish(): this {
    this.interpolateMobject(1);
    this.finished = true;
    return this;
  }
}

// --- movement / method animations -----------------------------------------
export class ApplyMethod extends Animation {
  method: string | ((...args: any[]) => any);
  args: any[];
  targetCopy: any;

  // Records the effect of calling `method(...args)` on a copy, then tweens to it.
  constructor(mobject: Mobject, method: string | ((...args: any[]) => any), ...args: any[]) {
    // Drop a trailing undefined/null (from optional config params in factories).
    while (args.length && args[args.length - 1] == null) args.pop();
    let config: AnimationConfig = {};
    if (args.length && typeof args[args.length - 1] === "object" && args[args.length - 1]?._animConfig) {
      config = args.pop();
    }
    super(mobject, config);
    this.method = method;
    this.args = args;
  }

  setup(): void {
    this.targetCopy = this.mobject.copy();
    const fn = typeof this.method === "string" ? this.targetCopy[this.method] : this.method;
    fn.apply(this.targetCopy, this.args);
    if (this.mobject.alignPointsWith) {
      this.startState.alignPointsWith(this.targetCopy);
      this.targetCopy.alignPointsWith(this.startState);
      this.mobject.points = this.startState.points.map((p: number[]) => [...p]);
      this.mobject.subpathStarts = [...(this.startState.subpathStarts ?? [])];
    }
  }

  interpolateMobject(alpha: number): void {
    this.mobject.interpolate(this.startState, this.targetCopy, alpha);
  }
}

// Convenience factories mirroring manim's mobject.animate syntax.
export const Shift = (mob: Mobject, vec: number[], config?: AnimationConfig) => new ApplyMethod(mob, "shift", vec, config);
export const MoveTo = (mob: Mobject, pt: number[], config?: AnimationConfig) => new ApplyMethod(mob, "moveTo", pt, config);
export const ScaleAnim = (mob: Mobject, f: number, config?: AnimationConfig) => new ApplyMethod(mob, "scale", f, config);
// NOTE: the animated `Rotate` lives in ./extra.js (a full Animation subclass with
// about_point support). Do not re-add a factory named `Rotate` here — it caused a
// duplicate-export collision.

export class FadeToColor extends ApplyMethod {
  constructor(mobject: Mobject, color: any, config: AnimationConfig = {}) {
    super(mobject, "setColor", color, config);
  }
}
