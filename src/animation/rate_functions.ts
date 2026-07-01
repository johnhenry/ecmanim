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

export function running(name: RateFunc | string): RateFunc {
  if (typeof name === "function") return name;
  // Built-ins first, then any plugin-registered rate function, else smooth.
  return RATE_FUNCTIONS[name] ?? registry.rateFunctions.get(name) ?? smooth;
}

export const RATE_FUNCTIONS: Record<string, RateFunc> = {
  linear, smooth, rushInto, rushFrom, slowInto, doubleSmooth,
  thereAndBack, thereAndBackWithPause,
  easeInSine, easeOutSine, easeInOutSine,
  easeInQuad, easeOutQuad, easeInOutQuad,
  easeInCubic, easeOutCubic, easeInOutCubic,
};
