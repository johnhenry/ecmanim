import { test } from "node:test";
import assert from "node:assert/strict";
import { spring, measureSpring, springRate } from "../src/animation/spring.ts";

const approx = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b} (eps ${eps})`);

test("spring(frame=0) ≈ from", () => {
  approx(spring({ frame: 0, fps: 60 }), 0);
  approx(spring({ frame: 0, fps: 60, from: 5, to: 10 }), 5);
});

test("spring at large frame ≈ to", () => {
  approx(spring({ frame: 600, fps: 60 }), 1, 1e-3);
  approx(spring({ frame: 600, fps: 60, from: 5, to: 10 }), 10, 1e-3);
});

test("underdamped spring overshoots past `to`", () => {
  // Low damping => underdamped => overshoot.
  const config = { mass: 1, damping: 4, stiffness: 200 };
  const fps = 60;
  let maxVal = -Infinity;
  for (let frame = 0; frame <= 120; frame++) {
    maxVal = Math.max(maxVal, spring({ frame, fps, config }));
  }
  assert.ok(maxVal > 1, `expected overshoot past 1, got max ${maxVal}`);
});

test("overshootClamping prevents passing `to`", () => {
  const config = { mass: 1, damping: 4, stiffness: 200, overshootClamping: true };
  const fps = 60;
  for (let frame = 0; frame <= 120; frame++) {
    const v = spring({ frame, fps, config });
    assert.ok(v <= 1 + 1e-12, `clamped value ${v} exceeded to=1 at frame ${frame}`);
    assert.ok(v >= 0 - 1e-12, `clamped value ${v} below from=0 at frame ${frame}`);
  }
});

test("measureSpring returns a positive finite settle frame within threshold", () => {
  const fps = 60;
  const threshold = 0.005;
  const config = { mass: 1, damping: 10, stiffness: 100 };
  const n = measureSpring({ fps, config, threshold });
  assert.ok(Number.isFinite(n), "settle frame count must be finite");
  assert.ok(n > 0, `settle frame count must be positive, got ${n}`);
  const v = spring({ frame: n, fps, config });
  assert.ok(
    Math.abs(v - 1) < threshold + 1e-9,
    `value at settle frame ${n} = ${v}, not within ${threshold} of to=1`,
  );
});

test("measureSpring is capped at fps*10", () => {
  // Very high damping / low stiffness => slow, but should still cap.
  const fps = 30;
  const n = measureSpring({ fps, config: { damping: 100000, stiffness: 1 } });
  assert.ok(n <= fps * 10, `expected cap ${fps * 10}, got ${n}`);
  assert.ok(n > 0);
});

test("springRate endpoints: rate(0) ≈ 0 and rate(1) ≈ 1", () => {
  const config = { mass: 1, damping: 10, stiffness: 100 };
  const rate = springRate(config);
  approx(rate(0), 0, 1e-6);
  approx(rate(1), 1, 1e-6);
});

test("springRate is a usable RateFunc across the unit interval", () => {
  const rate = springRate({ mass: 1, damping: 6, stiffness: 180 });
  for (let i = 0; i <= 10; i++) {
    const v = rate(i / 10);
    assert.ok(Number.isFinite(v), `rate(${i / 10}) not finite: ${v}`);
  }
});

test("durationInFrames rescales settle to the requested frame", () => {
  const fps = 60;
  const config = { mass: 1, damping: 10, stiffness: 100 };
  const duration = 45;
  // At the requested duration, value should be close to `to`.
  const v = spring({ frame: duration, fps, config, durationInFrames: duration });
  approx(v, 1, 0.01);
  // And at frame 0 still starts at from.
  approx(spring({ frame: 0, fps, config, durationInFrames: duration }), 0);
});
