// IK / rig follow-ups (#92): effector lock, joint limits, pole targets,
// stretch multipliers + width response, constraint fixed point. Written first.
import { test } from "node:test";
import assert from "node:assert";
import { solveTwoBone, solveFABRIK, IKChain } from "../src/mobject/ik.ts";
import { Skeleton } from "../src/mobject/skeleton.ts";
import { SkeletonModel, wrapAngle } from "../src/mobject/skeleton_model.ts";
import { ConstraintSet } from "../src/mobject/skeleton_constraints.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const nearPt = (a: number[], b: number[], eps = 1e-6) => { near(a[0], b[0], eps); near(a[1], b[1], eps); };
const cross = (a: number[], b: number[]) => a[0] * b[1] - a[1] * b[0];

const arm = () => [
  { id: "upper", length: 1, angle: 0 },
  { id: "fore", parent: "upper", length: 1, angle: 0 },
  { id: "hand", parent: "fore", length: 0.5, angle: 0 },
];
const snake = () => [
  { id: "s1", length: 1, angle: 0 },
  { id: "s2", parent: "s1", length: 1, angle: 0 },
  { id: "s3", parent: "s2", length: 1, angle: 0 },
];

// --- 1. effector orientation lock ---------------------------------------------
test("effectorAngle: effector bone keeps its world angle and the chain still reaches", () => {
  const sk = new Skeleton(arm());
  const ik = new IKChain(sk, { bones: ["upper", "fore"], target: [1.2, 0.8], bendSide: "left", effectorAngle: 0.3 });
  const r = ik.solve();
  near(r.error, 0);
  near(sk.model.boneWorldAngle("hand"), 0.3);
});

test("effectorAngle: function form re-evaluates each solve; works while pinned and after the figure moves", () => {
  const sk = new Skeleton(arm());
  let a = 0.5;
  const ik = new IKChain(sk, { bones: ["upper", "fore"], target: [1.2, 0.8], bendSide: "left", effectorAngle: () => a });
  ik.pin([1.2, 0.8]);
  ik.solve();
  near(sk.model.boneWorldAngle("hand"), 0.5);
  a = -1;
  sk.model.setPlacement({ root: [0.2, 0.1] });
  const r = ik.solve();
  near(sk.model.boneWorldAngle("hand"), -1);
  nearPt(r.effector, [1.2, 0.8]);
});

test("effectorAngle: absent -> hand keeps its relative angle (old behaviour, byte-identical pose)", () => {
  const a = new Skeleton(arm()), b = new Skeleton(arm());
  new IKChain(a, { bones: ["upper", "fore"], target: [1.2, 0.8], bendSide: "left" }).solve();
  new IKChain(b, { bones: ["upper", "fore"], target: [1.2, 0.8], bendSide: "left", effectorAngle: undefined }).solve();
  assert.deepStrictEqual(a.model.getPose(), b.model.getPose());
  near(a.model.getAngle("hand"), 0);
});

test("effectorAngle: bone resolution errors and joint limit on the effector bone", () => {
  assert.throws(() => new IKChain(new Skeleton([{ id: "a", length: 1 }, { id: "b", parent: "a", length: 1 }]), { bones: ["a", "b"], target: [1, 1], effectorAngle: 0 }), /effector/i);
  const two = [...arm(), { id: "thumb", parent: "fore", length: 0.2, angle: 0 }];
  assert.throws(() => new IKChain(new Skeleton(two), { bones: ["upper", "fore"], target: [1, 1], effectorAngle: 0 }), /effectorBone/);
  const ok = new IKChain(new Skeleton(two), { bones: ["upper", "fore"], target: [1, 1], effectorAngle: 0, effectorBone: "thumb" });
  assert.ok(ok);
  assert.throws(() => new IKChain(new Skeleton(two), { bones: ["upper", "fore"], target: [1, 1], effectorAngle: 0, effectorBone: "upper" }), /child/);
  const lim = new Skeleton([...arm().slice(0, 2), { id: "hand", parent: "fore", length: 0.5, limits: { min: -0.2, max: 0.2 } }]);
  const c = new IKChain(lim, { bones: ["upper", "fore"], target: [1.2, 0.8], bendSide: "left", effectorAngle: 2.0 });
  c.solve();
  const rel = lim.model.getAngle("hand");
  assert.ok(rel <= 0.2 + 1e-9 && rel >= -0.2 - 1e-9, `rel ${rel}`);
});

