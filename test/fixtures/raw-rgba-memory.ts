import { createCanvas } from "@napi-rs/canvas";
import assert from "node:assert/strict";
import { readRgbaFrame } from "../../src/renderer/raw_frames.ts";

// Pooled composite layers, as in mask-heavy Lottie scenes. Reusing the
// canvases alone is insufficient if readback retains their old snapshots.
const width = 512, height = 256;
const canvas = createCanvas(width, height), ctx = canvas.getContext("2d");
const layer = createCanvas(width, height), layerCtx = layer.getContext("2d");
const initialRss = process.memoryUsage().rss;
let peakRss = initialRss;
for (let frame = 0; frame < 160; frame++) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 8; i++) {
    layerCtx.clearRect(0, 0, width, height);
    layerCtx.fillStyle = `rgb(${frame}, ${i * 20}, 80)`;
    layerCtx.fillRect(0, 0, width, height);
    ctx.drawImage(layer, 0, 0);
  }
  const pixels = readRgbaFrame(ctx, width, height);
  assert.deepEqual([...pixels.subarray(0, 4)], [frame, 140, 80, 255]);
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}
console.log(JSON.stringify({ growth: peakRss - initialRss }));
