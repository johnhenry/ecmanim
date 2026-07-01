import { test } from "node:test";
import assert from "node:assert/strict";
import { Surface, Sphere, Torus, Cylinder, Cone, Cube, Box } from "../src/mobject/surface.js";
import { ThreeDCamera } from "../src/scene/three_d.js";
import { CanvasRenderer } from "../src/renderer/CanvasRenderer.js";
import * as V from "../src/core/math/vector.js";

test("Surface builds a grid of quad faces", () => {
  const s = new Surface((u, v) => [u, v, u * v], { uRange: [0, 1], vRange: [0, 1], resolution: [8, 6] });
  assert.equal(s.submobjects.length, 8 * 6);
  for (const f of s.submobjects) {
    assert.ok(f.points.every((p) => p.every(Number.isFinite)));
    // Each face is a closed quad: 4 straight cubic segments = 13 points.
    assert.equal(f.points.length, 13);
    assert.equal((f.points.length - 1) % 3, 0);
  }
});

test("Sphere has correct radius extent and shaded faces", () => {
  const s = new Sphere({ radius: 2, resolution: [12, 24] });
  assert.equal(s.submobjects.length, 12 * 24);
  const bb = s.getBoundingBox();
  assert.ok(Math.abs((bb.max[0] - bb.min[0]) - 4) < 0.2); // diameter ~4
  // Shading must produce varied face brightness (not all identical).
  const lums = s.submobjects.map((f) => f.fillColor.r + f.fillColor.g + f.fillColor.b);
  const min = Math.min(...lums), max = Math.max(...lums);
  assert.ok(max - min > 0.1);
});

test("Torus self-occlusion depth ordering differs across faces", () => {
  const t = new Torus({ majorRadius: 2, minorRadius: 0.5 });
  const cam = new ThreeDCamera({ phi: 70 * V.DEGREES, theta: -90 * V.DEGREES });
  const depths = t.submobjects.map((f) => cam.projectionDepth(f.getCenter()));
  assert.ok(Math.max(...depths) - Math.min(...depths) > 0.5); // front vs back
});

test("Cube and Box have six faces", () => {
  assert.equal(new Cube({ sideLength: 2 }).submobjects.length, 6);
  assert.equal(new Box({ width: 1, height: 2, depth: 3 }).submobjects.length, 6);
});

test("Cube faces are shaded differently by orientation", () => {
  const c = new Cube({ sideLength: 2 });
  const lums = c.submobjects.map((f) => f.fillColor.r + f.fillColor.g + f.fillColor.b);
  assert.ok(Math.max(...lums) - Math.min(...lums) > 0.05);
});

test("Cylinder and Cone build without error", () => {
  assert.ok(new Cylinder({ radius: 1, height: 3 }).submobjects.length > 0);
  assert.ok(new Cone({ baseRadius: 1, height: 2 }).submobjects.length > 0);
});

test("renderer depth-sorts faces when a 3D camera is active", () => {
  // A fake 2D context that records the order faces are filled.
  const order = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, bezierCurveTo() {},
    fillRect() {}, rect() {}, clip() {}, stroke() {}, fill() { order.push(this._cur); },
    set fillStyle(v) {}, get fillStyle() { return ""; }, set strokeStyle(v) {}, set lineWidth(v) {},
    set lineJoin(v) {}, set lineCap(v) {}, set font(v) {}, set textAlign(v) {}, set textBaseline(v) {},
  };
  const cam = new ThreeDCamera({ pixelWidth: 100, pixelHeight: 100, phi: 70 * V.DEGREES });
  const renderer = new CanvasRenderer(ctx, cam);
  const s = new Sphere({ radius: 1, resolution: [6, 6] });
  // Tag each face with the SAME depth metric the renderer uses (point centroid).
  const orig = renderer.drawVMobject.bind(renderer);
  const centroid = (pts) => {
    let x = 0, y = 0, z = 0;
    for (const p of pts) { x += p[0]; y += p[1]; z += p[2]; }
    return [x / pts.length, y / pts.length, z / pts.length];
  };
  s.submobjects.forEach((f) => { f._depth = cam.projectionDepth(centroid(f.points)); });
  renderer.drawVMobject = (mob) => { ctx._cur = mob._depth; orig(mob); };
  renderer.renderMobjects([s]);
  // Faces should be drawn in ascending depth (far first, near last).
  const drawn = order.filter((d) => d !== undefined);
  let sorted = true;
  for (let i = 1; i < drawn.length; i++) if (drawn[i] < drawn[i - 1] - 1e-9) { sorted = false; break; }
  assert.ok(sorted, "faces drawn far-to-near");
});
