// D2 (D3-parity campaign): stack orders/offsets, line/area generators with
// defined-gaps, pie angles, arc shapes, link curves, basis/bundle splines.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stack, lineGen, areaGen, pieGen, arcShape, radialPoint,
  linkHorizontalPoints, linkRadialPoints, basisBeziers, bundleBeziers,
  bezierChainMobject,
} from "../src/mobject/shape_gen.ts";

const close = (a: number, b: number, eps = 1e-9, msg?: string) =>
  assert.ok(Math.abs(a - b) < eps, msg ?? `${a} !~ ${b}`);

const data = [
  { month: 0, apples: 10, bananas: 20 },
  { month: 1, apples: 15, bananas: 5 },
];

test("stack (none): series stack bottom-up in key order", () => {
  const s = stack({ keys: ["apples", "bananas"] })(data);
  assert.equal(s.length, 2);
  assert.equal(s[0].key, "apples");
  assert.deepEqual(s[0][0], [0, 10]);
  assert.deepEqual(s[1][0], [10, 30], "bananas sits on apples");
  assert.deepEqual(s[1][1], [15, 20]);
});

test("stack expand normalizes columns to [0, 1]", () => {
  const s = stack({ keys: ["apples", "bananas"], offset: "expand" })(data);
  close(s[1][0][1], 1, 1e-9, "column top = 1");
  close(s[0][0][1], 10 / 30);
});

test("stack silhouette centers columns on 0", () => {
  const s = stack({ keys: ["apples", "bananas"], offset: "silhouette" })(data);
  close(s[0][0][0] + s[1][0][1], 0, 1e-9, "baseline mirrors top");
});

test("stack wiggle runs and conserves layer thickness", () => {
  const s = stack({ keys: ["apples", "bananas"], order: "insideOut", offset: "wiggle" })(data);
  close(s[0][0][1] - s[0][0][0], 10, 1e-9, "apples layer thickness col 0");
  close(s[1][1][1] - s[1][1][0], 5, 1e-9, "bananas layer thickness col 1");
  assert.ok(s.every((series) => series.every(([a, b]) => isFinite(a) && isFinite(b))));
});

test("stack diverging sends negatives below zero", () => {
  const s = stack({ keys: ["a", "b"], offset: "diverging" })([{ a: 3, b: -2 }] as any);
  assert.deepEqual(s[0][0], [0, 3]);
  assert.deepEqual(s[1][0], [-2, 0]);
});

test("lineGen splits at undefined points", () => {
  const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: NaN }, { x: 3, y: 3 }, { x: 4, y: 4 }];
  const segs = lineGen<{ x: number; y: number }>({
    x: (d) => d.x, y: (d) => d.y, defined: (d) => !Number.isNaN(d.y),
  })(pts);
  assert.equal(segs.length, 2, "gap splits the line");
  assert.equal(segs[0].length, 2);
  assert.equal(segs[1].length, 2);
});

test("areaGen builds a closed band ring (top forward, bottom back)", () => {
  const rings = areaGen<{ x: number; lo: number; hi: number }>({
    x: (d) => d.x, y0: (d) => d.lo, y1: (d) => d.hi,
  })([{ x: 0, lo: 0, hi: 2 }, { x: 1, lo: 0.5, hi: 3 }]);
  assert.equal(rings.length, 1);
  const r = rings[0];
  assert.equal(r.length, 4);
  assert.deepEqual(r[0], [0, 2, 0], "starts at first top");
  assert.deepEqual(r[3], [0, 0, 0], "ends at first bottom (ring closes)");
});

test("pieGen matches d3 semantics (descending sort, proportional sweeps)", () => {
  const slices = pieGen<number>({})( [1, 3] );
  close(slices[1].endAngle - slices[1].startAngle, (3 / 4) * 2 * Math.PI);
  close(slices[1].startAngle, 0, 1e-9, "largest first (default descending)");
  close(slices[0].startAngle, (3 / 4) * 2 * Math.PI, 1e-9, "slices[i] keeps input index");
  const unsorted = pieGen<number>({ sortValues: null })([1, 3]);
  close(unsorted[0].startAngle, 0, 1e-9, "input order with sortValues null");
});

test("radialPoint uses d3's clockwise-from-12 convention in y-up world", () => {
  const top = radialPoint(0, 1);
  close(top[0], 0); close(top[1], 1, 1e-9, "angle 0 = straight up");
  const right = radialPoint(Math.PI / 2, 1);
  close(right[0], 1, 1e-9, "quarter turn clockwise = +x");
  close(right[1], 0, 1e-9);
});

test("arcShape builds a closed annular sector of the right extent", () => {
  const arc = arcShape({ innerRadius: 1, outerRadius: 2, startAngle: 0, endAngle: Math.PI / 2 });
  assert.ok(arc.points.length > 0);
  close(arc.getWidth(), 2, 0.02, "spans x in [0, 2]");
  close(arc.getHeight(), 2, 0.02, "spans y in [0, 2]");
  // All points within the annulus radii (with bezier tolerance).
  for (const p of arc.points) {
    const r = Math.hypot(p[0], p[1]);
    assert.ok(r > 0.95 && r < 2.1, `point radius ${r} inside annulus`);
  }
});

test("linkHorizontalPoints has horizontal tangents (sankey curve)", () => {
  const [s, c1, c2, t] = linkHorizontalPoints([0, 0, 0], [10, 4, 0]);
  close(c1[1], s[1], 1e-9, "control 1 level with source");
  close(c2[1], t[1], 1e-9, "control 2 level with target");
  close(c1[0], 5); close(c2[0], 5);
});

test("linkRadialPoints starts and ends on its endpoints", () => {
  const pts = linkRadialPoints({ angle: 0, radius: 1 }, { angle: Math.PI / 2, radius: 2 });
  close(pts[0][1], 1, 1e-9, "starts at angle 0 radius 1 (top)");
  const last = pts[pts.length - 1];
  close(last[0], 2, 1e-9, "ends at angle 90° radius 2 (+x)");
});

test("basis spline interpolates endpoints and stays in the hull", () => {
  const pts = [[0, 0, 0], [1, 2, 0], [2, -1, 0], [3, 0, 0]];
  const chain = basisBeziers(pts);
  close(chain.start[0], 0, 1e-9); close(chain.start[1], 0, 1e-9);
  const end = chain.beziers[chain.beziers.length - 1][2];
  close(end[0], 3, 1e-9); close(end[1], 0, 1e-9);
  const mob = bezierChainMobject(chain, { strokeWidth: 2 });
  assert.ok(mob.points.length > 0);
  for (const p of mob.points) {
    assert.ok(p[0] >= -1e-9 && p[0] <= 3 + 1e-9, "x inside hull");
    assert.ok(p[1] >= -1 - 1e-9 && p[1] <= 2 + 1e-9, "y inside hull");
  }
});

test("bundleBeziers beta straightens toward the chord", () => {
  const pts = [[0, 0, 0], [1, 5, 0], [2, 0, 0]]; // big detour through y=5
  const full = bundleBeziers(pts, 1);
  const straight = bundleBeziers(pts, 0);
  const maxY = (chain: { beziers: number[][][] }) =>
    Math.max(...chain.beziers.flat().map((p) => p[1]));
  assert.ok(maxY(full) > 2, "beta 1 keeps the detour");
  assert.ok(maxY(straight) < 0.6, `beta 0 hugs the chord (${maxY(straight)})`);
});
