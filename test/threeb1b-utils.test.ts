// 3b1b campaign small gaps: primes/sieve, 2x2 eigen, Hilbert/L-system
// curves, Surface.setFunc reparameterization.

import { test } from "node:test";
import assert from "node:assert/strict";
import { sieve, primesUpTo, isPrime, eigen2x2 } from "../src/core/math/primes.ts";
import { hilbertCurve, lsystem } from "../src/layout/hilbert.ts";
import { Surface } from "../src/mobject/surface.ts";

const close = (a: number, b: number, eps = 1e-9, msg?: string) =>
  assert.ok(Math.abs(a - b) < eps, msg ?? `${a} !~ ${b}`);

test("sieve/primesUpTo/isPrime agree and are correct", () => {
  const ps = primesUpTo(100);
  assert.equal(ps.length, 25, "25 primes below 100");
  assert.deepEqual(ps.slice(0, 5), [2, 3, 5, 7, 11]);
  const s = sieve(1000);
  for (const n of [2, 97, 101, 997]) assert.equal(s[n], 1, `${n} prime`);
  for (const n of [0, 1, 100, 999]) assert.equal(s[n], 0, `${n} composite`);
  assert.ok(isPrime(7919) && !isPrime(7917));
});

test("eigen2x2: diagonal, shear, symmetric, rotation cases", () => {
  const diag = eigen2x2([[3, 0], [0, 2]]);
  assert.equal(diag.length, 2);
  close(diag[0].value, 3); close(diag[1].value, 2);
  assert.deepEqual(diag[0].vector, [1, 0]);

  // Classic 3b1b example: [[3, 1], [0, 2]] — eigenvalues 3 and 2.
  const shear = eigen2x2([[3, 1], [0, 2]]);
  close(shear[0].value, 3);
  close(shear[1].value, 2);
  // λ=2 eigenvector along (1, -1)/√2.
  close(Math.abs(shear[1].vector[0]), Math.SQRT1_2, 1e-9);
  close(Math.abs(shear[1].vector[1]), Math.SQRT1_2, 1e-9);
  // Verify Av = λv for both.
  for (const { value, vector } of shear) {
    const [x, y] = vector;
    close(3 * x + 1 * y, value * x, 1e-9);
    close(0 * x + 2 * y, value * y, 1e-9);
  }

  const rot = eigen2x2([[0, -1], [1, 0]]);
  assert.equal(rot.length, 0, "rotation has no real eigenvectors");
});

test("hilbertCurve fills the unit square with unit-cell steps", () => {
  const pts = hilbertCurve(3);
  assert.equal(pts.length, 64, "4^3 points");
  // Consecutive points are exactly one cell apart (locality).
  const step = 1 / 8;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    close(d, step, 1e-12, `step ${i} is one cell`);
  }
  // Every cell visited exactly once.
  const seen = new Set(pts.map(([x, y]) => `${Math.round(x * 16)},${Math.round(y * 16)}`));
  assert.equal(seen.size, 64);
  // All within the unit square.
  assert.ok(pts.every(([x, y]) => x > 0 && x < 1 && y > 0 && y < 1));
});

test("lsystem: Koch-curve expansion has the right point count and extent", () => {
  const pts = lsystem("F", { F: "F+F-F-F+F" }, 2, Math.PI / 2);
  assert.equal(pts.length, 26, "25 F-steps after 2 iterations");
  close(pts[pts.length - 1][1], 0, 1e-9, "Koch curve returns to the axis");
  close(pts[pts.length - 1][0], 9, 1e-9, "net advance 9 units");
});

test("Surface.setFunc reparameterizes in place (identity preserved)", () => {
  const surf = new Surface((u, v) => [u, v, 0], {
    uRange: [0, 1], vRange: [0, 1], resolution: [4, 4],
  });
  const faces0 = surf.submobjects.length;
  const flatZ = Math.max(...surf.submobjects.flatMap((f: any) => f.points.map((p: number[]) => Math.abs(p[2]))));
  close(flatZ, 0, 1e-12, "starts flat");
  const same = surf.setFunc((u, v) => [u, v, u * v]);
  assert.equal(same, surf, "chainable, same object");
  assert.equal(surf.submobjects.length, faces0, "same mesh resolution");
  const bentZ = Math.max(...surf.submobjects.flatMap((f: any) => f.points.map((p: number[]) => p[2])));
  assert.ok(bentZ > 0.5, `rebuilt with the new function (max z ${bentZ})`);
});

// --- fixes surfaced by the recreation wave ------------------------------------

test("parseTexGroups handles nested braces in {{...}} groups", async () => {
  const { parseTexGroups } = await import("../src/mobject/mathtex.ts");
  const r = parseTexGroups("{{\\frac{x^3}{3!}}} + {{x^{11}}}");
  assert.deepEqual(r.isolate, ["\\frac{x^3}{3!}", "x^{11}"]);
  assert.equal(r.tex, "\\frac{x^3}{3!} + x^{11}", "markers stripped, braces intact");
  const simple = parseTexGroups("{{a^2}} + b");
  assert.deepEqual(simple.isolate, ["a^2"]);
});

test("Transform aligns FAMILY point counts (VGroup children don't truncate)", async () => {
  const { VGroup } = await import("../src/mobject/VMobject.ts");
  const { Circle, RegularPolygon } = await import("../src/mobject/geometry.ts");
  const { Transform } = await import("../src/animation/Animation.ts");
  const { Scene } = await import("../src/scene/Scene.ts");
  const a = new VGroup(new Circle({ radius: 1 }), new Circle({ radius: 0.5 }));
  const b = new VGroup(
    new RegularPolygon(7, { radius: 1 }),
    new RegularPolygon(5, { radius: 0.5 }),
  );
  const scene = new Scene({ fps: 20, frameHandler: async () => {} });
  scene.add(a);
  const t = new Transform(a, b);
  t.runTime = 0.2;
  await scene.play(t);
  // Each child must land on its full target geometry, not a truncated slice.
  const kids = a.submobjects as any[];
  const targets = b.submobjects as any[];
  for (let i = 0; i < 2; i++) {
    const got = kids[i].getWidth();
    const want = targets[i].getWidth();
    assert.ok(Math.abs(got - want) < 0.05, `child ${i} reaches target width (${got} vs ${want})`);
    // The tell-tale of the truncation bug: child keeps only a fraction of
    // its target's curves -> visibly shorter outline.
    const gotCurves = Math.floor((kids[i].getSubpaths()[0].length - 1) / 3);
    const wantCurves = Math.floor((targets[i].getSubpaths()[0].length - 1) / 3);
    assert.ok(gotCurves >= wantCurves, `child ${i} carries all target curves (${gotCurves} >= ${wantCurves})`);
  }
});
