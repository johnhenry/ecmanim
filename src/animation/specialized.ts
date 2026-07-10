// Specialized animations mirroring ManimCommunity manim/animation/specialized.py
// (Broadcast) and manim/animation/speedmodifier.py (ChangeSpeed).

import { Animation } from "./Animation.ts";
import type { AnimationConfig } from "./Animation.ts";
import { LaggedStart, AnimationGroup } from "./composition.ts";
import { Transform } from "./Animation.ts";
import * as V from "../core/math/vector.ts";
import { linear } from "./rate_functions.ts";
import type { Mobject } from "../mobject/Mobject.ts";
import type { RateFunc, Vec3 } from "../core/types.ts";

/** Config for Broadcast. */
export interface BroadcastConfig extends AnimationConfig {
  focalPoint?: Vec3 | number[];
  nMobjects?: number;
  initialOpacity?: number;
  finalOpacity?: number;
  initialWidth?: number;
  finalWidth?: number;
}

/**
 * Broadcast: concentric copies of `mobject` expand outward from `focalPoint`
 * while fading out, like a ripple. Built as a LaggedStart of Transforms, each
 * growing a small copy into a large faded one. Remover: all temporary copies
 * are removed when the animation finishes.
 */
export class Broadcast extends LaggedStart {
  broadcastCopies: any[];

  constructor(mobject: Mobject, config: BroadcastConfig = {}) {
    const focalPoint = config.focalPoint ?? V.ORIGIN;
    const nMobjects = config.nMobjects ?? 5;
    const initialOpacity = config.initialOpacity ?? 1;
    const finalOpacity = config.finalOpacity ?? 0;
    const initialWidth = config.initialWidth ?? 0;
    const finalWidth = config.finalWidth ?? (mobject.getWidth() || 1);

    const copies: any[] = [];
    const anims: any[] = [];
    for (let i = 0; i < nMobjects; i++) {
      const start: any = mobject.copy();
      start.moveTo(focalPoint);
      // Start tiny and (mostly) opaque; end large and faded.
      const w0 = Math.max(1e-3, initialWidth || 1e-3);
      if (start.getWidth() > 0) start.setWidth(w0);
      start.setOpacity?.(initialOpacity);

      const target: any = start.copy();
      if (target.getWidth() > 0) target.setWidth(Math.max(1e-3, finalWidth));
      target.moveTo(focalPoint);
      target.setOpacity?.(finalOpacity);

      copies.push(start);
      anims.push(new Transform(start, target, { runTime: config.runTime ?? 3, rateFunc: config.rateFunc ?? linear }));
    }

    super(anims, { lagRatio: config.lagRatio ?? 0.2, ...config });
    // The concentric copies are what get introduced and removed.
    this.remover = true;
    this.introducer = true;
    this.broadcastCopies = copies;
  }

  getMobjectsToIntroduce(): Mobject[] {
    return this.broadcastCopies;
  }

  getMobjectsToRemove(): Mobject[] {
    return this.broadcastCopies;
  }
}

/** A piecewise speed specification: { time: speed }. */
export type SpeedInfo = Record<number, number>;

/** Config for ChangeSpeed. */
export interface ChangeSpeedConfig extends AnimationConfig {
  rateFunc?: RateFunc;
}

/**
 * ChangeSpeed: wrap one or more animations and remap time by a piecewise-linear
 * speed function given as { t: speed } pairs (t normalized in [0, 1]). The
 * effective runTime is scaled by the average inverse speed, and playback alpha
 * is remapped so the wrapped animation runs faster/slower over its duration.
 */
export class ChangeSpeed extends Animation {
  wrapped: any;
  speedTimes: number[];
  speedValues: number[];
  private _cumDist: number[]; // cumulative "distance" (progress) at each knot
  private _totalDist: number;

