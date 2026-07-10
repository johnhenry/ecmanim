// CanvasRenderer effects-compositor plumbing tests: a call-recording fake ctx
// plus an injected fake offscreen factory prove the pass structure (filter
// strings set, glow's additive multi-pass, noise clipping) without needing a
// real canvas backend. Real Skia behavior is covered separately by
// test/effects-pixel.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";

import { CanvasRenderer, Camera } from "../src/renderer/CanvasRenderer.ts";
import { Circle } from "../src/mobject/geometry.ts";
import { VGroup } from "../src/mobject/VMobject.ts";

// Fake 2D ctx recording method calls AND property sets ("set:filter=blur(4px)").
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

// Fake offscreen canvas factory: each canvas carries its own fake ctx.
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

function makeRenderer() {
  const ctx = makeFakeCtx();
  const { factory, created } = makeFakeOffscreenFactory();
  const camera = new Camera({ pixelWidth: 200, pixelHeight: 200 });
  const renderer = new CanvasRenderer(ctx, camera, { createCanvas: factory });
  return { ctx, renderer, created };
}

test("a blurred mobject renders via offscreen + a filter'd drawImage composite", () => {
  const { ctx, renderer, created } = makeRenderer();
  const c = new Circle({ radius: 1 }).blur(4);
  renderer.renderScene([c]);
  assert.ok(created.length >= 1, "an offscreen canvas was created");
  const filterSets = ctx.calls.filter((s: string) => s.startsWith("set:filter=blur("));
  assert.ok(filterSets.length >= 1, `main ctx must receive a blur filter set; calls: ${ctx.calls.slice(-10)}`);
  assert.ok(ctx.calls.includes("drawImage"), "composite back via drawImage");
});

test("a no-effects mobject never touches ctx.filter (regression guard)", () => {
  const { ctx, renderer } = makeRenderer();
  renderer.renderScene([new Circle({ radius: 1 })]);
  assert.equal(ctx.calls.filter((s: string) => s.startsWith("set:filter=")).length, 0);
});

test("glow(strength 2) chains 2 drop-shadow() entries into ONE filtered composite", () => {
  // Chained filter drop-shadows -- NOT the shadow* ctx properties -- are the
  // deliberate mechanism: @napi-rs/canvas (Skia) ignores shadowBlur/
  // shadowColor on drawImage entirely, while filter drop-shadow() applies to
  // drawImage in both Skia and browsers.
  const { ctx, renderer } = makeRenderer();
  const c = new Circle({ radius: 1 }).glow(8, "#ff0000", 2);
  renderer.renderScene([c]);
  const drawImages = ctx.calls.filter((s: string) => s === "drawImage").length;
  assert.equal(drawImages, 1, "one composite draw, glow lives in the filter string");
  const filterSet = ctx.calls.find((s: string) => s.startsWith("set:filter=") && s.includes("drop-shadow"));
  assert.ok(filterSet, "filter string carries the glow");
  const shadowCount = (filterSet!.match(/drop-shadow\(0px 0px /g) ?? []).length;
  assert.equal(shadowCount, 2, "strength 2 => two chained drop-shadows");
  assert.equal(ctx.calls.filter((s: string) => s.startsWith("set:shadowBlur=")).length, 0,
    "shadow* ctx properties must NOT be used (Skia ignores them on drawImage)");
});

test("dropShadow becomes a drop-shadow() filter entry with scaled offsets", () => {
  const { ctx, renderer } = makeRenderer();
  const c = new Circle({ radius: 1 }).dropShadow({ blur: 6, offsetX: 3, offsetY: 2 });
  renderer.renderScene([c]);
  const filterSet = ctx.calls.find((s: string) => s.startsWith("set:filter=") && s.includes("drop-shadow"));
  assert.ok(filterSet, "filter string carries the shadow");
  assert.ok(/drop-shadow\([\d.]+px [\d.]+px [\d.]+px /.test(filterSet!), "offsets and blur present");
  assert.equal(ctx.calls.filter((s: string) => s.startsWith("set:shadowBlur=")).length, 0);
});

test("noise composites an alpha-clipped tile at the configured opacity", () => {
  const { ctx, renderer, created } = makeRenderer();
  const c = new Circle({ radius: 1 }).noise(0.35, { seed: 7 });
  renderer.renderScene([c]);
  // Offscreens: source render + noise tile + scratch (clip surface).
  assert.ok(created.length >= 3, `expected source+tile+scratch offscreens, got ${created.length}`);
  const scratchCtxCalls = created.map((cv) => cv._ctx.calls);
  const clipUsed = scratchCtxCalls.some((calls: string[]) => calls.includes("set:globalCompositeOperation=source-in"));
  assert.ok(clipUsed, "noise is clipped to source alpha via source-in");
  assert.ok(ctx.calls.some((s: string) => s === "set:globalAlpha=0.35"));
});

test("a parent group's effects propagate to leaf draws (per-leaf application)", () => {
  const { ctx, renderer, created } = makeRenderer();
  const group = new VGroup(new Circle({ radius: 0.5 }), new Circle({ radius: 1 }));
  group.blur(2);
  renderer.renderScene([group]);
  // Two leaves, each drawn through its own offscreen composite.
  const filterSets = ctx.calls.filter((s: string) => s.startsWith("set:filter=blur("));
  assert.equal(filterSets.length, 2, "each leaf gets its own filtered composite");
  assert.ok(created.length >= 2);
});

test("without an offscreen factory, effects degrade to direct-ctx filter (browser-less fallback)", () => {
  const ctx = makeFakeCtx();
  const camera = new Camera({ pixelWidth: 200, pixelHeight: 200 });
  // No createCanvas AND no browser OffscreenCanvas under Node tests.
  const renderer = new CanvasRenderer(ctx, camera);
  const c = new Circle({ radius: 1 }).blur(4);
  renderer.renderScene([c]);
  // Filter still set (directly around the vector draw), but no drawImage composite.
  assert.ok(ctx.calls.some((s: string) => s.startsWith("set:filter=blur(")));
  assert.equal(ctx.calls.filter((s: string) => s === "drawImage").length, 0);
});

test("cacheStatic works through the injected factory (was a Node no-op before)", () => {
  const { ctx, renderer, created } = makeRenderer();
  const c = new Circle({ radius: 1 }).cacheStatic();
  renderer.renderScene([c]);
  renderer.renderScene([c]);
  // First render populates the cache (1 offscreen); second reuses it.
  assert.equal(created.length, 1, "second render must reuse the cached offscreen");
  assert.equal(ctx.calls.filter((s: string) => s === "drawImage").length, 2, "both renders composite via drawImage");
});

test("updater-driven effect mutation changes the emitted filter string across frames", () => {
  const { ctx, renderer } = makeRenderer();
  const c = new Circle({ radius: 1 }).blur(2);
  // Simulate two animation frames with an updater growing the blur.
  renderer.renderScene([c]);
  (c.effects![0] as any).radius = 9;
  renderer.renderScene([c]);
  const filters = ctx.calls.filter((s: string) => s.startsWith("set:filter=blur("));
  assert.equal(filters.length, 2);
  assert.notEqual(filters[0], filters[1], "second frame must reflect the mutated radius");
  assert.ok(filters[1].includes("blur(9px)") || /blur\([\d.]+px\)/.test(filters[1]));
});
