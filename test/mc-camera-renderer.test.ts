// MC5 (Motion Canvas parity campaign): camera rotation + centerOn/reset,
// strokeStart partial draw, per-mobject compositeOperation, CompositeGroup
// layer scoping, and grayscale/blur effect animatability.

import { test } from "node:test";
import assert from "node:assert/strict";

import { CanvasRenderer, Camera } from "../src/renderer/CanvasRenderer.ts";
import { SVGRenderer } from "../src/renderer/SVGRenderer.ts";
import { MovingCameraScene } from "../src/scene/moving_camera_scene.ts";
import { Circle, Square, Line } from "../src/mobject/geometry.ts";
import { CompositeGroup } from "../src/mobject/Mobject.ts";
import { effectsToCanvasFilter, lerpEffects } from "../src/core/effects.ts";

const close = (a: number, b: number, eps = 1e-6, msg?: string) =>
  assert.ok(Math.abs(a - b) < eps, msg ?? `${a} !~ ${b}`);

// --- fakes (same conventions as test/effects-canvas.test.ts) ---------------

function makeFakeCtx(): any {
  const calls: string[] = [];
  const state: any = { calls, globalCompositeOperation: "source-over", globalAlpha: 1 };
  return new Proxy(state, {
    get(t: any, prop: string) {
      if (prop === "calls") return calls;
      if (prop in t && typeof t[prop] !== "function") return t[prop];
      return (..._args: any[]) => { calls.push(prop); };
    },
    set(t: any, prop: string, value: any) {
      t[prop] = value;
      calls.push(`set:${prop}=${value}`);
      return true;
    },
  });
}

function makeFakeOffscreenFactory() {
  const created: any[] = [];
  const factory = (w: number, h: number) => {
    const ctx = makeFakeCtx();
    const canvas = { width: w, height: h, getContext: () => ctx, _ctx: ctx };
    created.push(canvas);
    return canvas;
  };
  return { factory, created };
}

// --- camera rotation ---------------------------------------------------------

test("Camera.rotation rolls toPixel about frameCenter", () => {
  const cam = new Camera({ pixelWidth: 800, pixelHeight: 450, frameHeight: 8 });
  const centerPx = cam.toPixel([0, 0, 0]);
  cam.rotation = Math.PI / 2;
  // Center is the rotation pivot: unmoved.
  const centerPx2 = cam.toPixel([0, 0, 0]);
  close(centerPx[0], centerPx2[0]); close(centerPx[1], centerPx2[1]);
  // A point at world +x appears where world +... rotating the camera +90°
  // makes the world appear rotated -90°: (1,0) -> (0,-1) in frame space.
  const rolled = cam.toPixel([1, 0, 0]);
  cam.rotation = 0;
  const down = cam.toPixel([0, -1, 0]);
  close(rolled[0], down[0], 1e-6, "rolled x matches unrolled (0,-1)");
  close(rolled[1], down[1], 1e-6, "rolled y matches unrolled (0,-1)");
});

test("preRender derives roll + true edge lengths from a rotated camera frame", async () => {
  const scene = new MovingCameraScene({ fps: 20, frameHandler: async () => {} });
  const cam = new Camera({ pixelWidth: 800, pixelHeight: 450, frameHeight: 8 });
  (scene as any).camera = cam;
  scene.setupFrame();
  const frame = scene.getFrame();
  const w0 = cam.frameWidth;
  frame.rotate(Math.PI / 6);
  cam.preRender();
  close(cam.rotation ?? 0, Math.PI / 6, 1e-9, "roll picked up from frame corners");
  close(cam.frameWidth, w0, 1e-9, "width is the true edge length, not the inflated AABB");
  close(cam.frameHeight, 8, 1e-9);
});

test("centerOn / rotateCamera / resetCamera drive the frame through play()", async () => {
  const scene = new MovingCameraScene({ fps: 20, frameHandler: async () => {} });
  const cam = new Camera({ pixelWidth: 800, pixelHeight: 450, frameHeight: 8 });
  (scene as any).camera = cam;
  scene.setupFrame();
  const target = new Circle({ radius: 1 });
  target.moveTo([3, 2, 0]);
  scene.add(target);

  await scene.centerOn(target, { runTime: 0.2 });
  cam.preRender();
  close(cam.frameCenter[0], 3, 1e-6); close(cam.frameCenter[1], 2, 1e-6);

  await scene.rotateCamera(Math.PI / 4, { runTime: 0.2 });
  cam.preRender();
  close(cam.rotation ?? 0, Math.PI / 4, 1e-6, "rotateCamera rolls the view");

  await scene.resetCamera({ runTime: 0.2 });
  cam.preRender();
  close(cam.rotation ?? 0, 0, 1e-6, "reset zeroes the roll");
  close(cam.frameCenter[0], 0, 1e-6, "reset recenters");
  close(cam.frameWidth, (8 * 800) / 450, 1e-6, "reset restores width");
});

// --- strokeStart -------------------------------------------------------------

test("strokeStart trims the start of the traced path (canvas)", () => {
  const ctx = makeFakeCtx();
  const camera = new Camera({ pixelWidth: 200, pixelHeight: 200 });
  const renderer = new CanvasRenderer(ctx, camera);
  const c = new Circle({ radius: 1, strokeWidth: 4 }); // 4 curves, no fill
  (c as any).strokeStart = 0.5;
  renderer.renderScene([c]);
  const beziers = ctx.calls.filter((s: string) => s === "bezierCurveTo").length;
  assert.equal(beziers, 2, `half the circle's 4 curves stroke (got ${beziers})`);
});