  constructor(
    animation: any | any[],
    speedinfoDict: SpeedInfo,
    config: ChangeSpeedConfig = {},
  ) {
    // Allow a list of animations (played together) or a single animation.
    const wrapped = Array.isArray(animation)
      ? new AnimationGroup(animation)
      : animation;

    // Sort the knots by time.
    const times = Object.keys(speedinfoDict).map(Number).sort((a, b) => a - b);
    if (times.length === 0 || times[0] > 0) times.unshift(0);
    const values = times.map((t) => {
      // Nearest defined speed at/after this knot (fallback 1).
      if (t in speedinfoDict) return speedinfoDict[t];
      // linear default
      return 1;
    });
    // Ensure at least the endpoints are covered.
    if (times[times.length - 1] < 1) {
      times.push(1);
      values.push(values[values.length - 1]);
    }

    super(wrapped.mobject ?? null, config);
    this.wrapped = wrapped;
    this.speedTimes = times;
    this.speedValues = values;

    // Precompute cumulative progress covered by integrating speed over time.
    // progress(t) = ∫ speed dt. We invert this so equal *real* time steps map to
    // faster/slower *virtual* progress.
    this._cumDist = [0];
    for (let i = 1; i < times.length; i++) {
      const dt = times[i] - times[i - 1];
      const avg = (values[i] + values[i - 1]) / 2;
      this._cumDist.push(this._cumDist[i - 1] + avg * dt);
    }
    this._totalDist = this._cumDist[this._cumDist.length - 1] || 1;

    // Scale the reported runTime by the mean speed (higher speed -> shorter).
    const meanSpeed = this._totalDist / (times[times.length - 1] - times[0] || 1);
    this.runTime = (config.runTime ?? this.wrapped.runTime ?? 1) / (meanSpeed || 1);
  }

  begin(): this {
    this.started = true;
    this.wrapped.begin();
    this.interpolate(0);
    return this;
  }

  // Map real alpha -> virtual alpha via the integrated speed profile.
  private mapAlpha(alpha: number): number {
    const a = Math.max(0, Math.min(1, alpha));
    const target = a * this._totalDist;
    const t = this.speedTimes;
    const cd = this._cumDist;
    // Find the segment where cumulative distance reaches `target`.
    for (let i = 1; i < cd.length; i++) {
      if (target <= cd[i] || i === cd.length - 1) {
        const segDist = cd[i] - cd[i - 1] || 1e-9;
        const frac = (target - cd[i - 1]) / segDist;
        return t[i - 1] + frac * (t[i] - t[i - 1]);
      }
    }
    return 1;
  }

  interpolate(alpha: number): void {
    const eased = this.rateFunc(Math.max(0, Math.min(1, alpha)));
    this.wrapped.interpolate(this.mapAlpha(eased));
  }

  finish(): this {
    this.wrapped.finish();
    this.finished = true;
    return this;
  }

  getMobjectsToIntroduce(): Mobject[] {
    return this.wrapped.getMobjectsToIntroduce ? this.wrapped.getMobjectsToIntroduce() : [];
  }

  getMobjectsToRemove(): Mobject[] {
    return this.wrapped.getMobjectsToRemove ? this.wrapped.getMobjectsToRemove() : [];
  }
}

// ---------------------------------------------------------------------------
// UpdateFromFunc / UpdateFromAlphaFunc (manim parity)
// ---------------------------------------------------------------------------

/**
 * Calls `updateFunction(mobject)` every frame of the animation — manim's
 * escape hatch for driving one mobject from another mid-play (e.g.
 * MovingZoomedSceneAround keeps a backdrop glued to the zoomed display while
 * it scales). The function receives NO alpha; use UpdateFromAlphaFunc for
 * alpha-driven variants.
 */
export class UpdateFromFunc extends Animation {
  updateFunction: (mob: any) => void;

  constructor(mobject: any, updateFunction: (mob: any) => void, config: any = {}) {
    super(mobject, config);
    this.updateFunction = updateFunction;
  }

  interpolateMobject(_alpha: number): void {
    this.updateFunction(this.mobject);
  }
}

/** Like UpdateFromFunc, but the callback also receives the eased alpha. */
export class UpdateFromAlphaFunc extends Animation {
  updateFunction: (mob: any, alpha: number) => void;

  constructor(mobject: any, updateFunction: (mob: any, alpha: number) => void, config: any = {}) {
    super(mobject, config);
    this.updateFunction = updateFunction;
  }

  interpolateMobject(alpha: number): void {
    this.updateFunction(this.mobject, alpha);
  }
}
