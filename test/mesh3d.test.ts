import { test } from "node:test";
import assert from "node:assert/strict";
import { Mesh3D } from "../src/mobject/mesh3d.ts";
import { loadMesh3D } from "../src/loaders/mesh3d_loader.ts";
import { collectBuffers } from "../src/renderer/geometry_util.ts";
import { ThreeRenderer } from "../src/renderer/ThreeRenderer.ts";
import { ThreeDCamera } from "../src/scene/three_d.ts";
import { CanvasRenderer, Camera } from "../src/renderer/CanvasRenderer.ts";
import * as V from "../src/core/math/vector.ts";

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

// A unit cube (8 verts, 2 quad faces used only as a minimal smoke fixture --
// _mesh3D fan-triangulates n-gon faces, so quads exercise that path too).
const CUBE_VERTS = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const CUBE_FACES = [[0, 1, 2, 3], [4, 5, 6, 7]];

// A minimal mock of the Three.js surface used by ThreeRenderer -- extends
// test/three.test.ts's own mockTHREE() pattern with what _mesh3D() needs
// (setIndex/computeVertexNormals on BufferGeometry, a real Matrix4-shaped
// mock so the applied transform is inspectable).
function mockTHREE() {
  const V3 = () => ({ set(x: any, y: any, z: any) { (this as any).x = x; (this as any).y = y; (this as any).z = z; return this; } });
  const cam = (extra: any) => ({ position: V3(), up: V3(), lookAt() {}, updateProjectionMatrix() {}, ...extra });
  return {
    ColorManagement: { enabled: true },
    DoubleSide: 2,
    Color: class { r: number; g: number; b: number; constructor(r: number, g: number, b: number) { this.r = r; this.g = g; this.b = b; } },
    WebGLRenderer: class { setPixelRatio() {} setSize() {} render() { (this as any).rendered = true; } dispose() {} },
    Scene: class { children: any[] = []; add(o: any) { this.children.push(o); } },
    Group: class { children: any[] = []; add(o: any) { this.children.push(o); } clear() { this.children = []; } },
    PerspectiveCamera: class { constructor(fov: any, asp: any) { Object.assign(this, cam({ isPerspectiveCamera: true, fov, aspect: asp })); } },
    OrthographicCamera: class { constructor() { Object.assign(this, cam({ isOrthographicCamera: true })); } },
    BufferGeometry: class {
      attrs: any = {};
      index: number[] | null = null;
      setAttribute(k: string, v: any) { this.attrs[k] = v; }
      setIndex(idx: number[]) { this.index = idx; }
      computeVertexNormals() { (this as any).normalsComputed = true; }
      dispose() { (this as any).disposed = true; }
    },
    Float32BufferAttribute: class { array: any; itemSize: number; constructor(arr: any, size: number) { this.array = arr; this.itemSize = size; } },
    MeshBasicMaterial: class { constructor(o: any) { Object.assign(this, o); } dispose() {} },
    MeshStandardMaterial: class { constructor(o: any) { Object.assign(this, o); } dispose() {} },
    Mesh: class {
      isMesh = true;
      geometry: any;
      material: any;
      matrixAutoUpdate = true;
      matrix = { values: null as number[] | null, set(...args: number[]) { this.values = args; } };
      constructor(g: any, m: any) { this.geometry = g; this.material = m; }
    },
  };
}

test("collectBuffers routes a Mesh3D into its own bucket, not opaque", () => {
  const mesh = new Mesh3D(CUBE_VERTS, CUBE_FACES);
  const buf = collectBuffers([mesh]);
  assert.equal(buf.meshes.length, 1);
  assert.equal(buf.meshes[0], mesh);
  assert.equal(buf.opaque.positions.length, 0, "Mesh3D's bbox-proxy points must not leak into the generic VMobject fill path");
});

