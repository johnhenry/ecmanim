// Rig constraints for skeletons (epic #61, child #75). Pure and mobject-free:
// a `ConstraintSet` binds to a `SkeletonModel`, owns a constraint graph and
// WRITES DERIVED bone angles/lengths through the model's public setters. All
// semantics below are our own design.
//
// EVALUATION ORDER per frame: pose (FK) -> IK -> constraints -> refresh.
// `Skeleton.refresh()` applies its constraint set (if any) just before it
// rebuilds geometry, and `IKChain.solve()` / `PoseTween` / `setPose` all end in
// `refresh()`, so constraints re-apply after every pose or IK write. A skeleton
// with no constraints never reaches this code (byte-identical behaviour).
//
// CONSTRAINT TYPES (all `bone`s are bone ids; "joints" are bone ids or "root")
//  - connector { bone, a, b, slide }: the END joint of `bone` is placed at
//    A + slide * (B - A) (slide may be a number or a () => number; not clamped,
//    so values outside 0..1 extrapolate). `bone` keeps its start (its parent's
//    end) and has its angle AND length driven so its end lands on the point.
//  - weighted { bone, origin, anchors: [{joint, weight}] }: end joint of `bone`
//    = O + sum(w_i * (J_i - O)), 1..16 distinct anchors, signed weights.
//    Weights 0.5/0.5 blend two anchors; signed weights extrapolate. Drives
//    angle and length like a connector.
//  - angleLock { bone, reference = "parent", multiplier = 1, offset = 0 }:
//    world angle of `bone` = offset + multiplier * R, with R the parent bone's
//    world angle ("parent"; the placement rotation for a root bone) or the
//    figure's placement rotation ("world"). multiplier 1 = parallel to the
//    reference, 0 = fixed at `offset` in the world (for "world": stays upright
//    however the figure is rotated). Drives angle only.
//  - stretch { driver, targets?, exclude?, restLength?, min?, max? }: ratio =
//    clamp(length(driver) / rest, min, max) with rest = restLength or the
//    driver's authored length; every target's length becomes authoredLength *
//    ratio. targets default to all descendants of `driver`; `exclude` bones keep
//    their length. The driver itself is never written. Drives target lengths.
//
// GRAPH: each constraint declares what it WRITES (bone angle/length channels)
// and what it READS (FK geometry of joints, or one bone's length). B depends on
// A when A writes something B reads (writing bone X moves X's whole subtree, so
// a geometry read of joint J depends on writers of J's ancestors-or-self).
// `apply()` runs a stable topological order (insertion order among ready
// constraints). A cycle -- including a constraint that reads geometry its own
// write moves -- throws at `add()` naming the constraints, and the set is left
// unchanged. Two constraints may not drive the same channel of one bone.
// Structural fields (bones, anchors) are fixed at `add()`; mutate only the
// value fields (slide, weights, multiplier, offset, min, max, enabled).

import { ROOT_JOINT } from "./skeleton_model.ts";
import type { SkeletonModel } from "./skeleton_model.ts";

const EPS = 1e-12;
export const MAX_WEIGHTED_ANCHORS = 16;

interface Base { id?: string; enabled?: boolean }
export interface ConnectorConstraint extends Base {
  type: "connector";
  bone: string; a: string; b: string;
  slide: number | (() => number);
}
export interface WeightedAnchor { joint: string; weight: number }
export interface WeightedJointConstraint extends Base {
  type: "weighted";
  bone: string; origin: string; anchors: WeightedAnchor[];
}
export interface AngleLockConstraint extends Base {
  type: "angleLock";
  bone: string;
  reference?: "parent" | "world";
  multiplier?: number;
  offset?: number;
}
export interface StretchConstraint extends Base {
  type: "stretch";
  driver: string;
  targets?: string[];
  exclude?: string[];
  restLength?: number;
  min?: number;
  max?: number;
}
export type RigConstraint = ConnectorConstraint | WeightedJointConstraint | AngleLockConstraint | StretchConstraint;
/** A constraint after `add()`: `id` is always set and `enabled` defaults to true. */
export type BoundConstraint = RigConstraint & { id: string; enabled: boolean };

