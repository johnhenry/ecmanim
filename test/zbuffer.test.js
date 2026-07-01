import { test } from "node:test";
import assert from "node:assert/strict";
import { ZBuffer } from "../src/renderer/zbuffer.js";

// Read back an RGB pixel.
function px(zb, x, y) {
  const i = (y * zb.width + x) * 4;
  return [zb.color[i], zb.color[i + 1], zb.color[i + 2]];
}

test("per-pixel depth test resolves two crossing triangles", () => {
  const zb = new ZBuffer(20, 20);
  zb.clear(0, 0, 0);
  // Triangle A (red): near on the LEFT (z=10), far on the RIGHT (z=-10).
  const A = [
    { x: 0, y: 0, z: 10 }, { x: 0, y: 19, z: 10 }, { x: 19, y: 10, z: -10 },
  ];
  // Triangle B (green): far on the LEFT (z=-10), near on the RIGHT (z=10).
  const B = [
    { x: 19, y: 0, z: 10 }, { x: 19, y: 19, z: 10 }, { x: 0, y: 10, z: -10 },
  ];
  // Draw A then B; correct output must be independent of draw order per pixel.
  zb.triangle(A[0], A[1], A[2], [255, 0, 0], 1);
  zb.triangle(B[0], B[1], B[2], [0, 255, 0], 1);

  // Far left overlaps: A is near (red) there.
  assert.deepEqual(px(zb, 2, 10), [255, 0, 0]);
  // Far right overlaps: B is near (green) there.
  assert.deepEqual(px(zb, 17, 10), [0, 255, 0]);
});

test("draw order does not change the depth-resolved result", () => {
  const make = () => {
    const zb = new ZBuffer(10, 10);
    zb.clear(0, 0, 0);
    return zb;
  };
  const near = { a: { x: 0, y: 0, z: 5 }, b: { x: 9, y: 0, z: 5 }, c: { x: 5, y: 9, z: 5 } };
  const far = { a: { x: 0, y: 0, z: -5 }, b: { x: 9, y: 0, z: -5 }, c: { x: 5, y: 9, z: -5 } };

  const zb1 = make();
  zb1.triangle(near.a, near.b, near.c, [10, 20, 30], 1);
  zb1.triangle(far.a, far.b, far.c, [200, 100, 50], 1);

  const zb2 = make();
  zb2.triangle(far.a, far.b, far.c, [200, 100, 50], 1);
  zb2.triangle(near.a, near.b, near.c, [10, 20, 30], 1);

  // Both orders show the near triangle's color where they overlap.
  assert.deepEqual(px(zb1, 5, 3), [10, 20, 30]);
  assert.deepEqual(px(zb2, 5, 3), [10, 20, 30]);
});

test("lines respect the depth buffer", () => {
  const zb = new ZBuffer(20, 20);
  zb.clear(0, 0, 0);
  // A near horizontal blue line, then a far red line crossing it.
  zb.line({ x: 0, y: 10, z: 8 }, { x: 19, y: 10, z: 8 }, 1, [0, 0, 255], 1, 0);
  zb.line({ x: 10, y: 0, z: -8 }, { x: 10, y: 19, z: -8 }, 1, [255, 0, 0], 1, 0);
  // At the crossing the nearer (blue) line wins.
  assert.deepEqual(px(zb, 10, 10), [0, 0, 255]);
});