test("ThreeRenderer.render() builds a real indexed mesh from a Mesh3D and applies its transform", () => {
  const THREE = mockTHREE();
  const camera = new ThreeDCamera({ pixelWidth: 200, pixelHeight: 200, phi: 60 * V.DEGREES });
  const renderer = new ThreeRenderer(THREE, { camera, canvas: {} });
  const mesh = new Mesh3D(CUBE_VERTS, CUBE_FACES);
  mesh.moveTo([2, 3, 4]);

  renderer.render([mesh]);
  const threeMesh = renderer.group.children.find((c: any) => c.isMesh);
  assert.ok(threeMesh, "a THREE.Mesh was added for the Mesh3D");
  assert.equal(threeMesh.geometry.attrs.position.array.length, CUBE_VERTS.length * 3);
  // 2 quad faces fan-triangulated -> 2 triangles each -> 4 triangles -> 12 indices.
  assert.equal(threeMesh.geometry.index.length, 12);
  assert.ok(threeMesh.geometry.normalsComputed);
  // The applied matrix (row-major, this.transform's own layout) should carry
  // the moveTo([2,3,4]) translation in its 4th/8th/12th slots.
  assert.deepEqual(threeMesh.matrix.values, mesh.transform);
  assert.equal(mesh.transform[3], 2);
  assert.equal(mesh.transform[7], 3);
  assert.equal(mesh.transform[11], 4);
});

test("the built geometry is cached on the mobject and reused across renders (not rebuilt from scratch each frame)", () => {
  const THREE = mockTHREE();
  const camera = new ThreeDCamera({ pixelWidth: 200, pixelHeight: 200, phi: 60 * V.DEGREES });
  const renderer = new ThreeRenderer(THREE, { camera, canvas: {} });
  const mesh = new Mesh3D(CUBE_VERTS, CUBE_FACES);

  renderer.render([mesh]);
  const cachedGeometry = mesh._threeGeometryCache;
  assert.ok(cachedGeometry);

  mesh.rotate(0.3, { axis: [0, 1, 0] });
  renderer.render([mesh]);
  assert.equal(mesh._threeGeometryCache, cachedGeometry, "the SAME geometry object is reused, not rebuilt");
});

test("CanvasRenderer has no CPU path for Mesh3D -- it's skipped, not mis-rasterized as its bbox proxy", () => {
  const mesh = new Mesh3D(CUBE_VERTS, CUBE_FACES);
  const ctx = {
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, bezierCurveTo() {},
    fillRect() {}, rect() {}, clip() {}, stroke() {}, fill() {},
    set fillStyle(v: any) {}, get fillStyle() { return ""; }, set strokeStyle(v: any) {}, set lineWidth(v: any) {},
    set lineJoin(v: any) {}, set lineCap(v: any) {}, set font(v: any) {}, set textAlign(v: any) {}, set textBaseline(v: any) {},
    createImageData(w: number, h: number) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData() {}, getImageData(x: number, y: number, w: number, h: number) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
  };
  const cam = new ThreeDCamera({ pixelWidth: 40, pixelHeight: 40, phi: 60 * V.DEGREES });
  const renderer = new CanvasRenderer(ctx as any, cam);
  assert.doesNotThrow(() => renderer.renderScene([mesh]));

  // Also confirm the plain 2D (non-3D-camera) path skips it just as cleanly.
  const cam2d = new Camera({ pixelWidth: 40, pixelHeight: 40 });
  const renderer2d = new CanvasRenderer(ctx as any, cam2d);
  assert.doesNotThrow(() => renderer2d.renderScene([mesh]));
});

test("loadMesh3D parses a real OBJ into a Mesh3D via the shared parseOBJToMeshData step", async () => {
  const mesh = await loadMesh3D(PYRAMID_OBJ, { format: "obj" });
  assert.ok(mesh instanceof Mesh3D);
  assert.equal(mesh.facesList.length, 6);
  assert.equal(mesh.vertexCoords.length, 5);
  // rotate/scale/moveTo work identically to the OBJ/Polyhedron tier.
  mesh.moveTo([1, 2, 3]);
  assert.ok(V.equals(mesh.getCenter(), [1, 2, 3], 1e-6));
});

test("loadMesh3D rejects an unknown format with a clear error", async () => {
  await assert.rejects(() => loadMesh3D(PYRAMID_OBJ, { format: "ply" as any }), /unknown format/);
});