interface Write { bone: string; angle: boolean; length: boolean }
type Read = { kind: "geo"; joint: string } | { kind: "len"; bone: string };
interface Node { c: BoundConstraint; writes: Write[]; reads: Read[] }

export class ConstraintSet {
  private _nodes: Node[] = [];
  private _order: Node[] = [];
  private _counter = 0;

  readonly model: SkeletonModel;
  constructor(model: SkeletonModel) { this.model = model; }

  /** Constraint ids in insertion order. */
  ids(): string[] { return this._nodes.map((n) => n.c.id); }
  get size(): number { return this._nodes.length; }
  /** The live bound constraint (mutate value fields only), or undefined. */
  get(id: string): BoundConstraint | undefined { return this._nodes.find((n) => n.c.id === id)?.c; }
  /** Ids in evaluation (topological) order. */
  order(): string[] { return this._order.map((n) => n.c.id); }

  /** Validate and add a constraint (a shallow copy is stored). Throws on bad input, conflicts or cycles. */
  add(spec: RigConstraint): this {
    const node = this._bind(spec);
    const next = [...this._nodes, node];
    const order = this._sort(next); // throws on a cycle, before any state changes
    this._nodes = next;
    this._order = order;
    return this;
  }

  remove(id: string): boolean {
    const i = this._nodes.findIndex((n) => n.c.id === id);
    if (i < 0) return false;
    this._nodes.splice(i, 1);
    this._order = this._sort(this._nodes);
    return true;
  }

  /** Evaluate every enabled constraint in dependency order, writing into the model. */
  apply(): void {
    for (const n of this._order) if (n.c.enabled) this._eval(n.c);
  }

  /** Copy of this set bound to another model with the same bones (used by `Skeleton.copy()`). */
  cloneFor(model: SkeletonModel): ConstraintSet {
    const out = new ConstraintSet(model);
    for (const n of this._nodes) out.add(cloneSpec(n.c));
    out._counter = this._counter;
    return out;
  }

  /** Hidden state for cache keys (updater / wait fingerprints). */
  fingerprint(): string {
    return this._nodes.map((n) => {
      const c = n.c as any;
      const v = c.type === "connector" ? slideOf(c)
        : c.type === "weighted" ? c.anchors.map((a: WeightedAnchor) => a.weight).join(",")
        : c.type === "angleLock" ? `${c.reference ?? "parent"}:${c.multiplier ?? 1}:${c.offset ?? 0}`
        : `${c.restLength ?? ""}:${c.min ?? ""}:${c.max ?? ""}`;
      return `${c.id}=${c.enabled ? 1 : 0}:${v}`;
    }).join(";");
  }

