// Camera-level frameEffects tests: full-frame grading on the 2D and 3D
// paths, vignette/grain overlays, per-mobject effects on 3D overlay/fixed
// draws, and the stacked toPixel-override composition (_drawFixed inside
// _renderToOffscreen).

import { test } from "node:test";
import assert from "node:assert/strict";

import { CanvasRenderer, Camera } from "../src/renderer/CanvasRenderer.ts";
import { ThreeDCamera } from "../src/scene/three_d.ts";
import { Circle, Square } from "../src/mobject/geometry.ts";
import { RasterText } from "../src/mobject/text/Text.ts";
import * as V from "../src/core/math/vector.ts";
import { loadNapiCanvas } from "./_snapshot_util.ts";

const canvasMod = await loadNapiCanvas();
const canvasAvailable = !!canvasMod;

// Fake 2D ctx recording calls + property sets, with REAL ImageData support
// (the 3D path's blitTo needs createImageData/putImageData to carry data).
function makeFake3DCtx(): any {
  const calls: string[] = [];
  const state: any = { calls };
  const handler = {
    get(t: any, prop: string) {
      if (prop === "calls") return calls;
      if (prop in t && typeof t[prop] !== "function") return t[prop];
      if (prop === "createImageData") {
        return (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      }
      if (prop === "createRadialGradient") {
        return (...args: any[]) => { calls.push("createRadialGradient"); return { addColorStop: () => {} }; };
      }
      return (...args: any[]) => { calls.push(prop); };
    },
    set(t: any, prop: string, value: any) {
      t[prop] = value;
      calls.push(`set:${prop}=${value}`);
      return true;
    },
  };
  return new Proxy(state, handler);
}

function makeFakeOffscreenFactory() {
  const created: any[] = [];
  const factory = (w: number, h: number) => {
    const ctx = makeFake3DCtx();
    const canvas = { width: w, height: h, getContext: () => ctx, _ctx: ctx };
    created.push(canvas);
    return canvas;
  };
  return { factory, created };
}

test("3D + frameEffects: main ctx receives a filtered drawImage, NOT putImageData", () => {
  const ctx = makeFake3DCtx();
  const { factory } = makeFakeOffscreenFactory();
  const camera = new ThreeDCamera({
    pixelWidth: 60, pixelHeight: 60, phi: 60 * V.DEGREES,
    frameEffects: [{ type: "colorAdjust", saturate: 0.5 }],
  });
  const renderer = new CanvasRenderer(ctx, camera, { createCanvas: factory });
  renderer.renderScene([new Square({ sideLength: 1, fillColor: "#ff0000", fillOpacity: 1 })]);
  assert.ok(ctx.calls.includes("drawImage"), "graded frame composites via drawImage");
  assert.ok(ctx.calls.some((s: string) => s.startsWith("set:filter=") && s.includes("saturate")));
  assert.equal(ctx.calls.filter((s: string) => s === "putImageData").length, 0,
    "putImageData ignores ctx.filter per spec -- the graded path must avoid it on the main ctx");
});

test("3D without frameEffects keeps the direct putImageData blit (byte-path regression guard)", () => {
  const ctx = makeFake3DCtx();
  const camera = new ThreeDCamera({ pixelWidth: 60, pixelHeight: 60, phi: 60 * V.DEGREES });
  const renderer = new CanvasRenderer(ctx, camera);
  renderer.renderScene([new Square({ sideLength: 1, fillColor: "#ff0000", fillOpacity: 1 })]);
  assert.ok(ctx.calls.includes("putImageData"), "ungraded 3D path blits exactly as before");
  assert.equal(ctx.calls.filter((s: string) => s.startsWith("set:filter=")).length, 0);
});

test("2D + frameEffects: scene renders into an offscreen and composites back filtered", () => {
  const ctx = makeFake3DCtx();
  const { factory, created } = makeFakeOffscreenFactory();
  const camera = new Camera({
    pixelWidth: 80, pixelHeight: 80,
    frameEffects: [{ type: "blur", radius: 4 }],
  });
  const renderer = new CanvasRenderer(ctx, camera, { createCanvas: factory });
  renderer.renderScene([new Circle({ radius: 1, fillColor: "#00ff00", fillOpacity: 1 })]);
  assert.ok(created.length >= 1, "full-frame offscreen created");
  const off = created[0];
  assert.ok(off._ctx.calls.includes("fillRect"), "background cleared INTO the offscreen");
  assert.ok(ctx.calls.some((s: string) => s.startsWith("set:filter=blur(")));
  assert.ok(ctx.calls.includes("drawImage"));
});

test("vignette draws a radial gradient over the composed frame", () => {
  const ctx = makeFake3DCtx();
  const { factory } = makeFakeOffscreenFactory();
  const camera = new Camera({
    pixelWidth: 80, pixelHeight: 80,
    frameEffects: [{ type: "vignette", strength: 0.7 }],
  });
  const renderer = new CanvasRenderer(ctx, camera, { createCanvas: factory });
  renderer.renderScene([new Circle({ radius: 1 })]);
  assert.ok(ctx.calls.includes("createRadialGradient"));
  assert.ok(ctx.calls.includes("fillRect"));
});

test("per-mobject effects apply to overlay text in a 3D scene", () => {
  const ctx = makeFake3DCtx();
  const { factory } = makeFakeOffscreenFactory();
  const camera = new ThreeDCamera({ pixelWidth: 60, pixelHeight: 60, phi: 60 * V.DEGREES });
  const renderer = new CanvasRenderer(ctx, camera, { createCanvas: factory });
  const label = new RasterText("hi", { fontSize: 0.5 });
  label.blur(4);
  renderer.renderScene([label]);
  assert.ok(ctx.calls.some((s: string) => s.startsWith("set:filter=blur(")),
    "3D overlay text goes through the effects compositor");
});

test("effects on a fixed-in-frame mobject compose with _drawFixed's toPixel override", () => {
  const ctx = makeFake3DCtx();
  const { factory } = makeFakeOffscreenFactory();
  const camera = new ThreeDCamera({ pixelWidth: 60, pixelHeight: 60, phi: 60 * V.DEGREES });
  const renderer = new CanvasRenderer(ctx, camera, { createCanvas: factory });
  const hud = new Square({ sideLength: 1, fillColor: "#ffffff", fillOpacity: 1 });
  (hud as any)._fixedInFrame = true;
  hud.blur(3);
  // Must not throw (stacked overrides restore correctly) -- and the fixed
  // draw currently takes the plain path since _drawFixed handles its own
  // dispatch; assert no crash and toPixel restored.
  const before = camera.toPixel;
  renderer.renderScene([hud]);
  assert.equal(camera.toPixel, before, "toPixel override fully restored");
});

// --- real-pixel frame grading (skip without @napi-rs/canvas) ---------------

const W = 120, H = 120;

function renderReal(mobjects: any[], frameEffects?: any[]): Uint8ClampedArray {
  const { createCanvas } = canvasMod;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const camera = new Camera({ pixelWidth: W, pixelHeight: H, frameHeight: 8, background: "#808080", frameEffects });
  const renderer = new CanvasRenderer(ctx as any, camera, { createCanvas: (w, h) => createCanvas(w, h) });
  renderer.renderScene(mobjects);
  return ctx.getImageData(0, 0, W, H).data;
}

test("real pixels: vignette darkens corners more than center", { skip: !canvasAvailable && "@napi-rs/canvas not available" }, () => {
  const data = renderReal([new Circle({ radius: 0.5, fillColor: "#ffffff", fillOpacity: 1 })], [{ type: "vignette", strength: 0.9 }]);
  const at = (x: number, y: number) => data[(y * W + x) * 4];
  const corner = at(3, 3);
  const centerEdge = at(W / 2, 8); // top-center, outside the circle, same background
  assert.ok(corner < centerEdge - 20, `corner (${corner}) must be darker than top-center (${centerEdge})`);
});

test("real pixels: frame grain adds variance to a flat background", { skip: !canvasAvailable && "@napi-rs/canvas not available" }, () => {
  const flat = renderReal([]);
  const grainy = renderReal([], [{ type: "noise", amount: 0.4, seed: 5 }]);
  const varOf = (d: Uint8ClampedArray) => {
    let sum = 0, sumSq = 0, n = 0;
    for (let y = 20; y < 100; y += 4) {
      for (let x = 20; x < 100; x += 4) {
        const v = d[(y * W + x) * 4];
        sum += v; sumSq += v * v; n++;
      }
    }
    const mean = sum / n;
    return sumSq / n - mean * mean;
  };
  assert.ok(varOf(flat) < 2, "flat background has ~zero variance");
  assert.ok(varOf(grainy) > 10, "grain must add visible variance");
  // Deterministic across runs.
  const grainy2 = renderReal([], [{ type: "noise", amount: 0.4, seed: 5 }]);
  assert.ok(Buffer.from(grainy).equals(Buffer.from(grainy2)));
});
