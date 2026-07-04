import { test } from "node:test";
import assert from "node:assert/strict";

import { Circle, RegularPolygon } from "../src/mobject/geometry.ts";
import { VMobject } from "../src/mobject/VMobject.ts";
import * as V from "../src/core/math/vector.ts";

function squareCorners(cx: number, cy: number, s = 0.2): number[][] {
  const h = s / 2;
  return [
    [cx - h, cy - h, 0],
    [cx + h, cy - h, 0],
    [cx + h, cy + h, 0],
    [cx - h, cy + h, 0],
  ];
}

// One VMobject with N square subpaths, one per center -- e.g. a compound
// shape like scattered dots or a multi-glyph text run.
function multiSquareVMobject(centers: Array<[number, number]>): VMobject {
  const v = new VMobject();
  centers.forEach(([cx, cy], i) => {
    const corners = squareCorners(cx, cy);
    if (i === 0) {
      v.setPointsAsCorners(corners);
    } else {
      v.startNewPath(corners[0]);
      for (let k = 1; k < corners.length; k++) v.addLineTo(corners[k]);
    }
    v.close();
  });
  return v;
}

test("bestSubpathRotation is a zero-cost no-op for a single subpath", () => {
  const spA = [[[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]]];
  const spB = [[[10, 10, 0], [11, 10, 0], [12, 10, 0], [13, 10, 0]]];
  const result = (VMobject as any)._bestSubpathRotation(spA, spB);
  assert.strictEqual(result, spB, "single-subpath case returns `b` unchanged, by reference");
});

test("single-subpath fast path in alignPointsWith is unchanged", () => {
  const a = new Circle({ radius: 1 });
  const b = new RegularPolygon(7, { radius: 1 });
  const ac = a.copy(), bc = b.copy();
  assert.equal(ac.getSubpaths().length, 1);
  assert.equal(bc.getSubpaths().length, 1);
  ac.alignPointsWith(bc);
  bc.alignPointsWith(a.copy());
  assert.equal(ac.points.length, bc.points.length);
});

test("a cyclically-shifted subpath order is detected and corrected by centroid distance", () => {
  const aCenters: Array<[number, number]> = [[0, 0], [5, 0], [10, 0]];
  // Same three squares, but b's own subpath array order is a cyclic rotation.
  const bCentersRotated: Array<[number, number]> = [[5, 0], [10, 0], [0, 0]];

  const a = multiSquareVMobject(aCenters);
  const b = multiSquareVMobject(bCentersRotated);

  const aSub = a.getSubpaths();
  const bSub = b.getSubpaths();
  assert.equal(aSub.length, 3);
  assert.equal(bSub.length, 3);

  const rotated = (VMobject as any)._bestSubpathRotation(aSub, bSub);

  // After correction, rotated[i]'s centroid should match a[i]'s centroid --
  // i.e. the SAME square, not whatever b's raw array order happened to be.
  for (let i = 0; i < 3; i++) {
    const ca = V.centerOfMass(aSub[i]);
    const cr = V.centerOfMass(rotated[i]);
    const dist = Math.hypot(ca[0] - cr[0], ca[1] - cr[1]);
    assert.ok(dist < 1e-6, `subpath ${i}: expected centroid ${JSON.stringify(ca)}, got ${JSON.stringify(cr)} (dist=${dist})`);
  }

  // Contrast: the naive (identity, r=0) pairing has a much larger total
  // centroid-to-centroid distance, since it pairs unrelated squares.
  const naiveScore = aSub.reduce((sum: number, sp: number[][], i: number) => {
    const ca = V.centerOfMass(sp);
    const cb = V.centerOfMass(bSub[i]);
    return sum + Math.hypot(ca[0] - cb[0], ca[1] - cb[1]);
  }, 0);
  assert.ok(naiveScore > 5, `naive pairing should be far apart, got total distance ${naiveScore}`);

  // alignPointsWith itself must not throw and should preserve the corrected
  // per-subpath curve counts (a smoke-level integration check).
  const ac = a.copy();
  ac.alignPointsWith(b.copy());
  assert.equal(ac.getSubpaths().length, 3);
});

test("the >32-subpath cap falls back to identity order safely", () => {
  const n = 40;
  const aCenters: Array<[number, number]> = Array.from({ length: n }, (_, i) => [i * 2, 0]);
  // Rotate b's centers by 1 relative to a's.
  const bCenters: Array<[number, number]> = [...aCenters.slice(1), aCenters[0]];

  const a = multiSquareVMobject(aCenters);
  const b = multiSquareVMobject(bCenters);
  const aSub = a.getSubpaths();
  const bSub = b.getSubpaths();
  assert.equal(aSub.length, n);

  const rotated = (VMobject as any)._bestSubpathRotation(aSub, bSub);
  assert.strictEqual(rotated, bSub, "above the 32-subpath cap, the search is skipped and `b` is returned unchanged");

  // alignPointsWith must still complete without throwing at this size.
  const ac = a.copy();
  ac.alignPointsWith(b.copy());
  assert.equal(ac.getSubpaths().length, n);
});
