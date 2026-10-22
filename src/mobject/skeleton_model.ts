// Pure skeletal model (epic #61, child #64). Mobject-free and renderer-free:
// a bone hierarchy, forward kinematics, and the `Pose` value type. The
// `Skeleton` mobject (skeleton.ts) is a thin view that rebuilds geometry from
// this model; IK, pose operators, Clip, the Stick Nodes importer, studio
// overlays and rig constraints all build on THIS file, so the contract is
// documented here.
//
// CONVENTIONS
//  - Angles are radians, counter-clockwise, y-up (manim coordinates). 2D only.
//  - A bone starts at the END of its parent bone (or at the skeleton root if
//    `parent` is null) and ends at `start + length * scale * (cos a, sin a)`,
//    where `a` is its WORLD angle: `rotation + sum of local angles` up the
//    chain. `angle` is therefore relative to the parent's world angle.
//  - STABLE IDS: bone ids are caller-chosen strings and are the only handle
//    used by poses, joints, fills, heads and constraints. The joint at the end
//    of bone `b` has id `b`; the reserved id `"root"` (ROOT_JOINT) is the
//    skeleton origin where parent-less bones start. Ids are never renamed or
//    reindexed; `ids` is a topological order (parents first), stable for a
//    given input.
//  - `bend` is the sweep (radians) of a circular arc drawn between the bone's
//    start and end; it only changes how the link is DRAWN. Joint positions
//    and world angles always use the straight chord, so FK is unaffected.
//  - Placement (`root`, `rotation`, `scale`) is part of the pose: it is what
//    moves/rotates/scales the whole figure, and it tweens with the pose.
//
// DRIVING THE MODEL (for IK / constraints / ops): read with `jointPosition`,
// `boneWorldAngle`, `boneStart`; write with `setAngle` / `setWorldAngle` /
// `setLength` / `setBend` / `setPlacement` / `setPose`. Every write bumps
// `version` (FK is cached per version). After driving a model owned by a
// `Skeleton` mobject, call `skeleton.refresh()` to rebuild geometry.

export const ROOT_JOINT = "root";

export interface BoneSpec {
  id: string;
  /** Parent bone id, or null/undefined for a bone attached to the root. */
  parent?: string | null;
  length: number;
  /** Angle relative to the parent's world angle (rest value). Default 0. */
  angle?: number;
  /** Arc sweep of the drawn link, radians (rest value). Default 0 = straight. */
  bend?: number;
  /** Stroke width used when drawing this bone (view hint; not part of a Pose). */
  width?: number;
  /** z offset of this bone's mobject relative to the Skeleton's zIndex (view hint). */
  zIndex?: number;
  /**
   * Optional joint limits on this bone's local angle (radians, relative to the
   * parent's world angle). Not enforced by `setAngle` / poses (FK stays
   * unconstrained); honoured by IK solves (`IKChain`). Default: none.
   */
  limits?: AngleLimits;
}

/** Allowed range of a bone's LOCAL (parent-relative) angle, radians. Either end may be omitted. */
export interface AngleLimits { min?: number; max?: number }

export interface BonePose { angle: number; length: number; bend: number }

/** A complete pose: placement plus every bone's angle/length/bend. */
export interface Pose {
  root: [number, number];
  rotation: number;
  scale: number;
  bones: Record<string, BonePose>;
}

/** A pose where any field may be absent; absent fields are left unchanged. */
export interface PartialPose {
  root?: [number, number];
  rotation?: number;
  scale?: number;
  bones?: Record<string, Partial<BonePose>>;
}

export interface Placement { root?: [number, number]; rotation?: number; scale?: number }

interface BoneState {
  id: string;
  parent: string | null;
  children: string[];
  spec: Required<Pick<BoneSpec, "length" | "angle" | "bend">> & Pick<BoneSpec, "width" | "zIndex">;
  angle: number;
  length: number;
  bend: number;
  limits?: AngleLimits;
  /** Runtime stroke-width multiplier (derived by constraints; not part of a Pose). */
  widthScale: number;
}

function limitsOrThrow(id: string, l: AngleLimits | null | undefined): AngleLimits | undefined {
  if (l == null) return undefined;
  const out: AngleLimits = {};
  if (l.min !== undefined) out.min = finite(l.min, `limits.min of "${id}"`);
  if (l.max !== undefined) out.max = finite(l.max, `limits.max of "${id}"`);
  if (out.min !== undefined && out.max !== undefined && out.min > out.max) {
    throw new Error(`SkeletonModel: limits of "${id}" need min <= max (got min ${out.min}, max ${out.max})`);
  }
  return out.min === undefined && out.max === undefined ? undefined : out;
}

