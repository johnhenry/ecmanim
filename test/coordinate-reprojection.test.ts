import { test } from "node:test";
import assert from "node:assert/strict";

import { Axes, PolarPlane } from "../src/mobject/coordinate_systems.ts";
import { reprojectCurve } from "../src/mobject/coordinate_reprojection.ts";

test("reprojectCurve(samples, axes) matches Axes.coordsToPoint pointwise", () => {
  const ax = new Axes({ xRange: [-2, 2, 1], yRange: [-2, 2, 1] });
  const samples: Array<[number, number]> = [[-1, -1], [0, 0], [1, 1], [2, 0.5]];
  const curve = reprojectCurve(samples, ax);
  const pts = curve.getSubpaths()[0];
  // setPointsAsCorners builds 1 + 3k points for k corners -- anchors are at
  // indices 0, 3, 6, ... (every 3rd point).
  for (let i = 0; i < samples.length; i++) {
    const expected = ax.coordsToPoint(samples[i][0], samples[i][1]);
    const actual = pts[i * 3];
    assert.ok(
      Math.abs(actual[0] - expected[0]) < 1e-9 && Math.abs(actual[1] - expected[1]) < 1e-9,
      `sample ${i}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
});

test("reprojectCurve(samples, polarPlane) matches PolarPlane.coordsToPoint pointwise", () => {
  const pp = new PolarPlane({ size: 6, radiusMax: 3, radiusStep: 1 });
  const samples: Array<[number, number]> = [[1, 0], [2, Math.PI / 2], [3, Math.PI]];
  const curve = reprojectCurve(samples, pp);
  const pts = curve.getSubpaths()[0];
  for (let i = 0; i < samples.length; i++) {
    const expected = pp.coordsToPoint(samples[i][0], samples[i][1]);
    const actual = pts[i * 3];
    assert.ok(
      Math.abs(actual[0] - expected[0]) < 1e-9 && Math.abs(actual[1] - expected[1]) < 1e-9,
      `sample ${i}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
});

test("a Transform between the original and the reprojected curve interpolates without NaN", async () => {
  const ax = new Axes({ xRange: [-2, 2, 1], yRange: [-2, 2, 1] });
  const pp = new PolarPlane({ size: 6, radiusMax: 3, radiusStep: 1 });
  const original = ax.plot((x) => x * x, { xRange: [-1, 1, 0.25] });
  const reprojected = reprojectCurve(original as any, pp);

  const { Transform } = await import("../src/animation/Animation.ts");
  const t = new Transform(original.copy(), reprojected);
  t.begin();
  for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
    t.interpolate(alpha);
    for (const p of t.mobject.points) {
      assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]), `NaN at alpha=${alpha}: ${JSON.stringify(p)}`);
    }
  }
});

test("the tag-based overload throws a clear error when _domainSamples is absent", () => {
  const pp = new PolarPlane({ size: 6, radiusMax: 3, radiusStep: 1 });
  const ax = new Axes();
  const untaggedCurve = ax.plotLine([0, 0], [1, 1]); // a Line, not built via plot() -- no tag
  assert.throws(
    () => reprojectCurve(untaggedCurve as any, pp),
    /_domainSamples/,
  );
});

test("reprojectCurve(curve, targetSystem) reads the _domainSamples tag stamped by Axes.plot()", () => {
  const ax = new Axes({ xRange: [-2, 2, 1], yRange: [-2, 2, 1] });
  const pp = new PolarPlane({ size: 6, radiusMax: 3, radiusStep: 1 });
  const curve = ax.plot((x) => x, { xRange: [-1, 1, 0.5] });
  const domainSamples = (curve as any)._domainSamples;
  assert.ok(Array.isArray(domainSamples) && domainSamples.length > 0);

  const viaTag = reprojectCurve(curve as any, pp);
  const viaExplicitSamples = reprojectCurve(domainSamples, pp);
  assert.deepEqual(viaTag.points, viaExplicitSamples.points);
});
