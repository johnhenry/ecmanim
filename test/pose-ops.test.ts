// Pose operators (epic #61, #67): Breakdown / Blend to Neighbor / Relax / Push.
import { test } from "node:test";
import assert from "node:assert/strict";
import { breakdown, blendToNeighbor, relax, push, applyPoseOp, insertBreakdown, poseTrack, lerpPose } from "../src/skeletal.ts";
import type { Pose } from "../src/skeletal.ts";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const mk = (angle: number, length = 1, x = 0, scale = 1): Pose => ({
  root: [x, 0], rotation: 0, scale, bones: { a: { angle, length, bend: 0 } },
});

test("breakdown: 0 = prev, 1 = next, matches lerpPose, shortest arc", () => {
  const p = mk(0, 1, 0), n = mk(1, 3, 10);
  assert.deepEqual(breakdown(p, n, 0), p);
  assert.deepEqual(breakdown(p, n, 1), n);
  assert.deepEqual(breakdown(p, n, 0.3), lerpPose(p, n, 0.3));
  const wrap = breakdown(mk(3.0), mk(-3.0), 0.5);
  near(Math.abs(wrap.bones.a.angle), Math.PI, 0.2);
  assert.ok(Math.abs(wrap.bones.a.angle) > 3.0);
});

test("blendToNeighbor: -1 prev, 0 original, +1 next", () => {
  const p = mk(0, 1, 0), c = mk(0.5, 2, 5), n = mk(1, 3, 10);
  assert.deepEqual(blendToNeighbor(p, c, n, -1), p);
  assert.deepEqual(blendToNeighbor(p, c, n, 0), c);
  assert.deepEqual(blendToNeighbor(p, c, n, 1), n);
  near(blendToNeighbor(p, c, n, 0.5).bones.a.angle, 0.75);
  near(blendToNeighbor(p, c, n, -0.5).root[0], 2.5);
  // clamped
  assert.deepEqual(blendToNeighbor(p, c, n, 5), n);
});

test("relax: moves toward the time-proportional in-between", () => {
  const p = mk(0, 1, 0), n = mk(1, 1, 10), c = mk(0.8, 1, 9);
  // cur at t=1 of [0,4] => in-between angle 0.25, x 2.5
  const r = relax(p, c, n, 0, 1, 4, 1);
  near(r.bones.a.angle, 0.25); near(r.root[0], 2.5);
  assert.deepEqual(relax(p, c, n, 0, 1, 4, 0), c);
  const half = relax(p, c, n, 0, 1, 4, 0.5);
  near(half.bones.a.angle, 0.525);
  // degenerate span falls back to midpoint
  near(relax(p, c, n, 2, 2, 2, 1).bones.a.angle, 0.5);
});

test("push: reflects the relax displacement; scale/length stop at zero", () => {
  const p = mk(0, 1, 0), n = mk(1, 1, 10), c = mk(0.8, 1, 9);
  const psh = push(p, c, n, 0, 1, 4, 1);
  near(psh.bones.a.angle, 0.8 + (0.8 - 0.25));
  near(psh.root[0], 9 + (9 - 2.5));
  assert.deepEqual(push(p, c, n, 0, 1, 4, 0), c);
  const r = relax(p, c, n, 0, 1, 4, 0.4), q = push(p, c, n, 0, 1, 4, 0.4);
  near((r.bones.a.angle + q.bones.a.angle) / 2, c.bones.a.angle);
  const tiny = mk(0, 0.1, 0, 0.1);
  const big = mk(0, 5, 0, 5);
  const z = push(big, tiny, big, 0, 1, 2, 3);
  assert.equal(z.scale, 0); assert.equal(z.bones.a.length, 0);
});

test("push/relax take the shortest arc across +-pi", () => {
  const p = mk(3.0), n = mk(3.0), c = mk(-3.0);
  const r = relax(p, c, n, 0, 1, 2, 1);
  near(Math.abs(r.bones.a.angle - 3.0) % (2 * Math.PI), 0, 1e-9);
  const q = push(p, c, n, 0, 1, 2, 1);
  // displacement from target(3.0) to cur(-3.0) is +0.283 the short way; pushed further the same direction
  const d = Math.atan2(Math.sin(q.bones.a.angle - c.bones.a.angle), Math.cos(q.bones.a.angle - c.bones.a.angle));
  near(d, 2 * Math.PI - 6.0, 1e-9);
});

test("ops do not mutate inputs and ignore bones missing on a neighbour", () => {
  const p = mk(0), n = mk(1), c = mk(0.5);
  c.bones.extra = { angle: 1, length: 1, bend: 0 };
  const snap = structuredClone([p, c, n]);
  const r = relax(p, c, n, 0, 1, 2, 1);
  assert.deepEqual([p, c, n], snap);
  assert.deepEqual(r.bones.extra, c.bones.extra);
});

test("applyPoseOp edits a track key in place; insertBreakdown adds a key", () => {
  const track = poseTrack<Pose>([{ t: 0, value: mk(0) }, { t: 1, value: mk(0.9) }, { t: 4, value: mk(1) }]);
  const out = applyPoseOp(track, 1, { op: "relax", amount: 1 });
  near(out.bones.a.angle, 0.25);
  near(track.keyframes[1].value.bones.a.angle, 0.25);
  assert.equal(track.keyframes.length, 3);
  assert.throws(() => applyPoseOp(track, 0, { op: "push", amount: 1 }), /neighbo/);
  applyPoseOp(track, 1, { op: "blend", amount: -1 });
  near(track.keyframes[1].value.bones.a.angle, 0);
  insertBreakdown(track, 2, 0.5);
  assert.equal(track.keyframes.length, 4);
  near(track.keyframes[2].t, 2);
  assert.throws(() => insertBreakdown(track, 9, 0.5), /neighbo/);
});
