// IK solvers + IKChain (epic #61, #66). Tests written first.
import { test } from "node:test";
import assert from "node:assert";
import { solveTwoBone, solveFABRIK, IKChain, ikTarget, ikTargetXY } from "../src/mobject/ik.ts";
import { Skeleton } from "../src/mobject/skeleton.ts";
import { SkeletonModel } from "../src/mobject/skeleton_model.ts";
import { PoseTween } from "../src/animation/pose.ts";
import { ValueTracker } from "../src/mobject/value_tracker.ts";
import { ComplexValueTracker } from "../src/mobject/complex_value_tracker.ts";
import { KeyframeTrack } from "../src/animation/keyframe_track.ts";
import { Scene } from "../src/scene/Scene.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test("solveTwoBone: reachable target is hit exactly, lengths preserved", () => {
  const r = solveTwoBone([0, 0], 1, 1, [1, 1], "left");
  assert.equal(r.reached, true);
  near(dist(r.end, [1, 1]), 0);
  near(dist([0, 0], r.mid), 1);
  near(dist(r.mid, r.end), 1);
  assert.equal(r.scale, 1);
});

test("solveTwoBone: left/right pick opposite sides of the root->target line", () => {
  const l = solveTwoBone([0, 0], 1, 1, [1.5, 0], "left");
  const rr = solveTwoBone([0, 0], 1, 1, [1.5, 0], "right");
  assert.ok(l.mid[1] > 0 && rr.mid[1] < 0);
  near(l.mid[0], rr.mid[0]);
  near(l.mid[1], -rr.mid[1]);
  // "left" = counter-clockwise side of the direction of travel, also when aiming down
  const d = solveTwoBone([0, 0], 1, 1, [0, -1.5], "left");
  assert.ok(d.mid[0] > 0);
});

test("solveTwoBone: out of reach -> straight extended limb", () => {
  const r = solveTwoBone([0, 0], 1, 1, [4, 0]);
  assert.equal(r.reached, false);
  near(r.end[0], 2); near(r.end[1], 0); near(r.mid[0], 1); near(r.mid[1], 0);
  assert.equal(r.scale, 1);
});

test("solveTwoBone: allowStretch scales both bones uniformly to reach", () => {
  const r = solveTwoBone([0, 0], 1, 3, [8, 0], "left", { allowStretch: true });
  assert.equal(r.reached, true);
  near(r.scale, 2);
  near(r.end[0], 8); near(r.mid[0], 2);
});

test("solveTwoBone: too close (inside |l1-l2|) is clamped, finite", () => {
  const r = solveTwoBone([0, 0], 2, 1, [0.1, 0]);
  assert.equal(r.reached, false);
  assert.ok(Number.isFinite(r.mid[0]) && Number.isFinite(r.end[0]));
  near(dist([0, 0], r.mid), 2); near(dist(r.mid, r.end), 1);
});

test("solveTwoBone: target on the root and zero lengths are finite and deterministic", () => {
  const a = solveTwoBone([0, 0], 1, 1, [0, 0]);
  const b = solveTwoBone([0, 0], 1, 1, [0, 0]);
  assert.deepEqual(a, b);
  assert.ok(Number.isFinite(a.end[0]) && Number.isFinite(a.mid[1]));
  const z = solveTwoBone([0, 0], 0, 0, [3, 3]);
  assert.ok(Number.isFinite(z.end[0]));
});

test("solveFABRIK: reaches a reachable target within tolerance, root fixed, lengths kept", () => {
  const pts: [number, number][] = [[0, 0], [1, 0], [2, 0], [3, 0]];
  const lens = [1, 1, 1];
  const r = solveFABRIK(pts, lens, [1.5, 1.5]);
  assert.equal(r.reached, true);
  assert.ok(dist(r.points[3], [1.5, 1.5]) < 1e-3);
  assert.deepEqual(r.points[0], [0, 0]);
  for (let i = 0; i < 3; i++) near(dist(r.points[i], r.points[i + 1]), 1, 1e-6);
  assert.deepEqual(pts[3], [3, 0], "input not mutated");
});

test("solveFABRIK: out of reach -> straight; stretch scales lengths", () => {
  const pts: [number, number][] = [[0, 0], [1, 0], [2, 0]];
  const r = solveFABRIK(pts, [1, 1], [0, 5]);
  assert.equal(r.reached, false);
  near(r.points[2][0], 0); near(r.points[2][1], 2);
  const s = solveFABRIK(pts, [1, 1], [0, 5], { allowStretch: true });
  assert.equal(s.reached, true);
  near(s.scale, 2.5);
  near(s.points[2][1], 5);
});

test("solveFABRIK: deterministic, collinear start with off-axis target is finite", () => {
  const pts: [number, number][] = [[0, 0], [1, 0], [2, 0], [3, 0]];
  const a = solveFABRIK(pts, [1, 1, 1], [0, 1]);
  const b = solveFABRIK(pts, [1, 1, 1], [0, 1]);
  assert.deepEqual(a, b);
  assert.ok(a.points.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])));
  // a single bone is just a rotation toward the target
  const one = solveFABRIK([[0, 0], [1, 0]], [1], [0, 3]);
  near(one.points[1][0], 0); near(one.points[1][1], 1);
});

