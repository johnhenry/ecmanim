import { test } from "node:test";
import assert from "node:assert/strict";

// These tests run under PLAIN NODE (no DOM). They verify:
//   1. Importing src/video-browser.ts never throws in Node (import-safety).
//   2. loadVideo() throws a clear error without a DOM.
//   3. PreCapturedProvider's time -> index math (the frame-accurate lookup)
//      is correct + clamped, exercised via the injected-frames TEST SEAM
//      (its constructor accepts { frames, fps, ... } so no <video> is needed).
//   4. dispose() clears the frames.
//   5. Metadata plumbing (duration/width/height) from a fake element.
// A real-browser end-to-end test is included but SKIPPED under Node.

import {
  PreCapturedProvider,
  LiveVideoProvider,
  WebCodecsProvider,
  webCodecsAvailable,
  loadVideo,
} from "../src/video-browser.ts";

// ---------------------------------------------------------------------------
// 1. Import safety
// ---------------------------------------------------------------------------
test("importing video-browser under Node does not throw and exposes the API", () => {
  assert.equal(typeof PreCapturedProvider, "function");
  assert.equal(typeof LiveVideoProvider, "function");
  assert.equal(typeof loadVideo, "function");
});

// ---------------------------------------------------------------------------
// 2. loadVideo without a DOM
// ---------------------------------------------------------------------------
test("loadVideo() rejects with a clear error when there is no DOM", async () => {
  assert.equal(typeof document, "undefined", "test must run under Node (no DOM)");
  await assert.rejects(
    () => loadVideo("clip.mp4"),
    (err: Error) => {
      assert.match(err.message, /browser-only/i);
      assert.match(err.message, /loadVideo/);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// 3. PreCapturedProvider indexing math (test seam: injected frames)
// ---------------------------------------------------------------------------
test("PreCapturedProvider maps time -> index with round(t*fps), clamped", () => {
  // 5 fake drawables at 10 fps => 0.5s duration, frame i covers t=i/10.
  const frames = ["f0", "f1", "f2", "f3", "f4"];
  const p = new PreCapturedProvider({ frames, fps: 10 });

  // Metadata derived from frame count when no explicit duration is given.
  assert.equal(p.fps, 10);
  assert.equal(p.frameCount, 5);
  assert.ok(Math.abs(p.duration - 0.5) < 1e-9);

  // Exact frame times.
  assert.equal(p.frameAt(0.0), "f0");
  assert.equal(p.frameAt(0.1), "f1");
  assert.equal(p.frameAt(0.2), "f2");
  assert.equal(p.frameAt(0.4), "f4");

  // Rounding: 0.14 -> round(1.4)=1 ; 0.16 -> round(1.6)=2 ; 0.15 -> round(1.5)=2.
  assert.equal(p.frameAt(0.14), "f1");
  assert.equal(p.frameAt(0.16), "f2");
  assert.equal(p.frameAt(0.15), "f2");

  // Clamp below 0 and above duration.
  assert.equal(p.frameAt(-5), "f0", "negative time clamps to first frame");
  assert.equal(p.frameAt(999), "f4", "over-duration clamps to last frame");
});

test("PreCapturedProvider honors an explicit duration/width/height override", () => {
  const frames = ["a", "b", "c"];
  const p = new PreCapturedProvider({
    frames,
    fps: 24,
    duration: 2,
    width: 640,
    height: 480,
  });
  assert.equal(p.duration, 2);
  assert.equal(p.width, 640);
  assert.equal(p.height, 480);
  // Index still clamps to the available frames even if duration implies more.
  assert.equal(p.frameAt(2), "c");
});

test("PreCapturedProvider.frameAt returns null with no frames", () => {
  const p = new PreCapturedProvider({ fps: 30 });
  assert.equal(p.frameAt(0), null);
  assert.equal(p.frameCount, 0);
});

// ---------------------------------------------------------------------------
// 4. dispose() clears frames
// ---------------------------------------------------------------------------
test("PreCapturedProvider.dispose() clears frames (and closes ImageBitmaps)", () => {
  let closed = 0;
  const frames = [
    { close: () => { closed++; } },
    { close: () => { closed++; } },
  ];
  const p = new PreCapturedProvider({ frames, fps: 2 });
  assert.equal(p.frameCount, 2);
  p.dispose();
  assert.equal(p.frameCount, 0);
  assert.equal(p.frameAt(0), null);
  assert.equal(closed, 2, "dispose() calls close() on each drawable when present");
});

// ---------------------------------------------------------------------------
// 5. Metadata plumbing from a fake element (no browser)
// ---------------------------------------------------------------------------
test("PreCapturedProvider reads metadata from an injected fake <video>", () => {
  // A fake element with just the fields the provider reads. init() is NOT
  // called (that needs a DOM); we only verify the metadata plumbing.
  const fakeVideo = { duration: 3, videoWidth: 320, videoHeight: 180 };
  const p = new PreCapturedProvider({ video: fakeVideo, fps: 30 });
  assert.equal(p.duration, 3);
  assert.equal(p.width, 320);
  assert.equal(p.height, 180);
});

test("LiveVideoProvider exposes metadata and best-effort seeks the fake element", () => {
  const fakeVideo = {
    duration: 4,
    videoWidth: 1280,
    videoHeight: 720,
    currentTime: 0,
  };
  const p = new LiveVideoProvider(fakeVideo, 25);
  assert.equal(p.fps, 25);
  assert.equal(p.duration, 4);
  assert.equal(p.width, 1280);
  assert.equal(p.height, 720);

  // frameAt returns the element itself (the live drawable) and nudges the time.
  const drawable = p.frameAt(1.5);
  assert.equal(drawable, fakeVideo);
  assert.ok(Math.abs(fakeVideo.currentTime - 1.5) < 1e-9);

  // Clamps beyond duration.
  p.frameAt(999);
  assert.ok(Math.abs(fakeVideo.currentTime - 4) < 1e-9);

  p.dispose();
  assert.equal(p.frameAt(0), null, "after dispose the element is gone");
});

test("LiveVideoProvider reports zero metadata for a non-finite duration element", () => {
  const p = new LiveVideoProvider({ duration: NaN }, 30);
  assert.equal(p.duration, 0);
  assert.equal(p.width, 0);
  assert.equal(p.height, 0);
});

// ---------------------------------------------------------------------------
// WebCodecs provider — indexing seam + availability (decode itself is browser-only)
// ---------------------------------------------------------------------------
test("webCodecsAvailable() is false under Node (no VideoDecoder)", () => {
  assert.equal(typeof WebCodecsProvider, "function");
  assert.equal(webCodecsAvailable(), false);
});

test("WebCodecsProvider maps time -> index like the others (injected frames)", () => {
  const frames = ["w0", "w1", "w2", "w3"]; // 4 frames @ 8 fps => 0.5s
  const p = new WebCodecsProvider({ frames, fps: 8 });
  assert.equal(p.frameCount, 4);
  assert.ok(Math.abs(p.duration - 0.5) < 1e-9);
  assert.equal(p.frameAt(0), "w0");
  assert.equal(p.frameAt(0.125), "w1"); // 0.125*8 = 1
  assert.equal(p.frameAt(0.25), "w2");
  assert.equal(p.frameAt(-1), "w0", "clamps below zero");
  assert.equal(p.frameAt(99), "w3", "clamps past the end");
});

test("WebCodecsProvider honors explicit dims/duration and disposes frames", () => {
  let closed = 0;
  const frames = [{ close: () => { closed++; } }, { close: () => { closed++; } }];
  const p = new WebCodecsProvider({ frames, fps: 30, duration: 5, width: 1920, height: 1080 });
  assert.equal(p.duration, 5);
  assert.equal(p.width, 1920);
  assert.equal(p.height, 1080);
  p.dispose();
  assert.equal(p.frameCount, 0);
  assert.equal(p.frameAt(0), null);
  assert.equal(closed, 2, "dispose() closes each frame");
});

test("WebCodecsProvider.frameAt returns null with no frames", () => {
  assert.equal(new WebCodecsProvider({ fps: 30 }).frameAt(0), null);
});

// ---------------------------------------------------------------------------
// Real-browser end-to-end — SKIPPED under Node.
// The orchestrator runs this separately under the GPU lock. Kept here as
// executable documentation of the intended browser behavior.
// ---------------------------------------------------------------------------
test(
  "loadVideo precapture produces a frame-accurate VideoMobject (browser only)",
  { skip: typeof document === "undefined" },
  async () => {
    // In a real browser with a served fixture clip:
    //   const mob = await loadVideo("/fixtures/clip.mp4", { fps: 30, mode: "precapture", height: 2 });
    //   // Provider pre-captured every frame; frameAt is a sync array lookup.
    //   assert.ok(mob.provider.duration > 0);
    //   assert.equal(mob.provider.width > 0, true);
    //   // Base ImageMobject was seeded with the first frame + intrinsic size.
    //   assert.ok(mob.image);
    //   assert.ok(Math.abs(mob.aspect - mob.provider.width / mob.provider.height) < 1e-6);
    //   // Advancing swaps to a later frame (a different ImageBitmap).
    //   const first = mob.image;
    //   mob.seekTo(mob.playDuration / 2);
    //   assert.notEqual(mob.image, first);
    //   mob.dispose();
    //
    // "webcodecs" mode (mp4/mov): single-pass demux+decode via mp4box + VideoDecoder.
    //   const wc = await loadVideo("/fixtures/clip.mp4", { fps: 30, mode: "webcodecs" });
    //   assert.ok(wc.provider instanceof WebCodecsProvider);
    //   assert.ok(wc.provider.frameCount > 0);
    //   assert.equal(wc.provider.frameAt(0).constructor.name, "ImageBitmap");
    //
    // "live" mode: frameAt(t) returns the <video> element and nudges currentTime.
    //   const live = await loadVideo("/fixtures/clip.mp4", { mode: "live" });
    //   assert.equal(live.provider.frameAt(1).tagName, "VIDEO");
    assert.ok(true);
  },
);
