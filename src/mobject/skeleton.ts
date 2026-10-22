// Skeleton mobject (epic #61, child #64): a VGroup rebuilt from a pure
// SkeletonModel (skeleton_model.ts -- read its header for the conventions).
//
// Children, in draw order: fills (polygons over joint ids), bones (a line or
// circular arc each), heads (circles centred on a joint), joint dots. They are
// plain VMobjects whose points are rewritten in place on every pose change,
// so references to a bone mobject stay valid across tweens.
//
// Time-pure: nothing here integrates dt. `setTime(t)` evaluates a bound pose
// track at absolute time, so it is seekable (studio scrubbing, onion skins,
// node-parallel segments).

import { VMobject, VGroup } from "./VMobject.ts";
import { Circle } from "./geometry.ts";
import { ArcBetweenPoints } from "./arcs.ts";
import { SkeletonModel, ROOT_JOINT, lerpPose } from "./skeleton_model.ts";
import type { BoneSpec, Pose, PartialPose, Placement } from "./skeleton_model.ts";
import { ConstraintSet } from "./skeleton_constraints.ts";
import type { RigConstraint, ConstraintSetOptions } from "./skeleton_constraints.ts";
import { PoseLibrary } from "../animation/pose.ts";
import type { KeyframeTrack } from "../animation/keyframe_track.ts";
import type { ColorLike } from "../core/types.ts";

export interface HeadSpec {
  /** Joint id (a bone id or "root") the circle is centred on. */
  joint: string;
  radius: number;
  color?: ColorLike;
  fillColor?: ColorLike;
  fillOpacity?: number;
  strokeWidth?: number;
  /** z offset relative to the Skeleton's zIndex. Default 0. */
  zIndex?: number;
}

export interface FillSpec {
  /** Closed polygon over these joint ids, in order. */
  joints: string[];
  color?: ColorLike;
  opacity?: number;
  zIndex?: number;
}

export interface SkeletonConfig extends Placement {
  color?: ColorLike;
  /** Default stroke width for bones without their own `width`. Default 4. */
  strokeWidth?: number;
  /** Draw a dot on every joint (including the root). Default false. */
  joints?: boolean;
  jointRadius?: number;
  jointColor?: ColorLike;
  heads?: HeadSpec[];
  fills?: FillSpec[];
}

type Part =
  | { kind: "fill"; index: number; z: number }
  | { kind: "bone"; id: string; z: number }
  | { kind: "head"; index: number; z: number }
  | { kind: "joint"; id: string; z: number };

const p3 = (p: number[]): number[] => [p[0], p[1], 0];

export class Skeleton extends VGroup {
  model: SkeletonModel;
  /** Named poses for this rig (cloned by copy()). */
  poses: PoseLibrary;
  /** Track evaluated by setTime(); shared by reference with copies. */
  poseTrack: KeyframeTrack<any> | null = null;

  private _constraints: ConstraintSet | null = null;
  private _cfg: Required<Pick<SkeletonConfig, "strokeWidth" | "joints" | "jointRadius">> & SkeletonConfig;
  private _parts: Part[] = [];

  constructor(bones: BoneSpec[] | SkeletonModel, config: SkeletonConfig = {}) {
    super();
    this.model = bones instanceof SkeletonModel ? bones : new SkeletonModel(bones, config);
    if (bones instanceof SkeletonModel) this.model.setPlacement(config);
    this.poses = new PoseLibrary();
    this._cfg = { ...config, heads: config.heads?.map((h) => ({ ...h })), fills: config.fills?.map((f) => ({ ...f, joints: [...f.joints] })), strokeWidth: config.strokeWidth ?? 4, joints: config.joints ?? false, jointRadius: config.jointRadius ?? 0.06 };
    const color = config.color ?? "#FFFFFF";
    const m = this.model;
    const check = (j: string, what: string) => {
      if (!m.hasJoint(j)) throw new Error(`Skeleton: ${what} references unknown joint "${j}"`);
    };
    const kids: VMobject[] = [];
    (this._cfg.fills ?? []).forEach((f, i) => {
      f.joints.forEach((j) => check(j, "fill"));
      this._parts.push({ kind: "fill", index: i, z: f.zIndex ?? 0 });
      kids.push(new VMobject({ strokeWidth: 0, strokeOpacity: 0, fillColor: f.color ?? color, fillOpacity: f.opacity ?? 1 }));
    });
    for (const id of m.ids) {
      const spec = m.specOf(id);
      this._parts.push({ kind: "bone", id, z: spec.zIndex ?? 0 });
      kids.push(new VMobject({ strokeColor: color, strokeWidth: spec.width ?? this._cfg.strokeWidth, fillOpacity: 0, lineCap: "round", lineJoin: "round" }));
    }
    (this._cfg.heads ?? []).forEach((h, i) => {
      check(h.joint, "head");
      this._parts.push({ kind: "head", index: i, z: h.zIndex ?? 0 });
      kids.push(new Circle({ radius: h.radius, strokeColor: h.color ?? color, fillColor: h.fillColor ?? h.color ?? color, fillOpacity: h.fillOpacity ?? 0, strokeWidth: h.strokeWidth ?? this._cfg.strokeWidth }));
    });
    if (this._cfg.joints) {
      for (const id of [ROOT_JOINT, ...m.ids]) {
        this._parts.push({ kind: "joint", id, z: 0 });
        kids.push(new Circle({ radius: this._cfg.jointRadius, strokeWidth: 0, fillColor: config.jointColor ?? color, fillOpacity: 1 }));
      }
    }
    this.add(...kids);
    this._applyZ();
    this.refresh();
  }