// --- 2. joint limits ---------------------------------------------------------
test("model: limits stored, validated, cloned; absent by default", () => {
  const m = new SkeletonModel([{ id: "a", length: 1, limits: { min: -1, max: 1 } }, { id: "b", parent: "a", length: 1 }]);
  assert.deepStrictEqual(m.limitsOf("a"), { min: -1, max: 1 });
  assert.equal(m.limitsOf("b"), undefined);
  assert.ok(!("limits" in m.specOf("b")));
  assert.deepStrictEqual(m.clone().limitsOf("a"), { min: -1, max: 1 });
  m.setLimits("b", { min: 0 });
  assert.deepStrictEqual(m.limitsOf("b"), { min: 0 });
  m.setLimits("b", null);
  assert.equal(m.limitsOf("b"), undefined);
  assert.throws(() => m.setLimits("a", { min: 2, max: 1 }), /min/);
  assert.throws(() => new SkeletonModel([{ id: "x", length: 1, limits: { min: NaN } }]), /finite/);
});

test("solveTwoBone: no limits -> result identical to before (no `limited` field)", () => {
  const a = solveTwoBone([0, 0], 1, 1, [1, 1], "left");
  const b = solveTwoBone([0, 0], 1, 1, [1, 1], "left", {});
  assert.deepStrictEqual(a, b);
  assert.ok(!("limited" in a));
});

test("solveTwoBone: invalid preferred branch -> the other branch is used", () => {
  // left bend has the elbow at (0,1): relative elbow angle -90deg; forbid negative.
  const r = solveTwoBone([0, 0], 1, 1, [1, 1], "left", { limits: { b: { min: 0 } } });
  nearPt(r.mid, [1, 0]);
  assert.equal(r.reached, true);
  assert.equal(r.limited, true);
  // base limit via parentAngle
  const s = solveTwoBone([0, 0], 1, 1, [1, 1], "left", { limits: { parentAngle: 0, a: { min: -0.1, max: 0.1 } } });
  nearPt(s.mid, [1, 0]);
  // a valid preferred branch is left alone
  const ok = solveTwoBone([0, 0], 1, 1, [1, 1], "left", { limits: { b: { min: -Math.PI, max: 0 } } });
  nearPt(ok.mid, [0, 1]);
  assert.equal(ok.limited, false);
});

test("solveTwoBone: unsatisfiable limits clamp, keep lengths, report not reached", () => {
  const r = solveTwoBone([0, 0], 1, 1, [1, 1], "left", { limits: { b: { min: 0, max: 0.1 } } });
  assert.equal(r.reached, false);
  assert.equal(r.limited, true);
  const th1 = Math.atan2(r.mid[1], r.mid[0]);
  const th2 = Math.atan2(r.end[1] - r.mid[1], r.end[0] - r.mid[0]);
  const rel = wrapAngle(th2 - th1);
  assert.ok(rel >= -1e-9 && rel <= 0.1 + 1e-9, `rel ${rel}`);
  near(Math.hypot(r.mid[0], r.mid[1]), 1);
  near(Math.hypot(r.end[0] - r.mid[0], r.end[1] - r.mid[1]), 1);
});

test("solveFABRIK: no limits -> identical to before", () => {
  const pts = [[0, 0], [1, 0], [2, 0], [3, 0]];
  const a = solveFABRIK(pts, [1, 1, 1], [1.5, 1.2]);
  const b = solveFABRIK(pts, [1, 1, 1], [1.5, 1.2], { limits: undefined });
  assert.deepStrictEqual(a, b);
});

const fk = (rels: number[], lens: number[], parent = 0): number[][] => {
  const pts = [[0, 0]]; let a = parent;
  rels.forEach((r, i) => { a += r; const p = pts[i]; pts.push([p[0] + lens[i] * Math.cos(a), p[1] + lens[i] * Math.sin(a)]); });
  return pts;
};
const relsOf = (pts: number[][], parent = 0) => {
  const out: number[] = []; let prev = parent;
  for (let i = 1; i < pts.length; i++) { const a = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]); out.push(wrapAngle(a - prev)); prev = a; }
  return out;
};