  // --- binding & graph ------------------------------------------------------
  private _bind(spec: RigConstraint): Node {
    const m = this.model;
    const s = spec as any;
    const type = s?.type;
    const bone = (id: unknown, what: string) => { if (typeof id !== "string" || !m.has(id)) throw new Error(`ConstraintSet: ${what} references unknown bone "${String(id)}"`); return id; };
    const joint = (id: unknown, what: string) => { if (typeof id !== "string" || !m.hasJoint(id)) throw new Error(`ConstraintSet: ${what} references unknown joint "${String(id)}"`); return id; };
    const num = (v: unknown, what: string) => { if (typeof v !== "number" || !Number.isFinite(v)) throw new TypeError(`ConstraintSet: ${what} must be a finite number (got ${String(v)})`); return v; };
    const id = s.id ?? `${type}:${++this._counter}`;
    if (typeof id !== "string" || id === "") throw new TypeError("ConstraintSet: id must be a non-empty string");
    if (this._nodes.some((n) => n.c.id === id)) throw new Error(`ConstraintSet: duplicate constraint id "${id}"`);
    const what = `constraint "${id}"`;
    let c: any, writes: Write[], reads: Read[];
    switch (type) {
      case "connector": {
        c = { ...s, id, enabled: s.enabled ?? true };
        bone(c.bone, what); joint(c.a, what); joint(c.b, what);
        if (typeof c.slide !== "function") num(c.slide, `${what} slide`);
        writes = [{ bone: c.bone, angle: true, length: true }];
        reads = [{ kind: "geo", joint: c.a }, { kind: "geo", joint: c.b }];
        break;
      }
      case "weighted": {
        const anchors: WeightedAnchor[] = Array.isArray(s.anchors) ? s.anchors.map((a: WeightedAnchor) => ({ ...a })) : [];
        c = { ...s, id, enabled: s.enabled ?? true, anchors };
        bone(c.bone, what); joint(c.origin, what);
        if (anchors.length === 0) throw new Error(`ConstraintSet: ${what} needs at least one anchor`);
        if (anchors.length > MAX_WEIGHTED_ANCHORS) throw new Error(`ConstraintSet: ${what} has ${anchors.length} anchors; the maximum is ${MAX_WEIGHTED_ANCHORS}`);
        const seen = new Set<string>();
        for (const a of anchors) {
          joint(a.joint, what); num(a.weight, `${what} weight`);
          if (seen.has(a.joint)) throw new Error(`ConstraintSet: ${what} has duplicate anchor "${a.joint}" (anchors must be distinct)`);
          seen.add(a.joint);
        }
        writes = [{ bone: c.bone, angle: true, length: true }];
        reads = [{ kind: "geo", joint: c.origin }, ...anchors.map((a) => ({ kind: "geo", joint: a.joint }) as Read)];
        break;
      }
      case "angleLock": {
        c = { ...s, id, enabled: s.enabled ?? true };
        bone(c.bone, what);
        if (c.reference !== undefined && c.reference !== "parent" && c.reference !== "world") throw new Error(`ConstraintSet: ${what} reference must be "parent" or "world"`);
        if (c.multiplier !== undefined) num(c.multiplier, `${what} multiplier`);
        if (c.offset !== undefined) num(c.offset, `${what} offset`);
        writes = [{ bone: c.bone, angle: true, length: false }];
        reads = [];
        break;
      }
      case "stretch": {
        c = { ...s, id, enabled: s.enabled ?? true };
        bone(c.driver, what);
        const exclude = new Set<string>((c.exclude ?? []).map((b: string) => bone(b, what)));
        const targets: string[] = (c.targets ?? m.descendantsOf(c.driver)).filter((b: string) => !exclude.has(b));
        for (const t of targets) { bone(t, what); if (t === c.driver) throw new Error(`ConstraintSet: ${what} cannot stretch its own driver "${c.driver}"`); }
        if (c.restLength !== undefined && !(num(c.restLength, `${what} restLength`) > 0)) throw new Error(`ConstraintSet: ${what} restLength must be > 0`);
        const lo = c.min === undefined ? 0 : num(c.min, `${what} min`), hi = c.max === undefined ? Infinity : (c.max === Infinity ? Infinity : num(c.max, `${what} max`));
        if (lo < 0 || lo > hi) throw new Error(`ConstraintSet: ${what} needs 0 <= min <= max (got min ${lo}, max ${hi})`);
        c._targets = targets;
        writes = targets.map((t) => ({ bone: t, angle: false, length: true }));
        reads = [{ kind: "len", bone: c.driver }];
        break;
      }
      default:
        throw new Error(`ConstraintSet: unknown constraint type "${String(type)}"`);
    }
    // A driven bone's own start and parent frame are read too.
    // (Pure length writes, i.e. stretch, do not depend on geometry.)
    for (const w of writes) {
      if (!w.angle) continue;
      const p = m.parentOf(w.bone);
      if (p != null) reads.push({ kind: "geo", joint: p });
    }
    // One driver per channel of a bone.
    for (const n of this._nodes) for (const w of writes) for (const o of n.writes) {
      if (o.bone === w.bone && ((o.angle && w.angle) || (o.length && w.length))) {
        throw new Error(`ConstraintSet: bone "${w.bone}" is already driven by constraint "${n.c.id}" (cannot also drive it from "${id}")`);
      }
    }
    return { c: c as BoundConstraint, writes, reads };
  }

