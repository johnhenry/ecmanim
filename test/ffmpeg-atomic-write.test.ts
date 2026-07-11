// encodeFrames() writes a partial-movie-cache file (partial/{hash}.{ext}).
// Regression: it used to write straight to the final path, so a concurrent
// reader's existsSync(partialPath) check could see the file mid-write --
// reading it then returned a truncated file, or (given a hash collision
// across two DIFFERENT concurrently-rendering scenes) spliced foreign
// footage into an unrelated render (confirmed reproducible during the
// Reveal.js/Slidev campaign's parallel port wave). Fix: write to a temp
// path in the same directory, renameSync() atomically into place only after
// ffmpeg exits 0. These tests verify the safety properties that fix
// establishes, not true multi-process concurrency (which would be slow/
// flaky in CI) -- the meaningful thing to prove is that a reader can never
// observe a half-written file at the FINAL path, and that failures don't
// leave stray temp files behind.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { encodeFrames } from "../src/renderer/ffmpeg.ts";
import { loadNapiCanvas } from "./_snapshot_util.ts";

const canvasMod = await loadNapiCanvas();
const canvasAvailable = !!canvasMod;

function pngFrame(w: number, h: number, color: string): any {
  const { createCanvas } = canvasMod;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  return canvas.toBuffer("image/png");
}

test("encodeFrames: on success, only the final path exists — no stray temp file left behind", { skip: !canvasAvailable }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecmanim-atomic-"));
  try {
    const outPath = join(dir, "seg-abc123.mp4");
    const frames = [pngFrame(32, 32, "#ff0000"), pngFrame(32, 32, "#00ff00")];
    await encodeFrames(frames, { fps: 2, pixelWidth: 32, pixelHeight: 32, format: "mp4", outPath, verbose: false });

    assert.ok(existsSync(outPath), "the final partial file must exist after a successful encode");
    const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp-"));
    assert.deepEqual(leftovers, [], `no .tmp-* files should remain, found: ${leftovers}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("encodeFrames: on failure, the temp file is cleaned up and the final path is never created", { skip: !canvasAvailable }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecmanim-atomic-fail-"));
  try {
    const outPath = join(dir, "seg-willfail.mp4");
    // Zero frames + an invalid format string makes ffmpeg exit non-zero
    // (image2pipe with no input frames and no matching codec branch).
    await assert.rejects(
      () => encodeFrames([], { fps: 2, pixelWidth: 32, pixelHeight: 32, format: "mp4", outPath, verbose: false }),
      /ffmpeg partial exited/,
    );
    assert.ok(!existsSync(outPath), "the final path must never be created on a failed encode");
    const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp-"));
    assert.deepEqual(leftovers, [], `failed encode must not leave a stray temp file, found: ${leftovers}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("encodeFrames: two concurrent encodes to DIFFERENT final paths in the same directory don't collide on temp filenames", { skip: !canvasAvailable }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecmanim-atomic-concurrent-"));
  try {
    const outA = join(dir, "seg-a.mp4");
    const outB = join(dir, "seg-b.mp4");
    // Same tick, same process -- exercises the per-call temp-suffix counter
    // (pid+threadId alone wouldn't distinguish two concurrent calls in the
    // same thread).
    await Promise.all([
      encodeFrames([pngFrame(32, 32, "#ff0000")], { fps: 1, pixelWidth: 32, pixelHeight: 32, format: "mp4", outPath: outA, verbose: false }),
      encodeFrames([pngFrame(32, 32, "#0000ff")], { fps: 1, pixelWidth: 32, pixelHeight: 32, format: "mp4", outPath: outB, verbose: false }),
    ]);
    assert.ok(existsSync(outA) && existsSync(outB), "both concurrent encodes must complete to their own distinct final paths");
    const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp-"));
    assert.deepEqual(leftovers, [], `no .tmp-* files should remain after both complete, found: ${leftovers}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
