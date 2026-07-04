// Repeat/yoyo/repeatDelay wrapper. Built as a standalone Animation subclass
// (not baked into AnimationGroup/Timeline's own internals, which are already
// fragile enough -- Timeline.build() reaches into AnimationGroup fields from
// outside the class with no setter API; a third reach-in would compound that).
// Repeat only relies on the public Animation contract (begin/interpolate/
// finish/getMobjectsToIntroduce/getMobjectsToRemove), so it wraps a leaf
// Animation, an AnimationGroup, or a built Timeline identically.

import { Animation } from "./Animation.ts";
import type { AnimationConfig } from "./Animation.ts";
import type { Mobject } from "../mobject/Mobject.ts";

export interface RepeatConfig extends AnimationConfig {
  /** Number of times the wrapped animation plays. Must be a finite integer >= 1. */
  count: number;
  /** Odd-indexed cycles (1st, 3rd, ...) play in reverse, so motion "bounces". */
  yoyo?: boolean;
  /** Seconds to hold the wrapped animation's end value between cycles. */
  repeatDelay?: number;
}

interface CycleWindow {
  start: number; // in [0,1] of Repeat's own runTime
  end: number;
  reversed: boolean;
}

// NOTE: a Repeat's own `rateFunc`/easing config is NOT used to drive playback
// -- interpolate() dispatches directly to the wrapped animation's own timing
// per cycle, to avoid double-easing confusion (the wrapped animation already
// has its own rateFunc).
export class Repeat extends Animation {
  animation: any;
  count: number;
  yoyo: boolean;
  repeatDelay: number;
  private cycles: CycleWindow[];

  constructor(animation: any, config: RepeatConfig) {
    if (!Number.isFinite(config.count) || config.count < 1) {
      throw new RangeError(
        `Repeat requires a finite count >= 1 (got ${config.count}); infinite/looping ` +
        `playback belongs in a Studio live-preview loop, not the renderable-clip contract.`,
      );
    }
    const cycleRunTime = animation.runTime;
    const repeatDelay = config.repeatDelay ?? 0;
    const totalRunTime = config.count * cycleRunTime + (config.count - 1) * repeatDelay;
    super(animation.mobject ?? null, { ...config, runTime: config.runTime ?? totalRunTime });
    this.animation = animation;
    this.count = config.count;
    this.yoyo = config.yoyo ?? false;
    this.repeatDelay = repeatDelay;

    this.cycles = [];
    let t = 0;
    for (let i = 0; i < this.count; i++) {
      const start = t;
      const end = start + cycleRunTime;
      this.cycles.push({
        start: start / this.runTime,
        end: end / this.runTime,
        reversed: this.yoyo && i % 2 === 1,
      });
      t = end + repeatDelay;
    }
  }

  begin(): this {
    this.started = true;
    this.animation.begin();
    this.interpolate(0);
    return this;
  }

  // Finds the cycle window containing `t`, or (when `t` falls in a repeatDelay
  // gap) the PRECEDING cycle held at its own end value -- never the next
  // cycle's start, which would jump the visual ahead of the actual hold.
  private windowAt(t: number): CycleWindow {
    let win = this.cycles[0];
    for (const w of this.cycles) {
      if (t < w.start) break;
      win = w;
      if (t <= w.end) break;
    }
    return win;
  }

  interpolate(alpha: number): void {
    const t = Math.max(0, Math.min(1, alpha));
    const win = this.windowAt(t);
    const span = win.end - win.start || 1e-9;
    let local = Math.max(0, Math.min(1, (t - win.start) / span));
    if (win.reversed) local = 1 - local;
    this.animation.interpolate(local);
  }

  finish(): this {
    // Reproduce exactly what continuing the frame loop to alpha=1 would have
    // produced: for a forward-ending last cycle, that's the wrapped
    // animation's own finish() (matching what a plain, unwrapped play of it
    // would do); for a yoyo-reversed last cycle, the cycle's "end" (in time)
    // is the wrapped animation's *start* value, i.e. its interpolate(0).
    const lastWindow = this.cycles[this.cycles.length - 1];
    if (lastWindow.reversed) this.animation.interpolate(0);
    else this.animation.finish();
    this.finished = true;
    return this;
  }

  getMobjectsToIntroduce(): Mobject[] {
    return this.animation.getMobjectsToIntroduce();
  }

  getMobjectsToRemove(): Mobject[] {
    return this.animation.getMobjectsToRemove();
  }
}
