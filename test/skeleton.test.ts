// Skeleton mobject + pose tweening (epic #61, #64).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Skeleton } from "../src/mobject/skeleton.ts";
import { PoseTween, PoseLibrary, poseTrack } from "../src/animation/pose.ts";
import { lerpPose } from "../src/mobject/skeleton_model.ts";
import type { BoneSpec, Pose } from "../src/mobject/skeleton_model.ts";
import { Transform } from "../src/animation/Animation.ts";
import { KeyframeTrack, PlayKeyframeTrack } from "../src/animation/keyframe_track.ts";
import { Mobject } from "../src/mobject/Mobject.ts";
import { registerBuiltins } from "../src/plugins/builtins.ts";
import { registry } from "../src/plugins/registry.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const nearPt = (p: number[], q: number[], eps = 1e-6) => { near(p[0], q[0], eps); near(p[1], q[1], eps); };

const ARM: BoneSpec[] = [
  { id: "upper", parent: null, length: 2, angle: 0, zIndex: 1 },
  { id: "fore", parent: "upper", length: 1, angle: Math.PI / 2, zIndex: 2, width: 6 },
];
const bone = (s: Skeleton, id: string) => s.getBoneMobject(id);
const ends = (m: Mobject) => [m.points[0], m.points[m.points.length - 1]];
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test("Skeleton builds one mobject per bone whose endpoints match FK", () => {
  const s = new Skeleton(ARM);
  const [a, b] = ends(bone(s, "fore"));
  nearPt(a, [2, 0]);
  nearPt(b, [2, 1]);
  assert.equal(bone(s, "fore").strokeWidth, 6);
});

test("setPose/getPose move geometry; bends render as arcs with the same endpoints", () => {
  const s = new Skeleton(ARM);
  s.setPose({ bones: { upper: { angle: Math.PI / 2, bend: 1 } } });
  assert.equal(s.getPose().bones.upper.bend, 1);
  const up = bone(s, "upper");
  const [a, b] = ends(up);
  nearPt(a, [0, 0]);
  nearPt(b, [0, 2]);
  const mid = up.pointFromProportion(0.5);
  assert.ok(Math.abs(mid[0]) > 0.1, "arc bulges off the chord");
  nearPt(ends(bone(s, "fore"))[0], [0, 2]);
});

test("joints, heads and fills follow the pose", () => {
  const s = new Skeleton(ARM, {
    joints: true,
    heads: [{ joint: "fore", radius: 0.25 }],
    fills: [{ joints: ["root", "upper", "fore"], color: "#ff0000" }],
  });
  const fam = s.submobjects;
  assert.equal(fam.length, 1 + 2 + 1 + 3); // fill + bones + head + joints (root, upper, fore)
  s.setPose({ bones: { upper: { angle: Math.PI } } });
  const head = s.getHeadMobject(0);
  nearPt(head.getCenter(), s.model.jointPosition("fore"), 1e-6);
  assert.equal(s.fillMobjects.length, 1);
});

test("copy() deep-clones the model: independent poses, same geometry", () => {
  const s = new Skeleton(ARM, { joints: true });
  s.setPose({ bones: { upper: { angle: 1 } } });
  const c = s.copy();
  assert.notEqual(c.model, s.model);
  assert.deepEqual(c.getPose(), s.getPose());
  c.setPose({ bones: { upper: { angle: -1 } } });
  near(s.getPose().bones.upper.angle, 1);
  nearPt(ends(bone(s, "upper"))[1], [2 * Math.cos(1), 2 * Math.sin(1)]);
  nearPt(ends(bone(c, "upper"))[1], [2 * Math.cos(-1), 2 * Math.sin(-1)]);
  assert.notEqual(bone(c, "upper"), bone(s, "upper"));
});

test("shift/scale/rotate keep the model in sync (placement follows the group)", () => {
  const s = new Skeleton(ARM);
  s.shift([1, 2, 0]);
  nearPt(s.model.root, [1, 2]);
  nearPt(s.model.jointPosition("fore"), [3, 3]);
  s.scale(2, { aboutPoint: [1, 2, 0] });
  near(s.model.scale, 2);
  nearPt(s.model.jointPosition("fore"), [5, 4]);
  s.rotate(Math.PI / 2, { aboutPoint: [1, 2, 0] });
  near(s.model.rotation, Math.PI / 2);
  s.setPose({ bones: { fore: { angle: 0 } } }); // rebuild from model: no snap-back
  nearPt(ends(bone(s, "upper"))[0], [1, 2]);
  nearPt(s.model.jointPosition("upper"), [1, 6]);
  nearPt(ends(bone(s, "upper"))[1], [1, 6]);
  s.moveTo([0, 0, 0]);
  nearPt(s.getCenter(), [0, 0]);
});

test("interpolate() blends poses, never joint points: limb lengths invariant", () => {
  const a = new Skeleton(ARM);
  const b = new Skeleton(ARM);
  b.setPose({ bones: { upper: { angle: 2.8 }, fore: { angle: -2.8 } } });
  const live = a.copy();
  for (let i = 0; i <= 20; i++) {
    live.interpolate(a, b, i / 20);
    const u = live.model.jointPosition("upper"), f = live.model.jointPosition("fore");
    near(dist([0, 0], u), 2);
    near(dist(u, f), 1);
    // drawn geometry agrees with the model
    nearPt(ends(bone(live, "fore"))[1], f);
  }
  // 0.5 is the pose blend, not the average of end joints (which would shrink the arm)
  live.interpolate(a, b, 0.5);
  near(live.model.getAngle("upper"), 1.4);
});

