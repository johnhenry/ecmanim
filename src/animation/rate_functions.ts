// Rate functions map animation progress t in [0,1] to eased progress in [0,1].
// Names mirror manim.utils.rate_functions.

import type { RateFunc } from "../core/types.ts";
import { registry } from "../plugins/registry.ts";

export const linear = (t: number): number => t;

export function smooth(t: number, inflection = 10): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const error = sigmoid(-inflection / 2);
  return Math.min(Math.max((sigmoid(inflection * (t - 0.5)) - error) / (1 - 2 * error), 0), 1);
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export const rushInto = (t: number): number => 2 * smooth(t / 2);
export const rushFrom = (t: number): number => 2 * smooth(t / 2 + 0.5) - 1;
export const slowInto = (t: number): number => Math.sqrt(1 - (1 - t) * (1 - t));
export const doubleSmooth = (t: number): number => (t < 0.5 ? 0.5 * smooth(2 * t) : 0.5 * (1 + smooth(2 * t - 1)));

export const thereAndBack = (t: number, inflection = 10): number => {
  const s = t < 0.5 ? 2 * t : 2 * (1 - t);
  return smooth(s, inflection);
};

export const thereAndBackWithPause = (t: number, pauseRatio = 1 / 3): number => {
  const a = 1 / pauseRatio;
  if (t < 0.5 - pauseRatio / 2) return smooth(a * t);
  if (t < 0.5 + pauseRatio / 2) return 1;
  return smooth(a - a * t);
};

export const easeInSine = (t: number): number => 1 - Math.cos((t * Math.PI) / 2);
export const easeOutSine = (t: number): number => Math.sin((t * Math.PI) / 2);
export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeInQuad = (t: number): number => t * t;
export const easeOutQuad = (t: number): number => 1 - (1 - t) * (1 - t);
export const easeInOutQuad = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeInCubic = (t: number): number => t * t * t;
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export const thereAndBackClamp = thereAndBack;

// ---------------------------------------------------------------------------
// Clamp helpers (manim's @unit_interval / @zero decorators). unitInterval wraps
// a rate func so its output is clamped to [0, 1]; zero clamps to >= 0.
// ---------------------------------------------------------------------------

/** Wrap a rate func so its output is clamped to the unit interval [0, 1]. */
export const unitInterval = (func: RateFunc): RateFunc => (t: number): number =>
  Math.min(Math.max(func(t), 0), 1);

/** Wrap a rate func so its output is clamped to be non-negative (>= 0). */
export const zero = (func: RateFunc): RateFunc => (t: number): number => Math.max(func(t), 0);

// ---------------------------------------------------------------------------
// Smoothstep family (Perlin). Each is 0 at t<=0 and 1 at t>=1.
// ---------------------------------------------------------------------------