  private _depends(b: Node, a: Node): boolean {
    for (const r of b.reads) for (const w of a.writes) {
      if (r.kind === "len") { if (w.length && w.bone === r.bone) return true; }
      else if (r.joint !== ROOT_JOINT && (w.bone === r.joint || this.model.ancestorsOf(r.joint).includes(w.bone))) return true;
    }
    return false;
  }

  /** Stable topological order (Kahn; insertion order among ready nodes). */
  private _sort(nodes: Node[]): Node[] {
    const n = nodes.length;
    const dep: boolean[][] = nodes.map((b) => nodes.map((a) => this._depends(b, a)));
    for (let i = 0; i < n; i++) if (dep[i][i]) throw new Error(`ConstraintSet: cycle detected: "${nodes[i].c.id}" depends on a bone it drives itself`);
    const done = new Array<boolean>(n).fill(false);
    const out: Node[] = [];
    while (out.length < n) {
      const k = nodes.findIndex((_, i) => !done[i] && dep[i].every((d, j) => !d || done[j]));
      if (k < 0) {
        // Every remaining node waits on another remaining node: report one concrete cycle.
        let cur = done.findIndex((d) => !d);
        const path: number[] = [];
        while (!path.includes(cur)) { path.push(cur); cur = dep[cur].findIndex((d, j) => d && !done[j]); }
        const cyc = path.slice(path.indexOf(cur)).map((i) => `"${nodes[i].c.id}"`);
        throw new Error(`ConstraintSet: cycle detected among constraints: ${[...cyc, cyc[0]].join(" -> ")}`);
      }
      done[k] = true; out.push(nodes[k]);
    }
    return out;
  }

  // --- evaluation -----------------------------------------------------------
  private _eval(c: BoundConstraint): void {
    const m = this.model;
    switch (c.type) {
      case "connector": {
        const a = m.jointPosition(c.a), b = m.jointPosition(c.b), s = slideOf(c);
        this._place(c.bone, [a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1])]);
        break;
      }
      case "weighted": {
        const o = m.jointPosition(c.origin);
        let x = o[0], y = o[1];
        for (const an of c.anchors) { const j = m.jointPosition(an.joint); x += an.weight * (j[0] - o[0]); y += an.weight * (j[1] - o[1]); }
        this._place(c.bone, [x, y]);
        break;
      }
      case "angleLock": {
        const parent = m.parentOf(c.bone);
        const ref = (c.reference ?? "parent") === "world" || parent == null ? m.rotation : m.boneWorldAngle(parent);
        m.setWorldAngle(c.bone, (c.offset ?? 0) + (c.multiplier ?? 1) * ref);
        break;
      }
      case "stretch": {
        const rest = c.restLength ?? m.specOf(c.driver).length;
        const raw = rest > EPS ? m.getLength(c.driver) / rest : 1;
        const ratio = Math.min(Math.max(raw, c.min ?? 0), c.max ?? Infinity);
        for (const t of (c as any)._targets as string[]) m.setLength(t, m.specOf(t).length * ratio);
        break;
      }
    }
  }

  /** Aim `bone` from its start at world point `p` and give it the length that lands its end there. */
  private _place(bone: string, p: [number, number]): void {
    const m = this.model;
    const sc = m.scale;
    if (!(sc > 0)) return;
    const s = m.boneStart(bone);
    const dx = p[0] - s[0], dy = p[1] - s[1];
    const d = Math.hypot(dx, dy);
    if (d > EPS) m.setWorldAngle(bone, Math.atan2(dy, dx));
    m.setLength(bone, d / sc);
  }
}

function slideOf(c: ConnectorConstraint): number {
  const v = typeof c.slide === "function" ? c.slide() : c.slide;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new TypeError(`ConstraintSet: connector "${(c as any).id}" slide must be a finite number (got ${String(v)})`);
  return v;
}

function cloneSpec(c: BoundConstraint): RigConstraint {
  const { _targets, ...rest } = c as any;
  void _targets;
  if (rest.anchors) rest.anchors = rest.anchors.map((a: WeightedAnchor) => ({ ...a }));
  if (rest.targets) rest.targets = [...rest.targets];
  if (rest.exclude) rest.exclude = [...rest.exclude];
  return rest;
}
