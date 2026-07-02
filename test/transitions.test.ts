import { test } from "node:test";
import assert from "node:assert/strict";

import { crossFade, slide, wipe } from "../src/animation/transitions.ts";
import { Circle } from "../src/mobject/geometry.ts";
import { linear } from "../src/animation/rate_functions.ts";

test("crossFade: a fades out while b fades in across the timeline", () => {
  const a = new Circle();
  const b = new Circle();
  // Use overlap=1 (fully simultaneous) + linear so opacities move together.
  const g = crossFade(a, b, { overlap: 1, rateFunc: linear });
  g.begin();

  g.interpolate(0);
  assert.ok(Math.abs(a.strokeOpacity - 1) < 0.01, `a starts opaque, got ${a.strokeOpacity}`);
  assert.ok(b.strokeOpacity < 0.01, `b starts transparent, got ${b.strokeOpacity}`);

  g.interpolate(1);
  assert.ok(a.strokeOpacity < 0.01, `a ends transparent, got ${a.strokeOpacity}`);
  assert.ok(Math.abs(b.strokeOpacity - 1) < 0.01, `b ends opaque, got ${b.strokeOpacity}`);

  // Midpoint ordering: a decreasing, b increasing, crossing near the middle.
  g.interpolate(0.5);
  assert.ok(a.strokeOpacity < 1 && a.strokeOpacity > 0, `a mid partial, got ${a.strokeOpacity}`);
  assert.ok(b.strokeOpacity < 1 && b.strokeOpacity > 0, `b mid partial, got ${b.strokeOpacity}`);
});

test("crossFade: sequential overlap=0 staggers the two fades", () => {
  const a = new Circle();
  const b = new Circle();
  const g = crossFade(a, b, { overlap: 0, rateFunc: linear });
  g.begin();

  // With overlap=0, outgoing window is [0,0.5], incoming [0.5,1].
  // At alpha 0.25 a is mid-fade-out but b hasn't started.
  g.interpolate(0.25);
  assert.ok(a.strokeOpacity < 1, `a already fading, got ${a.strokeOpacity}`);
  assert.ok(b.strokeOpacity < 0.01, `b not yet started, got ${b.strokeOpacity}`);

  // At alpha 0.75 a is fully gone and b is fading in.
  g.interpolate(0.75);
  assert.ok(a.strokeOpacity < 0.01, `a gone, got ${a.strokeOpacity}`);
  assert.ok(b.strokeOpacity > 0.01, `b fading in, got ${b.strokeOpacity}`);
});

test("slide: b moves from an offset toward its home target", () => {
  const a = new Circle();
  const b = new Circle(); // home at origin
  const home = b.getCenter();

  const g = slide(a, b, { direction: [4, 0, 0], overlap: 1, rateFunc: linear });
  g.begin();

  // At start, b is offset by -direction (to the left).
  g.interpolate(0);
  const startX = b.getCenter()[0];
  assert.ok(startX < home[0] - 1, `b starts left of home, got x=${startX}`);

  // At end, b has slid to its home.
  g.interpolate(1);
  const endX = b.getCenter()[0];
  assert.ok(Math.abs(endX - home[0]) < 0.01, `b ends at home, got x=${endX}`);

  // Midpoint is between start and home (monotone motion).
  g.interpolate(0.5);
  const midX = b.getCenter()[0];
  assert.ok(midX > startX && midX < endX, `b mid between (${startX} < ${midX} < ${endX})`);
});

test("slide: a moves out the opposite way (positive direction)", () => {
  const a = new Circle();
  const b = new Circle();
  const homeA = a.getCenter();

  const g = slide(a, b, { direction: [4, 0, 0], overlap: 1, rateFunc: linear });
  g.begin();

  g.interpolate(1);
  const endX = a.getCenter()[0];
  assert.ok(endX > homeA[0] + 1, `a slides right/out, got x=${endX}`);
});

test("wipe: b slides in while a fades and drifts out", () => {
  const a = new Circle();
  const b = new Circle();
  const homeB = b.getCenter();

  const g = wipe(a, b, { direction: [4, 0, 0], overlap: 1, rateFunc: linear });
  g.begin();

  g.interpolate(0);
  assert.ok(Math.abs(a.strokeOpacity - 1) < 0.01, `a starts opaque, got ${a.strokeOpacity}`);
  assert.ok(b.getCenter()[0] < homeB[0] - 1, `b starts offset left`);

  g.interpolate(1);
  assert.ok(a.strokeOpacity < 0.01, `a faded out, got ${a.strokeOpacity}`);
  assert.ok(Math.abs(b.getCenter()[0] - homeB[0]) < 0.01, `b arrives home, got ${b.getCenter()[0]}`);
});
