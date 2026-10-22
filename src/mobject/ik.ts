// Inverse kinematics for skeletons (epic #61, child #66).
//
// TWO LAYERS
//  1. Pure solvers (`solveTwoBone`, `solveFABRIK`): points/lengths in, points
//     out. No Mobject, no model, no hidden state; deterministic.
//  2. `IKChain`: binds a run of bones (root -> effector) of a `SkeletonModel` /
//     `Skeleton` to a target. It reads the model's joints, calls a solver and
//     WRITES DERIVED ANGLES back (`setWorldAngle`, plus `setLength` only when
//     stretching), then `skeleton.refresh()`. Bone lengths are preserved
//     unless `allowStretch` is on.
//
// CONVENTIONS (see skeleton_model.ts): radians, CCW, y-up, 2D. "left" means
// the middle joint (knee/elbow) sits on the counter-clockwise side of the
// root -> target direction; "right" is the mirror. Solvers work in WORLD units
// (model length * model scale); IKChain converts.
//
// BEND "auto" (our own design): keep the branch the limb is currently on.
// The current side is read from the pose (sign of cross(effector - root,
// mid - root)). When the limb is (numerically) straight there is no current
// side, so the chain falls back to the last side it saw while bent (initially
// `autoFallback`, default "left"). That memory is the only hidden state, so
// "auto" is path-dependent: scrubbing to an arbitrary time is only
// reproducible with an explicit "left"/"right" (or by baking).
//
// PLAY() / POSETWEEN: see docs/skeletal.md "Inverse kinematics". Summary:
// `attach()` installs an updater; Scene.play suspends updaters on the animated
// mobject, so IK freezes under a PoseTween unless the tween gets `{ ik: chain }`
// (it re-solves after every pose write -- recommended) or
// `suspendMobjectUpdating: false`.

import type { SkeletonModel } from "./skeleton_model.ts";
import type { Skeleton } from "./skeleton.ts";
import type { KeyframeTrack } from "../animation/keyframe_track.ts";

export type Vec2 = [number, number];
export type BendSide = "left" | "right" | "auto";

const EPS = 1e-12;

// --- pure solvers ------------------------------------------------------------

export interface TwoBoneResult {
  /** Middle joint (knee/elbow). */
  mid: Vec2;
  /** Effector position (the target when `reached`). */
  end: Vec2;
  /** True when the effector landed on the target. */
  reached: boolean;
  /** Uniform length multiplier applied (1 unless stretched). */
  scale: number;
  /** Lengths actually used: [l1, l2] * scale. */
  lengths: [number, number];
}

export interface TwoBoneOptions { allowStretch?: boolean }

/**
 * Analytic two-bone solve (law of cosines). Out of reach: a straight, fully
 * extended limb pointing at the target (or, with `allowStretch`, both bones
 * scaled by the same factor so the effector reaches it). Inside the minimum
 * reach |l1 - l2|: folded, effector stops at the minimum reach. A target on
 * the root uses direction +x, so the result is always finite.
 */
export function solveTwoBone(
  root: ArrayLike<number>, l1: number, l2: number, target: ArrayLike<number>,
  bendSide: "left" | "right" = "left", opts: TwoBoneOptions = {},
): TwoBoneResult {
  const rx = root[0], ry = root[1];
  const dx = target[0] - rx, dy = target[1] - ry;
  const d = Math.hypot(dx, dy);
  const ux = d > EPS ? dx / d : 1, uy = d > EPS ? dy / d : 0;
  let a = Math.max(0, l1), b = Math.max(0, l2);
  let scale = 1;
  let reached = true;
  const reach = a + b;
  if (d > reach + 1e-12) {
    if (opts.allowStretch && reach > EPS) { scale = d / reach; a *= scale; b *= scale; }
    else reached = false;
  }
  const minReach = Math.abs(a - b);
  if (d < minReach - 1e-12) reached = false;
  const dc = Math.min(Math.max(d, Math.abs(a - b)), a + b);
  const along = dc > EPS ? (dc * dc + a * a - b * b) / (2 * dc) : 0;
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  const sign = bendSide === "right" ? -1 : 1;
  const mid: Vec2 = [rx + ux * along - uy * h * sign, ry + uy * along + ux * h * sign];
  const end: Vec2 = [rx + ux * dc, ry + uy * dc];
  return { mid, end, reached, scale, lengths: [a, b] };
}

export interface FabrikOptions { iterations?: number; tolerance?: number; allowStretch?: boolean }
export interface FabrikResult {
  /** Solved joint positions (same count as the input; point 0 is the fixed root). */
  points: Vec2[];
  reached: boolean;
  /** Uniform length multiplier applied (1 unless stretched). */
  scale: number;
  /** FABRIK passes executed (0 for the out-of-reach straight-line case). */
  iterations: number;
  /** Final distance from the effector to the target. */
  error: number;
}

