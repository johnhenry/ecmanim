import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMeshSTL } from "../src/loaders/mesh_stl.ts";
import { isMeshLoaderAvailable } from "../src/loaders/mesh_util.ts";
import { Polyhedron } from "../src/mobject/polyhedra.ts";
import { ThreeDCamera } from "../src/scene/three_d.ts";
import { CanvasRenderer } from "../src/renderer/CanvasRenderer.ts";
import * as V from "../src/core/math/vector.ts";

// ASCII STL for a square pyramid (same shape as the OBJ fixture in
// test/mesh-obj.test.ts): 6 triangular facets, written with zero index
// sharing at all -- STL has no built-in vertex-sharing concept whatsoever
// (unlike OBJ, which at least sometimes shares indices), so this fixture is
// the sterner test of the shared dedup step in mesh_util.ts.
const PYRAMID_STL = `solid pyramid
facet normal 0 0 -1
  outer loop
    vertex -1 -1 0
    vertex 1 -1 0
    vertex 1 1 0
  endloop
endfacet
facet normal 0 0 -1
  outer loop
    vertex -1 -1 0
    vertex 1 1 0
    vertex -1 1 0
  endloop
endfacet
facet normal 0 -1 0.5
  outer loop
    vertex -1 -1 0
    vertex 1 -1 0
    vertex 0 0 2
  endloop
endfacet
facet normal 1 0 0.5
  outer loop
    vertex 1 -1 0
    vertex 1 1 0
    vertex 0 0 2
  endloop
endfacet
facet normal 0 1 0.5
  outer loop
    vertex 1 1 0
    vertex -1 1 0
    vertex 0 0 2
  endloop
endfacet
facet normal -1 0 0.5
  outer loop
    vertex -1 1 0
    vertex -1 -1 0
    vertex 0 0 2
  endloop
endfacet
endsolid pyramid
`;

test("loadMeshSTL parses ASCII STL via the real bundled three STLLoader", async () => {
  const mesh = await loadMeshSTL(PYRAMID_STL);
  assert.ok(mesh instanceof Polyhedron);
  assert.equal(mesh.faces.submobjects.length, 6);
  // 5 unique vertices after dedup -- STL's 18 raw corners (6 facets * 3, zero
  // sharing) must collapse to the pyramid's actual 5 distinct points.
  assert.equal(mesh.vertexCoords.length, 5);
  assert.ok(isMeshLoaderAvailable());
});

test("an STL-imported mesh's transforms and rendering work identically to OBJ's", async () => {
  const mesh = await loadMeshSTL(PYRAMID_STL);
  mesh.moveTo([3, 3, 3]);
  assert.ok(V.equals(mesh.getCenter(), [3, 3, 3], 1e-6));

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

test("showVertices/showEdges default to false for an imported STL mesh", async () => {
  const mesh = await loadMeshSTL(PYRAMID_STL);
  assert.equal(mesh.submobjects.length, 1);
  assert.equal(mesh.submobjects[0], mesh.faces);
  assert.equal(mesh.vertices.submobjects.length, 5);
  assert.ok(mesh.edges.size > 0);
});

test("STL's total lack of vertex sharing is fully deduped: a fixture with 2 facets sharing an edge collapses to 4 vertices, not 6", async () => {
  const twoTriangles = `solid pair
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 1 1 0
  endloop
endfacet
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 1 0
    vertex 0 1 0
  endloop
endfacet
endsolid pair
`;
  const mesh = await loadMeshSTL(twoTriangles);
  assert.equal(mesh.faces.submobjects.length, 2);
  assert.equal(mesh.vertexCoords.length, 4, "4 unique corners, not 6 -- the shared edge's 2 vertices must be deduped");
  assert.equal(mesh.edges.size, 5, "2 triangles sharing one edge have 5 unique edges (3 + 3 - 1 shared)");
});

test("loadMeshSTL accepts an injected STLLoader class (no real three import needed)", async () => {
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const fakeGeometry = {
    index: null,
    attributes: {
      position: {
        count: 3,
        getX: (i: number) => positions[i * 3],
        getY: (i: number) => positions[i * 3 + 1],
        getZ: (i: number) => positions[i * 3 + 2],
      },
    },
  };
  class FakeSTLLoader {
    parse(_bytesOrText: ArrayBuffer | string) {
      return fakeGeometry;
    }
  }
  const mesh = await loadMeshSTL("irrelevant with a fake loader", { STLLoader: FakeSTLLoader as any });
  assert.equal(mesh.faces.submobjects.length, 1);
  assert.equal(mesh.vertexCoords.length, 3);
});

test("loadMeshSTL throws a clear error for valid-but-geometry-less STL data", async () => {
  // Padded long enough that STLLoader's binary-vs-ASCII sniff (which probes
  // byte offsets into the input) succeeds and correctly parses this as an
  // empty ASCII solid, rather than throwing its own internal RangeError --
  // see the next test for that shorter-input case.
  const empty = "solid emptysolidname_padded_to_be_long_enough_for_the_sniffer\nendsolid emptysolidname_padded_to_be_long_enough_for_the_sniffer\n";
  await assert.rejects(() => loadMeshSTL(empty), /no mesh geometry/);
});

test("loadMeshSTL wraps a too-short/malformed input's internal parser error into a clear, catchable message", async () => {
  // Short enough that STLLoader's own binary-format sniff throws a raw
  // RangeError while probing byte offsets -- confirms loadMeshSTL's own
  // try/catch converts that into the same documented failure shape as every
  // other error path here, not a leaked library-internal exception.
  await assert.rejects(() => loadMeshSTL("solid empty\nendsolid empty\n"), /could not parse STL data/);
});
