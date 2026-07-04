import { test } from "node:test";
import assert from "node:assert/strict";

import { ThreeRenderer } from "../src/renderer/ThreeRenderer.ts";
import { Camera } from "../src/renderer/CanvasRenderer.ts";
import { RasterText } from "../src/mobject/text/Text.ts";

function mockTHREE(): any {
  const V3 = (): any => ({ set(x: number, y: number, z: number) { (this as any).x = x; (this as any).y = y; (this as any).z = z; return this; } });
  const cam = (extra: any): any => ({
    position: V3(), up: V3(), lookAt() {}, updateProjectionMatrix() {}, ...extra,
  });
  return {
    ColorManagement: { enabled: true },
    DoubleSide: 2,
    Color: class { c: any; constructor(c: any) { this.c = c; } },
    WebGLRenderer: class {
      info = { render: { calls: 0 } };
      setPixelRatio() {}
      setSize() {}
      render() { this.info.render.calls++; }
      dispose() {}
    },
    Scene: class { children: any[] = []; add(o: any) { this.children.push(o); } },
    Group: class { children: any[] = []; add(o: any) { this.children.push(o); } clear() { this.children = []; } },
    PerspectiveCamera: class { constructor(fov: any, asp: any) { Object.assign(this, cam({ isPerspectiveCamera: true, fov, aspect: asp })); } },
    OrthographicCamera: class { constructor() { Object.assign(this, cam({ isOrthographicCamera: true })); } },
    BufferGeometry: class { attrs: any; setAttribute(k: string, v: any) { (this.attrs ??= {})[k] = v; } dispose() {} },
    Float32BufferAttribute: class { array: any; itemSize: any; constructor(array: any, itemSize: any) { this.array = array; this.itemSize = itemSize; } },
    MeshBasicMaterial: class { constructor(o: any) { Object.assign(this, o); } dispose() {} },
    LineBasicMaterial: class { constructor(o: any) { Object.assign(this, o); } dispose() {} },
    SpriteMaterial: class { constructor(o: any) { Object.assign(this, o); } dispose() {} },
    Sprite: class { isSprite = true; scale = { set() {} }; position = { set() {} }; material: any; constructor(material: any) { this.material = material; } },
    CanvasTexture: class { source: any; constructor(source: any) { this.source = source; } dispose() {} },
    Mesh: class { isMesh = true; geometry: any; material: any; constructor(geometry: any, material: any) { this.geometry = geometry; this.material = material; } },
    LineSegments: class { isLine = true; geometry: any; material: any; constructor(geometry: any, material: any) { this.geometry = geometry; this.material = material; } },
  };
}

// A deterministic fake canvas 2D context/document, standing in for the
// browser's real one (Node has neither).
function fakeCtx2D(): any {
  return {
    font: "", fillStyle: "", textAlign: "", textBaseline: "",
    measureText(text: string) { return { width: text.length * 10 }; },
    fillText() {},
  };
}

function withFakeDocument<T>(fn: () => T): T {
  const g: any = globalThis as any;
  const had = "document" in g;
  const saved = g.document;
  g.document = {
    createElement(_tag: string) {
      const canvas: any = { width: 0, height: 0, getContext: () => fakeCtx2D() };
      return canvas;
    },
  };
  try {
    return fn();
  } finally {
    if (had) g.document = saved;
    else delete g.document;
  }
}

function makeText(label: string): RasterText {
  return new RasterText(label, { fontSize: 0.4 });
}

test("~20 raster Text mobjects batch into ONE mesh (and one WebGLRenderer.render() call), not one per mobject", () => {
  withFakeDocument(() => {
    const THREE = mockTHREE();
    const camera = new Camera({ pixelWidth: 960, pixelHeight: 540, frameWidth: (960 / 540) * 8, frameHeight: 8 });
    const renderer = new ThreeRenderer(THREE, { camera, canvas: {} });

    const labels = Array.from({ length: 20 }, (_, i) => makeText(`Label ${i}`));
    renderer.render(labels);

    const meshes = renderer.group.children.filter((c: any) => c.isMesh);
    const sprites = renderer.group.children.filter((c: any) => c.isSprite);
    assert.equal(sprites.length, 0, "the batched path replaces per-mobject sprites entirely");
    assert.equal(meshes.length, 1, "all 20 text mobjects should collapse into exactly one merged mesh");
    // 6 vertices (2 triangles) per text mobject, 3 floats per vertex.
    assert.equal(meshes[0].geometry.attrs.position.array.length, 20 * 6 * 3);
    assert.equal(meshes[0].geometry.attrs.uv.array.length, 20 * 6 * 2);
    assert.equal(renderer.renderer.info.render.calls, 1, "exactly one WebGLRenderer.render() call regardless of mobject count");
  });
});

test("a single Text mobject still batches into one mesh (not a degenerate per-sprite fallback)", () => {
  withFakeDocument(() => {
    const THREE = mockTHREE();
    const camera = new Camera({ pixelWidth: 960, pixelHeight: 540, frameWidth: (960 / 540) * 8, frameHeight: 8 });
    const renderer = new ThreeRenderer(THREE, { camera, canvas: {} });
    renderer.render([makeText("Solo")]);
    const meshes = renderer.group.children.filter((c: any) => c.isMesh);
    assert.equal(meshes.length, 1);
  });
});

test("falls back to the original per-sprite path without a document/canvas backend (headless, no DOM)", () => {
  // No withFakeDocument() wrapper here -- Node has no global `document`.
  const THREE = mockTHREE();
  const camera = new Camera({ pixelWidth: 960, pixelHeight: 540, frameWidth: (960 / 540) * 8, frameHeight: 8 });
  const renderer = new ThreeRenderer(THREE, { camera, canvas: {} });
  renderer.render([makeText("a"), makeText("b")]);
  // _textSprite() itself also bails out with no `document`, so neither path
  // adds anything -- this must not throw.
  assert.equal(renderer.group.children.filter((c: any) => c.isMesh || c.isSprite).length, 0);
});

test("a genuine 3D (perspective) camera keeps the original per-sprite billboarding path, not the batched flat-quad mesh", () => {
  withFakeDocument(() => {
    const THREE = mockTHREE();
    const camera3d: any = new Camera({ pixelWidth: 960, pixelHeight: 540, frameWidth: (960 / 540) * 8, frameHeight: 8 });
    camera3d.projectionDepth = (_p: number[]) => 0; // marks this as a 3D camera (ThreeRenderer.is3D())
    camera3d.focalDistance = 10;
    const renderer = new ThreeRenderer(THREE, { camera: camera3d, canvas: {} });
    renderer.render([makeText("a"), makeText("b"), makeText("c")]);
    const sprites = renderer.group.children.filter((c: any) => c.isSprite);
    assert.equal(sprites.length, 3, "3D cameras still get one real billboarded sprite per text mobject");
  });
});