/**
 * FABRIK (forward and backward reaching IK) over joint `points` (root first)
 * and per-link `lengths` (points.length - 1). The root stays fixed. Up to
 * `iterations` (default 32) passes, stopping once the effector is within
 * `tolerance` (default 1e-4) of the target. Out of reach: a straight line
 * toward the target (stretched uniformly when `allowStretch`). Inputs are not
 * mutated; coincident points use direction +x so the result is deterministic.
 */
export function solveFABRIK(
  points: ArrayLike<number>[], lengths: number[], target: ArrayLike<number>, opts: FabrikOptions = {},
): FabrikResult {
  const n = points.length;
  if (n < 2 || lengths.length !== n - 1) throw new Error("solveFABRIK: need >= 2 points and points.length - 1 lengths");
  const iterations = opts.iterations ?? 32, tol = opts.tolerance ?? 1e-4;
  const root: Vec2 = [points[0][0], points[0][1]];
  const tx = target[0], ty = target[1];
  let lens = lengths.map((l) => Math.max(0, l));
  const total = lens.reduce((s, l) => s + l, 0);
  const d = Math.hypot(tx - root[0], ty - root[1]);
  let scale = 1;
  let p: Vec2[] = points.map((q) => [q[0], q[1]]);
  const finish = (reached: boolean, it: number): FabrikResult => ({
    points: p, reached, scale, iterations: it, error: Math.hypot(p[n - 1][0] - tx, p[n - 1][1] - ty),
  });

  if (d > total + 1e-12) {
    let reached = false;
    if (opts.allowStretch && total > EPS) { scale = d / total; lens = lens.map((l) => l * scale); reached = true; }
    const ux = d > EPS ? (tx - root[0]) / d : 1, uy = d > EPS ? (ty - root[1]) / d : 0;
    let acc = 0;
    p = p.map((_, i) => { if (i > 0) acc += lens[i - 1]; return [root[0] + ux * acc, root[1] + uy * acc] as Vec2; });
    return finish(reached, 0);
  }

  const step = (from: Vec2, toward: Vec2, len: number): Vec2 => {
    const vx = toward[0] - from[0], vy = toward[1] - from[1];
    const m = Math.hypot(vx, vy);
    const ux = m > EPS ? vx / m : 1, uy = m > EPS ? vy / m : 0;
    return [from[0] + ux * len, from[1] + uy * len];
  };
  let it = 0;
  while (it < iterations && Math.hypot(p[n - 1][0] - tx, p[n - 1][1] - ty) > tol) {
    it++;
    p[n - 1] = [tx, ty];
    for (let i = n - 2; i >= 0; i--) p[i] = step(p[i + 1], p[i], lens[i]);
    p[0] = [root[0], root[1]];
    for (let i = 1; i < n; i++) p[i] = step(p[i - 1], p[i], lens[i - 1]);
  }
  return finish(Math.hypot(p[n - 1][0] - tx, p[n - 1][1] - ty) <= tol, it);
}

// --- target adapters ---------------------------------------------------------

/** Anything `ikTarget` can turn into a `() => [x, y]` getter. */
export type IKTargetSource =
  | ArrayLike<number>
  | (() => ArrayLike<number>)
  | { getCenter(): ArrayLike<number> }
  | { track: KeyframeTrack<number[]>; time: () => number };

export type IKTargetFn = () => Vec2;

/**
 * Normalise a target source to a getter. Accepts a fixed point, a function
 * returning a point, any Mobject (its center: `Dot`, `ComplexValueTracker`,
 * ...), or `{ track, time }` to sample a `KeyframeTrack<number[]>` at a
 * caller-supplied time (e.g. `() => scene.time`).
 */
export function ikTarget(src: IKTargetSource): IKTargetFn {
  const s = src as any;
  if (typeof s === "function") return () => pt2(s());
  if (s && typeof s.getCenter === "function") return () => pt2(s.getCenter());
  if (s && s.track && typeof s.track.valueAt === "function" && typeof s.time === "function") {
    return () => pt2(s.track.valueAt(s.time()));
  }
  if (s && typeof s.length === "number" && s.length >= 2 && typeof s !== "string") {
    const p = pt2(s);
    return () => [p[0], p[1]];
  }
  throw new TypeError("ikTarget: expected a point, a () => point function, a Mobject, or { track, time }");
}

/** Target from two scalar `ValueTracker`s (anything with `getValue()`). */
export function ikTargetXY(x: { getValue(): number }, y: { getValue(): number }): IKTargetFn {
  return () => [x.getValue(), y.getValue()];
}