test(".animate.setPose(p) works and Transform between two skeletons works", () => {
  const s = new Skeleton(ARM);
  const target: Pose = { ...s.getPose(), bones: { ...s.getPose().bones, upper: { angle: 1, length: 3, bend: 0 } } };
  const anim = s.animate.setPose(target).build() as Transform;
  anim.begin();
  anim.interpolate(1);
  anim.finish();
  near(s.getPose().bones.upper.angle, 1);
  near(s.getPose().bones.upper.length, 3);
  nearPt(ends(bone(s, "upper"))[1], [3 * Math.cos(1), 3 * Math.sin(1)]);

  const x = new Skeleton(ARM);
  const y = new Skeleton(ARM);
  y.setPose({ bones: { upper: { angle: -1 } } });
  const t = new Transform(x, y, { runTime: 1 });
  t.begin();
  t.interpolate(0.5);
  near(x.getPose().bones.upper.angle, -0.5);
  t.finish();
  near(x.getPose().bones.upper.angle, -1);
  near(y.getPose().bones.upper.angle, -1);
});

test("PoseTween: tweens a (partial) pose or a named pose, keeps lengths, shortest arc", () => {
  const s = new Skeleton(ARM);
  s.setPose({ bones: { upper: { angle: 170 * Math.PI / 180 } } });
  const tw = new PoseTween(s, { bones: { upper: { angle: -170 * Math.PI / 180 } } }, { runTime: 1, rateFunc: (t: number) => t });
  tw.begin();
  tw.interpolate(0.5);
  near(Math.cos(s.model.getAngle("upper")), -1);
  near(dist([0, 0], s.model.jointPosition("upper")), 2);
  tw.finish();
  near(s.model.getAngle("upper"), -170 * Math.PI / 180);
  assert.equal(tw.startState, undefined, "no default start-state copy (PlayKeyframeTrack.begin model)");

  const lib = new PoseLibrary();
  lib.set("up", { bones: { upper: { angle: Math.PI / 2 } } });
  assert.ok(lib.has("up"));
  assert.deepEqual(lib.names(), ["up"]);
  const t2 = lib.tween(s, "up", { runTime: 1 });
  t2.begin(); t2.finish();
  near(s.model.getAngle("upper"), Math.PI / 2);
  assert.throws(() => lib.tween(s, "nope"), /unknown pose/i);
  lib.capture("snap", s);
  assert.deepEqual(lib.get("snap"), s.getPose());
  assert.deepEqual(PoseLibrary.fromJSON(lib.toJSON()).names(), ["up", "snap"]);
});

test("KeyframeTrack<Pose> via poseTrack, bound with setTime and PlayKeyframeTrack", () => {
  const s = new Skeleton(ARM);
  const p0 = s.getPose();
  const p1 = { ...p0, bones: { ...p0.bones, upper: { angle: 2, length: 2, bend: 0 } } };
  const track = poseTrack([{ t: 0, value: p0 }, { t: 2, value: p1 }]);
  assert.ok(track instanceof KeyframeTrack);
  assert.throws(() => s.setTime(1), /no pose track/i);
  s.bindPoseTrack(track);
  s.setTime(1);
  near(s.model.getAngle("upper"), 1);
  s.setTime(0);
  near(s.model.getAngle("upper"), 0);
  s.setTime(1.5);
  const copy = s.copy();
  copy.setTime(2);
  near(copy.model.getAngle("upper"), 2);
  near(s.model.getAngle("upper"), 1.5);

  const s2 = new Skeleton(ARM);
  const play = new PlayKeyframeTrack(s2, track, (m, v) => m.setPose(v), { rateFunc: (t: number) => t });
  play.begin(); play.interpolate(0.5);
  near(s2.model.getAngle("upper"), 1);
  assert.deepEqual(lerpPose(p0, p1, 0).bones.upper, p0.bones.upper);
});

test("per-bone zIndex is an offset that survives parent setZIndex", () => {
  const s = new Skeleton(ARM, { joints: true });
  assert.equal(bone(s, "upper").zIndex, 1);
  assert.equal(bone(s, "fore").zIndex, 2);
  s.setZIndex(10);
  assert.equal(s.zIndex, 10);
  assert.equal(bone(s, "upper").zIndex, 11);
  assert.equal(bone(s, "fore").zIndex, 12);
  s.setBoneZIndex("upper", 5);
  assert.equal(bone(s, "upper").zIndex, 15);
  const c = s.copy();
  assert.equal(c.getBoneMobject("upper").zIndex, 15);
  c.setZIndex(0);
  assert.equal(c.getBoneMobject("upper").zIndex, 5);
  assert.equal(s.getBoneMobject("upper").zIndex, 15);
});

test("refresh() rebuilds geometry after another module drives the model", () => {
  const s = new Skeleton(ARM);
  s.model.setAngle("upper", 1);
  nearPt(ends(bone(s, "upper"))[1], [2, 0]); // stale until refresh
  s.refresh();
  nearPt(ends(bone(s, "upper"))[1], [2 * Math.cos(1), 2 * Math.sin(1)]);
});

test("registerBuiltins registers Skeleton and PoseTween", () => {
  registerBuiltins();
  assert.equal(registry.get("mobject", "Skeleton"), Skeleton);
  assert.equal(registry.get("animation", "PoseTween"), PoseTween);
});
