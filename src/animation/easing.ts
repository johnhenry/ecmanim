// Remotion-style composable easing combinators.
//
// This module is intentionally independent of rate_functions.ts: every
// combinator operates on ANY base easing function passed as an argument, so it
// can be composed with the library's built-in rate functions or arbitrary
// user-supplied curves alike.

import type { RateFunc } from "../core/types.ts";

/** An easing function maps t in [0,1] to eased progress. Structurally identical to RateFunc. */
export type EaseFn = RateFunc;

// --- cubic-bezier timing function (CSS cubic-bezier / Remotion Easing.bezier) ---
//
// Standard UnitBezier / bezier-easing algorithm. Given control points
// (x1,y1) and (x2,y2) — the endpoints are fixed at (0,0) and (1,1) — build a
// timing function y = f(x) for x in [0,1]. For a given x we solve for the
// bezier parameter s such that the x-component equals x (Newton-Raphson with a
// bisection fallback), then evaluate the y-component at that s.

const NEWTON_ITERATIONS = 4;
const NEWTON_MIN_SLOPE = 0.001;
const SUBDIVISION_PRECISION = 0.0000001;
const SUBDIVISION_MAX_ITERATIONS = 10;

function A(a1: number, a2: number): number {
  return 1.0 - 3.0 * a2 + 3.0 * a1;
}
function B(a1: number, a2: number): number {
  return 3.0 * a2 - 6.0 * a1;
}
function C(a1: number): number {
  return 3.0 * a1;
}

/** Evaluate a 1D cubic bezier component at parameter t with control values a1,a2. */
function calcBezier(t: number, a1: number, a2: number): number {
  return ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
}

/** Derivative of the 1D cubic bezier component at parameter t. */
function getSlope(t: number, a1: number, a2: number): number {
  return 3.0 * A(a1, a2) * t * t + 2.0 * B(a1, a2) * t + C(a1);
}

function binarySubdivide(x: number, a: number, b: number, x1: number, x2: number): number {
  let currentX: number;
  let currentT: number;
  let i = 0;
  do {
    currentT = a + (b - a) / 2.0;
    currentX = calcBezier(currentT, x1, x2) - x;
    if (currentX > 0.0) {
      b = currentT;
    } else {
      a = currentT;
    }
  } while (Math.abs(currentX) > SUBDIVISION_PRECISION && ++i < SUBDIVISION_MAX_ITERATIONS);
  return currentT;
}

function newtonRaphsonIterate(x: number, guessT: number, x1: number, x2: number): number {
  for (let i = 0; i < NEWTON_ITERATIONS; ++i) {
    const currentSlope = getSlope(guessT, x1, x2);
    if (currentSlope === 0.0) {
      return guessT;
    }
    const currentX = calcBezier(guessT, x1, x2) - x;
    guessT -= currentX / currentSlope;
  }
  return guessT;
}

function bezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  // Linear identity fast-path (also keeps y === x exactly).
  if (x1 === y1 && x2 === y2) {
    return (t: number) => t;
  }

  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;

    // Find the bezier parameter s for which the x-component equals t.
    const guessT = t;
    const initialSlope = getSlope(guessT, x1, x2);
    let s: number;
    if (initialSlope >= NEWTON_MIN_SLOPE) {
      s = newtonRaphsonIterate(t, guessT, x1, x2);
    } else if (initialSlope === 0.0) {
      s = guessT;
    } else {
      s = binarySubdivide(t, 0.0, 1.0, x1, x2);
    }
    return calcBezier(s, y1, y2);
  };
}

// --- combinators ---

/** Ease-in: use the base curve directly. */
const easeIn = (fn: EaseFn): EaseFn => (t: number) => fn(t);

/** Ease-out: mirror the base curve. */
const easeOut = (fn: EaseFn): EaseFn => (t: number) => 1 - fn(1 - t);

/** Ease-in-out: base curve on the first half, mirrored on the second half. */
const easeInOut = (fn: EaseFn): EaseFn => (t: number) =>
  t < 0.5 ? fn(2 * t) / 2 : 1 - fn(2 - 2 * t) / 2;

// --- convenience base curves ---

const linear: EaseFn = (t) => t;
const quad: EaseFn = (t) => t * t;
const cubic: EaseFn = (t) => t * t * t;
const poly = (n: number): EaseFn => (t) => Math.pow(t, n);
const sin: EaseFn = (t) => 1 - Math.cos((t * Math.PI) / 2);
const circle: EaseFn = (t) => 1 - Math.sqrt(1 - t * t);
const exp: EaseFn = (t) => Math.pow(2, 10 * (t - 1));

export const Easing: {
  in: (fn: EaseFn) => EaseFn;
  out: (fn: EaseFn) => EaseFn;
  inOut: (fn: EaseFn) => EaseFn;
  bezier: (x1: number, y1: number, x2: number, y2: number) => EaseFn;
  linear: EaseFn;
  quad: EaseFn;
  cubic: EaseFn;
  poly: (n: number) => EaseFn;
  sin: EaseFn;
  circle: EaseFn;
  exp: EaseFn;
} = {
  in: easeIn,
  out: easeOut,
  inOut: easeInOut,
  bezier,
  linear,
  quad,
  cubic,
  poly,
  sin,
  circle,
  exp,
};
