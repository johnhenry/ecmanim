// Pure skeletal model (epic #61, #64): FK, poses, shortest-arc lerp.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SkeletonModel, lerpPose, ROOT_JOINT } from "../src/mobject/skeleton_model.ts";
import type { BoneSpec } from "../src/mobject/skeleton_model.ts";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const nearPt = (p: number[], q: number[], eps = 1e-9) => { near(p[0], q[0], eps); near(p[1], q[1], eps); };

const ARM: BoneSpec[] = [
  { id: "upper", parent: null, length: 2, angle: 0 },
  { id: "fore", parent: "upper", length: 1, angle: Math.PI / 2 },
];

test("FK: joint world positions and per-bone world angles", () => {
  const m = new SkeletonModel(ARM);
  nearPt(m.jointPosition(ROOT_JOINT), [0, 0]);
  nearPt(m.jointPosition("upper"), [2, 0]);
  nearPt(m.jointPosition("fore"), [2, 1]);
  nearPt(m.boneStart("fore"), [2, 0]);
  near(m.boneWorldAngle("upper"), 0);
  near(m.boneWorldAngle("fore"), Math.PI / 2);
  assert.deepEqual(Object.keys(m.jointPositions()), ["root", "upper", "fore"]);
});

test("placement: root, rotation and scale feed FK", () => {
  const m = new SkeletonModel(ARM, { root: [1, 1], rotation: Math.PI / 2, scale: 2 });
  nearPt(m.jointPosition("upper"), [1, 5]);
  nearPt(m.jointPosition("fore"), [-1, 5]);
  near(m.boneWorldAngle("fore"), Math.PI);
});

test("setters invalidate the FK cache and bump version", () => {
  const m = new SkeletonModel(ARM);
  nearPt(m.jointPosition("fore"), [2, 1]);
  const v = m.version;
  m.setAngle("upper", Math.PI / 2);
  assert.ok(m.version > v);
  nearPt(m.jointPosition("fore"), [-1, 2]);
  m.setLength("upper", 3);
  nearPt(m.jointPosition("upper"), [0, 3]);
});

test("setWorldAngle sets a local angle from a desired world angle", () => {
  const m = new SkeletonModel(ARM);
  m.setAngle("upper", 0.5);
  m.setWorldAngle("fore", 2);
  near(m.boneWorldAngle("fore"), 2);
  near(m.getAngle("fore"), 1.5);
});

test("hierarchy queries and topological ordering of out-of-order input", () => {
  const m = new SkeletonModel([
    { id: "hand", parent: "fore", length: 0.3 },
    { id: "fore", parent: "upper", length: 1 },
    { id: "upper", parent: null, length: 2 },
  ]);
  assert.deepEqual([...m.ids], ["upper", "fore", "hand"]);
  assert.equal(m.parentOf("hand"), "fore");
  assert.equal(m.parentOf("upper"), null);
  assert.deepEqual(m.childrenOf("upper"), ["fore"]);
  assert.deepEqual(m.ancestorsOf("hand"), ["fore", "upper"]);
  assert.deepEqual(m.descendantsOf("upper"), ["fore", "hand"]);
  assert.deepEqual(m.rootBones(), ["upper"]);
});

test("validation: duplicate ids, unknown parent, cycles, reserved id, non-finite", () => {
  assert.throws(() => new SkeletonModel([{ id: "a", length: 1 }, { id: "a", length: 1 }]), /duplicate/i);
  assert.throws(() => new SkeletonModel([{ id: "a", parent: "zz", length: 1 }]), /unknown parent/i);
  assert.throws(() => new SkeletonModel([{ id: "a", parent: "b", length: 1 }, { id: "b", parent: "a", length: 1 }]), /cycle/i);
  assert.throws(() => new SkeletonModel([{ id: "root", length: 1 }]), /reserved/i);
  assert.throws(() => new SkeletonModel([{ id: "a", length: NaN }]), /finite/i);
  const m = new SkeletonModel(ARM);
  assert.throws(() => m.setAngle("upper", Infinity), /finite/i);
  assert.throws(() => m.setAngle("nope", 0), /unknown bone/i);
});

test("getPose/setPose round-trip; partial poses touch only listed fields; unknown ids ignored", () => {
  const m = new SkeletonModel(ARM);
  const p = m.getPose();
  assert.deepEqual(p.bones.fore, { angle: Math.PI / 2, length: 1, bend: 0 });
  p.bones.fore.angle = 0; // getPose returns a copy
  assert.equal(m.getAngle("fore"), Math.PI / 2);
  m.setPose({ bones: { fore: { angle: 1 }, ghost: { angle: 5 } } });
  assert.equal(m.getAngle("fore"), 1);
  assert.equal(m.getLength("fore"), 1);
  assert.throws(() => m.setPose({ bones: { ghost: { angle: 5 } } }, { strict: true }), /unknown bone/i);
  m.setPose(m.restPose());
  assert.equal(m.getAngle("fore"), Math.PI / 2);
});

test("clone is independent", () => {
  const a = new SkeletonModel(ARM);
  const b = a.clone();
  b.setAngle("upper", 1);
  assert.equal(a.getAngle("upper"), 0);
  assert.equal(b.getAngle("upper"), 1);
});

test("lerpPose: shortest arc, linear length/bend/root/scale, ends exact", () => {
  const a = { root: [0, 0] as [number, number], rotation: 0, scale: 1, bones: { b: { angle: 170 * Math.PI / 180, length: 1, bend: 0 } } };
  const b = { root: [2, 0] as [number, number], rotation: 0, scale: 3, bones: { b: { angle: -170 * Math.PI / 180, length: 3, bend: 1 } } };
  const mid = lerpPose(a, b, 0.5);
  near(Math.cos(mid.bones.b.angle), -1); // passes through 180deg, not 0
  near(mid.bones.b.length, 2);
  near(mid.bones.b.bend, 0.5);
  near(mid.root[0], 1);
  near(mid.scale, 2);
  assert.deepEqual(lerpPose(a, b, 0), a);
  near(lerpPose(a, b, 1).bones.b.angle, b.bones.b.angle);
});

test("lerpPose: partial poses take the present side; lengths stay invariant through a tween", () => {
  const out = lerpPose({ bones: { x: { angle: 0 } } }, { bones: { x: { angle: 1 }, y: { angle: 2 } } }, 0.5);
  near(out.bones!.x.angle!, 0.5);
  assert.equal(out.bones!.y.angle, 2);
  const m = new SkeletonModel(ARM);
  const target = { bones: { upper: { angle: 2.5 }, fore: { angle: -2.5 } } };
  const start = m.getPose();
  for (let i = 0; i <= 20; i++) {
    m.setPose(lerpPose(start, { ...start, ...target, bones: { ...start.bones, ...Object.fromEntries(Object.entries(target.bones).map(([k, v]) => [k, { ...start.bones[k], ...v }])) } } as any, i / 20));
    near(Math.hypot(m.jointPosition("upper")[0], m.jointPosition("upper")[1]), 2);
    const f = m.jointPosition("fore"), u = m.jointPosition("upper");
    near(Math.hypot(f[0] - u[0], f[1] - u[1]), 1);
  }
});
