// F6 (Part A): Remotion-style `Sequence` time-shift.
//
// A `Sequence` wraps a SINGLE animation and shifts its "active" window inside a
// larger timeline, mirroring Remotion's `<Sequence from durationInFrames>`.
// Outside the window the child is frozen: before its `from` frame it sits at its
// start state (local alpha 0); after `from + durationInFrames` it sits at its end
// state (local alpha 1); inside the window it progresses 0 -> 1.
//
// Implementation strategy: extend the existing AnimationGroup machinery. The
// group already dispatches a *local* alpha to each child via its window
// (`(t - start)/span`, clamped to [0,1]). We create a single-child group whose
// child window is exactly [from, from+duration) expressed as a fraction of the
// total runTime. AnimationGroup's clamp then gives us the freeze-before /
// freeze-after behavior for free, and `squishRateFunc` is layered on the child's
// own rate function as a belt-and-suspenders windowing so the child reports its
// start value before the window and its end value after it, independent of how
// the outer alpha is driven.

import { AnimationGroup } from "./composition.ts";
import { squishRateFunc } from "./rate_functions.ts";
import type { RateFunc } from "../core/types.ts";

export interface SequenceConfig {
  from?: number; // start frame offset into the timeline (default 0)
  durationInFrames?: number; // how long the child plays (default: whole remainder)
  fps?: number; // frames <-> seconds conversion (default 30)
  runTime?: number; // total timeline seconds (optional; else derived from child + from)
}

/**
 * Wrap `animation` so it is only "active" during its frame window
 * `[from, from + durationInFrames)`. Returns an Animation (an AnimationGroup
 * subclass) whose `interpolate(alpha)` drives the child through its shifted
 * window: frozen at start before, progressing inside, frozen at end after.
 */
export function Sequence(animation: any, config: SequenceConfig = {}): any {
  return new SequenceAnimation(animation, config);
}

export class SequenceAnimation extends AnimationGroup {
  from: number;
  durationInFrames: number;
  fps: number;
  // Window as fractions of the total runTime, in [0, 1].
  windowStart: number;
  windowEnd: number;

  constructor(animation: any, config: SequenceConfig = {}) {
    const child = animation && animation._isAnimateBuilder ? animation.build() : animation;
    const fps = config.fps ?? 30;
    const from = config.from ?? 0;

    // Child's natural play length, in frames, defaults to durationInFrames or the
    // child's own runTime (seconds -> frames).
    const childSeconds = child?.runTime ?? 1;
    const durationInFrames = config.durationInFrames ?? Math.round(childSeconds * fps);

    // Total timeline length (seconds). Derive it so the window fits if not given.
    const fromSeconds = from / fps;
    const durSeconds = durationInFrames / fps;
    const total = config.runTime ?? fromSeconds + durSeconds;

    // Window as fractions of total runTime. Guard against a zero-length timeline.
    const safeTotal = total > 0 ? total : 1;
    const windowStart = Math.min(1, Math.max(0, fromSeconds / safeTotal));
    const windowEnd = Math.min(1, Math.max(windowStart, (fromSeconds + durSeconds) / safeTotal));

    // TIMING is expressed purely through the child's rate function: squish the
    // child's existing easing into the sub-window [windowStart, windowEnd] so it
    // holds func(0) before and func(1) after. PRESENTATION (what the child does)
    // is untouched. This keeps the two orthogonal.
    const baseRate: RateFunc = child.rateFunc;
    child.rateFunc = squishRateFunc(baseRate, windowStart, windowEnd);

    // Single-child group spanning the whole timeline (lagRatio 0, one child).
    super([child], { runTime: total });

    this.from = from;
    this.durationInFrames = durationInFrames;
    this.fps = fps;
    this.windowStart = windowStart;
    this.windowEnd = windowEnd;
  }

  // Drive the single child across the full [0,1] timeline. Because the child's
  // rate function is squished into [windowStart, windowEnd], the child freezes at
  // its start state before the window and at its end state after it. We bypass
  // the group's per-window local-alpha remap (which would clamp to [0,1] over the
  // child's timing entry) and hand the child the raw timeline alpha; the squish
  // does the windowing.
  interpolate(alpha: number): void {
    const t = Math.max(0, Math.min(1, alpha));
    // Single child; feed the whole-timeline alpha so squishRateFunc windows it.
    this.animations[0].interpolate(t);
  }
}
