import { test } from "node:test";
import assert from "node:assert/strict";
import * as V from "../src/core/math/vector.ts";
import { bezier, partialBezier, arcBezierPoints } from "../src/core/math/bezier.ts";
import { Color } from "../src/core/color.ts";

test("vector arithmetic", () => {
  assert.deepEqual(V.add([1, 2, 3], [4, 5, 6]), [5, 7, 9]);
  assert.deepEqual(V.sub([4, 5, 6], [1, 2, 3]), [3, 3, 3]);
  assert.deepEqual(V.scale([1, 2, 3], 2), [2, 4, 6]);
  assert.equal(V.length([3, 4, 0]), 5);
  assert.deepEqual(V.lerp([0, 0, 0], [10, 0, 0], 0.5), [5, 0, 0]);
  assert.equal(V.lerp(0, 10, 0.25), 2.5);
});

test("rotate vector 90deg about z", () => {
  const r = V.rotateVector([1, 0, 0], Math.PI / 2);
  assert.ok(Math.abs(r[0]) < 1e-9);
  assert.ok(Math.abs(r[1] - 1) < 1e-9);
});

test("cubic bezier endpoints", () => {
  const p0 = [0, 0, 0], p1 = [0, 1, 0], p2 = [1, 1, 0], p3 = [1, 0, 0];
  assert.deepEqual(bezier(p0, p1, p2, p3, 0), p0);
  assert.deepEqual(bezier(p0, p1, p2, p3, 1), p3);
});

test("partialBezier preserves start and shortens end", () => {
  const p0 = [0, 0, 0], p1 = [1, 0, 0], p2 = [2, 0, 0], p3 = [3, 0, 0];
  const [a, , , d] = partialBezier(p0, p1, p2, p3, 0, 0.5);
  assert.ok(V.equals(a, p0));
  assert.ok(Math.abs(d[0] - 1.5) < 1e-9); // halfway along a straight line
});

test("arc bezier points count is 1 + 3k", () => {
  const pts = arcBezierPoints(1, 0, 2 * Math.PI);
  assert.equal((pts.length - 1) % 3, 0);
  // First point sits on the circle at angle 0.
  assert.ok(V.equals(pts[0], [1, 0, 0], 1e-6));
});

test("color parsing and interpolation", () => {
  const red = Color.fromHex("#FF0000");
  assert.equal(red.r, 1);
  assert.equal(red.g, 0);
  const mid = Color.lerp("#000000", "#FFFFFF", 0.5);
  assert.ok(Math.abs(mid.r - 0.5) < 1e-9);
  assert.equal(Color.fromHex("#f00").r, 1); // shorthand
});
