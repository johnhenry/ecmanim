import { test } from "node:test";
import assert from "node:assert/strict";

import { CanvasRenderer, Camera } from "../src/renderer/CanvasRenderer.ts";
import { ThreeRenderer } from "../src/renderer/ThreeRenderer.ts";
import { SVGRenderer } from "../src/renderer/SVGRenderer.ts";
import { Circle } from "../src/mobject/geometry.ts";

// A minimal fake Ctx2D recording calls, mirroring the fake-context pattern
// used by other CanvasRenderer tests.
function makeFakeCtx(): any {
  const calls: string[] = [];
  const handler = {
    get(t: any, prop: string) {
      if (prop === "calls") return calls;
      return (...args: any[]) => { calls.push(prop); };
    },
    set(t: any, prop: string, value: any) { t[prop] = value; return true; },
  };
  const ctx: any = new Proxy({ calls }, handler);
  return ctx;
}

function mockTHREE() {
  const V3 = () => ({ set(x: number, y: number, z: number) { (this as any).x = x; (this as any).y = y; (this as any).z = z; return this; } });
  const cam = (extra: any) => ({
    position: V3(), up: V3(), lookAt() {}, updateProjectionMatrix() {}, ...extra,
  });
  return {
    ColorManagement: { enabled: true },
    DoubleSide: 2,
    Color: class { c: any; constructor(c: any) { this.c = c; } },
    WebGLRenderer: class { setPixelRatio() {} setSize() {} render() { (this as any).rendered = true; } dispose() {} },
    Scene: class { children: any[] = []; add(o: any) { this.children.push(o); } },
    Group: class { children: any[] = []; add(o: any) { this.children.push(o); } clear() { this.children = []; } },
    PerspectiveCamera: class { constructor(fov: any, asp: any) { Object.assign(this, cam({ isPerspectiveCamera: true, fov, aspect: asp })); } },
    OrthographicCamera: class { constructor() { Object.assign(this, cam({ isOrthographicCamera: true })); } },
    BufferGeometry: class { attrs: any; setAttribute(k: string, v: any) { (this.attrs ??= {})[k] = v; } dispose() {} },
    Float32BufferAttribute: class { array: any; itemSize: any; constructor(array: any, itemSize: any) { this.array = array; this.itemSize = itemSize; } },
    MeshBasicMaterial: class { constructor(o: any) { Object.assign(this, o); } dispose() {} },
    LineBasicMaterial: class { constructor(o: any) { Object.assign(this, o); } dispose() {} },
    Mesh: class { isMesh = true; geometry: any; material: any; constructor(geometry: any, material: any) { this.geometry = geometry; this.material = material; } },
    LineSegments: class { isLine = true; geometry: any; material: any; constructor(geometry: any, material: any) { this.geometry = geometry; this.material = material; } },
  };
}

test("every renderer backend exposes a renderFrame() function", () => {
  const canvasR = new CanvasRenderer(makeFakeCtx(), new Camera({ pixelWidth: 100, pixelHeight: 100 }));
  const svgR = new SVGRenderer(new Camera({ pixelWidth: 100, pixelHeight: 100 }));
  const threeR = new ThreeRenderer(mockTHREE(), { camera: new Camera({ pixelWidth: 100, pixelHeight: 100 }), canvas: {} });

  assert.equal(typeof canvasR.renderFrame, "function");
  assert.equal(typeof svgR.renderFrame, "function");
  assert.equal(typeof threeR.renderFrame, "function");
});

test("CanvasRenderer.renderFrame() produces output equivalent to renderScene()", () => {
  const mob = new Circle({ radius: 1, fillColor: "#58C4DD", fillOpacity: 1 });
  const camera1 = new Camera({ pixelWidth: 100, pixelHeight: 100 });
  const camera2 = new Camera({ pixelWidth: 100, pixelHeight: 100 });
  const ctx1 = makeFakeCtx();
  const ctx2 = makeFakeCtx();
  new CanvasRenderer(ctx1, camera1).renderScene([mob]);
  new CanvasRenderer(ctx2, camera2).renderFrame([mob]);
  assert.deepEqual(ctx2.calls, ctx1.calls);
});

test("SVGRenderer.renderFrame() produces output equivalent to renderToString()", () => {
  const mob = new Circle({ radius: 1, fillColor: "#58C4DD", fillOpacity: 1 });
  const svg1 = new SVGRenderer(new Camera({ pixelWidth: 100, pixelHeight: 100 }));
  const svg2 = new SVGRenderer(new Camera({ pixelWidth: 100, pixelHeight: 100 }));
  assert.equal(svg2.renderFrame([mob]), svg1.renderToString([mob]));
});

test("ThreeRenderer.renderFrame() produces the same GPU mesh output as render()", () => {
  const mob = new Circle({ radius: 1, fillColor: "#58C4DD", fillOpacity: 1 });
  const r1 = new ThreeRenderer(mockTHREE(), { camera: new Camera({ pixelWidth: 100, pixelHeight: 100 }), canvas: {} });
  const r2 = new ThreeRenderer(mockTHREE(), { camera: new Camera({ pixelWidth: 100, pixelHeight: 100 }), canvas: {} });
  r1.render([mob]);
  r2.renderFrame([mob]);
  const mesh1 = r1.group.children.find((c: any) => c.isMesh);
  const mesh2 = r2.group.children.find((c: any) => c.isMesh);
  assert.ok(mesh1 && mesh2);
  assert.deepEqual(mesh2.geometry.attrs.position.array, mesh1.geometry.attrs.position.array);
});