function leg(config: Record<string, unknown> = {}) {
  return new Skeleton([
    { id: "hip", parent: null, length: 1, angle: -Math.PI / 2 },
    { id: "shin", parent: "hip", length: 1, angle: 0.5 },
  ], config);
}

test("IKChain: two-bone chain drives the effector onto the target", () => {
  const s = leg();
  const chain = new IKChain(s, { bones: ["hip", "shin"], target: [0.7, -1.2], bendSide: "left" });
  const r = chain.solve();
  assert.equal(r.reached, true);
  const e = s.model.jointPosition("shin");
  near(e[0], 0.7, 1e-6); near(e[1], -1.2, 1e-6);
  near(s.model.getLength("hip"), 1); near(s.model.getLength("shin"), 1);
  // geometry was refreshed
  const bone = s.getBoneMobject("shin");
  assert.ok(bone.points.length > 0);
});

test("IKChain: bend sides give mirrored knees; auto keeps the current branch", () => {
  const mk = (side: "left" | "right" | "auto") => {
    const s = leg(); const c = new IKChain(s, { bones: ["hip", "shin"], target: [0, -1.5], bendSide: side }); c.solve();
    return s.model.jointPosition("hip");
  };
  const L = mk("left"), R = mk("right");
  near(L[0], -R[0]); assert.ok(L[0] > 0 && R[0] < 0);
  // auto: start bent to the right (knee at +x); follow a target that moves across
  const s = leg(); // shin angle 0.5 => knee initially at x=0 bent; hip pointing down, shin ccw => end at +x, knee left? compute explicitly
  const k0 = s.model.jointPosition("hip"), e0 = s.model.jointPosition("shin");
  const side0 = Math.sign(e0[0] * k0[1] - e0[1] * k0[0]); // cross(end, mid)>0 => left
  const c = new IKChain(s, { bones: ["hip", "shin"], target: () => [0.3, -1.7], bendSide: "auto" });
  c.solve();
  const k1 = s.model.jointPosition("hip"), e1 = s.model.jointPosition("shin");
  const side1 = Math.sign(e1[0] * k1[1] - e1[1] * k1[0]);
  assert.equal(side1, side0);
  // sweep the target through full extension and back: branch must not flip
  const sweep = [[0.3, -1.7], [0, -1.99], [0, -2.5], [0, -1.99], [0.3, -1.7], [0.6, -1.2]];
  let i = 0; const c2 = new IKChain(s, { bones: ["hip", "shin"], target: () => sweep[i] as number[], bendSide: "auto" });
  for (i = 0; i < sweep.length; i++) {
    c2.solve();
    const k = s.model.jointPosition("hip"), e = s.model.jointPosition("shin");
    const cr = e[0] * k[1] - e[1] * k[0];
    if (Math.abs(cr) > 1e-6) assert.equal(Math.sign(cr), side0, `flipped at step ${i}`);
  }
});

test("IKChain: out of reach without/with stretch", () => {
  const s = leg();
  const c = new IKChain(s, { bones: ["hip", "shin"], target: [0, -5] });
  const r = c.solve();
  assert.equal(r.reached, false);
  near(s.model.jointPosition("shin")[1], -2);
  const s2 = leg();
  const c2 = new IKChain(s2, { bones: ["hip", "shin"], target: [0, -5], allowStretch: true });
  assert.equal(c2.solve().reached, true);
  near(s2.model.jointPosition("shin")[1], -5);
  near(s2.model.getLength("hip"), 2.5);
  // back in reach: authored lengths are restored
  c2.target = ikTarget([0.5, -1]);
  c2.solve();
  near(s2.model.getLength("hip"), 1); near(s2.model.getLength("shin"), 1);
});

test("IKChain: longer chain uses FABRIK", () => {
  const s = new Skeleton([
    { id: "a", parent: null, length: 1, angle: 0 },
    { id: "b", parent: "a", length: 1 },
    { id: "c", parent: "b", length: 1 },
    { id: "d", parent: "c", length: 1 },
  ]);
  const c = new IKChain(s, { bones: ["a", "b", "c", "d"], target: [1, 2] });
  assert.equal(c.solve().reached, true);
  const e = s.model.jointPosition("d");
  assert.ok(dist(e, [1, 2]) < 1e-3);
  for (const id of ["a", "b", "c", "d"]) near(s.model.getLength(id), 1);
});

test("IKChain: respects model placement (root offset, rotation, scale)", () => {
  const s = leg({ root: [2, 1], scale: 2 });
  const c = new IKChain(s, { bones: ["hip", "shin"], target: [3, -1] });
  c.solve();
  const e = s.model.jointPosition("shin");
  near(e[0], 3, 1e-6); near(e[1], -1, 1e-6);
});

