import { test } from "node:test";
import assert from "node:assert/strict";
import { Sphere, Surface, Cube } from "../src/mobject/surface.js";
import { ZBuffer } from "../src/renderer/zbuffer.js";

test("smooth surfaces attach per-vertex colors; flat ones do not", () => {
  const smooth = new Sphere({ radius: 1, resolution: [8, 8], smooth: true });
  const flat = new Sphere({ radius: 1, resolution: [8, 8], smooth: false });
  assert.ok(smooth.submobjects.every((f) => Array.isArray(f._vertexColors) && f._vertexColors.length === 5));
  assert.ok(flat.submobjects.every((f) => !f._vertexColors));
});

test("per-vertex colors vary within a face (smooth gradient)", () => {
  const s = new Sphere({ radius: 2, resolution: [12, 12], smooth: true });
  // At least one face must have non-uniform corner brightness.
  const varied = s.submobjects.some((f) => {
    const lums = f._vertexColors.slice(0, 4).map((c) => c[0] + c[1] + c[2]);
    return Math.max(...lums) - Math.min(...lums) > 1;
  });
  assert.ok(varied);
});

test("shared grid vertices get matching normals -> seamless shading", () => {
  // Two horizontally-adjacent faces share an edge; the shared corners should get
  // (near) identical colors, which is what makes Gouraud shading seamless.
  const s = new Surface((u, v) => [Math.cos(u), Math.sin(u), v], {
    uRange: [0, 2 * Math.PI], vRange: [0, 1], resolution: [12, 4], smooth: true,
  });
  // Face at (i=0,j=0) and (i=1,j=0): resolution nv=4, so face index = i*nv + j.
  const f0 = s.submobjects[0 * 4 + 0];
  const f1 = s.submobjects[1 * 4 + 0];
  // f0 corner P1 (ub,va) == f1 corner P0 (ua,va); colors should match closely.
  const a = f0._vertexColors[1];
  const b = f1._vertexColors[0];
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(a[k] - b[k]) < 2);
});

test("Cube stays flat-shaded (no per-vertex colors)", () => {
  const c = new Cube({ sideLength: 2 });
  assert.ok(c.submobjects.every((f) => !f._vertexColors));
});

test("Gouraud triangle interpolates vertex colors across pixels", () => {
  const zb = new ZBuffer(11, 11);
  zb.clear(0, 0, 0);
  // A wide triangle: left vertex black, right vertices white.
  zb.triangleGouraud(
    { x: 0, y: 5, z: 0, r: 0, g: 0, b: 0 },
    { x: 10, y: 0, z: 0, r: 255, g: 255, b: 255 },
    { x: 10, y: 10, z: 0, r: 255, g: 255, b: 255 },
    1,
  );
  const at = (x, y) => zb.color[(y * 11 + x) * 4];
  // Brightness should increase left-to-right.
  assert.ok(at(9, 5) > at(2, 5));
});
