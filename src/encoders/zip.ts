// ZIP writer + frame-sequence encoder, written from PKWARE's APPNOTE.TXT
// (local file header 4.3.7, central directory 4.3.12, end of central
// directory 4.3.16). Methods: 0 (store) and 8 (deflate). No ZIP64: archives
// are limited to 65,534 entries and 4 GiB - 1 (a clear error is thrown
// beyond that). Deterministic output: a fixed DOS timestamp unless one is
// given. Pure and isomorphic.

import { deflateSync } from "fflate";
import { crc32 } from "./crc32.ts";
import { encodePng, checkDims, checkFrame, concat, type RgbaBytes } from "./png.ts";

export interface ZipFileOptions {
  /** "store" (default for already-compressed data you opt in with) or "deflate". Default "deflate". */
  method?: "store" | "deflate";
  /** Modification time; default is the DOS epoch (1980-01-01) for reproducible bytes. */
  date?: Date;
}

interface CentralRecord {
  name: Uint8Array;
  method: number;
  crc: number;
  csize: number;
  usize: number;
  offset: number;
  dosTime: number;
  dosDate: number;
}

const MAX_ENTRIES = 65534;
const MAX_U32 = 0xffffffff;
const UTF8_FLAG = 0x0800;

function dosDateTime(d?: Date): [number, number] {
  if (!d) return [0, (0 << 9) | (1 << 5) | 1]; // 00:00:00 on 1980-01-01
  const year = Math.max(1980, d.getFullYear());
  return [
    (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  ];
}

export class ZipWriter {
  private readonly parts: Uint8Array[] = [];
  private readonly central: CentralRecord[] = [];
  private readonly names = new Set<string>();
  private offset = 0;
  private done = false;

  get entryCount(): number { return this.central.length; }

  addFile(name: string, data: Uint8Array, opts: ZipFileOptions = {}): void {
    if (this.done) throw new Error("ZipWriter: already finished");
    if (this.names.has(name)) throw new Error(`ZipWriter: duplicate entry name ${JSON.stringify(name)}`);
    if (this.central.length >= MAX_ENTRIES) throw new Error(`ZipWriter: too many entries (max ${MAX_ENTRIES}, no ZIP64)`);
    const nameBytes = new TextEncoder().encode(name);
    let method = opts.method === "store" ? 0 : 8;
    let payload: Uint8Array = method === 8 ? deflateSync(data, { level: 6 }) : data;
    if (method === 8 && payload.length >= data.length) { method = 0; payload = data; } // deflate didn't help
    if (payload.length > MAX_U32 || this.offset + payload.length > MAX_U32 - 1024 * 1024) {
      throw new Error("ZipWriter: archive would exceed 4 GiB (no ZIP64)");
    }
    const [dosTime, dosDate] = dosDateTime(opts.date);
    const c = crc32(data);

    const h = new Uint8Array(30 + nameBytes.length);
    const v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, method === 8 ? 20 : 10, true); // version needed to extract
    v.setUint16(6, UTF8_FLAG, true);
    v.setUint16(8, method, true);
    v.setUint16(10, dosTime, true);
    v.setUint16(12, dosDate, true);
    v.setUint32(14, c, true);
    v.setUint32(18, payload.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, nameBytes.length, true);
    v.setUint16(28, 0, true);
    h.set(nameBytes, 30);

    this.central.push({ name: nameBytes, method, crc: c, csize: payload.length, usize: data.length, offset: this.offset, dosTime, dosDate });
    this.names.add(name);
    this.parts.push(h, payload);
    this.offset += h.length + payload.length;
  }

  finish(): Uint8Array {
    if (this.done) throw new Error("ZipWriter: already finished");
    this.done = true;
    const cdStart = this.offset;
    let cdSize = 0;
    for (const r of this.central) {
      const h = new Uint8Array(46 + r.name.length);
      const v = new DataView(h.buffer);
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 20, true);                       // version made by (2.0, MS-DOS attrs)
      v.setUint16(6, r.method === 8 ? 20 : 10, true); // version needed
      v.setUint16(8, UTF8_FLAG, true);
      v.setUint16(10, r.method, true);
      v.setUint16(12, r.dosTime, true);
      v.setUint16(14, r.dosDate, true);
      v.setUint32(16, r.crc, true);
      v.setUint32(20, r.csize, true);
      v.setUint32(24, r.usize, true);
      v.setUint16(28, r.name.length, true);
      // extra(30) comment(32) disk(34) int attrs(36) ext attrs(38) = 0
      v.setUint32(42, r.offset, true);
      h.set(r.name, 46);
      this.parts.push(h);
      cdSize += h.length;
    }
    const e = new Uint8Array(22);
    const ev = new DataView(e.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, this.central.length, true);
    ev.setUint16(10, this.central.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdStart, true);
    this.parts.push(e);
    return concat(this.parts);
  }
}

export interface ZipSequenceOptions {
  width: number;
  height: number;
  fps: number;
  /** zlib level for the PNG frames (default 6). */
  level?: number;
}

/**
 * Numbered PNG frames (`frame-000001.png` ...) plus an `animation.json`
 * manifest: { fps, width, height, frameCount, pattern, frames[, delaysMs] }.
 * `delaysMs` appears only if some frame's delay differs from 1000/fps.
 */
export class ZipSequenceEncoder {
  private readonly zip = new ZipWriter();
  private readonly names: string[] = [];
  private readonly delays: number[] = [];
  private done = false;
  private readonly opts: ZipSequenceOptions;
  constructor(opts: ZipSequenceOptions) {
    this.opts = opts;
    checkDims(opts.width, opts.height);
    if (!(opts.fps > 0)) throw new Error("ZipSequenceEncoder: fps must be > 0");
  }

  get frameCount(): number { return this.names.length; }

  addFrame(rgba: RgbaBytes, delayMs?: number): void {
    if (this.done) throw new Error("ZipSequenceEncoder: already finished");
    checkFrame(rgba, this.opts.width, this.opts.height);
    const name = `frame-${String(this.names.length + 1).padStart(6, "0")}.png`;
    // PNG is already deflated: store it rather than compress twice.
    this.zip.addFile(name, encodePng(rgba, this.opts.width, this.opts.height, this.opts.level ?? 6), { method: "store" });
    this.names.push(name);
    this.delays.push(delayMs ?? 1000 / this.opts.fps);
  }

  finish(): Uint8Array {
    if (this.done) throw new Error("ZipSequenceEncoder: already finished");
    if (this.names.length === 0) throw new Error("ZipSequenceEncoder: no frames added");
    this.done = true;
    const base = 1000 / this.opts.fps;
    const manifest: Record<string, unknown> = {
      fps: this.opts.fps, width: this.opts.width, height: this.opts.height,
      frameCount: this.names.length, pattern: "frame-%06d.png", frames: this.names,
    };
    if (this.delays.some((d) => Math.abs(d - base) > 1e-6)) manifest.delaysMs = this.delays;
    this.zip.addFile("animation.json", new TextEncoder().encode(JSON.stringify(manifest, null, 2)), { method: "deflate" });
    return this.zip.finish();
  }
}