function finite(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new TypeError(`SkeletonModel: ${what} must be a finite number (got ${String(v)})`);
  }
  return v;
}

/** Wrap an angle difference into (-PI, PI]. */
export function wrapAngle(a: number): number {
  const TAU = Math.PI * 2;
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  else if (r <= -Math.PI) r += TAU;
  return r;
}

export class SkeletonModel {
  /** Bone ids, parents before children. Stable for a given input. */
  readonly ids: readonly string[];
  /** Incremented by every write; use to invalidate caches. */
  version = 0;

  private _bones = new Map<string, BoneState>();
  private _root: [number, number] = [0, 0];
  private _rotation = 0;
  private _scale = 1;
  private _widthTouched = false;
  private _fk: { version: number; start: Map<string, [number, number]>; end: Map<string, [number, number]>; world: Map<string, number> } | null = null;

  constructor(bones: BoneSpec[], placement: Placement = {}) {
    const byId = new Map<string, BoneSpec>();
    for (const b of bones) {
      if (typeof b?.id !== "string" || b.id === "") throw new TypeError("SkeletonModel: every bone needs a non-empty string id");
      if (b.id === ROOT_JOINT) throw new Error(`SkeletonModel: bone id "${ROOT_JOINT}" is reserved for the skeleton root`);
      if (byId.has(b.id)) throw new Error(`SkeletonModel: duplicate bone id "${b.id}"`);
      finite(b.length, `bone "${b.id}" length`);
      if (b.angle !== undefined) finite(b.angle, `bone "${b.id}" angle`);
      if (b.bend !== undefined) finite(b.bend, `bone "${b.id}" bend`);
      limitsOrThrow(b.id, b.limits);
      byId.set(b.id, b);
    }
    for (const b of bones) {
      if (b.parent != null && !byId.has(b.parent)) {
        throw new Error(`SkeletonModel: bone "${b.id}" has unknown parent "${b.parent}"`);
      }
    }
    // Stable topological order (Kahn, preserving input order among ready bones).
    const order: string[] = [];
    const placed = new Set<string>();
    let remaining = bones.slice();
    while (remaining.length) {
      const next = remaining.filter((b) => b.parent == null || placed.has(b.parent));
      if (next.length === 0) throw new Error(`SkeletonModel: parent cycle involving "${remaining[0].id}"`);
      for (const b of next) { order.push(b.id); placed.add(b.id); }
      remaining = remaining.filter((b) => !placed.has(b.id));
    }
    for (const id of order) {
      const b = byId.get(id)!;
      const spec = { length: b.length, angle: b.angle ?? 0, bend: b.bend ?? 0, width: b.width, zIndex: b.zIndex };
      this._bones.set(id, { id, parent: b.parent ?? null, children: [], spec, angle: spec.angle, length: spec.length, bend: spec.bend, limits: limitsOrThrow(id, b.limits), widthScale: 1 });
    }
    for (const id of order) {
      const p = this._bones.get(id)!.parent;
      if (p != null) this._bones.get(p)!.children.push(id);
    }
    this.ids = Object.freeze(order);
    this.setPlacement(placement);
    this.version = 0;
  }

  // --- structure ----------------------------------------------------------
  has(id: string): boolean { return this._bones.has(id); }
  /** True for a bone id or the reserved root joint id. */
  hasJoint(id: string): boolean { return id === ROOT_JOINT || this._bones.has(id); }
  parentOf(id: string): string | null { return this._get(id).parent; }
  childrenOf(id: string): string[] { return [...this._get(id).children]; }
  rootBones(): string[] { return this.ids.filter((i) => this._bones.get(i)!.parent == null); }
  /** Ancestor bone ids, nearest first (parent, grandparent, ...). */
  ancestorsOf(id: string): string[] {
    const out: string[] = [];
    for (let p = this._get(id).parent; p != null; p = this._bones.get(p)!.parent) out.push(p);
    return out;
  }
  /** Descendant bone ids in topological order. */
  descendantsOf(id: string): string[] {
    const out: string[] = [];
    const walk = (i: string) => { for (const c of this._bones.get(i)!.children) { out.push(c); walk(c); } };
    walk(this._get(id).id);
    return out;
  }
  /** The build-time (rest) spec of a bone, including view hints `width`/`zIndex`. */
  specOf(id: string): Readonly<BoneSpec> {
    const b = this._get(id);
    const out: BoneSpec = { id, parent: b.parent, ...b.spec };
    if (b.limits) out.limits = { ...b.limits };
    return out;
  }
  /** Joint limits of a bone's local angle, or undefined when it has none. */
  limitsOf(id: string): AngleLimits | undefined { const l = this._get(id).limits; return l ? { ...l } : undefined; }
  /** Set (or clear with `null`) the joint limits of a bone. Does not move the pose. */
  setLimits(id: string, limits: AngleLimits | null): this {
    this._get(id).limits = limitsOrThrow(id, limits);
    return this;
  }
  /** Runtime stroke-width multiplier of a bone (1 unless a constraint set it). */
  getWidthScale(id: string): number { return this._get(id).widthScale; }
  /** True once any bone width scale was written (lets views skip width work otherwise). */
  get widthScaled(): boolean { return this._widthTouched; }
  setWidthScale(id: string, scale: number): this {
    this._get(id).widthScale = finite(scale, `width scale of "${id}"`);
    this._widthTouched = true;
    this.version++;
    return this;
  }

