// Manual perf benchmark for imported meshes (Phase 2 of the mesh-import
// plan) -- NOT picked up by `npm test` (glob is 'test/**/*.test.ts', this is
// .bench.ts on purpose). Run directly:
//
//   node --experimental-strip-types test/mesh-perf.bench.ts
//
// Produces a go/no-go DECISION for whether the CPU/Polyhedron tier (one
// PolyhedronFace VMobject per triangle, walked individually every frame) is
// good enough for the initial mesh-import release, or whether the GPU
// Mesh3D+ThreeRenderer tier needs to be pulled forward. See the "Phase 2"
// section of ~/.claude/plans/let-s-create-a-plan-cozy-wind.md.
//
// Real-time ThreeRenderer GPU timing isn't meaningfully measurable here --
// that needs an actual WebGL context (the project's existing headless-Chrome
// CDP setup in test/node-gl.test.ts), out of scope for a lightweight
// benchmark script. What's measured instead is `collectBuffers()`'s JS-side
// fan-triangulation cost (via the test suite's own mockTHREE() pattern) as a
// cheap proxy for how that path scales, not real GPU draw time.

import { Polyhedron } from "../src/mobject/polyhedra.ts";
import { ThreeDCamera } from "../src/scene/three_d.ts";
import { CanvasRenderer } from "../src/renderer/CanvasRenderer.ts";
import { collectBuffers } from "../src/renderer/geometry_util.ts";
import * as V from "../src/core/math/vector.ts";

// A procedural UV-sphere, triangulated (2 triangles per quad) -- picks
// rows/cols to land close to `targetTriangles`, no external asset needed.
function generateSphereMesh(targetTriangles: number): { vertexCoords: number[][]; facesList: number[][] } {
  const cols = Math.max(3, Math.round(Math.sqrt(targetTriangles / 2)));
  const rows = Math.max(2, Math.round(targetTriangles / (2 * cols)));
  const vertexCoords: number[][] = [];
  for (let r = 0; r <= rows; r++) {
    const theta = (r / rows) * Math.PI;
    for (let c = 0; c <= cols; c++) {
      const phi = (c / cols) * 2 * Math.PI;
      vertexCoords.push([Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)]);
    }
  }
  const idx = (r: number, c: number) => r * (cols + 1) + c;
  const facesList: number[][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = idx(r, c), b = idx(r, c + 1), cc = idx(r + 1, c), d = idx(r + 1, c + 1);
      facesList.push([a, b, cc]);
      facesList.push([b, d, cc]);
    }
  }
  return { vertexCoords, facesList };
}

function makeFakeCtx(): any {
  return {
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, bezierCurveTo() {},
    fillRect() {}, rect() {}, clip() {}, stroke() {}, fill() {},
    set fillStyle(v: any) {}, get fillStyle() { return ""; }, set strokeStyle(v: any) {}, set lineWidth(v: any) {},
    set lineJoin(v: any) {}, set lineCap(v: any) {}, set font(v: any) {}, set textAlign(v: any) {}, set textBaseline(v: any) {},
    createImageData(w: number, h: number) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData() {},
    getImageData(x: number, y: number, w: number, h: number) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
  };
}

function timeMs(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

const SIZES = [1000, 5000, 10000];
const results: { triangles: number; actualTriangles: number; constructMs: number; renderMs: number; collectBuffersMs: number }[] = [];

for (const target of SIZES) {
  const { vertexCoords, facesList } = generateSphereMesh(target);

  let mesh!: Polyhedron;
  const constructMs = timeMs(() => {
    mesh = new Polyhedron(vertexCoords, facesList, { showVertices: false, showEdges: false });
  });

  const cam = new ThreeDCamera({ pixelWidth: 400, pixelHeight: 400, phi: 60 * V.DEGREES });
  const renderer = new CanvasRenderer(makeFakeCtx(), cam);
  // Warm up once (first call allocates the ZBuffer), then time a clean frame.
  renderer.renderScene([mesh]);
  const renderMs = timeMs(() => renderer.renderScene([mesh]));

  const collectBuffersMs = timeMs(() => collectBuffers([mesh]));

  results.push({ triangles: target, actualTriangles: facesList.length, constructMs, renderMs, collectBuffersMs });
}

console.log("Mesh import perf benchmark (Tier A / CPU Polyhedron path)");
console.log("=".repeat(70));
for (const r of results) {
  console.log(
    `~${r.triangles} triangles (actual ${r.actualTriangles}): ` +
    `construct=${r.constructMs.toFixed(1)}ms  ` +
    `CanvasRenderer.renderScene3D=${r.renderMs.toFixed(1)}ms  ` +
    `collectBuffers (ThreeRenderer proxy)=${r.collectBuffersMs.toFixed(1)}ms`,
  );
}
console.log("=".repeat(70));

const FRAME_BUDGET_MS = 1000 / 24; // ~41.7ms -- Phase 2's stated 24fps-equivalent bar
const at5k = results.find((r) => r.triangles === 5000)!;
const goNoGo = at5k.renderMs <= FRAME_BUDGET_MS;
console.log(
  goNoGo
    ? `GO: CanvasRenderer sustains ${at5k.renderMs.toFixed(1)}ms/frame at ~5,000 triangles ` +
      `(budget ${FRAME_BUDGET_MS.toFixed(1)}ms) -- Tier A (Polyhedron) is good enough for the initial ` +
      `release; Tier B (GPU Mesh3D) is a non-blocking future item.`
    : `NO-GO: CanvasRenderer needs ${at5k.renderMs.toFixed(1)}ms/frame at ~5,000 triangles, ` +
      `over budget (${FRAME_BUDGET_MS.toFixed(1)}ms) -- pull Phase 3 (GPU tier) forward before calling ` +
      `mesh import "first class" beyond small/decorative models.`,
);
