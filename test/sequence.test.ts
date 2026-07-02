import { test } from "node:test";
import assert from "node:assert/strict";

import { Sequence } from "../src/animation/sequence.ts";
import { FadeIn } from "../src/animation/Animation.ts";
import { Circle } from "../src/mobject/geometry.ts";

// A Circle defaults to a RED stroke with fillOpacity 0. FadeIn drives its
// strokeOpacity from 0 -> its target (1). We observe strokeOpacity to know the
// child's local progress.
function makeSeq(config: any) {
  const c = new Circle();
  const anim = new FadeIn(c);
  const seq = Sequence(anim, config);
  seq.begin();
  return { c, seq };
}

test("Sequence: child frozen at start before its window", () => {
  // Window: from frame 30 (=1s at fps 30), duration 30 frames (=1s), total 2s.
  // Window fraction = [0.5, 1.0]. Before alpha 0.5 the child sits at alpha 0.
  const { c, seq } = makeSeq({ from: 30, durationInFrames: 30, fps: 30 });

  seq.interpolate(0.0);
  assert.ok(c.strokeOpacity < 0.001, `at alpha 0 expected ~0, got ${c.strokeOpacity}`);

  seq.interpolate(0.25);
  assert.ok(c.strokeOpacity < 0.001, `before window expected ~0, got ${c.strokeOpacity}`);

  // Right at the window boundary, still ~0.
  seq.interpolate(0.5);
  assert.ok(c.strokeOpacity < 0.001, `at window start expected ~0, got ${c.strokeOpacity}`);
});

test("Sequence: child progresses inside its window", () => {
  const { c, seq } = makeSeq({ from: 30, durationInFrames: 30, fps: 30 });

  // Midpoint of the timeline is the midpoint of window [0.5,1.0] -> local ~0.5.
  seq.interpolate(0.75);
  const mid = c.strokeOpacity;
  assert.ok(mid > 0.05 && mid < 0.95, `mid-window expected partial, got ${mid}`);

  // Later in the window -> larger opacity (monotone increasing presentation).
  seq.interpolate(0.9);
  assert.ok(c.strokeOpacity > mid, `later in window should exceed mid (${c.strokeOpacity} vs ${mid})`);
});

test("Sequence: child frozen at end after its window", () => {
  const { c, seq } = makeSeq({ from: 30, durationInFrames: 30, fps: 30 });

  seq.interpolate(1.0);
  assert.ok(Math.abs(c.strokeOpacity - 1) < 0.001, `after window expected ~1, got ${c.strokeOpacity}`);
});

test("Sequence: from=0 with full duration behaves like a plain animation", () => {
  // Window [0,1]: no shifting; endpoints are 0 and 1.
  const { c, seq } = makeSeq({ from: 0, durationInFrames: 30, fps: 30 });

  seq.interpolate(0);
  assert.ok(c.strokeOpacity < 0.001, `start ~0, got ${c.strokeOpacity}`);
  seq.interpolate(1);
  assert.ok(Math.abs(c.strokeOpacity - 1) < 0.001, `end ~1, got ${c.strokeOpacity}`);
});

test("Sequence: exposes computed window fractions", () => {
  const { seq } = makeSeq({ from: 30, durationInFrames: 30, fps: 30 });
  assert.equal(seq.windowStart, 0.5);
  assert.equal(seq.windowEnd, 1.0);
  assert.equal(seq.runTime, 2);
});
