// Isomorphic raw encoders (no node:* imports, no canvas): RGBA frames in,
// Uint8Array out. Exposed as the `@johnhenry/ecmanim/encoders` subpath and used
// by Node render() (`encoder: "js"`, formats "apng" | "zip" | "gif") and by the
// browser recordApng()/recordZip().

import { ApngEncoder } from "./apng.ts";
import { ZipSequenceEncoder } from "./zip.ts";
import { GifEncoder } from "./gif.ts";
import type { RgbaBytes } from "./png.ts";

export { crc32, crc32Update } from "./crc32.ts";
export { ApngEncoder, msToDelay } from "./apng.ts";
export type { ApngOptions } from "./apng.ts";
export { ZipWriter, ZipSequenceEncoder } from "./zip.ts";
export type { ZipFileOptions, ZipSequenceOptions } from "./zip.ts";
export { GifEncoder } from "./gif.ts";
export type { GifOptions } from "./gif.ts";
export { encodePng } from "./png.ts";
export type { RgbaBytes } from "./png.ts";

/** Common streaming surface of every encoder. */
export interface FrameEncoder {
  addFrame(rgba: RgbaBytes, delayMs?: number): void;
  finish(): Uint8Array;
}

export type FrameEncoderKind = "apng" | "zip" | "gif";

export async function createFrameEncoder(
  kind: FrameEncoderKind,
  opts: { width: number; height: number; fps: number; maxColors?: number },
): Promise<FrameEncoder> {
  switch (kind) {
    case "apng": return new ApngEncoder(opts);
    case "zip": return new ZipSequenceEncoder(opts);
    case "gif": return GifEncoder.create(opts);
    default: throw new Error(`createFrameEncoder(): unknown encoder kind ${JSON.stringify(kind)} (expected "apng" | "zip" | "gif")`);
  }
}
