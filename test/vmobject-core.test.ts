// Core VMobject parity: smoothing, anchors, winding, arc length, partials,
// curve insertion, point reversal, background stroke, subcurves.

import { test } from "node:test";
import assert from "node:assert/strict";
import { VMobject } from "../src/mobject/VMobject.ts";
import { Circle } from "../src/mobject/geometry.ts";
import * as V from "../src/core/math/vector.ts";

test("setPointsSmoothly passes through the given anchors", () => {
  const anchors = [[0, 0, 0], [1, 2, 0], [3, -1, 0], [4, 1, 0]];
  const vm = new VMobject().setPointsSmoothly(anchors);
  const got = vm.getAnchors();
  assert.equal(got.length, anchors.length);
  for (let i = 0; i < anchors.length; i++) {
    assert.ok(V.equals(got[i], anchors[i] as number[], 1e-6),
      `anchor ${i} mismatch: ${got[i]} vs ${anchors[i]}`);
  }
});

test("setPointsSmoothly is C1-ish (handles collinear across shared anchor)", () => {
  const anchors = [[0, 0, 0], [1, 1, 0], [2, 0, 0], [3, 1, 0]];
  const vm = new VMobject().setPointsSmoothly(anchors);
  const [, h1s, h2s, a1s] = vm.getAnchorsAndHandles();
  // At an interior shared anchor, the incoming handle (h2 of curve i) and the
  // outgoing handle (h1 of curve i+1) should be roughly reflected through it.
  for (let i = 0; i < a1s.length - 1; i++) {
    const anchor = a1s[i];
    const incoming = V.sub(anchor, h2s[i]);       // tangent arriving
    const outgoing = V.sub(h1s[i + 1], anchor);   // tangent leaving
    const din = V.normalize(incoming);
    const dout = V.normalize(outgoing);
    // Directions should be nearly parallel (dot ~ 1).
    assert.ok(V.dot(din, dout) > 0.9, `not smooth at ${i}: dot=${V.dot(din, dout)}`);
  }
});

test("getAnchors count = numCurves + subpaths", () => {
  const c = new Circle({ radius: 1 });
  assert.equal(c.getAnchors().length, c.getNumCurves() + c.getSubpaths().length);
});

test("getDirection distinguishes CW vs CCW windings", () => {
  const ccw = new VMobject().setPointsAsCorners([
    [0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0], [0, 0, 0],
  ]);
  const cw = ccw.copy().reversePoints();
  assert.notEqual(ccw.getDirection(), cw.getDirection());
  assert.equal(ccw.getDirection(), "CCW");
  assert.equal(cw.getDirection(), "CW");
});

test("getArcLength of a unit circle approximates 2*pi", () => {
  const c = new Circle({ radius: 1 });
  const len = c.getArcLength(40);
  assert.ok(Math.abs(len - 2 * Math.PI) < 0.05, `arc length ${len}`);
});

test("pointwiseBecomePartial(0, 0.5) matches half-outline endpoints", () => {
  const c = new Circle({ radius: 1 });
  const half = new VMobject().pointwiseBecomePartial(c, 0, 0.5);
  const anchors = half.getAnchors();
  const start = anchors[0];
  const end = anchors[anchors.length - 1];
  assert.ok(V.equals(start, c.pointFromProportion(0), 1e-6));
  assert.ok(V.equals(end, c.pointFromProportion(0.5), 1e-6));
});

test("insertNCurves raises the curve count by n", () => {
  const c = new Circle({ radius: 1 });
  const before = c.getNumCurves();
  c.insertNCurves(5);
  assert.equal(c.getNumCurves(), before + 5);
});

test("reversePoints reverses start and end anchors", () => {
  const vm = new VMobject().setPointsAsCorners([[0, 0, 0], [1, 0, 0], [2, 1, 0]]);
  const startBefore = vm.getStartAnchors()[0];
  const endBefore = vm.getEndAnchors()[vm.getEndAnchors().length - 1];
  vm.reversePoints();
  const startAfter = vm.getStartAnchors()[0];
  const endAfter = vm.getEndAnchors()[vm.getEndAnchors().length - 1];
  assert.ok(V.equals(startAfter, endBefore, 1e-9));
  assert.ok(V.equals(endAfter, startBefore, 1e-9));
});

test("setBackgroundStroke sets the background stroke fields", () => {
  const vm = new VMobject().setBackgroundStroke({ color: "#FF0000", width: 8, opacity: 0.5 });
  assert.equal(vm.backgroundStrokeWidth, 8);
  assert.equal(vm.backgroundStrokeOpacity, 0.5);
  assert.ok(Math.abs(vm.backgroundStrokeColor.r - 1) < 1e-6);
  assert.ok(Math.abs(vm.backgroundStrokeColor.g) < 1e-6);
});

test("getSubcurve builds a shorter curve than the whole", () => {
  const c = new Circle({ radius: 1 });
  const sub = c.getSubcurve(0.25, 0.5);
  assert.ok(sub instanceof VMobject);
  assert.ok(sub.getArcLength(20) < c.getArcLength(20));
  assert.ok(sub.getArcLength(20) > 0);
});

test("addQuadraticBezierCurveTo elevates a quad and lands on the anchor", () => {
  const vm = new VMobject().startNewPath([0, 0, 0]);
  vm.addQuadraticBezierCurveTo([1, 2, 0], [2, 0, 0]);
  const end = vm.getEndAnchors()[0];
  assert.ok(V.equals(end, [2, 0, 0], 1e-9));
});

test("makeJagged then makeSmooth preserves anchor positions", () => {
  const anchors = [[0, 0, 0], [1, 1, 0], [2, 0, 0], [3, 1, 0]];
  const vm = new VMobject().setPointsSmoothly(anchors);
  vm.makeJagged();
  vm.makeSmooth();
  const got = vm.getAnchors();
  for (let i = 0; i < anchors.length; i++) {
    assert.ok(V.equals(got[i], anchors[i] as number[], 1e-6));
  }
});
