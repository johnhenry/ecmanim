// Composite animations (AnimationGroup, LaggedStart, Succession) and the
// ergonomic `.animate` builder that mirrors manim's `mob.animate.shift(...)`.

import { Animation, Transform } from "./Animation.ts";
import type { AnimationConfig } from "./Animation.ts";
import { running, smooth, linear } from "./rate_functions.ts";
import type { Mobject } from "../mobject/Mobject.ts";

// Interpolate a scalar (used for timing math).
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

interface Timing {
  anim: any;
  start: number;
  end: number;
}

export class AnimationGroup extends Animation {
  animations: any[];
  groupRunTime: number | null;
  timings!: Timing[];
  maxEnd!: number;
  scaledTimings!: Timing[];

  constructor(animations: any[], config: AnimationConfig = {}) {
    // The group's own mobject is a stand-in; real work is delegated. manim's
    // AnimationGroup defaults to a linear group rate function.
    super(null, { ...config, rateFunc: config.rateFunc ?? linear });
    this.animations = animations.flat().filter(Boolean).map((a) =>
      a && a._isAnimateBuilder ? a.build() : a);
    this.lagRatio = config.lagRatio ?? 0;
    this.groupRunTime = config.runTime ?? null;
    this._buildTimings();
    if (this.groupRunTime == null) this.runTime = this.maxEnd;
    else this.runTime = this.groupRunTime;
  }

  _buildTimings(): void {
    // Mirror manim: next start = start + lagRatio * run_time.
    let curr = 0;
    let maxEnd = 0;
    this.timings = [];
    for (const anim of this.animations) {
      const start = curr;
      const end = start + anim.runTime;
      this.timings.push({ anim, start, end });
      maxEnd = Math.max(maxEnd, end);
      curr = mix(start, end, this.lagRatio);
    }
    this.maxEnd = maxEnd || 1;
  }

  begin(): this {
    this.started = true;
    for (const { anim } of this.timings) anim.begin();
    // Rescale timings into [0,1] against the span of the built timings. This is
    // correct whether or not an explicit group runTime was given: with no
    // groupRunTime, runTime === maxEnd so windows map 1:1 to seconds; with one,
    // children compress/stretch proportionally into it (manim semantics).
    const scale = this.maxEnd;
    this.scaledTimings = this.timings.map(({ anim, start, end }) => ({
      anim,
      start: start / scale,
      end: end / scale,
    }));
    this.interpolate(0);
    return this;
  }

  interpolate(alpha: number): void {
    // Apply the group's rate function, then dispatch to each child by its window.
    const t = this.rateFunc(Math.max(0, Math.min(1, alpha)));
    for (const { anim, start, end } of this.scaledTimings) {
      const span = end - start || 1e-9;
      const local = Math.max(0, Math.min(1, (t - start) / span));
      anim.interpolate(local);
    }
  }

  finish(): this {
    for (const { anim } of this.timings) anim.finish();
    this.finished = true;
    return this;
  }

  getMobjectsToIntroduce(): Mobject[] {
    return this.animations.flatMap((a) => a.getMobjectsToIntroduce());
  }

  getMobjectsToRemove(): Mobject[] {
    return this.animations.flatMap((a) => a.getMobjectsToRemove());
  }
}

export class LaggedStart extends AnimationGroup {
  constructor(animations: any[], config: AnimationConfig = {}) {
    super(animations, { lagRatio: config.lagRatio ?? 0.05, ...config });
  }
}

export class Succession extends AnimationGroup {
  constructor(animations: any[], config: AnimationConfig = {}) {
    super(animations, { lagRatio: 1, ...config });
  }
}

// Apply the same animation factory to many mobjects with a stagger.
export class LaggedStartMap extends LaggedStart {
  constructor(animFactory: (m: any) => any, mobjects: any[], config: AnimationConfig = {}) {
    super(mobjects.map((m) => animFactory(m)), config);
  }
}

// --- the `.animate` builder ------------------------------------------------
// Returns a chainable proxy; each method call mutates a copy of the mobject.
// When handed to Scene.play it is converted to a Transform via build().
export function makeAnimateBuilder(mob: any, config: AnimationConfig = {}): any {
  const target = mob.copy();
  const state: any = {
    _isAnimateBuilder: true,
    _mob: mob,
    _target: target,
    _config: { rateFunc: smooth, ...config },
    build() {
      return new Transform(mob, target, this._config);
    },
  };
  const proxy: any = new Proxy(state, {
    get(t: any, prop: string | symbol) {
      if (prop in t) return t[prop];
      const value = target[prop];
      if (typeof value === "function") {
        return (...args: any[]) => {
          value.apply(target, args);
          return proxy;
        };
      }
      return value;
    },
  });
  return proxy;
}
