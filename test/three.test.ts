import { test } from "node:test";
import assert from "node:assert/strict";
import { collectBuffers, flattenMobject } from "../src/renderer/geometry_util.ts";
import { ThreeRenderer } from "../src/renderer/ThreeRenderer.ts";
import { Sphere, Cube } from "../src/mobject/surface.ts";
import { ThreeDAxes, ThreeDCamera } from "../src/scene/three_d.ts";
import { Circle } from "../src/mobject/geometry.ts";
import { Camera } from "../src/renderer/CanvasRenderer.ts";
import * as V from "../src/core/math/vector.ts";

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

// Regression: blur()/glow()/dropShadow()/colorAdjust()/noise() and
// ParticleSystem render on Canvas-2D/SVG but have zero implementation in
// ThreeRenderer -- previously this was entirely silent, so a caller
// exporting via WebGL got no signal that content was being dropped.
test("ThreeRenderer warns (once, not per-frame) when a mobject has an unsupported effect", async () => {
  const THREE = mockTHREE();
  const r = new ThreeRenderer(THREE, { camera: new Camera({ pixelWidth: 640, pixelHeight: 360 }), canvas: {} });
  const circle = new Circle({ radius: 1, fillColor: "#58C4DD", fillOpacity: 1 }).blur(4);

  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: any[]) => { warnings.push(String(args[0])); };
  try {
    r.render([circle]);
    r.render([circle]); // a second frame with the same mobject must not re-warn
  } finally {
    console.warn = origWarn;
  }

  assert.equal(warnings.length, 1, `should warn exactly once, not once per frame, got: ${JSON.stringify(warnings)}`);
  assert.match(warnings[0], /blur/i);
  assert.match(warnings[0], /ThreeRenderer|WebGL/i);
});

test("ThreeRenderer warns when a ParticleSystem is rendered (unsupported on WebGL)", async () => {
  const { ParticleSystem } = await import("../src/mobject/particles.ts");
  const THREE = mockTHREE();
  const r = new ThreeRenderer(THREE, { camera: new Camera({ pixelWidth: 640, pixelHeight: 360 }), canvas: {} });
  const ps = new ParticleSystem({});

  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: any[]) => { warnings.push(String(args[0])); };
  try {
    // Call the warning check directly rather than through the full render()
    // pipeline: ParticleSystem isn't a VMobject (no getSubpaths()), and
    // collectBuffers()'s generic fill/stroke path assumes one -- a
    // separate, pre-existing gap in WebGL's geometry pipeline (not part of
    // this fix's scope, which is only the missing warning signal).
    r._warnUnsupported([ps]);
  } finally {
    console.warn = origWarn;
  }

  assert.equal(warnings.length, 1, `should warn exactly once, got: ${JSON.stringify(warnings)}`);
  assert.match(warnings[0], /ParticleSystem/i);
});

test("ThreeRenderer does NOT warn for an ordinary mobject with no effects", () => {
  const THREE = mockTHREE();
  const r = new ThreeRenderer(THREE, { camera: new Camera({ pixelWidth: 640, pixelHeight: 360 }), canvas: {} });
  const circle = new Circle({ radius: 1, fillColor: "#58C4DD", fillOpacity: 1 });

  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: any[]) => { warnings.push(String(args[0])); };
  try {
    r.render([circle]);
  } finally {
    console.warn = origWarn;
  }

  assert.deepEqual(warnings, []);
});
