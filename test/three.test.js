import { test } from "node:test";
import assert from "node:assert/strict";
import { collectBuffers, flattenMobject } from "../src/renderer/geometry_util.js";
import { ThreeRenderer } from "../src/renderer/ThreeRenderer.js";
import { Sphere, Cube } from "../src/mobject/surface.js";
import { ThreeDAxes, ThreeDCamera } from "../src/scene/three_d.js";
import { Circle } from "../src/mobject/geometry.js";
import { Camera } from "../src/renderer/CanvasRenderer.js";
import * as V from "../src/core/math/vector.js";

test("collectBuffers builds matching position/color triangle buffers", () => {
  const s = new Sphere({ radius: 1, resolution: [8, 16], strokeWidth: 0 });
  const buf = collectBuffers([s]);
  assert.ok(buf.opaque.positions.length > 0);
  assert.equal(buf.opaque.positions.length, buf.opaque.colors.length); // 3 comps each
  assert.equal(buf.opaque.positions.length % 9, 0); // whole triangles
  assert.ok(buf.opaque.positions.every(Number.isFinite));
});

test("collectBuffers emits line segments for strokes", () => {
  const ax = new ThreeDAxes({});
  const buf = collectBuffers([ax]);
  assert.ok(buf.lines.positions.length >= 6); // >=1 segment (2 verts x 3)
  assert.equal(buf.lines.positions.length % 6, 0);
});

test("smooth surface produces per-vertex-varied colors in the buffer", () => {
  const s = new Sphere({ radius: 2, resolution: [10, 20], strokeWidth: 0, smooth: true });
  const { colors } = collectBuffers([s]).opaque;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < colors.length; i += 3) {
    const lum = colors[i] + colors[i + 1] + colors[i + 2];
    min = Math.min(min, lum); max = Math.max(max, lum);
  }
  assert.ok(max - min > 0.1); // shading gradient present
});

// A minimal mock of the Three.js surface used by ThreeRenderer.
function mockTHREE() {
  const V3 = () => ({ set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });
  const cam = (extra) => ({
    position: V3(), up: V3(), lookAt() {}, updateProjectionMatrix() {}, ...extra,
  });
  return {
    ColorManagement: { enabled: true },
    DoubleSide: 2,
    Color: class { constructor(c) { this.c = c; } },
    WebGLRenderer: class { setPixelRatio() {} setSize() {} render() { this.rendered = true; } dispose() {} },
    Scene: class { constructor() { this.children = []; } add(o) { this.children.push(o); } },
    Group: class { constructor() { this.children = []; } add(o) { this.children.push(o); } clear() { this.children = []; } },
    PerspectiveCamera: class { constructor(fov, asp) { Object.assign(this, cam({ isPerspectiveCamera: true, fov, aspect: asp })); } },
    OrthographicCamera: class { constructor() { Object.assign(this, cam({ isOrthographicCamera: true })); } },
    BufferGeometry: class { setAttribute(k, v) { (this.attrs ??= {})[k] = v; } dispose() {} },
    Float32BufferAttribute: class { constructor(arr, size) { this.array = arr; this.itemSize = size; } },
    MeshBasicMaterial: class { constructor(o) { Object.assign(this, o); } dispose() {} },
    LineBasicMaterial: class { constructor(o) { Object.assign(this, o); } dispose() {} },
    Mesh: class { constructor(g, m) { this.isMesh = true; this.geometry = g; this.material = m; } },
    LineSegments: class { constructor(g, m) { this.isLine = true; this.geometry = g; this.material = m; } },
  };
}

test("ThreeRenderer builds a GPU mesh from a sphere and renders", () => {
  const THREE = mockTHREE();
  const camera = new ThreeDCamera({ pixelWidth: 640, pixelHeight: 360, phi: 60 * V.DEGREES, theta: -90 * V.DEGREES });
  const r = new ThreeRenderer(THREE, { camera, background: "#000000", canvas: {} });
  assert.ok(r.threeCamera.isPerspectiveCamera); // 3D -> perspective
  r.render([new Sphere({ radius: 1, resolution: [8, 16], strokeWidth: 0 })]);
  const mesh = r.group.children.find((c) => c.isMesh);
  assert.ok(mesh, "a mesh was added");
  assert.ok(mesh.geometry.attrs.position.array.length > 0);
  assert.ok(r.renderer.rendered);
  // Camera moved off-origin to view the scene.
  assert.ok(Math.abs(r.threeCamera.position.x) + Math.abs(r.threeCamera.position.y) + Math.abs(r.threeCamera.position.z) > 0);
});

test("ThreeRenderer uses an orthographic camera for a 2D scene", () => {
  const THREE = mockTHREE();
  const r = new ThreeRenderer(THREE, { camera: new Camera({ pixelWidth: 640, pixelHeight: 360 }), canvas: {} });
  assert.ok(r.threeCamera.isOrthographicCamera);
  r.render([new Circle({ radius: 1, fillColor: "#58C4DD", fillOpacity: 1 })]);
  assert.ok(r.group.children.some((c) => c.isMesh));
});
