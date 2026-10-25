// Node Canvas readback and partial streaming. No movie-sized raw frame arrays:
// each renderer/worker has at most one encoder and one pending frame write.
import { existsSync } from "node:fs";
import { createFfmpegEncoder } from "./ffmpeg.ts";

export function readRgbaFrame(ctx: any, width: number, height: number): Buffer {
  // canvas.data() exposes premultiplied Skia pixels; ffmpeg expects straight
  // alpha. getImageData matches the pixels the old PNG path delivered.
  const data = ctx.getImageData(0, 0, width, height).data;
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
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