  // --- model access -------------------------------------------------------
  getPose(): Pose { return this.model.getPose(); }

  /** Apply a (possibly partial) pose and rebuild geometry. */
  setPose(pose: PartialPose, opts: { strict?: boolean } = {}): this {
    this.model.setPose(pose, opts);
    return this.refresh();
  }

  bindPoseTrack(track: KeyframeTrack<any> | null): this { this.poseTrack = track; return this; }

  /** Evaluate the bound pose track at absolute time `t` (seconds). */
  setTime(t: number): this {
    if (!this.poseTrack) throw new Error("Skeleton.setTime(): no pose track bound; call bindPoseTrack(poseTrack([...])) first");
    return this.setPose(this.poseTrack.valueAt(t));
  }

  // --- rig constraints (skeleton_constraints.ts) -----------------------------
  /** The constraint set, or null when none was ever added (the unconstrained fast path). */
  get constraints(): ConstraintSet | null { return this._constraints; }
  /**
   * The constraint set, creating an empty one on first use. `opts` (fixed-point
   * `iterations` / `tolerance`, see `ConstraintSet`) are applied when given.
   */
  ensureConstraints(opts?: ConstraintSetOptions): ConstraintSet {
    const cs = (this._constraints ??= new ConstraintSet(this.model, opts));
    if (opts) cs.configure(opts);
    return cs;
  }
  /** Add a rig constraint (validated; throws on cycles/conflicts) and apply it now. */
  addConstraint(c: RigConstraint): this { this.ensureConstraints().add(c); return this.refresh(); }
  removeConstraint(id: string): boolean {
    const ok = this._constraints?.remove(id) ?? false;
    if (ok) this.refresh();
    return ok;
  }
  /** Evaluate constraints into the model without rebuilding geometry (refresh() does both). */
  applyConstraints(): this { this._constraints?.apply(); return this; }

  /**
   * Rebuild the drawn geometry from the model. Call after another module (IK,
   * pose ops) has driven `skeleton.model` directly. Rig constraints (if any)
   * are applied first, so they hold after every pose / IK write.
   */
  refresh(): this {
    this._constraints?.apply();
    const m = this.model;
    const j = m.jointPositions();
    this._parts.forEach((part, i) => {
      const mob = this.submobjects[i] as VMobject;
      switch (part.kind) {
        case "bone": {
          const s = m.boneStart(part.id), e = j[part.id];
          setLink(mob, s, e, m.getBend(part.id));
          if (m.widthScaled) mob.strokeWidth = (m.specOf(part.id).width ?? this._cfg.strokeWidth) * m.getWidthScale(part.id);
          break;
        }
        case "fill": {
          const pts = this._cfg.fills![part.index].joints.map((id) => p3(j[id]));
          mob.setPointsAsCorners([...pts, pts[0]]);
          break;
        }
        case "head": {
          moveCenter(mob, p3(j[this._cfg.heads![part.index].joint]));
          break;
        }
        case "joint": moveCenter(mob, p3(j[part.id])); break;
      }
    });
    return this;
  }

  getBoneMobject(id: string): VMobject {
    const i = this._parts.findIndex((p) => p.kind === "bone" && p.id === id);
    if (i < 0) throw new Error(`Skeleton: unknown bone "${id}"`);
    return this.submobjects[i] as VMobject;
  }
  getHeadMobject(index: number): VMobject {
    const i = this._parts.findIndex((p) => p.kind === "head" && p.index === index);
    if (i < 0) throw new Error(`Skeleton: no head #${index}`);
    return this.submobjects[i] as VMobject;
  }
  getJointMobject(id: string): VMobject {
    const i = this._parts.findIndex((p) => p.kind === "joint" && p.id === id);
    if (i < 0) throw new Error(`Skeleton: no joint dot "${id}" (construct with joints: true)`);
    return this.submobjects[i] as VMobject;
  }
  get fillMobjects(): VMobject[] {
    return this._parts.flatMap((p, i) => (p.kind === "fill" ? [this.submobjects[i] as VMobject] : []));
  }

