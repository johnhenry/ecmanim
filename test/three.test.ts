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
    OrthographicCamera: class { constructor(l, r, t, b) { Object.assign(this, cam({ isOrthographicCamera: true, left: l, right: r, top: t, bottom: b })); } },
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

// Regression for #62: ThreeRenderer never called camera.preRender(), so
// MovingCameraScene frame motion never reached the WebGL camera.
test("ThreeRenderer 2D: no camera frame leaves three camera params unchanged (#62)", () => {
  const THREE = mockTHREE();
  const cam = new Camera({ pixelWidth: 640, pixelHeight: 360 });
  const r = new ThreeRenderer(THREE, { camera: cam, canvas: {} });
  const t = r.threeCamera;
  const before = { l: t.left, r: t.right, t: t.top, b: t.bottom };
  r.render([new Circle({ radius: 1 })]);
  assert.deepEqual({ l: t.left, r: t.right, t: t.top, b: t.bottom }, before);
  assert.deepEqual([t.position.x, t.position.y, t.position.z], [0, 0, 100]);
  assert.deepEqual([t.up.x, t.up.y, t.up.z], [0, 1, 0]);
  assert.equal(t.zoom, 1);
});

test("ThreeRenderer 2D: moved/scaled/rolled camera frame reaches the three camera (#62)", async () => {
  const { Rectangle } = await import("../src/mobject/geometry.ts");
  const THREE = mockTHREE();
  const cam = new Camera({ pixelWidth: 640, pixelHeight: 360 });
  const frame = new Rectangle({ width: cam.frameWidth, height: cam.frameHeight, strokeWidth: 0, fillOpacity: 0 });
  (frame as any).__isCameraFrameRect = true;
  cam.frame = frame;
  const r = new ThreeRenderer(THREE, { camera: cam, canvas: {} });
  const w0 = cam.frameWidth;
  frame.scale(0.5).moveTo([2, 1, 0]);
  r.render([new Circle({ radius: 1 })]);
  const t = r.threeCamera;
  assert.ok(Math.abs(t.position.x - 2) < 1e-9 && Math.abs(t.position.y - 1) < 1e-9);
  assert.ok(Math.abs(t.right - w0 / 4) < 1e-9 && Math.abs(t.left + w0 / 4) < 1e-9);
  assert.ok(Math.abs(t.top - cam.frameHeight / 2) < 1e-9);
  assert.ok(Math.abs(cam.frameWidth - w0 / 2) < 1e-9);
  // Roll: rotating the frame rolls the camera (up vector rotated by +rotation).
  frame.rotate(Math.PI / 2);
  r.render([new Circle({ radius: 1 })]);
  assert.ok(Math.abs(Math.abs(cam.rotation!) - Math.PI / 2) < 1e-6);
  assert.ok(Math.abs(t.up.x + Math.sin(cam.rotation!)) < 1e-9 && Math.abs(t.up.y - Math.cos(cam.rotation!)) < 1e-9);
  // Zoom still honoured.
  cam.zoom = 2;
  r.render([new Circle({ radius: 1 })]);
  assert.equal(t.zoom, 2);
});

test("ThreeRenderer 3D: frame center/size/roll reach the perspective camera (#62)", async () => {
  const { Rectangle } = await import("../src/mobject/geometry.ts");
  const THREE = mockTHREE();
  const mk = () => new ThreeDCamera({ pixelWidth: 640, pixelHeight: 360, phi: 60 * V.DEGREES, theta: -90 * V.DEGREES });
  // Baseline (no frame) vs a frame identical to the default viewport: same camera.
  const base = mk();
  const rb = new ThreeRenderer(THREE, { camera: base, canvas: {} });
  rb.render([]);
  const cam = mk();
  const frame = new Rectangle({ width: cam.frameWidth, height: cam.frameHeight, strokeWidth: 0, fillOpacity: 0 });
  (frame as any).__isCameraFrameRect = true;
  cam.frame = frame;
  const r = new ThreeRenderer(THREE, { camera: cam, canvas: {} });
  r.render([]);
  const t = r.threeCamera, tb = rb.threeCamera;
  assert.ok(Math.abs(t.position.x - tb.position.x) < 1e-9 && Math.abs(t.fov - tb.fov) < 1e-9);
  frame.scale(0.5).moveTo([1, 0, 0]);
  r.render([]);
  assert.ok(Math.abs(t.position.x - tb.position.x - 1) < 1e-9);
  assert.ok(t.fov < tb.fov);
});

test("ThreeRenderer warns once per particle PRESET, not once per child system", async () => {
  const { Aura } = await import("../src/mobject/particle_presets.ts");
  const THREE = mockTHREE();
  const r = new ThreeRenderer(THREE, { camera: new Camera({ pixelWidth: 640, pixelHeight: 360 }), canvas: {} });
  const aura = new Aura();
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: any[]) => { warnings.push(String(args[0])); };
  try {
    r._warnUnsupported([aura]);
    r._warnUnsupported([aura]);
  } finally {
    console.warn = origWarn;
  }
  assert.equal(warnings.length, 1, JSON.stringify(warnings));
  assert.match(warnings[0], /Aura/);
});
