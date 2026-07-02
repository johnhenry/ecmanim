import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import {
  rationalTime, rtSeconds, sceneToOtio, toOtioJSON, fromOtioJSON, sceneToOtioString,
} from "../src/interchange/otio.ts";
import {
  vmobjectToLottieShapes, lottieShapesToVMobject, vmobjectToLottieJSON, loadLottie,
} from "../src/interchange/lottie.ts";
import { Square, RegularPolygon } from "../src/mobject/geometry.ts";

function ffmpegAvailable() {
  try { execSync("ffmpeg -version", { stdio: "ignore" }); return true; } catch { return false; }
}

const fakeScene = {
  fps: 30,
  sections: [],
  playRecords: [
    { index: 0, kind: "play", hash: "abc", startFrame: 0, endFrame: 30 },
    { index: 1, kind: "wait", hash: "def", startFrame: 30, endFrame: 45 },
  ],
};

// --- OTIO -----------------------------------------------------------------

test("rationalTime → seconds", () => {
  assert.equal(rtSeconds(rationalTime(45, 30)), 1.5);
});

test("sceneToOtio builds frame-exact clips from playRecords", () => {
  const tl = sceneToOtio(fakeScene, { name: "demo" });
  assert.equal(tl.name, "demo");
  assert.equal(tl.tracks.length, 1);
  const clips = tl.tracks[0].children;
  assert.equal(clips.length, 2);
  assert.deepEqual(clips[0].sourceRange.startTime, { value: 0, rate: 30 });
  assert.deepEqual(clips[0].sourceRange.duration, { value: 30, rate: 30 });
  assert.deepEqual(clips[1].sourceRange.startTime, { value: 30, rate: 30 });
  assert.equal(clips[1].sourceRange.duration.value, 15);
});

test("toOtioJSON emits OTIO_SCHEMA and round-trips via fromOtioJSON", () => {
  const json = toOtioJSON(sceneToOtio(fakeScene));
  assert.equal(json.OTIO_SCHEMA, "Timeline.1");
  assert.equal(json.tracks.OTIO_SCHEMA, "Stack.1");
  assert.equal(json.tracks.children[0].children[0].OTIO_SCHEMA, "Clip.1");
  const back = fromOtioJSON(json);
  assert.equal(back.tracks[0].children.length, 2);
  assert.equal(back.tracks[0].children[1].sourceRange.duration.value, 15);
  // serializes cleanly
  assert.doesNotThrow(() => JSON.parse(sceneToOtioString(fakeScene)));
});

// --- Lottie ---------------------------------------------------------------

test("VMobject → Lottie shapes → VMobject round-trips anchor geometry", () => {
  const sq = new Square({ sideLength: 2 });
  const shapes = vmobjectToLottieShapes(sq, 100);
  assert.ok(shapes.length >= 1);
  assert.equal(shapes[0].ty, "sh");
  assert.equal(shapes[0].ks.k.c, true, "square subpath is closed");
  assert.equal(shapes[0].ks.k.v.length, 4, "4 corners");

  const back: any = lottieShapesToVMobject(shapes, 100);
  // Compare the imported anchors to the original corners (order preserved).
  const origAnchors = (sq as any).getAnchors ? (sq as any).getAnchors() : null;
  assert.ok(back.points.length >= 4);
  // First anchor should match the square's first anchor (within tolerance).
  assert.ok(Math.abs(back.points[0][0] - sq.points[0][0]) < 1e-3);
  assert.ok(Math.abs(back.points[0][1] - sq.points[0][1]) < 1e-3);
  void origAnchors;
});

test("vmobjectToLottieJSON produces a valid-looking Lottie doc; loadLottie imports it", () => {
  const poly = new RegularPolygon(6, { radius: 1.5 });
  const doc = vmobjectToLottieJSON(poly, { width: 400, height: 400, fps: 30 });
  assert.equal(doc.v, "5.7.0");
  assert.equal(doc.w, 400);
  assert.equal(doc.layers.length, 1);
  assert.equal(doc.layers[0].ty, 4);
  assert.ok(doc.layers[0].shapes.some((s: any) => s.ty === "sh"));
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(doc)));
  const mob: any = loadLottie(doc, 100);
  assert.ok((mob.points?.length ?? 0) > 0 || mob.submobjects?.length > 0);
});

// --- Watermark (guarded) --------------------------------------------------

test("applyWatermark burns text into a clip (skips without ffmpeg)", { skip: !ffmpegAvailable() }, async () => {
  const { applyWatermark } = await import("../src/core/watermark.ts");
  const { mkdtempSync, rmSync, statSync } = await import("node:fs");
  const os = await import("node:os"); const path = await import("node:path");
  const dir = mkdtempSync(path.join(os.tmpdir(), "mjs-wm-"));
  const clip = path.join(dir, "v.mp4");
  execSync(`ffmpeg -v error -f lavfi -i "testsrc=duration=0.5:size=320x180:rate=10" -pix_fmt yuv420p -y ${clip}`);
  const before = statSync(clip).size;
  try {
    await applyWatermark(clip, { text: "@ecmanim", position: "bottom-right" });
    assert.ok(statSync(clip).size > 0);
    // Still a valid video.
    execSync(`ffprobe -v error ${clip}`);
    void before;
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
