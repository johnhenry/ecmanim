// Animated GIF encoder: a thin wrapper over `gifenc` (MIT, already a
// dependency) with the same RGBA-in / Uint8Array-out streaming interface as the
// APNG and ZIP encoders. gifenc is loaded lazily because it ships as CJS and
// the unbundled browser demos must not need a bare specifier at import time.

import { checkDims, checkFrame, type RgbaBytes } from "./png.ts";

export interface GifOptions {
  width: number;
  height: number;
  fps?: number;
  /** Default per-frame delay in ms (wins over fps). Default 100. */
  defaultDelayMs?: number;
  /** Per-frame palette size cap, 2-256 (default 256). */
  maxColors?: number;
  /** Loop count; 0 (default) = forever. */
  loops?: number;
}

async function loadGifenc(): Promise<any> {
  const pkg: any = await import("gifenc");
  return pkg.GIFEncoder ? pkg : (pkg.default ?? pkg);
}

export class GifEncoder {
  private done = false;
  private n = 0;
  private readonly gif: any;
  private readonly lib: any;
  private readonly o: Required<Omit<GifOptions, "fps">>;
  private constructor(gif: any, lib: any, o: Required<Omit<GifOptions, "fps">>) {
    this.gif = gif; this.lib = lib; this.o = o;
  }

  static async create(opts: GifOptions): Promise<GifEncoder> {
    checkDims(opts.width, opts.height);
    const lib = await loadGifenc();
    if (typeof lib.GIFEncoder !== "function") throw new Error("GifEncoder: the 'gifenc' package is unavailable");
    return new GifEncoder(lib.GIFEncoder(), lib, {
      width: opts.width, height: opts.height,
      defaultDelayMs: opts.defaultDelayMs ?? (opts.fps && opts.fps > 0 ? 1000 / opts.fps : 100),
      maxColors: Math.max(2, Math.min(256, opts.maxColors ?? 256)),
      loops: opts.loops ?? 0,
    });
  }

  get frameCount(): number { return this.n; }

  addFrame(rgba: RgbaBytes, delayMs?: number): void {
    if (this.done) throw new Error("GifEncoder: already finished");
    checkFrame(rgba, this.o.width, this.o.height);
    const data = rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    const palette = this.lib.quantize(data, this.o.maxColors);
    const index = this.lib.applyPalette(data, palette);
    // gifenc writes the loop extension on the first frame only; `repeat` -1 = no loop.
    this.gif.writeFrame(index, this.o.width, this.o.height, {
      palette, delay: delayMs ?? this.o.defaultDelayMs, repeat: this.o.loops === 0 ? 0 : this.o.loops,
    });
    this.n++;
  }

  finish(): Uint8Array {
    if (this.done) throw new Error("GifEncoder: already finished");
    if (this.n === 0) throw new Error("GifEncoder: no frames added");
    this.done = true;
    this.gif.finish();
    return this.gif.bytes() as Uint8Array;
  }
}