/** Classic Hermite smoothstep: 3t^2 - 2t^3, clamped to [0, 1]. */
export function smoothstep(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/** Ken Perlin's smootherstep: 6t^5 - 15t^4 + 10t^3, clamped to [0, 1]. */
export function smootherstep(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * t * (t * (6 * t - 15) + 10);
}

/** Higher-order smoothstep (7th order): -20t^7 + 70t^6 - 84t^5 + 35t^4. */
export function smoothererstep(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 35 * t ** 4 - 84 * t ** 5 + 70 * t ** 6 - 20 * t ** 7;
}

// ---------------------------------------------------------------------------
// Assorted manim rate functions.
// ---------------------------------------------------------------------------

/** Overshoots forward before settling. pullFactor < 0 dips below zero first. */
export function runningStart(t: number, pullFactor = -0.5): number {
  // Bezier through [0, 0, pullFactor, pullFactor, 1] evaluated at t.
  const points = [0, 0, pullFactor, pullFactor, 1];
  const n = points.length - 1;
  let result = 0;
  for (let i = 0; i <= n; i++) {
    result += points[i] * binomial(n, i) * (1 - t) ** (n - i) * t ** i;
  }
  return result;
}

function binomial(n: number, k: number): number {
  let result = 1;
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
  return result;
}

/** Applies `func` but never quite reaches 1 (scaled to `proportion` of the way). */
export function notQuiteThere(func: RateFunc = smooth, proportion = 0.7): RateFunc {
  return (t: number): number => func(t) * proportion;
}

/** Oscillates `wiggles` times, returning to 0 at t=0 and t=1. */
export function wiggle(t: number, wiggles = 2): number {
  return thereAndBack(t) * Math.sin(wiggles * Math.PI * t);
}

/** Rushes to 1 and lingers there (never fully reaching 1 until the end). */
export function lingering(t: number): number {
  return squishRateFunc((x: number) => x, 0, 0.8)(t);
}

/** Exponential decay from 1 towards 0, normalized so f(0)=0, growing to ~1. */
export function exponentialDecay(t: number, halfLife = 0.1): number {
  // The half-life should be rather small to minimize the cut-off error at t=1.
  return 1 - Math.exp(-t / halfLife);
}

// ---------------------------------------------------------------------------
// Higher-order combinator: squish a rate func into the sub-interval [a, b].
// ---------------------------------------------------------------------------

/**
 * Returns a rate func that runs `func` compressed into [a, b]: it holds
 * func(0) before a, func(1) after b, and maps [a, b] onto func's [0, 1].
 */
export function squishRateFunc(func: RateFunc, a = 0.4, b = 0.6): RateFunc {
  return (t: number): number => {
    if (a === b) return a;
    if (t < a) return func(0);
    if (t > b) return func(1);
    return func((t - a) / (b - a));
  };
}

// ---------------------------------------------------------------------------
// Robert Penner easing families: Quart, Quint, Expo, Circ, Back, Elastic,
// Bounce (in / out / inOut for each), matching manim's rate_functions.
// ---------------------------------------------------------------------------

export const easeInQuart = (t: number): number => t * t * t * t;
export const easeOutQuart = (t: number): number => 1 - Math.pow(1 - t, 4);
export const easeInOutQuart = (t: number): number =>
  t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;

export const easeInQuint = (t: number): number => t * t * t * t * t;
export const easeOutQuint = (t: number): number => 1 - Math.pow(1 - t, 5);
export const easeInOutQuint = (t: number): number =>
  t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;

export const easeInExpo = (t: number): number => (t === 0 ? 0 : Math.pow(2, 10 * t - 10));
export const easeOutExpo = (t: number): number => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInOutExpo = (t: number): number => {
  if (t === 0) return 0;
  if (t === 1) return 1;
  return t < 0.5
    ? Math.pow(2, 20 * t - 10) / 2
    : (2 - Math.pow(2, -20 * t + 10)) / 2;
};

export const easeInCirc = (t: number): number => 1 - Math.sqrt(1 - Math.pow(t, 2));
export const easeOutCirc = (t: number): number => Math.sqrt(1 - Math.pow(t - 1, 2));
export const easeInOutCirc = (t: number): number =>
  t < 0.5
    ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
    : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2;

const C1 = 1.70158;

// Parameterized "back" ease factories (GSAP's back.in/out/inOut(overshoot)
// ergonomic) -- these are the exact same formula the plain exports below
// already used, just with the overshoot constant exposed as an argument
// instead of hardcoded, so the default-argument call collapses to byte-
// identical output.
export function easeInBackFactory(overshoot = C1): RateFunc {
  const c3 = overshoot + 1;
  return (t: number) => c3 * t * t * t - overshoot * t * t;
}
export function easeOutBackFactory(overshoot = C1): RateFunc {
  const c3 = overshoot + 1;
  return (t: number) => 1 + c3 * Math.pow(t - 1, 3) + overshoot * Math.pow(t - 1, 2);
}
export function easeInOutBackFactory(overshoot = C1): RateFunc {
  const c2 = overshoot * 1.525;
  return (t: number) =>
    t < 0.5
      ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
}

export const easeInBack: RateFunc = easeInBackFactory();
export const easeOutBack: RateFunc = easeOutBackFactory();
export const easeInOutBack: RateFunc = easeInOutBackFactory();

const C4 = (2 * Math.PI) / 3;
const C5 = (2 * Math.PI) / 4.5;
const DEFAULT_AMPLITUDE = 1;
const DEFAULT_PERIOD = 0.3;

// Parameterized "elastic" ease factories (GSAP's elastic.in/out/inOut
// (amplitude, period) ergonomic). Safe fast path: at the exact defaults,
// return the existing hardcoded function unchanged (same constants, zero
// floating-point-drift risk) -- the general GSAP-style amplitude/period
// formula below is only exercised for genuinely custom arguments, so there's
// no "should algebraically collapse" assumption to get subtly wrong.
export function easeInElasticFactory(amplitude = DEFAULT_AMPLITUDE, period = DEFAULT_PERIOD): RateFunc {
  if (amplitude === DEFAULT_AMPLITUDE && period === DEFAULT_PERIOD) return easeInElastic;
  const a = Math.max(1, amplitude);
  const s = amplitude < 1 ? period / 4 : (period / (2 * Math.PI)) * Math.asin(1 / a);
  return (t: number) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return -(a * Math.pow(2, 10 * (t - 1)) * Math.sin(((t - 1 - s) * 2 * Math.PI) / period));
  };
}
export function easeOutElasticFactory(amplitude = DEFAULT_AMPLITUDE, period = DEFAULT_PERIOD): RateFunc {
  if (amplitude === DEFAULT_AMPLITUDE && period === DEFAULT_PERIOD) return easeOutElastic;
  const a = Math.max(1, amplitude);
  const s = amplitude < 1 ? period / 4 : (period / (2 * Math.PI)) * Math.asin(1 / a);
  return (t: number) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return a * Math.pow(2, -10 * t) * Math.sin(((t - s) * 2 * Math.PI) / period) + 1;
  };
}
export function easeInOutElasticFactory(amplitude = DEFAULT_AMPLITUDE, period = DEFAULT_PERIOD): RateFunc {
  if (amplitude === DEFAULT_AMPLITUDE && period === DEFAULT_PERIOD) return easeInOutElastic;
  const a = Math.max(1, amplitude);
  const s = amplitude < 1 ? period / 4 : (period / (2 * Math.PI)) * Math.asin(1 / a);
  const p = period * 1.5;
  return (t: number) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    const tt = t * 2;
    if (tt < 1) return -0.5 * (a * Math.pow(2, 10 * (tt - 1)) * Math.sin(((tt - 1 - s) * 2 * Math.PI) / p));
    return a * Math.pow(2, -10 * (tt - 1)) * Math.sin(((tt - 1 - s) * 2 * Math.PI) / p) * 0.5 + 1;
  };
}

