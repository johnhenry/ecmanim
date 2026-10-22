// Per-keyframe OUTGOING easing for KeyframeTrack (epic #61, #65).
//
// Internal module (not re-exported from the package root): KeyframeTrack.valueAt
// consults it only when a segment opts in through `Keyframe.easeOut` or
// `KeyframeTrackOptions.easeMode`. Segments that opt into nothing never reach
// this file, so existing tracks sample byte-identically.
//
// "auto" is a monotone cubic Hermite spline using the public Fritsch-Carlson /
// Fritsch-Butland construction: tangents at a key shared by two consecutive
// auto segments are the duration-weighted harmonic mean of the two secant
// slopes (zero at flat spans and direction reversals), and the ends of an auto
// run have zero tangent (ease from / to rest). That guarantees the curve never
// leaves the [min, max] of its segment endpoints, and two isolated keys reduce
// to smoothstep.

import { linear, easeInCubic, easeOutCubic, smoothstep, running } from "./rate_functions.ts";
import type { RateFunc } from "../core/types.ts";

export type OutgoingMode =
  | { kind: "auto" }
  | { kind: "hold" }
  | { kind: "rate"; fn: RateFunc };

/** Resolves a `Keyframe.easeOut`-style value to a segment mode. */
export function resolveOutgoing(spec: RateFunc | string): OutgoingMode {
  if (typeof spec === "function") return { kind: "rate", fn: spec };
  switch (spec) {
    case "auto": return { kind: "auto" };
    case "hold": return { kind: "hold" };
    case "linear": return { kind: "rate", fn: linear };
    case "easeIn": return { kind: "rate", fn: easeInCubic };
    case "easeOut": return { kind: "rate", fn: easeOutCubic };
    default: return { kind: "rate", fn: running(spec) };
  }
}

/** Duration-weighted harmonic mean of two secant slopes (0 if signs differ / either is 0). */
function harmonicTangent(dLeft: number, dRight: number, hLeft: number, hRight: number): number {
  if (!(dLeft * dRight > 0)) return 0;
  const w1 = 2 * hRight + hLeft;
  const w2 = hRight + 2 * hLeft;
  return (w1 + w2) / (w1 / dLeft + w2 / dRight);
}

/**
 * Monotone-cubic value of one numeric component on the segment (t0,v0)->(t1,v1)
 * at time `t`. `prev` / `next` are the neighbouring keys of the SAME auto run
 * (omit when the neighbouring segment is not auto, or does not exist).
 */
export function autoComponent(
  t: number,
  t0: number, v0: number,
  t1: number, v1: number,
  prev?: { t: number; v: number },
  next?: { t: number; v: number },
): number {
  const h = t1 - t0;
  if (!(h > 0)) return v1;
  const d = (v1 - v0) / h;
  let m0 = 0;
  let m1 = 0;
  if (prev && t0 - prev.t > 0) {
    const hp = t0 - prev.t;
    m0 = harmonicTangent((v0 - prev.v) / hp, d, hp, h);
  }
  if (next && next.t - t1 > 0) {
    const hn = next.t - t1;
    m1 = harmonicTangent(d, (next.v - v1) / hn, h, hn);
  }
  const s = Math.max(0, Math.min(1, (t - t0) / h));
  const s2 = s * s;
  const s3 = s2 * s;
  const v =
    (2 * s3 - 3 * s2 + 1) * v0 +
    (s3 - 2 * s2 + s) * h * m0 +
    (-2 * s3 + 3 * s2) * v1 +
    (s3 - s2) * h * m1;
  // The tangents above already guarantee monotonicity; clamp absorbs rounding.
  return Math.max(Math.min(v0, v1), Math.min(Math.max(v0, v1), v));
}

/** Smoothstep alpha used by auto on non-numeric (custom-interpolated) tracks. */
export function autoFallbackAlpha(rawAlpha: number): number {
  return smoothstep(rawAlpha);
}
