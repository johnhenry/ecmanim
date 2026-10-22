// Poses and pose tweening (epic #61, child #64). The `Pose` value type and the
// pure `lerpPose` live in mobject/skeleton_model.ts (so the pure model has no
// dependency on the animation layer) and are re-exported here.

import { Animation } from "./Animation.ts";
import type { AnimationConfig } from "./Animation.ts";
import { KeyframeTrack } from "./keyframe_track.ts";
import type { Keyframe, KeyframeTrackOptions } from "./keyframe_track.ts";
import { lerpPose } from "../mobject/skeleton_model.ts";
import type { Pose, PartialPose } from "../mobject/skeleton_model.ts";

export { lerpPose } from "../mobject/skeleton_model.ts";
export type { Pose, PartialPose, BonePose } from "../mobject/skeleton_model.ts";

/** Anything poseable: a `Skeleton`, or any object with this pair of methods. */
export interface PoseTarget {
  getPose(): Pose;
  setPose(pose: PartialPose): unknown;
}

/** Anything with a `solve()` that drives the posed object (an `IKChain`). */
export interface PoseTweenIK { solve(): unknown; ikFingerprint?(): string }

export interface PoseTweenConfig extends AnimationConfig {
  /**
   * IK chain(s) to re-solve after every pose write during the tween, so IK
   * stays live although `Scene.play` suspends the skeleton's updaters. Default:
   * none (unchanged behaviour).
   */
  ik?: PoseTweenIK | PoseTweenIK[];
}

/** A name -> pose map. Poses may be partial (e.g. "only the arms"). */
export class PoseLibrary {
  private _poses = new Map<string, PartialPose>();

  constructor(poses: Record<string, PartialPose> = {}) {
    for (const [k, v] of Object.entries(poses)) this.set(k, v);
  }

  set(name: string, pose: PartialPose): this { this._poses.set(name, structuredClone(pose)); return this; }
  has(name: string): boolean { return this._poses.has(name); }
  names(): string[] { return [...this._poses.keys()]; }
  delete(name: string): boolean { return this._poses.delete(name); }
  /** A copy of the named pose (undefined if absent). */
  get(name: string): PartialPose | undefined {
    const p = this._poses.get(name);
    return p ? structuredClone(p) : undefined;
  }
  /** Store the target's CURRENT pose under `name`. */
  capture(name: string, target: PoseTarget): this { return this.set(name, target.getPose()); }
  /** Apply the named pose immediately. */
  apply(target: PoseTarget, name: string): void { target.setPose(this._require(name)); }
  /** A PoseTween to the named pose. */
  tween(target: PoseTarget, name: string, config: AnimationConfig = {}): PoseTween {
    return new PoseTween(target, this._require(name), config);
  }
  clone(): PoseLibrary { return new PoseLibrary(Object.fromEntries(this._poses)); }
  toJSON(): Record<string, PartialPose> { return Object.fromEntries([...this._poses].map(([k, v]) => [k, structuredClone(v)])); }
  static fromJSON(json: Record<string, PartialPose>): PoseLibrary { return new PoseLibrary(json); }

  private _require(name: string): PartialPose {
    const p = this._poses.get(name);
    if (!p) throw new Error(`PoseLibrary: unknown pose "${name}" (have: ${this.names().join(", ") || "none"})`);
    return p;
  }
}

/**
 * Tween a poseable object from its CURRENT pose to `target` (a full or partial
 * Pose; absent fields hold their starting value). Blends with `lerpPose`
 * (shortest-arc angles; joint points are never lerped), so limb lengths hold.
 *
 * Modelled on PlayKeyframeTrack.begin(): it skips the default whole-mobject
 * `copy()` start-state snapshot, since only the pose is read.
 */
export class PoseTween extends Animation {
  target: PartialPose;
  /** IK chains re-solved after every pose write (see `PoseTweenConfig.ik`). */
  ik: PoseTweenIK[];
  startPose!: Pose;
  endPose!: Pose;

  constructor(mobject: PoseTarget, target: PartialPose, config: PoseTweenConfig = {}) {
    super(mobject as any, config);
    this.target = target;
    this.ik = config.ik === undefined ? [] : Array.isArray(config.ik) ? config.ik : [config.ik];
  }

  /** Cache-key salt: the tween's target pose and any IK it drives. */
  _hashExtra(): string {
    return JSON.stringify(this.target) + this.ik.map((c) => c.ikFingerprint?.() ?? "ik").join("|");
  }

  begin(): this {
    this.started = true;
    const m = this.mobject as PoseTarget;
    this.startPose = m.getPose();
    // Resolve the (possibly partial) target against the start pose once.
    this.endPose = lerpPose(this.startPose, mergePose(this.startPose, this.target), 1);
    this.setup();
    this.interpolate(0);
    return this;
  }

  interpolateMobject(alpha: number): void {
    (this.mobject as PoseTarget).setPose(lerpPose(this.startPose, this.endPose, alpha));
    // IK wins over the FK pose for the bones it drives, even though Scene.play
    // has suspended the skeleton's updaters (so an attached IKChain would freeze).
    for (const c of this.ik) c.solve();
  }
}

function mergePose(base: Pose, over: PartialPose): Pose {
  const bones: Pose["bones"] = {};
  for (const [id, b] of Object.entries(base.bones)) bones[id] = { ...b, ...(over.bones?.[id] ?? {}) };
  return {
    root: over.root ? [over.root[0], over.root[1]] : [base.root[0], base.root[1]],
    rotation: over.rotation ?? base.rotation,
    scale: over.scale ?? base.scale,
    bones,
  };
}

/**
 * A `KeyframeTrack<Pose>`: the track's existing `interpolate` option set to
 * `lerpPose`. Sample with `track.valueAt(t)`, bind with
 * `skeleton.bindPoseTrack(track)` + `setTime(t)`, or play it with
 * `PlayKeyframeTrack(skeleton, track, (m, p) => m.setPose(p))`.
 */
export function poseTrack<P extends PartialPose = Pose>(
  keyframes: Keyframe<P>[],
  options: Omit<KeyframeTrackOptions<P>, "interpolate"> = {},
): KeyframeTrack<P> {
  return new KeyframeTrack<P>(keyframes, { ...options, interpolate: lerpPose as unknown as (a: P, b: P, t: number) => P });
}
