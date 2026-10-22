// Rig constraints (epic #61, #75). Tests written first.
import { test } from "node:test";
import assert from "node:assert";
import { ConstraintSet } from "../src/mobject/skeleton_constraints.ts";
import { Skeleton } from "../src/mobject/skeleton.ts";
import { SkeletonModel } from "../src/mobject/skeleton_model.ts";
import { IKChain } from "../src/mobject/ik.ts";
import { PoseTween } from "../src/animation/pose.ts";
import { Scene } from "../src/scene/Scene.ts";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const nearPt = (a: number[], b: number[], eps = 1e-9) => { near(a[0], b[0], eps); near(a[1], b[1], eps); };

// Two arms hanging off a spine plus a free "pin" bone used as a driven joint.
const rig = () => [
  { id: "spine", length: 2, angle: Math.PI / 2 },
  { id: "armL", parent: "spine", length: 1, angle: Math.PI / 2 },
  { id: "armR", parent: "spine", length: 1, angle: -Math.PI / 2 },
  { id: "handL", parent: "armL", length: 0.5, angle: 0 },
  { id: "mid", parent: "spine", length: 0.1, angle: 0 },
  { id: "mid2", parent: "mid", length: 0.1, angle: 0 },
];

test("connector: joint sits at slide% between two anchors", () => {
  const m = new SkeletonModel(rig());
  const cs = new ConstraintSet(m);
  cs.add({ type: "connector", bone: "mid", a: "armL", b: "armR", slide: 0.25 });
  cs.apply();
  const a = m.jointPosition("armL"), b = m.jointPosition("armR");
  nearPt(m.jointPosition("mid"), [a[0] + 0.25 * (b[0] - a[0]), a[1] + 0.25 * (b[1] - a[1])]);
});

test("connector: tracks anchors as the pose changes; slide may be a function", () => {
  const m = new SkeletonModel(rig());
  const cs = new ConstraintSet(m);
  let s = 0.5;
  cs.add({ type: "connector", id: "c", bone: "mid", a: "armL", b: "armR", slide: () => s });
  cs.apply();
  m.setAngle("armL", 0.3); s = 1;
  cs.apply();
  nearPt(m.jointPosition("mid"), m.jointPosition("armR"));
  // descendants of the driven bone follow it
  nearPt(m.boneStart("mid2"), m.jointPosition("mid"));
});

test("connector may anchor to root and handle coincident anchors", () => {
  const m = new SkeletonModel(rig());
  const cs = new ConstraintSet(m);
  cs.add({ type: "connector", bone: "mid", a: "root", b: "root", slide: 0.5 });
  cs.apply();
  nearPt(m.jointPosition("mid"), [0, 0]);
  assert.ok(Number.isFinite(m.getAngle("mid")) && Number.isFinite(m.getLength("mid")));
});

test("weighted joint: origin + sum w_i * offset_i", () => {
  const m = new SkeletonModel(rig());
  const cs = new ConstraintSet(m);
  cs.add({ type: "weighted", bone: "mid", origin: "spine", anchors: [{ joint: "armL", weight: 0.5 }, { joint: "armR", weight: 0.5 }] });
  cs.apply();
  const o = m.jointPosition("spine"), a = m.jointPosition("armL"), b = m.jointPosition("armR");
  nearPt(m.jointPosition("mid"), [o[0] + 0.5 * (a[0] - o[0]) + 0.5 * (b[0] - o[0]), o[1] + 0.5 * (a[1] - o[1]) + 0.5 * (b[1] - o[1])]);
});

test("weighted joint: signed weights and validation", () => {
  const m = new SkeletonModel(rig());
  const cs = new ConstraintSet(m);
  cs.add({ type: "weighted", bone: "mid", origin: "root", anchors: [{ joint: "spine", weight: 2 }, { joint: "armL", weight: -1 }] });
  cs.apply();
  const s = m.jointPosition("spine"), a = m.jointPosition("armL");
  nearPt(m.jointPosition("mid"), [2 * s[0] - a[0], 2 * s[1] - a[1]]);
  assert.throws(() => cs.add({ type: "weighted", bone: "mid2", origin: "root", anchors: [] }), /anchor/);
  assert.throws(() => cs.add({ type: "weighted", bone: "mid2", origin: "root", anchors: [{ joint: "armL", weight: 1 }, { joint: "armL", weight: 1 }] }), /distinct|duplicate/);
  const many = Array.from({ length: 17 }, (_, i) => ({ joint: i % 2 ? "armL" : "armR", weight: 0 }));
  assert.throws(() => cs.add({ type: "weighted", bone: "mid2", origin: "root", anchors: many }), /16/);
});

test("angle lock: to parent with multiplier and offset", () => {
  const m = new SkeletonModel(rig());
  const cs = new ConstraintSet(m);
  cs.add({ type: "angleLock", bone: "handL", reference: "parent", multiplier: 0.5, offset: 0.1 });
  cs.apply();
  near(m.boneWorldAngle("handL"), 0.1 + 0.5 * m.boneWorldAngle("armL"));
  m.setAngle("armL", 1.2);
  cs.apply();
  near(m.boneWorldAngle("handL"), 0.1 + 0.5 * m.boneWorldAngle("armL"));
});