test("solveFABRIK: limits are honoured in the returned pose and a reachable target is still hit", () => {
  const lim = { min: 0, max: Math.PI / 2 };
  const target = fk([0.4, 0.5, 0.6], [1, 1, 1])[3];
  const r = solveFABRIK([[0, 0], [1, 0], [2, 0], [3, 0]], [1, 1, 1], target, { limits: [lim, lim, lim], iterations: 200, tolerance: 1e-4 });
  for (const rel of relsOf(r.points)) assert.ok(rel >= -1e-9 && rel <= Math.PI / 2 + 1e-9, `rel ${rel}`);
  assert.ok(r.error < 1e-3, `error ${r.error}`);
});

test("solveFABRIK: unsatisfiable limits still respect them and report not reached; deterministic", () => {
  const lim = { min: -0.05, max: 0.05 };
  const run = () => solveFABRIK([[0, 0], [1, 0], [2, 0], [3, 0]], [1, 1, 1], [0, 2], { limits: [lim, lim, lim], parentAngle: 0 });
  const r = run();
  assert.equal(r.reached, false);
  for (const rel of relsOf(r.points)) assert.ok(Math.abs(rel) <= 0.05 + 1e-9, `rel ${rel}`);
  assert.deepStrictEqual(r, run());
});

test("solveFABRIK: out-of-reach straight line is clamped to the first bone's parent-relative limit", () => {
  const r = solveFABRIK([[0, 0], [1, 0], [2, 0]], [1, 1], [0, 5], { limits: [{ min: -0.5, max: 0.5 }, null], parentAngle: 0 });
  const rel = relsOf(r.points);
  near(rel[0], 0.5, 1e-9);
});

test("IKChain: model limits honoured by 2-bone and 3-bone chains; limits in the fingerprint", () => {
  const sk = new Skeleton([
    { id: "upper", length: 1, angle: 0 },
    { id: "fore", parent: "upper", length: 1, angle: 0, limits: { min: 0 } },
  ]);
  const ik = new IKChain(sk, { bones: ["upper", "fore"], target: [1, 1], bendSide: "left" });
  const fp0 = ik.ikFingerprint();
  const r = ik.solve();
  near(r.error, 0);
  assert.ok(sk.model.getAngle("fore") >= -1e-9);
  const s3 = new Skeleton(snake().map((b) => ({ ...b, limits: { min: 0, max: 1.2 } })));
  const c3 = new IKChain(s3, { bones: ["s1", "s2", "s3"], target: [1.5, 1.2], iterations: 100 });
  c3.solve();
  for (const id of ["s2", "s3"]) { const a = s3.model.getAngle(id); assert.ok(a >= -1e-9 && a <= 1.2 + 1e-9, `${id} ${a}`); }
  const plain = new Skeleton(snake());
  const noLim = new IKChain(plain, { bones: ["s1", "s2", "s3"], target: [1.5, 1.2] });
  const other = new Skeleton(snake().map((b) => ({ ...b, limits: { max: 3 } })));
  const withLim = new IKChain(other, { bones: ["s1", "s2", "s3"], target: [1.5, 1.2] });
  assert.notEqual(noLim.ikFingerprint(), withLim.ikFingerprint());
  void fp0;
});

test("IKChain: a model with no limits solves exactly as before", () => {
  const a = new Skeleton(snake()), b = new Skeleton(snake());
  new IKChain(a, { bones: ["s1", "s2", "s3"], target: [1.5, 1.2] }).solve();
  new IKChain(b, { bones: ["s1", "s2", "s3"], target: [1.5, 1.2], pole: undefined, effectorAngle: undefined }).solve();
  assert.deepStrictEqual(a.model.getPose(), b.model.getPose());
});

// --- 3. pole targets ---------------------------------------------------------
const sideOf = (sk: Skeleton, tgt: number[], ids: string[]) => {
  const root = sk.model.boneStart(ids[0]);
  let s = 0;
  for (const id of ids.slice(0, -1)) { const p = sk.model.jointPosition(id); s += cross([tgt[0] - root[0], tgt[1] - root[1]], [p[0] - root[0], p[1] - root[1]]); }
  return Math.sign(s);
};