  // --- z-index ------------------------------------------------------------
  /**
   * Sets the Skeleton's zIndex; each part's own zIndex is this value PLUS its
   * per-bone offset (BoneSpec.zIndex / HeadSpec.zIndex / FillSpec.zIndex), so
   * a parent setZIndex() does not flatten the figure's internal draw order
   * (the base Mobject.setZIndex would overwrite every child with one value).
   */
  setZIndex(value: number): this {
    this.zIndex = value;
    this._applyZ();
    return this;
  }
  /** Change one bone's z offset (relative to the Skeleton's zIndex). */
  setBoneZIndex(id: string, offset: number): this {
    const i = this._parts.findIndex((p) => p.kind === "bone" && p.id === id);
    if (i < 0) throw new Error(`Skeleton: unknown bone "${id}"`);
    this._parts[i].z = offset;
    this._applyZ();
    return this;
  }
  private _applyZ(): void {
    this._parts.forEach((p, i) => { this.submobjects[i].setZIndex(this.zIndex + p.z); });
  }

  // --- placement follows the group ----------------------------------------
  // Every Mobject transform funnels through applyToPoints /
  // applyPointsFunctionAboutPoint; after applying, derive the similarity
  // (translation, rotation, uniform scale) it performed on the figure and
  // fold it into the model's placement so the next refresh() does not snap
  // back. Non-similarity transforms (stretch, mirror) change the drawn
  // geometry only until the next pose change.
  applyToPoints(fn: (p: number[]) => number[]): this {
    super.applyToPoints(fn);
    this._foldPlacement(fn);
    return this;
  }
  applyPointsFunctionAboutPoint(fn: (points: number[][]) => number[][], aboutPoint?: number[]): this {
    const about = aboutPoint ?? this.getCenter();
    super.applyPointsFunctionAboutPoint(fn, about);
    this._foldPlacement((p) => {
      const q = fn([[p[0] - about[0], p[1] - about[1], p[2] - about[2]]])[0];
      return [q[0] + about[0], q[1] + about[1], q[2] + about[2]];
    });
    return this;
  }
  private _foldPlacement(fn: (p: number[]) => number[]): void {
    // `fn` has ALREADY been applied to the drawn points; evaluate it on the
    // model's pre-transform root frame (fn is a pure point map).
    const [rx, ry] = this.model.root;
    const p0 = fn([rx, ry, 0]);
    const p1 = fn([rx + 1, ry, 0]);
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    const k = Math.hypot(dx, dy);
    const placement: Placement = { root: [p0[0], p0[1]] };
    if (k > 1e-12) {
      placement.rotation = this.model.rotation + Math.atan2(dy, dx);
      placement.scale = this.model.scale * k;
    }
    this.model.setPlacement(placement);
  }

  // --- copy / interpolate ---------------------------------------------------
  /** Deep copy: independent model, pose library and part list; the pose track is shared. */
  copy(): this {
    const c = super.copy();
    c.model = this.model.clone();
    c.poses = this.poses.clone();
    c._constraints = this._constraints ? this._constraints.cloneFor(c.model) : null;
    c._parts = this._parts.map((p) => ({ ...p }));
    c._cfg = { ...this._cfg, heads: this._cfg.heads?.map((h) => ({ ...h })), fills: this._cfg.fills?.map((f) => ({ ...f, joints: [...f.joints] })) };
    return c;
  }

  /**
   * Blend POSES (shortest-arc angle, length, bend, placement), never joint
   * points, then rebuild geometry. Deliberately does not call
   * `super.interpolate`. Bones are matched by id; ids absent from this rig are
   * ignored. Colours/styles are not blended.
   */
  interpolate(start: any, target: any, alpha: number): this {
    if (!(start?.model instanceof SkeletonModel) || !(target?.model instanceof SkeletonModel)) {
      throw new TypeError("Skeleton.interpolate: start and target must both be Skeletons");
    }
    this.model.setPose(lerpPose(start.model.getPose(), target.model.getPose(), alpha));
    this.opacity = start.opacity + (target.opacity - start.opacity) * alpha;
    return this.refresh();
  }
}

/** Write a straight or circular-arc link between two points into `mob`. */
function setLink(mob: VMobject, s: number[], e: number[], bend: number): void {
  const a = p3(s), b = p3(e);
  if (Math.abs(bend) < 1e-6 || Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) {
    mob.setPointsAsCorners([a, b]);
    return;
  }
  const arc = new ArcBetweenPoints(a, b, bend);
  mob.points = arc.points;
  mob.subpathStarts = [...arc.subpathStarts];
  mob._straightPath = false;
}

/** Move a fixed-shape mobject (circle) so its centre is at `c`. */
function moveCenter(mob: VMobject, c: number[]): void {
  const cur = mob.getCenter();
  const d = [c[0] - cur[0], c[1] - cur[1], 0];
  for (let i = 0; i < mob.points.length; i++) mob.points[i] = [mob.points[i][0] + d[0], mob.points[i][1] + d[1], mob.points[i][2]];
}