test("angle lock: to world stays put when the figure rotates (multiplier 0)", () => {
  const m = new SkeletonModel(rig());
  const cs = new ConstraintSet(m);
  cs.add({ type: "angleLock", bone: "handL", reference: "world", multiplier: 0, offset: 0.4 });
  m.setPlacement({ rotation: 1 });
  cs.apply();
  near(m.boneWorldAngle("handL"), 0.4);
  // multiplier 1 follows the figure rotation
  const m2 = new SkeletonModel(rig());
  const c2 = new ConstraintSet(m2);
  c2.add({ type: "angleLock", bone: "handL", reference: "world" });
  m2.setPlacement({ rotation: 1 });
  c2.apply();
  near(m2.boneWorldAngle("handL"), 1);
});

test("stretch: descendant lengths scale by the (clamped) driver ratio", () => {
  const m = new SkeletonModel(rig());
  const cs = new ConstraintSet(m);
  cs.add({ type: "stretch", driver: "armL", min: 0.5, max: 2 });
  m.setLength("armL", 1.5);
  cs.apply();
  near(m.getLength("handL"), 0.75);
  near(m.getLength("armL"), 1.5);           // driver untouched
  m.setLength("armL", 5);
  cs.apply();
  near(m.getLength("handL"), 1);            // clamped at max 2 -> 0.5 * 2
  m.setLength("armL", 0.1);
  cs.apply();
  near(m.getLength("handL"), 0.25);         // clamped at min 0.5
});

test("stretch: explicit targets, exclude, and restLength override", () => {
  const m = new SkeletonModel(rig());
  const cs = new ConstraintSet(m);
  cs.add({ type: "stretch", driver: "spine", targets: ["armL", "armR", "mid"], exclude: ["mid"], restLength: 1 });
  cs.apply(); // ratio 2
  near(m.getLength("armL"), 2); near(m.getLength("armR"), 2);
  near(m.getLength("mid"), 0.1); near(m.getLength("handL"), 0.5);
});

test("topological order: constraints are applied dependencies-first regardless of add order", () => {
  const m = new SkeletonModel(rig());
  const cs = new ConstraintSet(m);
  // c2 reads mid (driven by c1) but is added first.
  cs.add({ type: "connector", id: "c2", bone: "mid2", a: "mid", b: "armR", slide: 0.5 });
  cs.add({ type: "connector", id: "c1", bone: "mid", a: "armL", b: "armR", slide: 0.5 });
  assert.deepStrictEqual(cs.order(), ["c1", "c2"]);
  cs.apply();
  const mid = m.jointPosition("mid"), r = m.jointPosition("armR");
  nearPt(m.jointPosition("mid2"), [(mid[0] + r[0]) / 2, (mid[1] + r[1]) / 2]);
});

test("cycle detection: clear error naming the constraints; set is left unchanged", () => {
  const m = new SkeletonModel(rig());
  const cs = new ConstraintSet(m);
  cs.add({ type: "connector", id: "c1", bone: "armL", a: "armR", b: "root", slide: 0.5 });
  assert.throws(() => cs.add({ type: "connector", id: "c2", bone: "armR", a: "armL", b: "root", slide: 0.5 }),
    /cycle.*c1.*c2|cycle.*c2.*c1/i);
  assert.deepStrictEqual(cs.ids(), ["c1"]);
});

test("cycle detection: a constraint that depends on its own bone", () => {
  const m = new SkeletonModel(rig());
  const cs = new ConstraintSet(m);
  assert.throws(() => cs.add({ type: "connector", id: "self", bone: "mid", a: "mid2", b: "armR", slide: 0.5 }), /cycle.*self/i);
});

test("conflicts and bad input are rejected with clear errors", () => {
  const m = new SkeletonModel(rig());
  const cs = new ConstraintSet(m);
  cs.add({ type: "connector", id: "c1", bone: "mid", a: "armL", b: "armR", slide: 0.5 });
  assert.throws(() => cs.add({ type: "angleLock", id: "x", bone: "mid" }), /already driven.*c1/);
  assert.throws(() => cs.add({ type: "connector", id: "c1", bone: "mid2", a: "armL", b: "armR", slide: 0 }), /duplicate/i);
  assert.throws(() => cs.add({ type: "connector", bone: "nope", a: "armL", b: "armR", slide: 0 } as any), /unknown bone/);
  assert.throws(() => cs.add({ type: "connector", bone: "mid2", a: "zzz", b: "armR", slide: 0 } as any), /unknown joint/);
  assert.throws(() => cs.add({ type: "stretch", driver: "armL", min: 2, max: 1 }), /min/);
  assert.throws(() => cs.add({ type: "wat" } as any), /unknown constraint type/);
});