function pt2(p: ArrayLike<number>): Vec2 {
  const x = p?.[0], y = p?.[1];
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError(`IK target must be a finite [x, y] point (got ${String(p)})`);
  return [x, y];
}

// --- IKChain -----------------------------------------------------------------

export interface IKChainConfig {
  /** Bone ids from the chain root to the effector; each must be the child of the previous. */
  bones: string[];
  /** Where the effector (end of the last bone) should go (world space). */
  target: IKTargetSource;
  /** Which side the middle joint bends toward. Default "auto" (keep the current branch). */
  bendSide?: BendSide;
  /** Out of reach: uniformly stretch the chain instead of stopping at full extension. Default false. */
  allowStretch?: boolean;
  /** Authored (rest) bone lengths used by stretch; restored when back in reach. Default: lengths at construction. */
  restLengths?: Record<string, number>;
  /** FABRIK passes for chains longer than two bones. Default 32. */
  iterations?: number;
  /** FABRIK stop distance. Default 1e-4. */
  tolerance?: number;
  /** Side "auto" uses when the limb is straight and nothing has been seen yet. Default "left". */
  autoFallback?: "left" | "right";
}

export interface IKSolveResult {
  reached: boolean;
  /** Stretch factor applied (1 unless stretching). */
  scale: number;
  /** Distance from the effector to the target after solving. */
  error: number;
  /** Final effector world position. */
  effector: Vec2;
}

/** Anything a `PoseTween` can re-solve after each pose write. */
export interface IKSolver { solve(): unknown; ikFingerprint?(): string }

export class IKChain implements IKSolver {
  readonly bones: readonly string[];
  target: IKTargetFn;
  bendSide: BendSide;
  allowStretch: boolean;
  iterations: number;
  tolerance: number;
  autoFallback: "left" | "right";
  /** Last side seen while the limb was bent; used by "auto" when it is straight. */
  autoSide: "left" | "right";

  private _skeleton: Skeleton | null;
  private _model: SkeletonModel;
  private _rest: Record<string, number>;
  private _pin: Vec2 | null = null;
  private _updater: ((m: unknown, dt: number) => void) | null = null;

  /** `owner` is a `Skeleton` (geometry is refreshed after each solve) or a bare `SkeletonModel`. */
  constructor(owner: Skeleton | SkeletonModel, config: IKChainConfig) {
    const isSkel = !!owner && typeof (owner as Skeleton).refresh === "function" && !!(owner as Skeleton).model;
    this._skeleton = isSkel ? (owner as Skeleton) : null;
    this._model = isSkel ? (owner as Skeleton).model : (owner as SkeletonModel);
    const m = this._model;
    const bones = config.bones ?? [];
    if (bones.length === 0) throw new Error("IKChain: `bones` must list at least one bone id");
    for (let i = 0; i < bones.length; i++) {
      if (!m.has(bones[i])) throw new Error(`IKChain: unknown bone "${bones[i]}"`);
      if (i > 0 && m.parentOf(bones[i]) !== bones[i - 1]) {
        throw new Error(`IKChain: bone "${bones[i]}" must be a child of "${bones[i - 1]}" (its parent is ${String(m.parentOf(bones[i]))})`);
      }
    }
    this.bones = Object.freeze([...bones]);
    this.target = ikTarget(config.target);
    this.bendSide = config.bendSide ?? "auto";
    this.allowStretch = config.allowStretch ?? false;
    this.iterations = config.iterations ?? 32;
    this.tolerance = config.tolerance ?? 1e-4;
    this.autoFallback = config.autoFallback ?? "left";
    this.autoSide = this.autoFallback;
    this._rest = {};
    for (const id of bones) this._rest[id] = config.restLengths?.[id] ?? m.getLength(id);
  }

  /** Current world position of the effector (end of the last bone). */
  get effector(): Vec2 { return this._model.jointPosition(this.bones[this.bones.length - 1]); }
  get pinned(): boolean { return this._pin !== null; }

  /**
   * Plant the effector at a fixed WORLD position (default: where it is now).
   * While pinned the chain ignores `target` and keeps reaching for the pin as
   * the rest of the skeleton moves.
   */
  pin(position?: ArrayLike<number>): this {
    this._pin = position ? pt2(position) : this.effector;
    return this;
  }
  unpin(): this { this._pin = null; return this; }

  /** The point currently being reached for (the pin, else the target). */
  currentTarget(): Vec2 { return this._pin ? [this._pin[0], this._pin[1]] : this.target(); }

