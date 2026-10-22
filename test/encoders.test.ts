import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync, inflateRawSync, crc32 as zlibCrc32 } from "node:zlib";
import { crc32, ApngEncoder, ZipWriter, ZipSequenceEncoder, GifEncoder, createFrameEncoder } from "../src/encoders/index.ts";

const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** Solid-colour RGBA frame with a per-pixel gradient so frames differ. */
function frame(w: number, h: number, r: number, g: number, b: number, a = 255): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = (b + i) & 255; out[i * 4 + 3] = a; }
  return out;
}

// ---- minimal independent PNG/APNG parser ---------------------------------
interface Chunk { type: string; data: Uint8Array; crcOk: boolean }
function parsePng(bytes: Uint8Array): Chunk[] {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  assert.deepEqual([...bytes.subarray(0, 8)], sig, "PNG signature");
  const v = dv(bytes);
  const chunks: Chunk[] = [];
  let o = 8;
  while (o < bytes.length) {
    const len = v.getUint32(o);
    const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
    const data = bytes.subarray(o + 8, o + 8 + len);
    const crc = v.getUint32(o + 8 + len);
    chunks.push({ type, data, crcOk: crc === zlibCrc32(bytes.subarray(o + 4, o + 8 + len)) });
    o += 12 + len;
  }
  assert.equal(o, bytes.length, "no trailing bytes");
  return chunks;
}
/** Unfilter (filter 0 only is emitted; also handle Sub/Up for robustness) and return RGBA. */
function decodeRaw(z: Uint8Array, w: number, h: number): Uint8Array {
  const raw = inflateSync(z);
  assert.equal(raw.length, h * (1 + w * 4));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (1 + w * 4)];
    assert.equal(ft, 0, "encoder emits filter type 0");
    out.set(raw.subarray(y * (1 + w * 4) + 1, (y + 1) * (1 + w * 4)), y * w * 4);
  }
  return out;
}

test("crc32 matches zlib.crc32 and known vector", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
  const big = new Uint8Array(100000).map((_, i) => (i * 31) & 255);
  assert.equal(crc32(big), zlibCrc32(big));
});

test("ApngEncoder: chunk order, CRCs, acTL/fcTL fields, sequence numbers, pixel round-trip", () => {
  const w = 5, h = 3;
  const enc = new ApngEncoder({ width: w, height: h, loops: 2, defaultDelayMs: 40 });
  const f0 = frame(w, h, 255, 0, 0), f1 = frame(w, h, 0, 255, 0, 128), f2 = frame(w, h, 0, 0, 255);
  enc.addFrame(f0);
  enc.addFrame(f1, 100);
  enc.addFrame(f2, 250);
  const bytes = enc.finish();
  assert.ok(bytes instanceof Uint8Array);

  const chunks = parsePng(bytes);
  assert.ok(chunks.every((c) => c.crcOk), "all CRCs valid");
  assert.deepEqual(chunks.map((c) => c.type), ["IHDR", "acTL", "fcTL", "IDAT", "fcTL", "fdAT", "fcTL", "fdAT", "IEND"]);

  const ihdr = dv(chunks[0].data);
  assert.equal(ihdr.getUint32(0), w); assert.equal(ihdr.getUint32(4), h);
  assert.deepEqual([...chunks[0].data.subarray(8)], [8, 6, 0, 0, 0], "8-bit RGBA, deflate, filter 0, no interlace");

  const actl = dv(chunks[1].data);
  assert.equal(actl.getUint32(0), 3, "num_frames");
  assert.equal(actl.getUint32(4), 2, "num_plays");

  const seqs: number[] = [];
  const delays: number[] = [];
  const fcTLs = chunks.filter((c) => c.type === "fcTL");
  for (const c of fcTLs) {
    const v = dv(c.data);
    assert.equal(c.data.length, 26);
    seqs.push(v.getUint32(0));
    assert.equal(v.getUint32(4), w); assert.equal(v.getUint32(8), h);
    assert.equal(v.getUint32(12), 0); assert.equal(v.getUint32(16), 0);
    delays.push((v.getUint16(20) / v.getUint16(22)) * 1000);
    assert.equal(c.data[24], 0, "dispose NONE"); assert.equal(c.data[25], 0, "blend SOURCE");
  }
  assert.deepEqual(delays.map(Math.round), [40, 100, 250]);
  // fdAT sequence numbers continue the fcTL sequence: 0 fcTL, 1 fcTL, 2 fdAT, 3 fcTL, 4 fdAT
  const order = chunks.filter((c) => c.type === "fcTL" || c.type === "fdAT").map((c) => dv(c.data).getUint32(0));
  assert.deepEqual(order, [0, 1, 2, 3, 4]);
  assert.deepEqual(seqs, [0, 1, 3]);

  // pixels round-trip
  assert.deepEqual(decodeRaw(chunks[3].data, w, h), f0);
  assert.deepEqual(decodeRaw(chunks[5].data.subarray(4), w, h), f1);
  assert.deepEqual(decodeRaw(chunks[7].data.subarray(4), w, h), f2);
});

