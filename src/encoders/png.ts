// Minimal PNG writer primitives (PNG spec, W3C PNG 3rd ed.): signature, chunk
// framing with CRC, and a lossless 8-bit RGBA still-image encoder. Shared by
// the APNG and ZIP-sequence encoders. Isomorphic: no node:* imports.

import { zlibSync } from "fflate";
import { crc32Update } from "./crc32.ts";

export const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** Accepted pixel buffers: RGBA bytes, row-major, top-left origin. */
export type RgbaBytes = Uint8Array | Uint8ClampedArray;

export function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** length(4) | type(4) | data | crc(4 over type+data). */
export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set(ascii(type), 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32Update(crc32Update(0, out.subarray(4, 8)), data));
  return out;
}

export function ihdr(width: number, height: number): Uint8Array {
  const d = new Uint8Array(13);
  const v = new DataView(d.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  d[8] = 8;  // bit depth
  d[9] = 6;  // colour type 6: truecolour + alpha
  d[10] = 0; // compression: deflate
  d[11] = 0; // filter method 0
  d[12] = 0; // no interlace
  return pngChunk("IHDR", d);
}

/** Scanlines with filter type 0 (None) prefixed to each row, zlib-compressed. */
export function compressRgba(rgba: RgbaBytes, width: number, height: number, level: number): Uint8Array {
  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return zlibSync(raw, { level: level as any });
}

export function checkFrame(rgba: RgbaBytes, width: number, height: number): void {
  const want = width * height * 4;
  if (rgba.length !== want) {
    throw new Error(`addFrame(): expected ${want} bytes (${width}x${height} RGBA), got ${rgba.length}`);
  }
}

export function checkDims(width: number, height: number): void {
  for (const [k, v] of [["width", width], ["height", height]] as const) {
    if (!Number.isInteger(v) || v < 1 || v > 0x7fffffff) throw new Error(`${k} must be a positive integer, got ${v}`);
  }
}

export function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Single-image PNG (IHDR, IDAT, IEND). */
export function encodePng(rgba: RgbaBytes, width: number, height: number, level = 6): Uint8Array {
  checkDims(width, height);
  checkFrame(rgba, width, height);
  return concat([
    PNG_SIGNATURE,
    ihdr(width, height),
    pngChunk("IDAT", compressRgba(rgba, width, height, level)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}
