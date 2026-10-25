import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { encodeFrames, probeVideo } from "../src/renderer/ffmpeg.ts";
import { render, Circle } from "../src/node.ts";
import { renderParallel, renderSegmentRange } from "../src/node-parallel.ts";
import { rgbaScene, noPngScene } from "./fixtures/raw-rgba-scene.ts";

function decode(path: string): Buffer {
  return execFileSync("ffmpeg", ["-v", "error", "-i", path, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 10 * 1024 * 1024 });
}

function colorTags(path: string) {
  return JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_range,color_space,color_transfer,color_primaries", "-of", "json", path], { encoding: "utf8" })).streams[0];
}

// PNG is the pre-#167 reference path, deliberately retained by encodeFrames.
// Translucent colors catch premultiplied-alpha readback; asymmetric blocks
// catch swapped channels, vertical flips, and incorrectly framed raw input.
for (const format of ["mp4", "webm", "mov", "gif"]) {
  test(`raw RGBA matches PNG-fed ${format}: pixels, frame count, size and fps`, { timeout: 30_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "ecmanim-rgba-codec-"));
    try {
      const canvas = createCanvas(32, 24), ctx = canvas.getContext("2d");
      const png: Buffer[] = [], raw: Buffer[] = [];
      for (const color of ["rgba(201,100,50,0.5)", "rgba(20,80,230,0.75)"]) {
        ctx.clearRect(0, 0, 32, 24);
        ctx.fillStyle = color; ctx.fillRect(0, 0, 20, 12);
        ctx.fillStyle = "#00ff40"; ctx.fillRect(20, 12, 12, 12);
        png.push(canvas.toBuffer("image/png"));
        raw.push(Buffer.from(ctx.getImageData(0, 0, 32, 24).data));
      }
      const opts = { fps: 8, pixelWidth: 32, pixelHeight: 24, format, verbose: false };
      const reference = join(dir, `png.${format}`), actual = join(dir, `raw.${format}`);
      await encodeFrames(png, { ...opts, outPath: reference });
      await encodeFrames(raw, { ...opts, outPath: actual, inputFormat: "rgba" });
      const expectedPixels = decode(reference), actualPixels = decode(actual);
      assert.equal(actualPixels.length, 32 * 24 * 4 * 2);
      assert.deepEqual(actualPixels, expectedPixels);
      assert.deepEqual(await probeVideo(actual), await probeVideo(reference));
      assert.deepEqual(colorTags(actual), colorTags(reference), "retain PNG's sRGB tags for color-managed playback");
      if (format === "mp4") assert.ok(readFileSync(actual).equals(readFileSync(reference)), "default MP4 stays byte-identical");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

const options = { pixelWidth: 96, pixelHeight: 64, fps: 8, verbose: false };
const scenePath = fileURLToPath(new URL("./fixtures/raw-rgba-scene.ts", import.meta.url));

test("sequential, cached and parallel videos avoid PNG and share identical partials", { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecmanim-rgba-render-"));
  try {
    const single = join(dir, "single.mp4"), cached = join(dir, "cached", "out.mp4"), parallel = join(dir, "parallel", "out.mp4");
    await render(noPngScene, { ...options, output: single, disableCaching: true });
    const first = await render(noPngScene, { ...options, output: cached });
    assert.equal(first.frames, 8);
    const cold = decode(cached);
    assert.equal(cold.length, 96 * 64 * 4 * 8);
    const second = await render(noPngScene, { ...options, output: cached });
    assert.equal(second.reusedPartials, 4);
    assert.equal(second.frames, 0, "a warm cache does no raster readback");
    assert.deepEqual(decode(cached), cold);

    const result = await renderParallel(scenePath, "noPngScene", { ...options, output: parallel, workers: 2 });
    assert.equal(result.workers, 2, "exercise actual workers, not fallback");
    assert.deepEqual(decode(parallel), cold);
    const partials = readdirSync(join(dir, "cached", "partial"));
    assert.equal(partials.length, 4);
    for (const name of partials) {
      assert.deepEqual(readFileSync(join(dir, "parallel", "partial", name)), readFileSync(join(dir, "cached", "partial", name)));
    }
    const reuse = await renderSegmentRange(scenePath, "noPngScene", [0, 1, 2, 3], { ...options, output: cached });
    assert.deepEqual(reuse, { encoded: 0, reused: 4 });
    assert.equal(decode(single).length, cold.length);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("cached frames are encoded during construct and a later failure cleans the active partial", { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecmanim-rgba-abort-"));
  try {
    await assert.rejects(render(async (scene: any) => {
      const circle = new Circle();
      scene.add(circle);
      await scene.wait(0.25);
      circle.shift([1, 0, 0]);
      await scene.wait(0.25);
      const completed = readdirSync(join(dir, "partial")).filter((p) => !p.includes(".tmp-"));
      assert.equal(completed.length, 1, "flush the preceding segment instead of buffering the movie");
      throw new Error("scene failed after frames");
    }, { ...options, output: join(dir, "out.mp4") }), /scene failed after frames/);
    assert.deepEqual(readdirSync(dir), ["partial"]);
    assert.ok(readdirSync(join(dir, "partial")).every((p) => !p.includes(".tmp-")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("empty scenes and repeated hashes keep their frames on cold and warm caches", { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecmanim-rgba-boundaries-"));
  try {
    for (const empty of [true, false]) {
      const output = join(dir, String(empty), "out.mp4");
      const scene = async (s: any) => {
        if (empty) return;
        await s.emitFrame(); // init bucket followed by identical segment hashes
        for (let i = 0; i < 3; i++) await s.wait(0.25);
      };
      await render(scene, { ...options, output });
      const cold = decode(output);
      assert.equal(cold.length, 96 * 64 * 4 * (empty ? 1 : 7));
      await render(scene, { ...options, output });
      assert.deepEqual(decode(output), cold);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("raw encoder failures reject pending writes, reap ffmpeg and preserve existing output", { timeout: 15_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecmanim-rgba-fail-"));
  try {
    // Unsupported muxer: ffmpeg exits while a large frame is still in flight.
    const outPath = join(dir, "out.unknown");
    writeFileSync(outPath, "previous output");
    await assert.rejects(encodeFrames([Buffer.alloc(1920 * 1080 * 4)], {
      fps: 30, pixelWidth: 1920, pixelHeight: 1080, format: "mp4", inputFormat: "rgba", outPath, verbose: false,
    }));
    assert.equal(readFileSync(outPath, "utf8"), "previous output");
    assert.deepEqual(readdirSync(dir), ["out.unknown"]);
    assert.ok(!execFileSync("ps", ["-A", "-o", "command"]).toString().includes(dir), "no encoder remains after rejection");

    await assert.rejects(encodeFrames([Buffer.alloc(3)], {
      ...options, outPath: join(dir, "malformed.mp4"), inputFormat: "rgba",
    }), /RGBA frame size/);
    assert.deepEqual(readdirSync(dir), ["out.unknown"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("missing ffmpeg rejects without an unhandled error or temp file", { timeout: 15_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecmanim-rgba-missing-"));
  const path = process.env.PATH;
  try {
    process.env.PATH = dir;
    await assert.rejects(encodeFrames([Buffer.alloc(32 * 24 * 4)], {
      fps: 8, pixelWidth: 32, pixelHeight: 24, inputFormat: "rgba", outPath: join(dir, "out.mp4"), verbose: false,
    }));
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    if (path === undefined) delete process.env.PATH;
    else process.env.PATH = path;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PNG sequence output stays PNG and matches the reference encoding", { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecmanim-rgba-png-"));
  try {
    const result = await render(rgbaScene, { ...options, output: join(dir, "frames.png"), format: "png-sequence" });
    const files = readdirSync(result.output).sort();
    assert.equal(files.length, 8);
    const pngs = files.map((f) => readFileSync(join(result.output, f)));
    for (const png of pngs) assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    const reference = join(dir, "reference.mp4"), actual = join(dir, "actual.mp4");
    await encodeFrames(pngs, { ...options, outPath: reference, format: "mp4" });
    await render(noPngScene, { ...options, output: actual, disableCaching: true });
    assert.deepEqual(decode(actual), decode(reference));
    assert.ok(readFileSync(actual).equals(readFileSync(reference)), "the default scene export matches its PNG-fed reference byte for byte");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
