import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { CanvasRenderer } from "../../src/renderer/CanvasRenderer.ts";
import { Square } from "../../src/mobject/geometry.ts";
import type { Scene } from "../../src/scene/Scene.ts";

export async function holdScene(scene: Scene) {
  const square = new Square({ fillColor: "#e62918", fillOpacity: 0.6 }).shift([-2, -1, 0]);
  scene.add(square);
  for (let i = 0; i < 4; i++) {
    square.shift([0.7, 0.3, 0]);
    await scene.wait(0.5);
  }
}

export async function referenceHoldScene(scene: Scene) {
  const handler = scene.frameHandler;
  // A plain callback preserves the original per-frame rasterization path.
  scene.frameHandler = (...args) => handler(...args);
  await holdScene(scene);
}

// Also runs inside real workers. Count actual draw/readback calls rather than
// trusting a hint or a renderer statistic. Discovery/warm-cache waits use zero.
export async function countedHoldScene(scene: Scene) {
  const prototype = Object.getPrototypeOf(createCanvas(1, 1).getContext("2d"));
  const read = prototype.getImageData, draw = CanvasRenderer.prototype.renderScene;
  let reads = 0, draws = 0;
  prototype.getImageData = function(...args: any[]) { reads++; return read.apply(this, args); };
  CanvasRenderer.prototype.renderScene = function(...args) { draws++; return draw.apply(this, args); };
  const wait = scene.wait;
  scene.wait = async function(duration) {
    reads = draws = 0;
    await wait.call(this, duration);
    assert.ok(draws <= 1, `hold rasterized ${draws} times`);
    assert.equal(reads, draws, "one readback per rasterized hold");
    return this;
  };
  try { await holdScene(scene); }
  finally { prototype.getImageData = read; CanvasRenderer.prototype.renderScene = draw; scene.wait = wait; }
}