test("pole: picks the bend side of a 3-bone chain, from a straight start and from the opposite bend", () => {
  const tgt = [2, 0.5];
  for (const [pole, want] of [[[0, 5], 1], [[0, -5], -1]] as const) {
    const sk = new Skeleton(snake());
    new IKChain(sk, { bones: ["s1", "s2", "s3"], target: tgt, pole }).solve();
    assert.equal(sideOf(sk, tgt, ["s1", "s2", "s3"]), want);
    near(Math.hypot(sk.model.jointPosition("s3")[0] - tgt[0], sk.model.jointPosition("s3")[1] - tgt[1]), 0, 1e-3);
    // opposite-bent start
    const bent = new Skeleton([{ id: "s1", length: 1, angle: -0.6 }, { id: "s2", parent: "s1", length: 1, angle: 1.2 }, { id: "s3", parent: "s2", length: 1, angle: -0.6 }]);
    new IKChain(bent, { bones: ["s1", "s2", "s3"], target: tgt, pole: [0, -want * 5] }).solve();
    assert.equal(sideOf(bent, tgt, ["s1", "s2", "s3"]), -want);
    new IKChain(bent, { bones: ["s1", "s2", "s3"], target: tgt, pole }).solve();
    assert.equal(sideOf(bent, tgt, ["s1", "s2", "s3"]), want);
  }
});

test("pole: lengths preserved, function/mobject-style sources accepted, 2-bone pole overrides bendSide", () => {
  const sk = new Skeleton(snake());
  new IKChain(sk, { bones: ["s1", "s2", "s3"], target: [2, 0.5], pole: () => [0, 4] }).solve();
  for (const id of ["s1", "s2", "s3"]) near(sk.model.getLength(id), 1);
  const two = new Skeleton(arm());
  new IKChain(two, { bones: ["upper", "fore"], target: [1, 1], bendSide: "right", pole: [-3, 3] }).solve();
  nearPt(two.model.jointPosition("upper"), [0, 1]); // left of root->target, toward the pole
});

test("pole: without a pole the chain is unchanged (kept side)", () => {
  const bent = () => new Skeleton([{ id: "s1", length: 1, angle: -0.6 }, { id: "s2", parent: "s1", length: 1, angle: 1.2 }, { id: "s3", parent: "s2", length: 1, angle: -0.6 }]);
  const sk = bent();
  new IKChain(sk, { bones: ["s1", "s2", "s3"], target: [2, 0.5] }).solve();
  assert.equal(sideOf(sk, [2, 0.5], ["s1", "s2", "s3"]), -1);
});

test("pole: appears in the fingerprint only when set", () => {
  const sk = new Skeleton(snake());
  const a = new IKChain(sk, { bones: ["s1", "s2", "s3"], target: [2, 0.5] });
  const b = new IKChain(sk, { bones: ["s1", "s2", "s3"], target: [2, 0.5], pole: [0, 5] });
  assert.ok(!a.ikFingerprint().includes("pole"));
  assert.ok(b.ikFingerprint().includes("pole"));
});

// --- 4. stretch multipliers + width response -----------------------------------
const rig4 = () => [
  { id: "armL", length: 1, angle: 0 },
  { id: "foreL", parent: "armL", length: 1, angle: 0 },
  { id: "handL", parent: "foreL", length: 0.5, angle: 0 },
];

test("stretch: default path unchanged (no multipliers, no width writes)", () => {
  const m = new SkeletonModel(rig4());
  const cs = new ConstraintSet(m);
  cs.add({ type: "stretch", driver: "armL" });
  m.setLength("armL", 2);
  cs.apply();
  near(m.getLength("foreL"), 2); near(m.getLength("handL"), 1);
  near(m.getWidthScale("foreL"), 1);
});

test("stretch: per-target multipliers scale the stretch amount", () => {
  const m = new SkeletonModel(rig4());
  const cs = new ConstraintSet(m);
  cs.add({ type: "stretch", driver: "armL", multipliers: { foreL: 0.5, handL: 0 } });
  m.setLength("armL", 2);
  cs.apply();
  near(m.getLength("foreL"), 1.5);
  near(m.getLength("handL"), 0.5);
  assert.throws(() => new ConstraintSet(new SkeletonModel(rig4())).add({ type: "stretch", driver: "armL", multipliers: { nope: 1 } }), /multipliers/);
  assert.throws(() => new ConstraintSet(new SkeletonModel(rig4())).add({ type: "stretch", driver: "armL", multipliers: { foreL: NaN } }), /finite/);
});

