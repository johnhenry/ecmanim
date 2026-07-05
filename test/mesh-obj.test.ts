import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadMeshOBJ, extractMeshData, extractMeshDataFromGeometry, isMeshLoaderAvailable,
} from "../src/loaders/mesh_obj.ts";
import { Polyhedron } from "../src/mobject/polyhedra.ts";
import { ThreeDCamera } from "../src/scene/three_d.ts";
import { CanvasRenderer } from "../src/renderer/CanvasRenderer.ts";
import * as V from "../src/core/math/vector.ts";

// A small square pyramid: 5 vertices, 6 triangular faces (4 sides + a
// 2-triangle base) -- deliberately written with NO shared vertex indices per
// face (every "f" line references its own trio) so the loader's own dedup
// step is what merges them, not three's OBJ parser doing it for us.
const PYRAMID_OBJ = `
v -1 -1 0
v 1 -1 0
v 1 1 0
v -1 1 0
v 0 0 2
f 1 2 5
f 2 3 5
f 3 4 5
f 4 1 5
f 1 2 3
f 1 3 4
`;

test("loadMeshOBJ parses a real OBJ via the real bundled three OBJLoader", async () => {
  const mesh = await loadMeshOBJ(PYRAMID_OBJ);
  assert.ok(mesh instanceof Polyhedron);
  // 6 triangular faces in the fixture.
  assert.equal(mesh.faces.submobjects.length, 6);
  // 5 unique vertices after dedup (without dedup this would be 18 -- 6*3).
  assert.equal(mesh.vertexCoords.length, 5);
  assert.ok(isMeshLoaderAvailable(), "a successful load marks the loader as available");
});

// Every point across all face submobjects (the actual rendered geometry that
// rotate()/scale() operate on) -- Polyhedron's own cached `vertexCoords` is
// NOT what transforms touch (only updateFaces() refreshes it from the
// vertex Dots, which aren't even present when showVertices is false), so
// tests must read the real per-face points, not that bookkeeping field.
function allFacePoints(mesh: Polyhedron): number[][] {
  return mesh.faces.submobjects.flatMap((f: any) => f.points);
}

test("an imported mesh's rotate/scale/moveTo work for free (real per-point transforms)", async () => {
  const mesh = await loadMeshOBJ(PYRAMID_OBJ);
  // Rotating 90deg about Y is about the mesh's own center ([0,0,1] for this
  // fixture, per Mobject.rotate()'s default aboutPoint) -- both the apex
  // [0,0,2] and (coincidentally, since this fixture's footprint half-width
  // equals its half-height) some base corners land back at z=2, so tracking
  // "does the max Z change" is NOT a reliable signal here. Instead assert the
  // apex lands exactly where the rotation predicts: offset [0,0,1] from
  // center, rotated 90deg about Y, is [1,0,0] -> absolute [1,0,1].
  const hasPredictedApex = allFacePoints(mesh).some((p) => V.equals(p, [0, 0, 2], 1e-6));
  assert.ok(hasPredictedApex, "fixture's apex is at [0,0,2] before any transform");

  mesh.rotate(Math.PI / 2, { axis: [0, 1, 0] });
  const hasRotatedApex = allFacePoints(mesh).some((p) => V.equals(p, [1, 0, 1], 1e-6));
  assert.ok(hasRotatedApex, "a 90deg rotation about Y must move the apex to the predicted [1,0,1]");

  const afterRotate = mesh.getBoundingBox();
  mesh.scale(2);
  const afterScale = mesh.getBoundingBox();
  const sizeBefore = V.distance(afterRotate.min, afterRotate.max);
  const sizeAfter = V.distance(afterScale.min, afterScale.max);
  assert.ok(Math.abs(sizeAfter / sizeBefore - 2) < 1e-6, "scale(2) should double the bounding diagonal");

  mesh.moveTo([5, 5, 5]);
  assert.ok(V.equals(mesh.getCenter(), [5, 5, 5], 1e-6));
});

test("an imported mesh renders through CanvasRenderer's 3D depth-buffered path without throwing", async () => {
  const mesh = await loadMeshOBJ(PYRAMID_OBJ);
  const ctx = {
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, bezierCurveTo() {},
    fillRect() {}, rect() {}, clip() {}, stroke() {}, fill() {},
    set fillStyle(v) {}, get fillStyle() { return ""; }, set strokeStyle(v) {}, set lineWidth(v) {},
    set lineJoin(v) {}, set lineCap(v) {}, set font(v) {}, set textAlign(v) {}, set textBaseline(v) {},
    createImageData(w: number, h: number) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData() {}, getImageData(x: number, y: number, w: number, h: number) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
  };
  const cam = new ThreeDCamera({ pixelWidth: 40, pixelHeight: 40, phi: 70 * V.DEGREES });
  const renderer = new CanvasRenderer(ctx as any, cam);
  assert.doesNotThrow(() => renderer.renderScene([mesh]));
});

