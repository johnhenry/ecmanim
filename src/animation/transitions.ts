// F6 (Part B): mobject-level transition catalogue.
//
// A transition moves the scene from an OUTGOING mobject `a` to an INCOMING
// mobject `b`. The design goal is to keep TIMING orthogonal to PRESENTATION:
//
//   - PRESENTATION = which primitive animations run and in which visual style
//     (fade? slide? directional wipe?). This is what distinguishes crossFade
//     from slide from wipe.
//   - TIMING = when each side's window opens/closes, its total runTime, and its
//     easing. This is expressed uniformly through `runTime`, `rateFunc`, and
//     `overlap`, and is applied identically regardless of the presentation.
//
// Concretely: every transition builds the SAME kind of AnimationGroup, and the
// only timing knob is `overlap`, which is turned into a pair of sub-windows via
// `squishRateFunc` (outgoing plays in the early part, incoming in the late part,
// with `overlap` controlling how much they share). Swapping the presentation
// (fade vs slide) never touches the windowing code below.
//
// Names deliberately avoid the existing `Swap` class in transform_extra.ts.

import { AnimationGroup } from "./composition.ts";
import { FadeIn, FadeOut, ApplyMethod } from "./Animation.ts";
import { squishRateFunc, smooth } from "./rate_functions.ts";
import type { RateFunc } from "../core/types.ts";

export interface TransitionConfig {
  runTime?: number;
  rateFunc?: (t: number) => number;
  direction?: [number, number, number];
  overlap?: number; // 0 = strict A-then-B; 1 = fully simultaneous
}

// --- TIMING helper (presentation-agnostic) ---------------------------------
// Given an `overlap` in [0,1], returns the [start,end] sub-windows for the
// outgoing and incoming sides. overlap=1 -> both span the full [0,1] (fully
// simultaneous). overlap=0 -> outgoing in [0,0.5], incoming in [0.5,1] (fully
// sequential). Intermediate values share a middle band.
function overlapWindows(overlap: number): {
  out: [number, number];
  in: [number, number];
} {
  const o = Math.max(0, Math.min(1, overlap));
  // Half-width of each side's window. At o=1 each side is full-width [0,1].
  // At o=0 each side is half-width and disjoint.
  const half = 0.5 + o * 0.5; // in [0.5, 1]
  const outStart = 0;
  const outEnd = half;
  const inStart = 1 - half;
  const inEnd = 1;
  return { out: [outStart, outEnd], in: [inStart, inEnd] };
}

// Squish a child's easing into a sub-window so it freezes at its start value
// before the window and its end value after it. This is the ONLY place timing
// windows touch an animation; presentation code just supplies the animations.
function windowRate(base: RateFunc, [a, b]: [number, number]): RateFunc {
  return squishRateFunc(base, a, b);
}

// Build the group: apply the shared rateFunc as each child's base easing, then
// squish outgoing into the early window and incoming into the late window.
function buildTransition(
  outgoing: any,
  incoming: any,
  config: TransitionConfig,
): AnimationGroup {
  const runTime = config.runTime ?? 1;
  const base: RateFunc = config.rateFunc ?? smooth;
  const overlap = config.overlap ?? 1;
  const { out, in: inW } = overlapWindows(overlap);

  outgoing.runTime = runTime;
  incoming.runTime = runTime;
  outgoing.rateFunc = windowRate(base, out);
  incoming.rateFunc = windowRate(base, inW);

  // lagRatio 0: both children share the full [0,1]; each child's own squished
  // rate function is what stages them. This keeps the group dumb about timing.
  return new AnimationGroup([outgoing, incoming], { runTime });
}

// --- crossFade -------------------------------------------------------------
// PRESENTATION: `a` fades out, `b` fades in. No movement.
export function crossFade(a: any, b: any, config: TransitionConfig = {}): any {
  const outgoing = new FadeOut(a);
  const incoming = new FadeIn(b);
  return buildTransition(outgoing, incoming, config);
}

// --- slide -----------------------------------------------------------------
// PRESENTATION: `b` slides IN from `direction`, `a` slides OUT the opposite way.
// `b` starts offset by `-direction` and moves to its home; `a` moves off by
// `+direction`. Timing/overlap handled identically to crossFade.
export function slide(a: any, b: any, config: TransitionConfig = {}): any {
  const dir = config.direction ?? [4, 0, 0];
  const neg: [number, number, number] = [-dir[0], -dir[1], -dir[2]];

  // Incoming `b`: place it offset by -dir now, then animate a shift back by +dir
  // (net: ends at its original home).
  b.shift(neg);
  const incoming = new ApplyMethod(b, "shift", dir as number[]);

  // Outgoing `a`: shift away by +dir.
  const outgoing = new ApplyMethod(a, "shift", dir as number[]);

  return buildTransition(outgoing, incoming, config);
}

// --- wipe ------------------------------------------------------------------
// PRESENTATION: a directional reveal. `b` slides in from `direction` (like slide)
// while `a` both fades AND shifts out — a softer directional hand-off. Timing is
// identical; only the composition of primitive animations differs.
export function wipe(a: any, b: any, config: TransitionConfig = {}): any {
  const dir = config.direction ?? [4, 0, 0];
  const neg: [number, number, number] = [-dir[0], -dir[1], -dir[2]];

  // Incoming `b`: slide in from the -dir side.
  b.shift(neg);
  const incoming = new ApplyMethod(b, "shift", dir as number[]);

  // Outgoing `a`: fade out while drifting by +dir (FadeOut supports a `shift`).
  const outgoing = new FadeOut(a, { shift: dir as number[] });

  return buildTransition(outgoing, incoming, config);
}

// Optional class aliases (do NOT collide with transform_extra.ts `Swap`).
export class Slide extends AnimationGroup {
  constructor(a: any, b: any, config: TransitionConfig = {}) {
    const g = slide(a, b, config) as AnimationGroup;
    super(g.animations, { runTime: g.runTime });
  }
}
export class Wipe extends AnimationGroup {
  constructor(a: any, b: any, config: TransitionConfig = {}) {
    const g = wipe(a, b, config) as AnimationGroup;
    super(g.animations, { runTime: g.runTime });
  }
}