  // --- reads --------------------------------------------------------------
  getAngle(id: string): number { return this._get(id).angle; }
  getLength(id: string): number { return this._get(id).length; }
  getBend(id: string): number { return this._get(id).bend; }
  get root(): [number, number] { return [this._root[0], this._root[1]]; }
  get rotation(): number { return this._rotation; }
  get scale(): number { return this._scale; }

  // --- writes -------------------------------------------------------------
  setAngle(id: string, angle: number): this {
    this._get(id).angle = finite(angle, `angle of "${id}"`); this.version++; return this;
  }
  /** Set a bone's local angle so its WORLD angle becomes `worldAngle`. */
  setWorldAngle(id: string, worldAngle: number): this {
    finite(worldAngle, `world angle of "${id}"`);
    const b = this._get(id);
    const parentWorld = b.parent == null ? this._rotation : this.boneWorldAngle(b.parent);
    b.angle = worldAngle - parentWorld;
    this.version++;
    return this;
  }
  setLength(id: string, length: number): this {
    this._get(id).length = finite(length, `length of "${id}"`); this.version++; return this;
  }
  setBend(id: string, bend: number): this {
    this._get(id).bend = finite(bend, `bend of "${id}"`); this.version++; return this;
  }
  setPlacement(p: Placement): this {
    if (p.root) this._root = [finite(p.root[0], "root.x"), finite(p.root[1], "root.y")];
    if (p.rotation !== undefined) this._rotation = finite(p.rotation, "rotation");
    if (p.scale !== undefined) this._scale = finite(p.scale, "scale");
    this.version++;
    return this;
  }