test("IKChain: pin plants the effector in world space while the root moves", () => {
  const s = leg();
  const c = new IKChain(s, { bones: ["hip", "shin"], target: [9, 9] });
  s.setPose({ bones: { hip: { angle: -Math.PI / 2 }, shin: { angle: 0.6 } } });
  c.pin();
  const planted = s.model.jointPosition("shin");
  s.model.setPlacement({ root: [0.1, -0.2] }); // move the body
  c.solve();
  const e = s.model.jointPosition("shin");
  near(e[0], planted[0], 1e-6); near(e[1], planted[1], 1e-6);
  c.unpin();
  c.solve();
  assert.ok(dist(s.model.jointPosition("shin"), [9, 9]) > 1, "back to following the (unreachable) target");
  c.pin([0.2, -1]);
  c.solve();
  near(s.model.jointPosition("shin")[0], 0.2, 1e-6);
});

test("IKChain: validation", () => {
  const s = leg();
  assert.throws(() => new IKChain(s, { bones: [], target: [0, 0] }));
  assert.throws(() => new IKChain(s, { bones: ["shin", "hip"], target: [0, 0] }), /parent/);
  assert.throws(() => new IKChain(s, { bones: ["nope"], target: [0, 0] }), /unknown/);
  const m = new SkeletonModel([{ id: "x", length: 1 }]);
  assert.doesNotThrow(() => new IKChain(m, { bones: ["x"], target: [0, 1] })); // bare model works
});

test("ikTarget adapters", () => {
  assert.deepEqual(ikTarget([1, 2])(), [1, 2]);
  assert.deepEqual(ikTarget(() => [3, 4, 5])(), [3, 4]);
  const x = new ValueTracker(1), y = new ValueTracker(2);
  const f = ikTargetXY(x, y);
  x.setValue(5);
  assert.deepEqual(f(), [5, 2]);
  const z = new ComplexValueTracker({ re: 2, im: -1 });
  assert.deepEqual(ikTarget(z)(), [2, -1]);
  let t = 0;
  const f2 = ikTarget({ track: new KeyframeTrack<number[]>([{ t: 0, value: [0, 0] }, { t: 2, value: [2, 4] }]), time: () => t });
  t = 1;
  assert.deepEqual(f2(), [1, 2]);
  assert.throws(() => ikTarget(42 as any));
});

test("IKChain.attach: updater re-solves as the target tracker changes; detach stops it", () => {
  const s = leg();
  const x = new ValueTracker(0.5), y = new ValueTracker(-1);
  const c = new IKChain(s, { bones: ["hip", "shin"], target: ikTargetXY(x, y) }).attach();
  s.update(1 / 30);
  near(s.model.jointPosition("shin")[0], 0.5);
  x.setValue(-0.5);
  s.update(1 / 30);
  near(s.model.jointPosition("shin")[0], -0.5);
  c.detach();
  x.setValue(0.9);
  s.update(1 / 30);
  near(s.model.jointPosition("shin")[0], -0.5);
});

test("IK vs PoseTween: suspended updater freezes IK; `ik` option re-solves each frame; suspend:false keeps updater live", () => {
  const build = () => {
    const s = leg();
    const c = new IKChain(s, { bones: ["hip", "shin"], target: [0.4, -1.5] }).attach();
    return { s, c };
  };
  const tweenTo = (s: Skeleton, cfg: any) => {
    const tw = new PoseTween(s, { root: [1, 0] }, cfg);
    tw.begin();
    // what Scene.play does around the animation, then a frame of the update loop
    if (tw.suspendMobjectUpdating) s.suspendUpdating();
    tw.interpolate(1);
    s.update(1 / 30);
    return s.model.jointPosition("shin");
  };
  // default: updaters suspended -> IK never re-solves, the foot is dragged with the body
  const { s: s1 } = build();
  const e1 = tweenTo(s1, { runTime: 0.5 });
  assert.ok(Math.abs(e1[0] - 0.4) > 0.5, "frozen IK follows the tween only");
  // ik option: the tween re-solves the chain after every pose write
  const { s: s2, c: c2 } = build();
  const e2 = tweenTo(s2, { runTime: 0.5, ik: c2 });
  near(e2[0], 0.4, 1e-6); near(e2[1], -1.5, 1e-6);
  // suspendMobjectUpdating:false -> the attached updater runs during the tween
  const { s: s3 } = build();
  const e3 = tweenTo(s3, { runTime: 0.5, suspendMobjectUpdating: false });
  near(e3[0], 0.4, 1e-6);
});

test("IKChain.update-less skeleton behaviour is untouched (byte-identical with no chain)", () => {
  const a = leg(), b = leg();
  new IKChain(a, { bones: ["hip", "shin"], target: [1, -1] }); // constructed, never solved/attached
  a.setPose({ bones: { shin: { angle: 0.2 } } }); b.setPose({ bones: { shin: { angle: 0.2 } } });
  assert.deepEqual(a.model.getPose(), b.model.getPose());
  assert.deepEqual(a.getBoneMobject("shin").points, b.getBoneMobject("shin").points);
});
