// Animated PNG encoder, written from the public APNG extension to the PNG
// spec (W3C PNG 3rd ed. section 11.3.x; the MDN/Mozilla APNG spec): acTL
// (animation control), fcTL (frame control) and fdAT (frame data) chunks around
// an ordinary PNG whose IDAT is the first frame. Every frame is a full-canvas,
// opaque-replace frame (dispose_op NONE, blend_op SOURCE), so output is
// lossless and keeps full alpha. Pure and isomorphic.

import {
  PNG_SIGNATURE, pngChunk, ihdr, compressRgba, checkFrame, checkDims, concat, type RgbaBytes,
} from "./png.ts";

export interface ApngOptions {
  width: number;
  height: number;
  /** Frames per second; sets the default per-frame delay (1000/fps ms). */
  fps?: number;
  /** Default delay in ms for frames added without one. Wins over `fps`. Default 100. */
  defaultDelayMs?: number;
  /** Loop count; 0 (default) = forever. */
  loops?: number;
  /** zlib level 0-9 (default 6). */
  level?: number;
}

/** Express `ms` as an APNG delay_num/delay_den pair (both uint16). */
export function msToDelay(ms: number): [number, number] {
  const ds = Math.max(0, ms) / 1000;
  if (Number.isInteger(ms) && ms <= 65535) return [Math.round(ms), 1000];
  const den = Math.max(1, Math.min(65535, Math.floor(65535 / Math.max(ds, 1))));
  const num = Math.min(65535, Math.round(ds * den));
  return [num, den];
}

/** Streaming APNG writer: `addFrame(rgba, delayMs?)` then `finish()`. */
export class ApngEncoder {
  readonly width: number;
  readonly height: number;
  private readonly loops: number;
  private readonly level: number;
  private readonly defaultDelayMs: number;
  private readonly frames: Array<{ delay: [number, number]; z: Uint8Array }> = [];
  private done = false;

  constructor(opts: ApngOptions) {
    checkDims(opts.width, opts.height);
    this.width = opts.width;
    this.height = opts.height;
    this.loops = opts.loops ?? 0;
    this.level = opts.level ?? 6;
    this.defaultDelayMs = opts.defaultDelayMs ?? (opts.fps && opts.fps > 0 ? 1000 / opts.fps : 100);
  }

  get frameCount(): number { return this.frames.length; }

  addFrame(rgba: RgbaBytes, delayMs?: number): void {
    if (this.done) throw new Error("ApngEncoder: already finished");
    checkFrame(rgba, this.width, this.height);
    this.frames.push({
      delay: msToDelay(delayMs ?? this.defaultDelayMs),
      z: compressRgba(rgba, this.width, this.height, this.level),
    });
  }

  finish(): Uint8Array {
    if (this.done) throw new Error("ApngEncoder: already finished");
    if (this.frames.length === 0) throw new Error("ApngEncoder: no frames added");
    this.done = true;

    const parts: Uint8Array[] = [PNG_SIGNATURE, ihdr(this.width, this.height)];
    const actl = new Uint8Array(8);
    const av = new DataView(actl.buffer);
    av.setUint32(0, this.frames.length);
    av.setUint32(4, this.loops);
    parts.push(pngChunk("acTL", actl));

    let seq = 0;
    this.frames.forEach((f, i) => {
      const fc = new Uint8Array(26);
      const v = new DataView(fc.buffer);
      v.setUint32(0, seq++);
      v.setUint32(4, this.width);
      v.setUint32(8, this.height);
      // x_offset(12) / y_offset(16) stay 0
      v.setUint16(20, f.delay[0]);
      v.setUint16(22, f.delay[1]);
      fc[24] = 0; // dispose_op: APNG_DISPOSE_OP_NONE
      fc[25] = 0; // blend_op: APNG_BLEND_OP_SOURCE
      parts.push(pngChunk("fcTL", fc));
      if (i === 0) {
        parts.push(pngChunk("IDAT", f.z));
      } else {
        const fd = new Uint8Array(4 + f.z.length);
        new DataView(fd.buffer).setUint32(0, seq++);
        fd.set(f.z, 4);
        parts.push(pngChunk("fdAT", fd));
      }
    });
    parts.push(pngChunk("IEND", new Uint8Array(0)));
    this.frames.length = 0;
    return concat(parts);
  }
}
