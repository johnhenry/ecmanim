// Tests for path boolean operations (Union / Intersection / Difference /
// Exclusion) in src/mobject/boolean_ops.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Square, Rectangle } from "../src/mobject/geometry.ts";
import { Union, Intersection, Difference, Exclusion } from "../src/mobject/boolean_ops.ts";

// Every subpath must satisfy the cubic-bezier invariant (len - 1) % 3 === 0,
// and all coordinates must be finite.
function assertValidOutline(mob: any): void {
  assert.ok(mob.points.every((p: number[]) => p.every(Number.isFinite)), "points finite");
  for (const sp of mob.getSubpaths()) {
    assert.equal((sp.length - 1) % 3, 0, "subpath is a valid bezier list");
  }
}

test("Union of two overlapping unit squares spans both", () => {
  // Two side-length-1 squares, offset by 0.5 in x and y so they overlap.
  const a = new Square({ side: 1 });
  const b = new Square({ side: 1 }).shift([0.5, 0.5, 0]);
  const u = new Union(a, b);
  assertValidOutline(u);
  const { min, max } = u.getBoundingBox();
  // Combined bounding box: x from -0.5 to 1.0, y from -0.5 to 1.0.
  assert.ok(Math.abs(min[0] - -0.5) < 1e-6 && Math.abs(min[1] - -0.5) < 1e-6, "union min corner");
  assert.ok(Math.abs(max[0] - 1.0) < 1e-6 && Math.abs(max[1] - 1.0) < 1e-6, "union max corner");
});

test("Intersection of two unit squares offset by 0.5 has width 0.5", () => {
  const a = new Square({ side: 1 });
  const b = new Square({ side: 1 }).shift([0.5, 0.5, 0]);
  const inter = new Intersection(a, b);
  assertValidOutline(inter);
  assert.ok(Math.abs(inter.getWidth() - 0.5) < 1e-6, "intersection width ~= 0.5");
  assert.ok(Math.abs(inter.getHeight() - 0.5) < 1e-6, "intersection height ~= 0.5");
});

test("Difference of a big square minus a small centered square has a hole", () => {
  const big = new Square({ side: 4 });
  const small = new Square({ side: 1 });
  const diff = new Difference(big, small);
  assertValidOutline(diff);
  // Outer boundary + inner hole -> at least 2 subpaths.
  assert.ok(diff.getSubpaths().length >= 2, "difference has a hole (>=2 subpaths)");
  // Outer extent is still the big square.
  assert.ok(Math.abs(diff.getWidth() - 4) < 1e-6, "difference keeps outer width");
});

test("Exclusion builds a valid outline", () => {
  const a = new Rectangle({ width: 2, height: 1 });
  const b = new Rectangle({ width: 1, height: 2 });
  const ex = new Exclusion(a, b);
  assertValidOutline(ex);
  assert.ok(ex.points.length > 0, "exclusion produced points");
});

test("Boolean ops copy fill/stroke style from the first input", () => {
  const a = new Square({ side: 1, fillColor: "#123456", fillOpacity: 0.5 });
  const b = new Square({ side: 1 }).shift([0.5, 0, 0]);
  const u = new Union(a, b);
  assert.equal(u.fillOpacity, 0.5, "fill opacity copied from first input");
});
