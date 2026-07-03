// Tests for the core Mobject methods added for manim `Mobject` parity.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Mobject, Group } from "../src/mobject/Mobject.ts";
import * as V from "../src/core/math/vector.ts";

// A tiny concrete Mobject with a controllable point cloud.
function makeMob(points: number[][]): Mobject {
  const m = new Mobject();
  m.points = points.map((p) => [p[0], p[1] ?? 0, p[2] ?? 0]);
  return m;
}

const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

test("Mobject is iterable over direct submobjects (matches Python manim's VGroup __iter__)", () => {
  const a = makeMob([[0, 0, 0]]);
  const b = makeMob([[1, 1, 0]]);
  const group = new Mobject();
  group.add(a, b);

  const collected: Mobject[] = [];
  for (const m of group) collected.push(m);
  assert.deepEqual(collected, [a, b]);

  // Spread and Array.from should also work, since both rely on the iterator.
  assert.deepEqual([...group], [a, b]);
  assert.deepEqual(Array.from(group), [a, b]);

  // Shallow, not recursive: a submobject's own children aren't yielded.
  const grandchild = makeMob([[2, 2, 0]]);
  a.add(grandchild);
  assert.deepEqual([...group], [a, b]);
});

test("become copies geometry, style and submobjects (deep)", () => {
  const a = makeMob([[0, 0, 0], [1, 1, 0]]);
  const child = makeMob([[2, 2, 0]]);
  a.add(child);
  a.setColor("#ff0000");

  const b = new Mobject();
  b.become(a);

  assert.equal(b.points.length, 2);
  assert.deepEqual(b.points[1], [1, 1, 0]);
  assert.equal(b.submobjects.length, 1);
  assert.deepEqual(b.submobjects[0].points[0], [2, 2, 0]);
  // Deep: mutating the source must not affect the become-target.
  a.points[0][0] = 99;
  assert.equal(b.points[0][0], 0);
});

test("saveState / restore round-trips geometry", () => {
  const m = makeMob([[0, 0, 0], [1, 0, 0]]);
  m.saveState();
  m.shift([3, 4, 0]);
  assert.ok(approx(m.getX(), 3.5));
  m.restore();
  assert.deepEqual(m.points[0], [0, 0, 0]);
  assert.deepEqual(m.points[1], [1, 0, 0]);
});

test("generateTarget + move target then matchPoints", () => {
  const m = makeMob([[0, 0, 0], [1, 0, 0]]);
  const target = m.generateTarget();
  assert.equal(m.target, target);
  target.shift([5, 0, 0]);
  // Original untouched by moving the (deep) target.
  assert.deepEqual(m.points[0], [0, 0, 0]);
  m.matchPoints(target);
  assert.deepEqual(m.points[0], [5, 0, 0]);
  assert.deepEqual(m.points[1], [6, 0, 0]);
});

test("matchWidth / matchHeight scale to reference size", () => {
  const ref = makeMob([[0, 0, 0], [4, 2, 0]]); // width 4, height 2
  const m = makeMob([[0, 0, 0], [1, 1, 0]]);   // width 1, height 1
  m.matchWidth(ref);
  assert.ok(approx(m.getWidth(), 4));
  const m2 = makeMob([[0, 0, 0], [1, 1, 0]]);
  m2.matchHeight(ref);
  assert.ok(approx(m2.getHeight(), 2));
});

test("setX / getX move along a single axis", () => {
  const m = makeMob([[0, 0, 0], [2, 0, 0]]); // center x = 1
  assert.ok(approx(m.getX(), 1));
  m.setX(10);
  assert.ok(approx(m.getX(), 10));
  // width preserved
  assert.ok(approx(m.getWidth(), 2));
});

test("scaleToFitWidth resizes uniformly", () => {
  const m = makeMob([[0, 0, 0], [2, 4, 0]]); // width 2, height 4
  m.scaleToFitWidth(6); // factor 3 (uniform)
  assert.ok(approx(m.getWidth(), 6));
  assert.ok(approx(m.getHeight(), 12));
});

test("applyMatrix rotates 90 degrees (2x2 matrix)", () => {
  const m = makeMob([[1, 0, 0]]);
  // 90-deg rotation matrix about origin.
  m.applyMatrix([[0, -1], [1, 0]], { aboutPoint: [0, 0, 0] });
  assert.ok(approx(m.points[0][0], 0));
  assert.ok(approx(m.points[0][1], 1));
});

test("applyComplexFunction z -> z^2 on a point", () => {
  // (1+i)^2 = 2i  => (0, 2)
  const m = makeMob([[1, 1, 0]]);
  m.applyComplexFunction(
    (z) => ({ re: z.re * z.re - z.im * z.im, im: 2 * z.re * z.im }),
    { aboutPoint: [0, 0, 0] },
  );
  assert.ok(approx(m.points[0][0], 0));
  assert.ok(approx(m.points[0][1], 2));
});

test("arrangeInGrid positions submobjects in a grid", () => {
  const g = new Group();
  for (let i = 0; i < 4; i++) g.add(makeMob([[0, 0, 0], [1, 1, 0]]));
  g.arrangeInGrid({ rows: 2, cols: 2, buff: 0 });
  // Four unit squares in a 2x2 grid, centered -> corners at +-0.5.
  const centers = g.submobjects.map((m) => m.getCenter());
  const xs = centers.map((c) => c[0]).sort((a, b) => a - b);
  const ys = centers.map((c) => c[1]).sort((a, b) => a - b);
  assert.ok(approx(xs[0], -0.5) && approx(xs[3], 0.5));
  assert.ok(approx(ys[0], -0.5) && approx(ys[3], 0.5));
  // Row-major: first two are on the top row (higher y).
  assert.ok(g.submobjects[0].getCenter()[1] > g.submobjects[2].getCenter()[1]);
});

test("sort orders submobjects by x; invert reverses", () => {
  const g = new Group();
  const right = makeMob([[3, 0, 0]]);
  const left = makeMob([[-3, 0, 0]]);
  const mid = makeMob([[0, 0, 0]]);
  g.add(right, left, mid);
  g.sort();
  assert.deepEqual(g.submobjects, [left, mid, right]);
  g.invert();
  assert.deepEqual(g.submobjects, [right, mid, left]);
});

test("suspendUpdating stops update; resumeUpdating restarts it", () => {
  const m = makeMob([[0, 0, 0]]);
  let ticks = 0;
  m.addUpdater(() => { ticks++; });
  m.update(1);
  assert.equal(ticks, 1);
  m.suspendUpdating();
  m.update(1);
  assert.equal(ticks, 1); // no change while suspended
  m.resumeUpdating();
  m.update(1);
  assert.equal(ticks, 2);
});

test("alignTo aligns edges; addToBack / insert order submobjects", () => {
  const ref = makeMob([[0, 5, 0], [1, 5, 0]]); // top edge at y=5
  const m = makeMob([[0, 0, 0], [1, 1, 0]]);
  m.alignTo(ref, V.UP);
  assert.ok(approx(m.getTop()[1], 5));

  const g = new Group();
  const a = makeMob([[0, 0, 0]]);
  const b = makeMob([[0, 0, 0]]);
  const c = makeMob([[0, 0, 0]]);
  g.add(a);
  g.addToBack(b);
  g.insert(1, c);
  assert.deepEqual(g.submobjects, [b, c, a]);
});