  // --- forward kinematics -------------------------------------------------
  /** Start (proximal) point of a bone: its parent's end, or the root. */
  boneStart(id: string): [number, number] { const p = this._solve().start.get(this._get(id).id)!; return [p[0], p[1]]; }
  /** World position of a joint: a bone id (that bone's end) or "root". */
  jointPosition(id: string): [number, number] {
    if (id === ROOT_JOINT) return this.root;
    const p = this._solve().end.get(this._get(id).id)!;
    return [p[0], p[1]];
  }
  /** Every joint position keyed by id, "root" first, then `ids` order. */
  jointPositions(): Record<string, [number, number]> {
    const out: Record<string, [number, number]> = { [ROOT_JOINT]: this.root };
    for (const id of this.ids) out[id] = this.jointPosition(id);
    return out;
  }
  /** World angle (radians) of a bone's chord direction. */
  boneWorldAngle(id: string): number { return this._solve().world.get(this._get(id).id)!; }
  boneWorldAngles(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const id of this.ids) out[id] = this.boneWorldAngle(id);
    return out;
  }

  // --- poses --------------------------------------------------------------
  /** The current pose (a deep copy; mutating it does not affect the model). */
  getPose(): Pose {
    const bones: Record<string, BonePose> = {};
    for (const id of this.ids) { const b = this._bones.get(id)!; bones[id] = { angle: b.angle, length: b.length, bend: b.bend }; }
    return { root: this.root, rotation: this._rotation, scale: this._scale, bones };
  }
  /** The rest pose given at construction (placement is the identity placement). */
  restPose(): Pose {
    const bones: Record<string, BonePose> = {};
    for (const id of this.ids) { const s = this._bones.get(id)!.spec; bones[id] = { angle: s.angle, length: s.length, bend: s.bend }; }
    return { root: [0, 0], rotation: 0, scale: 1, bones };
  }
  /**
   * Apply a (possibly partial) pose; absent fields are untouched. Unknown bone
   * ids are ignored (so a pose captured on a richer rig still applies) unless
   * `strict` is set, which throws.
   */
  setPose(pose: PartialPose, opts: { strict?: boolean } = {}): this {
    if (pose.bones) {
      for (const [id, bp] of Object.entries(pose.bones)) {
        const b = this._bones.get(id);
        if (!b) { if (opts.strict) throw new Error(`SkeletonModel.setPose: unknown bone "${id}"`); continue; }
        if (bp.angle !== undefined) b.angle = finite(bp.angle, `pose angle of "${id}"`);
        if (bp.length !== undefined) b.length = finite(bp.length, `pose length of "${id}"`);
        if (bp.bend !== undefined) b.bend = finite(bp.bend, `pose bend of "${id}"`);
      }
    }
    this.setPlacement({ root: pose.root, rotation: pose.rotation, scale: pose.scale });
    return this;
  }

  clone(): SkeletonModel {
    const specs: BoneSpec[] = this.ids.map((id) => this.specOf(id) as BoneSpec);
    const m = new SkeletonModel(specs, { root: this.root, rotation: this._rotation, scale: this._scale });
    m.setPose(this.getPose());
    for (const id of this.ids) if (this._bones.get(id)!.widthScale !== 1) m.setWidthScale(id, this._bones.get(id)!.widthScale);
    m.version = this.version;
    return m;
  }

  // --- internals ----------------------------------------------------------
  private _get(id: string): BoneState {
    const b = this._bones.get(id);
    if (!b) throw new Error(`SkeletonModel: unknown bone "${id}"`);
    return b;
  }

  private _solve() {
    if (this._fk && this._fk.version === this.version) return this._fk;
    const start = new Map<string, [number, number]>();
    const end = new Map<string, [number, number]>();
    const world = new Map<string, number>();
    for (const id of this.ids) {
      const b = this._bones.get(id)!;
      const s: [number, number] = b.parent == null ? this.root : end.get(b.parent)!;
      const w = (b.parent == null ? this._rotation : world.get(b.parent)!) + b.angle;
      const len = b.length * this._scale;
      start.set(id, s);
      world.set(id, w);
      end.set(id, [s[0] + len * Math.cos(w), s[1] + len * Math.sin(w)]);
    }
    return (this._fk = { version: this.version, start, end, world });
  }
}

/**
 * Blend two poses. Bone angles and placement rotation take the SHORTEST arc
 * (so 170deg -> -170deg passes through 180deg); lengths, bends, root and scale
 * are linear. Joint points are never interpolated, so limb lengths never
 * shrink mid-tween. For partial poses a field present on only one side is
 * taken as-is from that side; `lerpPose(a, b, 0)` / `(a, b, 1)` return `a` / `b`
 * values exactly.
 */
export function lerpPose(a: Pose, b: Pose, t: number): Pose;
export function lerpPose(a: PartialPose, b: PartialPose, t: number): PartialPose;
export function lerpPose(a: PartialPose, b: PartialPose, t: number): PartialPose {
  const num = (x: number | undefined, y: number | undefined, arc: boolean): number | undefined => {
    if (x === undefined) return y;
    if (y === undefined) return x;
    if (t <= 0) return x;
    if (t >= 1) return y;
    return arc ? x + wrapAngle(y - x) * t : x + (y - x) * t;
  };
  const out: PartialPose = {};
  if (a.root || b.root) {
    const ra = a.root ?? b.root!, rb = b.root ?? a.root!;
    out.root = [num(ra[0], rb[0], false)!, num(ra[1], rb[1], false)!];
  }
  const rot = num(a.rotation, b.rotation, true); if (rot !== undefined) out.rotation = rot;
  const sc = num(a.scale, b.scale, false); if (sc !== undefined) out.scale = sc;
  if (a.bones || b.bones) {
    out.bones = {};
    const ids = new Set([...Object.keys(a.bones ?? {}), ...Object.keys(b.bones ?? {})]);
    for (const id of ids) {
      const x = a.bones?.[id] ?? {}, y = b.bones?.[id] ?? {};
      const bp: Partial<BonePose> = {};
      const ang = num(x.angle, y.angle, true); if (ang !== undefined) bp.angle = ang;
      const len = num(x.length, y.length, false); if (len !== undefined) bp.length = len;
      const bnd = num(x.bend, y.bend, false); if (bnd !== undefined) bp.bend = bnd;
      out.bones[id] = bp;
    }
  }
  return out;
}
