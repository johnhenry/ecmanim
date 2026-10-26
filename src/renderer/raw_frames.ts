// Node Canvas readback and partial streaming. No movie-sized raw frame arrays:
// each renderer/worker has at most one encoder and one pending frame write.
import type { FrameHandler } from "../scene/Scene.ts";
import type { CanvasRenderer } from "./CanvasRenderer.ts";
import { existsSync } from "node:fs";
import { createFfmpegEncoder } from "./ffmpeg.ts";

export function readRgbaFrame(ctx: any, width: number, height: number): Buffer {
  // data() flushes/consolidates @napi-rs/canvas's deferred draw recordings;
  // getImageData() alone retains old composite-layer snapshots indefinitely.
  // This is a zero-copy view, used only for its flush (no PNG encoding).
  // See canvas v0.1.100 src/lib.rs:data and src/ctx.rs:Context::flush.
  ctx.canvas.data();
  // canvas.data() exposes premultiplied Skia pixels; ffmpeg expects straight
  // alpha. getImageData matches the pixels the old PNG path delivered.
  const data = ctx.getImageData(0, 0, width, height).data;
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

/** One retained RGBA buffer, reused only when Scene proves a static hold.
 * Writes remain awaited one frame at a time, preserving encoder backpressure. */
export function createRgbaFrameHandler(
  renderer: CanvasRenderer, ctx: any, width: number, height: number,
  write: (frame: Buffer) => Promise<void>, enabled: () => boolean = () => true,
): FrameHandler {
  let previous: Buffer | undefined;
  const handler: FrameHandler = async (mobjects) => {
    if (!enabled()) return;
    renderer.renderScene(mobjects);
    previous = readRgbaFrame(ctx, width, height);
    await write(previous);
  };
  handler.repeat = async (...args) => {
    if (!enabled()) return;
    if (previous) await write(previous);
    else await handler(...args);
  };
  return handler;
}

export function createPartialEncoder(options: any) {
  let activeIndex: number | undefined;
  let encoder: ReturnType<typeof createFfmpegEncoder> | undefined;
  let encoded = 0, reused = 0;
  async function finish() {
    if (encoder) {
      await encoder.finish();
      encoder = undefined;
      encoded++;
    }
  }
  return {
    get encoded() { return encoded; },
    get reused() { return reused; },
    async write(index: number, outPath: string, frame: Buffer) {
      if (index !== activeIndex) {
        await finish();
        activeIndex = index;
        // Recheck AFTER the preceding segment is committed: identical
        // consecutive segments may share a hash, as may concurrent workers.
        if (existsSync(outPath)) reused++;
        else encoder = createFfmpegEncoder({ ...options, outPath, inputFormat: "rgba" });
      }
      await encoder?.write(frame);
    },
    finish,
    async abort() { await encoder?.abort(); },
  };
}
