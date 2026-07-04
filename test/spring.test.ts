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

test("velocity0 defaults to 0 and is byte-identical to the pre-existing formula across all three damping regimes", () => {
  // Regression lock captured before adding velocity0 support: underdamped,
  // critically damped, overdamped, and the library default all reproduce
  // exactly the same sequence of values now that velocity0 defaults to 0.
  const configs = [
    { mass: 1, damping: 4, stiffness: 200 },  // underdamped
    { mass: 1, damping: 20, stiffness: 100 }, // critically damped (zeta=1)
    { mass: 1, damping: 40, stiffness: 100 }, // overdamped
    { mass: 1, damping: 10, stiffness: 100 }, // library default
  ];
  const expected = [
    0, 0.5559628062578796, 1.4209335959502964, 1.096735091171, 1.2590570816176752, 0.9334806643916277, 1.0065011833432493,
    0, 0.20323661773702328, 0.49633172576650164, 0.8454126954952396, 0.9902431408563948, 0.9999767857793102, 0.9999999996389135,
    1.1102230246251565e-16, 0.14169660278670793, 0.31085297763722197, 0.5589778141061978, 0.8194636935225812, 0.9697467398588371, 0.998672191232598,
    0, 0.25366068574198586, 0.695891727212196, 1.15528559137785, 0.9789091756620557, 0.9999591053807041, 1.000002794114033,
  ];
  let i = 0;
  for (const config of configs) {
    for (const frame of [0, 5, 10, 20, 40, 80, 150]) {
      approx(spring({ frame, fps: 60, from: 0, to: 1, config }), expected[i], 1e-12);
      i++;
    }
  }
});

test("velocity0 > 0 pushes the spring above a pure-rest trajectory shortly after t=0", () => {
  const config = { mass: 1, damping: 10, stiffness: 100 };
  const fps = 60;
  const atRest = spring({ frame: 3, fps, config });
  const withVelocity = spring({ frame: 3, fps, config, velocity0: 5 });
  assert.ok(withVelocity > atRest, `expected velocity0>0 to move faster, got ${withVelocity} <= ${atRest}`);
});

test("velocity0 < 0 (opposing the target) pulls the spring below a pure-rest trajectory shortly after t=0", () => {
  const config = { mass: 1, damping: 10, stiffness: 100 };
  const fps = 60;
  const atRest = spring({ frame: 3, fps, config });
  const withVelocity = spring({ frame: 3, fps, config, velocity0: -5 });
  assert.ok(withVelocity < atRest, `expected velocity0<0 to move slower/backward, got ${withVelocity} >= ${atRest}`);
});

test("momentum pattern: from===to with nonzero velocity0 drifts away then decays back to rest", () => {
  const config = { mass: 1, damping: 8, stiffness: 120 };
  const fps = 60;
  const current = 10; // an arbitrary "current position" (e.g. a camera offset)
  const released = 3; // release velocity (units/sec)

  const v0 = spring({ frame: 0, fps, from: current, to: current, config, velocity0: released });
  assert.ok(Math.abs(v0 - current) < 1e-9, `frame 0 must start exactly at the current value, got ${v0}`);

  const shortlyAfter = spring({ frame: 5, fps, from: current, to: current, config, velocity0: released });
  assert.ok(shortlyAfter > current, `expected the fling to move past the current value, got ${shortlyAfter}`);

  const settled = spring({ frame: 600, fps, from: current, to: current, config, velocity0: released });
  assert.ok(Math.abs(settled - current) < 1e-3, `expected it to decay back to ${current}, got ${settled}`);
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
