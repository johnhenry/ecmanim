// Pose operators (epic #61, #67): pure functions over `Pose` following the
// concepts in Blender's publicly documented "In-Betweens" tools (Breakdowner,
// Blend to Neighbour, Relax, Push). Angles take the shortest arc.
// clean-room: implemented from Blender's manual and prose docs only.

import { wrapAngle } from "../mobject/skeleton_model.ts";
import type { Pose, BonePose } from "../mobject/skeleton_model.ts";
import type { KeyframeTrack } from "./keyframe_track.ts";

/** Unclamped a + (b - a) * t; t may be outside [0, 1] (extrapolation). */
function mix(a: number, b: number, t: number, arc: boolean): number {
  if (t === 0) return a;
  return a + (arc ? wrapAngle(b - a) : b - a) * t;
}

/** Unclamped blend of two poses; fields of `a` missing from `b` stay as in `a`. */
function mixPose(a: Pose, b: Pose, t: number): Pose {
  const bones: Record<string, BonePose> = {};
  for (const [id, x] of Object.entries(a.bones)) {
    const y = b.bones[id];
    bones[id] = y
      ? { angle: mix(x.angle, y.angle, t, true), length: mix(x.length, y.length, t, false), bend: mix(x.bend, y.bend, t, false) }
      : { ...x };
  }
  return {
    root: [mix(a.root[0], b.root[0], t, false), mix(a.root[1], b.root[1], t, false)],
    rotation: mix(a.rotation, b.rotation, t, true),
    scale: mix(a.scale, b.scale, t, false),
    bones,
  };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function floorZero(p: Pose): Pose {
  p.scale = Math.max(0, p.scale);
  for (const b of Object.values(p.bones)) b.length = Math.max(0, b.length);
  return p;
}

/** The pose at the playhead's proportional time between the neighbours. */
function inBetween(prev: Pose, next: Pose, tPrev: number, tCur: number, tNext: number): Pose {
  const span = tNext - tPrev;
  const u = span === 0 || !Number.isFinite(span) ? 0.5 : (tCur - tPrev) / span;
  return mixPose(prev, next, u);
}

/** Breakdown: `t` = 0 is `prev`, 1 is `next` (unclamped beyond that). */
export function breakdown(prev: Pose, next: Pose, t: number): Pose {
  if (t === 1) return mixPose(next, next, 0);
  return mixPose(prev, next, t);
}

/**
 * Blend to Neighbour: `amount` -1 is `prev`, 0 is `cur`, +1 is `next`
 * (clamped to [-1, 1]).
 */
export function blendToNeighbor(prev: Pose, cur: Pose, next: Pose, amount: number): Pose {
  const a = clamp(amount, -1, 1);
  return a < 0 ? mixPose(cur, prev, -a) : mixPose(cur, next, a);
}

/**
 * Relax: move `cur` toward the in-between of `prev`/`next` at `cur`'s
 * proportional time. `factor` 0 = unchanged, 1 = exactly the in-between.
 */
export function relax(prev: Pose, cur: Pose, next: Pose, tPrev: number, tCur: number, tNext: number, factor: number): Pose {
  return mixPose(cur, inBetween(prev, next, tPrev, tCur, tNext), factor);
}

/**
 * Push: reflect Relax's displacement to exaggerate `cur` away from the
 * in-between. `scale` and bone `length` stop at zero.
 */
export function push(prev: Pose, cur: Pose, next: Pose, tPrev: number, tCur: number, tNext: number, factor: number): Pose {
  return floorZero(mixPose(cur, inBetween(prev, next, tPrev, tCur, tNext), -factor));
}

export type PoseOpSpec =
  | { op: "blend"; amount: number }
  | { op: "relax"; amount: number }
  | { op: "push"; amount: number };

/**
 * Apply an operator to keyframe `index` of a pose track, using the strict
 * previous/next keys as neighbours. Replaces that key's value and returns it.
 */
export function applyPoseOp(track: KeyframeTrack<Pose>, index: number, spec: PoseOpSpec): Pose {
  const kfs = track.keyframes;
  const prev = kfs[index - 1], cur = kfs[index], next = kfs[index + 1];
  if (!cur || !prev || !next) throw new Error(`applyPoseOp: key ${index} needs a previous and next neighbor key`);
  const out = spec.op === "blend"
    ? blendToNeighbor(prev.value, cur.value, next.value, spec.amount)
    : spec.op === "relax"
      ? relax(prev.value, cur.value, next.value, prev.t, cur.t, next.t, spec.amount)
      : push(prev.value, cur.value, next.value, prev.t, cur.t, next.t, spec.amount);
  cur.value = out;
  return out;
}

/** Insert a new key at time `t` as a Breakdown (`amount` 0 = prev, 1 = next) of the surrounding keys. */
export function insertBreakdown(track: KeyframeTrack<Pose>, t: number, amount = 0.5): Pose {
  const kfs = track.keyframes;
  let i = -1;
  for (let k = 0; k < kfs.length; k++) if (kfs[k].t < t) i = k;
  const prev = kfs[i], next = kfs[i + 1];
  if (!prev || !next || !(next.t > t)) throw new Error(`insertBreakdown: time ${t} needs a previous and next neighbor key`);
  const value = breakdown(prev.value, next.value, amount);
  track.addKeyframe({ t, value });
  return value;
}