test("ApngEncoder: delays derive from fps when no delay given; loops default infinite; fractional ms keep rational precision", () => {
  const enc = new ApngEncoder({ width: 2, height: 2, fps: 30 });
  enc.addFrame(frame(2, 2, 1, 2, 3));
  enc.addFrame(frame(2, 2, 4, 5, 6));
  const chunks = parsePng(enc.finish());
  assert.equal(dv(chunks.find((c) => c.type === "acTL")!.data).getUint32(4), 0, "0 = loop forever");
  for (const c of chunks.filter((c) => c.type === "fcTL")) {
    const v = dv(c.data);
    assert.ok(Math.abs(v.getUint16(20) / v.getUint16(22) - 1 / 30) < 1e-4, "1/30 s within rational precision");
  }
});

test("ApngEncoder: input validation", () => {
  assert.throws(() => new ApngEncoder({ width: 0, height: 2 }), /width/);
  const enc = new ApngEncoder({ width: 2, height: 2 });
  assert.throws(() => enc.addFrame(new Uint8Array(5)), /expected 16 bytes/);
  assert.throws(() => enc.finish(), /no frames/);
  enc.addFrame(frame(2, 2, 0, 0, 0));
  enc.finish();
  assert.throws(() => enc.addFrame(frame(2, 2, 0, 0, 0)), /finished/);
  assert.throws(() => enc.finish(), /finished/);
});

test("ApngEncoder: accepts Uint8ClampedArray (canvas ImageData)", () => {
  const enc = new ApngEncoder({ width: 2, height: 1 });
  enc.addFrame(new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]));
  const chunks = parsePng(enc.finish());
  assert.deepEqual([...decodeRaw(chunks.find((c) => c.type === "IDAT")!.data, 2, 1)], [1, 2, 3, 4, 5, 6, 7, 8]);
});

// ---- ZIP parser ------------------------------------------------------------
interface ZipEntry { name: string; method: number; crc: number; csize: number; usize: number; data: Uint8Array; flags: number }
function parseZip(bytes: Uint8Array): ZipEntry[] {
  const v = dv(bytes);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  assert.ok(eocd >= 0, "EOCD present");
  const total = v.getUint16(eocd + 10, true);
  assert.equal(v.getUint16(eocd + 8, true), total);
  assert.equal(v.getUint16(eocd + 4, true), 0); assert.equal(v.getUint16(eocd + 6, true), 0);
  const cdSize = v.getUint32(eocd + 12, true), cdOff = v.getUint32(eocd + 16, true);
  assert.equal(cdOff + cdSize, eocd, "central directory ends at EOCD");
  const entries: ZipEntry[] = [];
  let o = cdOff;
  for (let n = 0; n < total; n++) {
    assert.equal(v.getUint32(o, true), 0x02014b50, "central header sig");
    const flags = v.getUint16(o + 8, true), method = v.getUint16(o + 10, true);
    const crc = v.getUint32(o + 16, true), csize = v.getUint32(o + 20, true), usize = v.getUint32(o + 24, true);
    const nlen = v.getUint16(o + 28, true), elen = v.getUint16(o + 30, true), clen = v.getUint16(o + 32, true);
    const lho = v.getUint32(o + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(o + 46, o + 46 + nlen));
    // local header agrees with central
    assert.equal(v.getUint32(lho, true), 0x04034b50, "local header sig");
    assert.equal(v.getUint32(lho + 14, true), crc);
    assert.equal(v.getUint32(lho + 18, true), csize);
    assert.equal(v.getUint32(lho + 22, true), usize);
    const lnlen = v.getUint16(lho + 26, true), lelen = v.getUint16(lho + 28, true);
    assert.equal(new TextDecoder().decode(bytes.subarray(lho + 30, lho + 30 + lnlen)), name);
    const comp = bytes.subarray(lho + 30 + lnlen + lelen, lho + 30 + lnlen + lelen + csize);
    const data = method === 0 ? comp : new Uint8Array(inflateRawSync(comp));
    assert.equal(data.length, usize);
    assert.equal(zlibCrc32(data), crc, `CRC of ${name}`);
    entries.push({ name, method, crc, csize, usize, data, flags });
    o += 46 + nlen + elen + clen;
  }
  assert.equal(o, cdOff + cdSize);
  return entries;
}

test("ZipWriter: store + deflate entries parse back with valid central directory and CRCs", () => {
  const z = new ZipWriter();
  const text = new TextEncoder().encode("hello hello hello hello hello hello hello hello");
  z.addFile("a.txt", text, { method: "deflate" });
  z.addFile("dir/b.bin", new Uint8Array([1, 2, 3]), { method: "store" });
  z.addFile("ünï.txt", new Uint8Array(0));
  const entries = parseZip(z.finish());
  assert.deepEqual(entries.map((e) => e.name), ["a.txt", "dir/b.bin", "ünï.txt"]);
  assert.equal(entries[0].method, 8); assert.ok(entries[0].csize < entries[0].usize);
  assert.equal(entries[1].method, 0);
  assert.deepEqual([...entries[1].data], [1, 2, 3]);
  assert.deepEqual(entries[0].data, text);
  assert.ok(entries[2].flags & 0x800, "UTF-8 name flag");
  assert.throws(() => z.addFile("x", text), /finished/);
});