  /** Solve once against the model's current pose and write the result back. */
  solve(): IKSolveResult {
    const m = this._model, ids = this.bones;
    const sc = m.scale;
    const tgt = this.currentTarget();
    const n = ids.length;
    const lens = ids.map((id) => (this.allowStretch ? this._rest[id] : m.getLength(id)) * sc);
    const root = m.boneStart(ids[0]);
    if (!(sc > 0)) return { reached: false, scale: 1, error: Math.hypot(this.effector[0] - tgt[0], this.effector[1] - tgt[1]), effector: this.effector };

    let pts: Vec2[];
    let reached: boolean, scale: number;
    if (n === 2) {
      const side = this._resolveSide(root);
      const r = solveTwoBone(root, lens[0], lens[1], tgt, side, { allowStretch: this.allowStretch });
      pts = [root, r.mid, r.end]; reached = r.reached; scale = r.scale;
      if (Math.abs(cross(sub(r.mid, root), sub(r.end, root))) > 1e-9 * (lens[0] + lens[1]) ** 2) this.autoSide = side;
    } else {
      const cur: Vec2[] = [root, ...ids.map((id) => m.jointPosition(id))];
      const seeded = this._seedCollinear(cur, tgt);
      const r = solveFABRIK(seeded, lens, tgt, { iterations: this.iterations, tolerance: this.tolerance, allowStretch: this.allowStretch });
      pts = r.points; reached = r.reached; scale = r.scale;
    }

    // Write derived angles (root -> effector so each parent's world angle is current).
    for (let i = 0; i < n; i++) {
      const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
      if (Math.hypot(dx, dy) > EPS) m.setWorldAngle(ids[i], Math.atan2(dy, dx));
    }
    if (this.allowStretch) for (const id of ids) m.setLength(id, this._rest[id] * scale);
    this._skeleton?.refresh();
    const eff = this.effector;
    return { reached, scale, error: Math.hypot(eff[0] - tgt[0], eff[1] - tgt[1]), effector: eff };
  }

  /** Install an updater that re-solves every frame (see the PoseTween note in the header). */
  attach(): this {
    if (!this._skeleton) throw new Error("IKChain.attach(): needs a Skeleton (a bare SkeletonModel has no updaters)");
    if (this._updater) return this;
    this._updater = () => { this.solve(); };
    this._skeleton.addUpdater(this._updater as any, { hashExtra: () => this.ikFingerprint() });
    return this;
  }
  detach(): this {
    if (this._updater && this._skeleton) this._skeleton.removeUpdater(this._updater as any);
    this._updater = null;
    return this;
  }

  /** Hidden state for cache keys (partial-movie / wait fingerprints). */
  ikFingerprint(): string {
    const t = this.currentTarget();
    const cs = this._skeleton?.constraints;
    const rig = cs && cs.size > 0 ? `:rig[${cs.fingerprint()}]` : "";
    return `ik:${this.bones.join(">")}:${t[0].toFixed(5)},${t[1].toFixed(5)}:${this._pin ? "pin" : "free"}:${this.bendSide}:${this.autoSide}:${this.allowStretch ? 1 : 0}${rig}`;
  }

  // --- internals --------------------------------------------------------------
  private _resolveSide(root: Vec2): "left" | "right" {
    if (this.bendSide === "left" || this.bendSide === "right") return this.bendSide;
    const m = this._model, [a, b] = this.bones;
    const mid = m.jointPosition(a), end = m.jointPosition(b);
    const c = cross(sub(end, root), sub(mid, root));
    const scale = Math.hypot(end[0] - root[0], end[1] - root[1]) * Math.hypot(mid[0] - root[0], mid[1] - root[1]);
    if (scale > EPS && Math.abs(c) > 1e-7 * scale) return c > 0 ? "left" : "right";
    return this.autoSide;
  }

  /** FABRIK cannot leave a perfectly straight line on its own; nudge interior joints to the requested side. */
  private _seedCollinear(cur: Vec2[], tgt: Vec2): Vec2[] {
    const root = cur[0], end = cur[cur.length - 1];
    const span = Math.hypot(end[0] - root[0], end[1] - root[1]);
    if (span < EPS) return cur;
    const dx = (end[0] - root[0]) / span, dy = (end[1] - root[1]) / span;
    const straight = cur.slice(1, -1).every((p) => Math.abs(dx * (p[1] - root[1]) - dy * (p[0] - root[0])) < 1e-9 * span);
    if (!straight) return cur;
    const side = this.bendSide === "auto" ? this.autoSide : this.bendSide;
    const sign = side === "right" ? -1 : 1;
    const eps = 1e-3 * span;
    return cur.map((p, i) => (i === 0 || i === cur.length - 1) ? p : [p[0] - dy * eps * sign, p[1] + dx * eps * sign] as Vec2);
  }
}

function sub(a: ArrayLike<number>, b: ArrayLike<number>): Vec2 { return [a[0] - b[0], a[1] - b[1]]; }
function cross(a: ArrayLike<number>, b: ArrayLike<number>): number { return a[0] * b[1] - a[1] * b[0]; }
