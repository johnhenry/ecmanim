// Regression tests for library bugs surfaced by the Lottie parity campaign.
//
// The headline fix: rendering a matte/mask-heavy Lottie frame issues one
// CompositeGroup offscreen-composite per group, and drawCompositeGroup used to
// allocate a FRESH full-frame canvas for every one, every frame. Under Node
// those are @napi-rs/canvas Skia surfaces whose native memory V8 can't see, so
// GC never fired and RSS grew ~half a GB per frame until the OOM killer hit
// (05-navidad died after ~14 frames). CanvasRenderer now borrows full-frame
// offscreens from a pool bounded by composite NESTING depth and reuses them
// across frames. These tests pin that behavior with a call-recording fake
// offscreen factory (same harness idea as effects-canvas.test.ts).

import { test } from "node:test";
import assert from "node:assert/strict";

import { CanvasRenderer, Camera } from "../src/renderer/CanvasRenderer.ts";
import { Circle } from "../src/mobject/geometry.ts";
import { CompositeGroup } from "../src/mobject/Mobject.ts";

function makeFakeCtx(): any {
  const calls: string[] = [];
  const state: any = { calls };
  const handler = {
    get(t: any, prop: string) {
      if (prop === "calls") return calls;
      if (prop in t && typeof t[prop] !== "function") return t[prop];
      if (prop === "createImageData") {
        return (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      }
      return () => { calls.push(prop); };
    },
    set(t: any, prop: string, value: any) {
      t[prop] = value;
      calls.push(`set:${prop}=${value}`);
      return true;
    },
  };
  return new Proxy(state, handler);
}

function makeFakeOffscreenFactory(): { factory: (w: number, h: number) => any; created: any[] } {
  const created: any[] = [];
  const factory = (w: number, h: number) => {
    const ctx = makeFakeCtx();
    const canvas = { width: w, height: h, getContext: () => ctx, _ctx: ctx };
    created.push(canvas);
    return canvas;
  };
  return { factory, created };
}

function makeRenderer(w = 100, h = 100) {
  const { factory, created } = makeFakeOffscreenFactory();
  const camera = new Camera({ pixelWidth: w, pixelHeight: h });
  const renderer = new CanvasRenderer(makeFakeCtx(), camera, { createCanvas: factory });
  return { renderer, created };
}

test("a CompositeGroup reuses one pooled full-frame canvas across many frames (OOM regression)", () => {
  const { renderer, created } = makeRenderer();
  const cg = new CompositeGroup(new Circle({ radius: 1 }), new Circle({ radius: 0.5 }));
  for (let i = 0; i < 60; i++) renderer.renderScene([cg]);
  // Pre-fix this allocated 60 full-frame canvases; pooled it allocates exactly 1.
  assert.equal(created.length, 1, `expected 1 pooled canvas, got ${created.length}`);
});

test("nested CompositeGroups get DISTINCT canvases within a frame (no aliasing), pooled across frames", () => {
  const { renderer, created } = makeRenderer();
  const inner = new CompositeGroup(new Circle({ radius: 0.5 }));
  const outer = new CompositeGroup(inner, new Circle({ radius: 1 }));

  renderer.renderScene([outer]);
  // Outer borrows canvas A; while drawing outer's children the renderer recurses
  // into `inner`, which must borrow a SECOND canvas B (A is still live) — else
  // the inner render would clobber the outer's accumulated pixels.
  assert.equal(created.length, 2, `nested groups need 2 distinct canvases, got ${created.length}`);

  renderer.renderScene([outer]);
  // Both were released after frame 1; frame 2 reuses them — still only 2 ever made.
  assert.equal(created.length, 2, `pool should reuse across frames, got ${created.length}`);
});

test("a reused pooled canvas is reset to a pristine state before reuse", () => {
  const { renderer, created } = makeRenderer();
  const cg = new CompositeGroup(new Circle({ radius: 1 }));
  renderer.renderScene([cg]); // creates + first use
  const offCalls: string[] = created[0]._ctx.calls;
  offCalls.length = 0; // ignore first-use calls; inspect the SECOND borrow
  renderer.renderScene([cg]);
  // On borrow the pooled canvas must be cleared and its ctx state reset, so a
  // fresh composite never inherits a stale transform / alpha / blend mode.
  assert.ok(offCalls.includes("clearRect"), "reused canvas must be cleared");
  assert.ok(offCalls.includes("setTransform"), "reused canvas transform must be reset");
  assert.ok(
    offCalls.includes("set:globalCompositeOperation=source-over"),
    "reused canvas blend mode must be reset to source-over",
  );
});

test("pool is rebuilt when the frame size changes (no stale wrong-size canvas reuse)", () => {
  const { renderer, created } = makeRenderer(100, 100);
  const cg = new CompositeGroup(new Circle({ radius: 1 }));
  renderer.renderScene([cg]);
  assert.equal(created.length, 1);
  assert.equal(created[0].width, 100);
  // Resize the camera; the next composite must allocate a correctly-sized canvas.
  renderer.camera.pixelWidth = 200;
  renderer.camera.pixelHeight = 200;
  renderer.renderScene([cg]);
  assert.equal(created.length, 2, "a new canvas is made when the old pool is the wrong size");
  assert.equal(created[1].width, 200);
});