test("ZipWriter: output is deterministic (fixed DOS timestamp) and rejects duplicate names", () => {
  const mk = () => { const z = new ZipWriter(); z.addFile("a", new Uint8Array([1])); return z.finish(); };
  assert.deepEqual(mk(), mk());
  const z = new ZipWriter(); z.addFile("a", new Uint8Array([1]));
  assert.throws(() => z.addFile("a", new Uint8Array([2])), /duplicate/);
});

test("ZipSequenceEncoder: numbered PNGs + animation.json manifest", () => {
  const w = 4, h = 2;
  const enc = new ZipSequenceEncoder({ width: w, height: h, fps: 12 });
  const f0 = frame(w, h, 10, 20, 30), f1 = frame(w, h, 40, 50, 60);
  enc.addFrame(f0); enc.addFrame(f1);
  const entries = parseZip(enc.finish());
  assert.deepEqual(entries.map((e) => e.name), ["frame-000001.png", "frame-000002.png", "animation.json"]);
  for (const [i, f] of [f0, f1].entries()) {
    const chunks = parsePng(entries[i].data);
    assert.ok(chunks.every((c) => c.crcOk));
    assert.deepEqual(chunks.map((c) => c.type), ["IHDR", "IDAT", "IEND"]);
    assert.deepEqual(decodeRaw(chunks[1].data, w, h), f);
  }
  assert.equal(entries[0].method, 0, "PNG frames are stored (already compressed)");
  assert.equal(entries[2].method, 8, "manifest is deflated");
  const manifest = JSON.parse(new TextDecoder().decode(entries[2].data));
  assert.deepEqual(manifest, {
    fps: 12, width: w, height: h, frameCount: 2, pattern: "frame-%06d.png",
    frames: ["frame-000001.png", "frame-000002.png"],
  });
});

test("ZipSequenceEncoder: per-frame delays recorded when they differ from 1/fps; empty throws", () => {
  const enc = new ZipSequenceEncoder({ width: 2, height: 2, fps: 10 });
  enc.addFrame(frame(2, 2, 1, 1, 1)); enc.addFrame(frame(2, 2, 2, 2, 2), 500);
  const entries = parseZip(enc.finish());
  const m = JSON.parse(new TextDecoder().decode(entries[entries.length - 1].data));
  assert.deepEqual(m.delaysMs, [100, 500]);
  assert.throws(() => new ZipSequenceEncoder({ width: 2, height: 2, fps: 10 }).finish(), /no frames/);
});

// ---- GIF -------------------------------------------------------------------
test("GifEncoder: valid GIF89a, frame count + delays parsed back", async () => {
  const w = 8, h = 8;
  const enc = await GifEncoder.create({ width: w, height: h, fps: 20 });
  enc.addFrame(frame(w, h, 255, 0, 0));
  enc.addFrame(frame(w, h, 0, 255, 0), 200);
  enc.addFrame(frame(w, h, 0, 0, 255));
  const bytes = enc.finish();
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 6)), "GIF89a");
  assert.equal(bytes[bytes.length - 1], 0x3b, "trailer");
  const v = dv(bytes);
  assert.equal(v.getUint16(6, true), w); assert.equal(v.getUint16(8, true), h);
  // count Graphic Control Extensions (21 F9 04) and read delays (centiseconds)
  const delays: number[] = [];
  for (let i = 0; i < bytes.length - 8; i++) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 4) delays.push(v.getUint16(i + 4, true) * 10);
  }
  assert.deepEqual(delays, [50, 200, 50]);
});

test("createFrameEncoder dispatches by kind", async () => {
  for (const kind of ["apng", "zip", "gif"] as const) {
    const enc = await createFrameEncoder(kind, { width: 2, height: 2, fps: 10 });
    enc.addFrame(frame(2, 2, 9, 9, 9));
    assert.ok(enc.finish().length > 10);
  }
  await assert.rejects(createFrameEncoder("mp4" as any, { width: 2, height: 2, fps: 10 }), /unknown/);
});

// ---- optional external cross-check ----------------------------------------
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const hasFfprobe = spawnSync("ffprobe", ["-version"]).status === 0;
test("ffprobe agrees with our APNG (optional: skipped without ffprobe)", { skip: !hasFfprobe && "ffprobe not on PATH" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "apng-"));
  try {
    const enc = new ApngEncoder({ width: 16, height: 12, fps: 10 });
    for (let i = 0; i < 4; i++) enc.addFrame(frame(16, 12, i * 60, 10, 10));
    const p = join(dir, "a.apng");
    writeFileSync(p, enc.finish());
    const r = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,width,height,nb_read_frames", "-of", "json", p], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const s = JSON.parse(r.stdout).streams[0];
    assert.equal(s.codec_name, "apng"); assert.equal(s.width, 16); assert.equal(s.height, 12);
    assert.equal(s.nb_read_frames, "4");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
