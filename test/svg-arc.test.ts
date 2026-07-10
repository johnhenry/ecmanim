// SVG elliptical-arc support in the shared path parser (campaign 4, M1.5).
// `A` commands used to flatten to straight chords (mermaid pies rendered as
// triangles); they are now converted via the spec's endpoint-to-center
// parameterization into cubic Beziers (arcs > 90° split into segments).
//
// Coordinates below are in the path's OWN space (SVG y-down) — the space
// parsePathToSubpaths documents. A semicircle "M 0 0 A 50 50 0 0 1 100 0"
// therefore bulges toward NEGATIVE y here (up on screen, +y after the
// loader's world y-flip).

import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePathToSubpaths, arcToCubics } from "../src/mobject/svg_path.ts";

const near = (a: number, b: number, eps = 0.5) => Math.abs(a - b) <= eps;

// Evaluate the cubic starting at flat-list anchor index k, at parameter t.
function cubicAt(sp: number[][], k: number, t: number): number[] {
  const [p0, c1, c2, p1] = [sp[k], sp[k + 1], sp[k + 2], sp[k + 3]];
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [0, 1].map((d) =>
    w[0] * p0[d] + w[1] * c1[d] + w[2] * c2[d] + w[3] * p1[d]);
}

// Sample every cubic segment of a subpath into a polyline.
function sample(sp: number[][], perSeg = 16): number[][] {
  const out: number[][] = [[sp[0][0], sp[0][1]]];
  for (let k = 0; k + 3 < sp.length; k += 3) {
    for (let i = 1; i <= perSeg; i++) out.push(cubicAt(sp, k, i / perSeg));
  }
  return out;
}

test("semicircle arc: curve midpoint bulges to the arc, not the chord", () => {
  const sp = parsePathToSubpaths("M 0 0 A 50 50 0 0 1 100 0")[0];
  // Two >=90° segments -> the shared anchor at index 3 IS the arc midpoint.
  assert.equal((sp.length - 1) % 3, 0, "valid cubic flat list");
  assert.ok(sp.length >= 7, `arc split into >= 2 cubics (got ${(sp.length - 1) / 3})`);
  const mid = sp[3];
  assert.ok(near(mid[0], 50), `mid x ~50 (got ${mid[0]})`);
  assert.ok(near(Math.abs(mid[1]), 50), `mid |y| ~50, not the chord's 0 (got ${mid[1]})`);
  // Spec side: sweep=1 is the positive-angle direction, which in SVG's
  // y-down space bulges toward negative y (drawn "above" the chord).
  assert.ok(near(mid[1], -50), `sweep=1 bulges to y=-50 in path space (got ${mid[1]})`);
  // Every sampled point sits on the r=50 circle around (50, 0).
  for (const [x, y] of sample(sp)) {
    const r = Math.hypot(x - 50, y - 0);
    assert.ok(near(r, 50, 0.6), `sample (${x.toFixed(1)}, ${y.toFixed(1)}) on the circle (r=${r.toFixed(2)})`);
  }
  // End lands exactly on the endpoint.
  assert.deepEqual(sp[sp.length - 1].slice(0, 2).map(Math.round), [100, 0]);
});

test("large-arc + sweep flag combinations pick the correct arc", () => {
  // From (50,0) to (0,50), r=50: candidate centers are (0,0) and (50,50).
  // Expected arc midpoints, per the spec's center-selection sign rule:
  const cases: Array<[number, number, [number, number]]> = [
    [0, 1, [50 * Math.SQRT1_2, 50 * Math.SQRT1_2]],   // small, positive: center (0,0), far side
    [0, 0, [50 - 50 * Math.SQRT1_2, 50 - 50 * Math.SQRT1_2]], // small, negative: center (50,50), near side
    [1, 1, [50 + 50 * Math.SQRT1_2, 50 + 50 * Math.SQRT1_2]], // large, positive: center (50,50), long way
    [1, 0, [-50 * Math.SQRT1_2, -50 * Math.SQRT1_2]], // large, negative: center (0,0), long way
  ];
  for (const [laf, sweep, [ex, ey]] of cases) {
    const sp = parsePathToSubpaths(`M 50 0 A 50 50 0 ${laf} ${sweep} 0 50`)[0];
    const pts = sample(sp);
    const mid = pts[Math.floor(pts.length / 2)];
    assert.ok(
      near(mid[0], ex, 1.5) && near(mid[1], ey, 1.5),
      `laf=${laf} sweep=${sweep}: midpoint (${mid[0].toFixed(1)}, ${mid[1].toFixed(1)}) ~ (${ex.toFixed(1)}, ${ey.toFixed(1)})`,
    );
    // Large arcs are ~3x the length of small ones (3/4 vs 1/4 turn).
    const len = pts.reduce((acc, p, i) => i ? acc + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0, 0);
    const expected = (laf ? 1.5 : 0.5) * Math.PI * 50;
    assert.ok(near(len, expected, expected * 0.02), `laf=${laf} sweep=${sweep}: arc length ${len.toFixed(1)} ~ ${expected.toFixed(1)}`);
  }
});

test("pie-slice path (M L A Z) closes with the correct area and sign", () => {
  // Quarter slice: center (0,0), out to (50,0), arc to (0,50), close.
  const sp = parsePathToSubpaths("M 0 0 L 50 0 A 50 50 0 0 1 0 50 Z")[0];
  const pts = sample(sp);
  // Closed: last sampled point returns to the start.
  const last = pts[pts.length - 1];
  assert.ok(near(last[0], 0, 1e-6) && near(last[1], 0, 1e-6), "Z closes back to the start");
  // Shoelace signed area: quarter circle = pi*r^2/4, positive orientation
  // for this (counterclockwise-in-shoelace-terms) winding.
  let area = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    area += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  }
  area /= 2;
  const expected = (Math.PI * 50 * 50) / 4;
  assert.ok(area > 0, `area sign positive (got ${area.toFixed(1)})`);
  assert.ok(near(area, expected, expected * 0.01), `area ${area.toFixed(1)} ~ quarter circle ${expected.toFixed(1)}`);
});

test("degenerate arcs: zero radius falls back to a chord; coincident endpoints vanish", () => {
  const line = parsePathToSubpaths("M 0 0 A 0 50 0 0 1 100 0")[0];
  const mid = sample(line)[8];
  assert.ok(near(mid[1], 0, 1e-9), "rx=0 draws the straight chord");
  assert.equal(arcToCubics(10, 10, 50, 50, 0, 0, 1, 10, 10).length, 0, "identical endpoints produce no segments");
});

test("relative arcs and radius scale-up (F.6.6) both work", () => {
  // Relative 'a', radii too small to span the chord (r=10 for a 100-wide
  // chord) must scale up to r=50 -> a semicircle-like bulge of 50.
  const sp = parsePathToSubpaths("M 0 0 a 10 10 0 0 1 100 0")[0];
  const pts = sample(sp);
  const maxBulge = Math.max(...pts.map(([, y]) => Math.abs(y)));
  assert.ok(near(maxBulge, 50, 1), `scaled-up radii bulge ~50 (got ${maxBulge.toFixed(1)})`);
  assert.deepEqual(sp[sp.length - 1].slice(0, 2).map(Math.round), [100, 0], "relative endpoint honored");
});