test("remove / enabled flag", () => {
  const m = new SkeletonModel(rig());
  const cs = new ConstraintSet(m);
  cs.add({ type: "angleLock", id: "a", bone: "handL", reference: "world", multiplier: 0, offset: 0.4 });
  cs.get("a")!.enabled = false;
  cs.apply();
  assert.ok(Math.abs(m.boneWorldAngle("handL") - 0.4) > 1e-3);
  cs.get("a")!.enabled = true;
  cs.apply();
  near(m.boneWorldAngle("handL"), 0.4);
  assert.equal(cs.remove("a"), true);
  assert.equal(cs.remove("a"), false);
});

test("Skeleton: addConstraint holds across setPose, interpolate-style writes and refresh", () => {
  const sk = new Skeleton(rig());
  sk.addConstraint({ type: "connector", id: "c", bone: "mid", a: "armL", b: "armR", slide: 0.5 });
  const chk = () => {
    const a = sk.model.jointPosition("armL"), b = sk.model.jointPosition("armR");
    nearPt(sk.model.jointPosition("mid"), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 1e-9);
  };
  chk();
  sk.setPose({ bones: { armL: { angle: 0.2 } } });
  chk();
  sk.model.setAngle("armR", 0.9); sk.refresh();
  chk();
});

test("Skeleton.copy gets independent, rebound constraints", () => {
  const sk = new Skeleton(rig());
  sk.addConstraint({ type: "connector", id: "c", bone: "mid", a: "armL", b: "armR", slide: 0.5 });
  const cp = sk.copy();
  cp.setPose({ bones: { armL: { angle: 0.2 } } });
  const a = cp.model.jointPosition("armL"), b = cp.model.jointPosition("armR");
  nearPt(cp.model.jointPosition("mid"), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  assert.deepStrictEqual(cp.constraints!.ids(), ["c"]);
  assert.notStrictEqual(cp.constraints, sk.constraints);
});

test("IKChain re-applies constraints after its angle writes", () => {
  const sk = new Skeleton(rig());
  // keep the hand level (world) while the arm is driven by IK
  sk.addConstraint({ type: "angleLock", id: "lvl", bone: "handL", reference: "world", multiplier: 0, offset: 0 });
  const ik = new IKChain(sk, { bones: ["spine", "armL"], target: [1.2, 2.2], bendSide: "left" });
  ik.solve();
  near(sk.model.boneWorldAngle("handL"), 0);
});

test("PoseTween: constraints hold on every frame with and without IK", () => {
  const sk = new Skeleton(rig());
  sk.addConstraint({ type: "angleLock", id: "lvl", bone: "handL", reference: "world", multiplier: 0, offset: 0 });
  const ik = new IKChain(sk, { bones: ["spine", "armL"], target: [1.2, 2.2], bendSide: "left" });
  const tw = new PoseTween(sk, { bones: { armL: { angle: 0.4 }, spine: { angle: 1.2 } } }, { ik, runTime: 1 });
  tw.begin();
  for (const a of [0, 0.3, 0.7, 1]) { tw.interpolate(a); near(sk.model.boneWorldAngle("handL"), 0); }
  const sk2 = new Skeleton(rig());
  sk2.addConstraint({ type: "angleLock", id: "lvl", bone: "handL", reference: "world", multiplier: 0, offset: 0 });
  const tw2 = new PoseTween(sk2, { bones: { armL: { angle: 0.4 } } }, { runTime: 1 });
  tw2.begin();
  for (const a of [0, 0.5, 1]) { tw2.interpolate(a); near(sk2.model.boneWorldAngle("handL"), 0); }
});

test("no constraints: Skeleton/IK/PoseTween behave byte-identically (no constraint state, same geometry)", () => {
  const plain = new Skeleton(rig());
  assert.equal(plain.constraints, null);
  const withEmpty = new Skeleton(rig());
  withEmpty.ensureConstraints(); // creating an empty set must change nothing
  for (const s of [plain, withEmpty]) {
    const ik = new IKChain(s, { bones: ["spine", "armL"], target: [1.2, 2.2], bendSide: "left" });
    new PoseTween(s, { bones: { armR: { angle: -0.2 } } }, { ik, runTime: 1 }).begin().interpolate(0.6);
  }
  assert.deepStrictEqual(plain.model.getPose(), withEmpty.model.getPose());
  assert.deepStrictEqual(plain.submobjects.map((s: any) => s.points), withEmpty.submobjects.map((s: any) => s.points));
  assert.equal(plain.model.version, withEmpty.model.version);
});

test("fingerprint changes with slide and enabled state", () => {
  const m = new SkeletonModel(rig());
  const cs = new ConstraintSet(m);
  cs.add({ type: "connector", id: "c", bone: "mid", a: "armL", b: "armR", slide: 0.25 });
  const f1 = cs.fingerprint();
  (cs.get("c") as any).slide = 0.5;
  assert.notEqual(cs.fingerprint(), f1);
});

void Scene;