test("strokeStart + strokeEnd window the middle of the path (SVG)", () => {
  const camera = new Camera({ pixelWidth: 200, pixelHeight: 200, frameHeight: 8 });
  const renderer = new SVGRenderer(camera);
  const line = new Line({ start: [-2, 0, 0], end: [2, 0, 0], strokeWidth: 4 });
  (line as any).strokeStart = 0.25;
  (line as any).strokeEnd = 0.75;
  const svg = renderer.renderToString([line]);
  const m = svg.match(/d="M([\d.]+) ([\d.]+)C.*? ([\d.]+) ([\d.]+)"/);
  assert.ok(m, `stroked path present: ${svg}`);
  // World [-2,2] spans px [50,150]; the middle half spans px [75,125].
  close(parseFloat(m![1]), 75, 1, "path starts 25% in");
  close(parseFloat(m![3]), 125, 1, "path ends at 75%");
});

test("strokeStart=0 keeps the exact pre-existing trace (regression)", () => {
  const ctx = makeFakeCtx();
  const camera = new Camera({ pixelWidth: 200, pixelHeight: 200 });
  new CanvasRenderer(ctx, camera).renderScene([new Circle({ radius: 1, strokeWidth: 4 })]);
  const beziers = ctx.calls.filter((s: string) => s === "bezierCurveTo").length;
  const moves = ctx.calls.filter((s: string) => s === "moveTo").length;
  assert.equal(beziers, 4, "all 4 curves");
  assert.equal(moves, 1, "one moveTo per subpath, as before");
});

// --- compositeOperation + CompositeGroup --------------------------------------

test("per-mobject compositeOperation wraps only that mobject's draw", () => {
  const ctx = makeFakeCtx();
  const camera = new Camera({ pixelWidth: 200, pixelHeight: 200 });
  const renderer = new CanvasRenderer(ctx, camera);
  const base = new Square({ sideLength: 2, fillOpacity: 1 });
  const top = new Circle({ radius: 1, fillOpacity: 1 });
  top.compositeOperation = "multiply";
  renderer.renderScene([base, top]);
  const sets = ctx.calls.filter((s: string) => s.startsWith("set:globalCompositeOperation="));
  assert.ok(sets.includes("set:globalCompositeOperation=multiply"), `multiply set: ${sets}`);
  // Restored afterwards so nothing else inherits it.
  assert.equal(sets[sets.length - 1], "set:globalCompositeOperation=source-over");
});

test("CompositeGroup scopes children into an offscreen layer and blits once", () => {
  const ctx = makeFakeCtx();
  const { factory, created } = makeFakeOffscreenFactory();
  const camera = new Camera({ pixelWidth: 200, pixelHeight: 200 });
  const renderer = new CanvasRenderer(ctx, camera, { createCanvas: factory });
  const shape = new Circle({ radius: 1, fillOpacity: 1 });
  const cutter = new Square({ sideLength: 1, fillOpacity: 1 });
  cutter.compositeOperation = "destination-out";
  const group = new CompositeGroup(shape, cutter);
  renderer.renderScene([group]);
  assert.ok(created.length >= 1, "a full-frame offscreen layer was created");
  const layer = created[0];
  assert.equal(layer.width, 200, "layer is frame-sized");
  // destination-out applied INSIDE the layer, not on the main ctx.
  const layerOps = layer._ctx.calls.filter((s: string) => s === "set:globalCompositeOperation=destination-out");
  assert.equal(layerOps.length, 1, "cutter blends inside the layer");
  const mainOps = ctx.calls.filter((s: string) => s === "set:globalCompositeOperation=destination-out");
  assert.equal(mainOps.length, 0, "main canvas never sees destination-out");
  assert.ok(ctx.calls.includes("drawImage"), "layer blitted to main");
});

test("CompositeGroup degrades to unscoped children without an offscreen backend", () => {
  const ctx = makeFakeCtx();
  const camera = new Camera({ pixelWidth: 200, pixelHeight: 200 });
  const renderer = new CanvasRenderer(ctx, camera); // no factory, Node-less env
  const group = new CompositeGroup(new Circle({ radius: 1, fillOpacity: 1 }));
  renderer.renderScene([group]);
  assert.ok(ctx.calls.includes("fill"), "children still draw directly");
});

// --- grayscale + blur animatability -------------------------------------------

test("grayscale renders in the canvas filter string and lerps", () => {
  const f = effectsToCanvasFilter([{ type: "colorAdjust", grayscale: 0.6 }], 1);
  assert.ok(f.includes("grayscale(0.6)"), f);
  const mid = lerpEffects(
    [{ type: "colorAdjust", grayscale: 0 }],
    [{ type: "colorAdjust", grayscale: 1 }],
    0.5,
  ) as any[];
  close(mid[0].grayscale, 0.5);
});

test("blur animates through lerpEffects (animate.blur support)", () => {
  const a = new Circle({ radius: 1 }).blur(0);
  const b = new Circle({ radius: 1 }).blur(10);
  const mid = lerpEffects(a.effects!, b.effects!, 0.3) as any[];
  assert.equal(mid[0].type, "blur");
  close(mid[0].radius, 3, 1e-9, "blur radius lerps");
  // And a mobject mid-Transform carries the lerped filter string.
  const f = effectsToCanvasFilter(mid, 1);
  assert.ok(f.includes("blur(3px)"), f);
});