test("copy() is independent of the original", async () => {
  const mesh = await loadMeshOBJ(PYRAMID_OBJ);
  const clone = mesh.copy();
  clone.moveTo([9, 9, 9]);
  assert.ok(!V.equals(mesh.getCenter(), [9, 9, 9], 1e-6), "moving the clone must not move the original");
});

test("interpolate() between two loads of the same fixture doesn't throw (equal topology)", async () => {
  const a = await loadMeshOBJ(PYRAMID_OBJ);
  const b = await loadMeshOBJ(PYRAMID_OBJ);
  b.moveTo([4, 0, 0]);
  const mid = await loadMeshOBJ(PYRAMID_OBJ);
  assert.doesNotThrow(() => mid.interpolate(a, b, 0.5));
  // Halfway between center [0,0,~] and [4,0,0] should land near x=2.
  assert.ok(Math.abs(mid.getCenter()[0] - 2) < 0.5);
});

test("showVertices/showEdges default to false for an imported mesh (no stray Dot/Line overlay)", async () => {
  const mesh = await loadMeshOBJ(PYRAMID_OBJ);
  // Only the faces group should be a submobject -- no vertex Dots, no edge Lines.
  assert.equal(mesh.submobjects.length, 1);
  assert.equal(mesh.submobjects[0], mesh.faces);
  // Vertices/edges are still BUILT internally, just not displayed.
  assert.equal(mesh.vertices.submobjects.length, 5);
  assert.ok(mesh.edges.size > 0);
});

test("loadMeshOBJ accepts an injected OBJLoader class (no real three import needed)", async () => {
  // A minimal fake OBJLoader whose .parse() returns a hand-built Object3D-
  // shaped tree: one "mesh" with a non-indexed, 3-triangle BufferGeometry-
  // shaped position attribute sharing one coincident vertex pair, so this
  // also exercises the dedup path independently of three actually running.
  const positions = [
    0, 0, 0, 1, 0, 0, 0, 1, 0, // triangle 1
    1, 0, 0, 1, 1, 0, 0, 1, 0, // triangle 2 -- shares 2 verts with triangle 1
  ];
  const fakeGeometry = {
    index: null,
    attributes: {
      position: {
        count: positions.length / 3,
        getX: (i: number) => positions[i * 3],
        getY: (i: number) => positions[i * 3 + 1],
        getZ: (i: number) => positions[i * 3 + 2],
      },
    },
  };
  class FakeOBJLoader {
    parse(_text: string) {
      return { isMesh: true, geometry: fakeGeometry, children: [] };
    }
  }
  const mesh = await loadMeshOBJ("irrelevant with a fake loader", { OBJLoader: FakeOBJLoader as any });
  assert.equal(mesh.faces.submobjects.length, 2);
  // 6 raw corners, 2 coincident pairs merged -> 4 unique vertices.
  assert.equal(mesh.vertexCoords.length, 4);
});

test("loadMeshOBJ throws a clear error for geometry-less OBJ text", async () => {
  await assert.rejects(() => loadMeshOBJ("# just a comment, no vertices or faces\n"), /no mesh geometry/);
});

test("extractMeshData / extractMeshDataFromGeometry are independently usable on hand-built data", () => {
  const geometry = {
    index: { count: 3, getX: (i: number) => i }, // indexed, identity mapping
    attributes: {
      position: {
        getX: (i: number) => [0, 1, 0][i], getY: (i: number) => [0, 0, 1][i], getZ: () => 0,
      },
    },
  };
  const { vertexCoords, facesList } = extractMeshDataFromGeometry(geometry);
  assert.equal(vertexCoords.length, 3);
  assert.equal(facesList.length, 1);
  assert.deepEqual(facesList[0], [0, 1, 2]);

  const obj3D = { isMesh: false, children: [{ isMesh: true, geometry, children: [] }] };
  const merged = extractMeshData(obj3D);
  assert.equal(merged.vertexCoords.length, 3);
  assert.equal(merged.facesList.length, 1);
});