export const easeInElastic: RateFunc = (t: number): number => {
  if (t === 0) return 0;
  if (t === 1) return 1;
  return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * C4);
};
export const easeOutElastic: RateFunc = (t: number): number => {
  if (t === 0) return 0;
  if (t === 1) return 1;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * C4) + 1;
};
export const easeInOutElastic: RateFunc = (t: number): number => {
  if (t === 0) return 0;
  if (t === 1) return 1;
  return t < 0.5
    ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * C5)) / 2
    : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * C5)) / 2 + 1;
};

export const easeOutBounce = (t: number): number => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) {
    t -= 1.5 / d1;
    return n1 * t * t + 0.75;
  }
  if (t < 2.5 / d1) {
    t -= 2.25 / d1;
    return n1 * t * t + 0.9375;
  }
  t -= 2.625 / d1;
  return n1 * t * t + 0.984375;
};
export const easeInBounce = (t: number): number => 1 - easeOutBounce(1 - t);
export const easeInOutBounce = (t: number): number =>
  t < 0.5
    ? (1 - easeOutBounce(1 - 2 * t)) / 2
    : (1 + easeOutBounce(2 * t - 1)) / 2;

export function running(name: RateFunc | string): RateFunc {
  if (typeof name === "function") return name;
  // Registry first, then built-ins, else smooth. Flipping the old built-ins-
  // first precedence is safe: registerBuiltins() already copies every
  // RATE_FUNCTIONS entry into the registry, so for any built-in name both
  // resolve to the SAME function object -- this only changes behavior when a
  // plugin deliberately registers an override for a built-in name (new
  // capability, not a regression).
  const direct = registry.rateFunctions.get(name) ?? RATE_FUNCTIONS[name];
  if (direct) return direct;
  // Parameterized factory: "name:1,2" -> registry.rateFunctionFactories
  // .get("name")(1, 2). Lets a plugin-registered (or built-in, e.g. "spring"/
  // "bezier") factory be referenced anywhere a plain rate-function string is
  // accepted, without a bespoke per-factory config shape.
  const sep = name.indexOf(":");
  if (sep > 0) {
    const factory = registry.rateFunctionFactories.get(name.slice(0, sep));
    if (factory) {
      const args = name.slice(sep + 1).split(",").map(Number);
      return factory(...args);
    }
  }
  return smooth;
}

export const RATE_FUNCTIONS: Record<string, RateFunc> = {
  linear, smooth, rushInto, rushFrom, slowInto, doubleSmooth,
  thereAndBack, thereAndBackWithPause,
  smoothstep, smootherstep, smoothererstep,
  runningStart, wiggle, lingering, exponentialDecay,
  easeInSine, easeOutSine, easeInOutSine,
  easeInQuad, easeOutQuad, easeInOutQuad,
  easeInCubic, easeOutCubic, easeInOutCubic,
  easeInQuart, easeOutQuart, easeInOutQuart,
  easeInQuint, easeOutQuint, easeInOutQuint,
  easeInExpo, easeOutExpo, easeInOutExpo,
  easeInCirc, easeOutCirc, easeInOutCirc,
  easeInBack, easeOutBack, easeInOutBack,
  easeInElastic, easeOutElastic, easeInOutElastic,
  easeInBounce, easeOutBounce, easeInOutBounce,
};