test("stretch: widthResponse thins stretched bones (volume-style) and reaches the drawn stroke", () => {
  const sk = new Skeleton(rig4(), { strokeWidth: 8 });
  sk.addConstraint({ type: "stretch", driver: "armL", widthResponse: 1, widthBones: ["foreL"] });
  sk.model.setLength("armL", 2);
  sk.refresh();
  near(sk.model.getWidthScale("foreL"), 0.5);
  near(sk.model.getWidthScale("handL"), 1);
  near(sk.getBoneMobject("foreL").strokeWidth, 4);
  near(sk.getBoneMobject("handL").strokeWidth, 8);
  sk.model.setLength("armL", 1);
  sk.refresh();
  near(sk.getBoneMobject("foreL").strokeWidth, 8);
  assert.throws(() => new ConstraintSet(new SkeletonModel(rig4())).add({ type: "stretch", driver: "armL", widthBones: ["armL"] }), /widthBones/);
});

test("stretch: fingerprint unchanged unless the new options are used", () => {
  const m = new SkeletonModel(rig4());
  const cs = new ConstraintSet(m);
  cs.add({ type: "stretch", id: "s", driver: "armL", min: 0.5 });
  const base = cs.fingerprint();
  assert.equal(base, "s=1::0.5:");
  const cs2 = new ConstraintSet(new SkeletonModel(rig4()));
  cs2.add({ type: "stretch", id: "s", driver: "armL", min: 0.5, widthResponse: 1 });
  assert.notEqual(cs2.fingerprint(), base);
});

// --- 5. fixed point ----------------------------------------------------------
const fixRig = () => [
  { id: "spine", length: 2, angle: Math.PI / 2 },
  { id: "armL", parent: "spine", length: 1, angle: Math.PI / 2 },
  { id: "armR", parent: "spine", length: 1, angle: -Math.PI / 2 },
  { id: "mid", parent: "spine", length: 0.1, angle: 0 },
];

test("fixed point: default is one pass and byte-identical; iterations converge a self-referencing slide", () => {
  const build = (opts?: { iterations?: number; tolerance?: number }) => {
    const m = new SkeletonModel(fixRig());
    const cs = new ConstraintSet(m, opts);
    cs.add({ type: "connector", id: "c", bone: "mid", a: "armL", b: "armR", slide: () => 0.2 + 0.25 * m.getLength("mid") * 1 });
    return { m, cs };
  };
  // slide depends on the driven bone's own length via a callback: s = 0.2 + 0.25*|2s-1| -> fixed point 0.3
  const one = build(); const r1 = one.cs.apply();
  assert.equal(r1.passes, 1);
  const dflt = build(); dflt.cs.apply();
  assert.deepStrictEqual(one.m.getPose(), dflt.m.getPose());
  const many = build({ iterations: 60, tolerance: 1e-12 });
  const r = many.cs.apply();
  assert.ok(r.passes > 1 && r.passes <= 60, `passes ${r.passes}`);
  assert.ok(r.residual <= 1e-12 || r.passes === 60);
  const a = many.m.jointPosition("armL"), b = many.m.jointPosition("armR"), e = many.m.jointPosition("mid");
  const s = 0.2 + 0.25 * many.m.getLength("mid");
  nearPt(e, [a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1])], 1e-9);
  // a single pass is NOT self-consistent
  const sOne = 0.2 + 0.25 * one.m.getLength("mid");
  const eo = one.m.jointPosition("mid");
  assert.ok(Math.abs(eo[0] - (a[0] + sOne * (b[0] - a[0]))) > 1e-4);
  assert.throws(() => new ConstraintSet(new SkeletonModel(fixRig()), { iterations: 0 }), /iterations/);
});

test("fixed point: Skeleton.ensureConstraints(opts) and refresh use it; fingerprint unchanged by default", () => {
  const sk = new Skeleton(fixRig());
  const cs = sk.ensureConstraints({ iterations: 40 });
  assert.equal(cs.iterations, 40);
  const plain = new Skeleton(fixRig()).ensureConstraints();
  assert.equal(plain.iterations, 1);
  assert.equal(plain.fingerprint(), "");
  plain.add({ type: "angleLock", id: "l", bone: "mid", reference: "world", multiplier: 0 });
  assert.ok(!plain.fingerprint().includes("iter"));
  plain.iterations = 3; plain.tolerance = 1e-6;
  assert.ok(plain.fingerprint().includes("iter"));
  assert.ok(cs.fingerprint() === "" || cs.fingerprint().includes("iter"));
});
