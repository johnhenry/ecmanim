import { test } from "node:test";
import assert from "node:assert/strict";
import {
  smooth,
  squishRateFunc,
  runningStart,
  easeInOutBounce,
  easeInBack, easeOutBack, easeInOutBack,
  easeInElastic, easeOutElastic, easeInOutElastic,
  easeInBackFactory, easeOutBackFactory, easeInOutBackFactory,
  easeInElasticFactory, easeOutElasticFactory, easeInOutElasticFactory,
  running,
  easeInOutQuart,
  easeInOutQuint,
  easeInOutExpo,
  easeInOutCirc,
} from "../src/animation/rate_functions.ts";
import {
  SMALL_BUFF,
  FRAME_HEIGHT,
  X_AXIS,
  LineJointType,
  QUALITIES,
} from "../src/core/constants.ts";
// Side-effect import: registerBuiltins() (triggered by importing index.ts)
// seeds registry.rateFunctionFactories with "backOut"/"elasticOut"/etc, which
// the running("backOut:2")-style tests below need.
import "../src/index.ts";

const families = {
  easeInOutBounce,
  easeInOutBack,
  easeInOutElastic,
  easeInOutQuart,
  easeInOutQuint,
  easeInOutExpo,
  easeInOutCirc,
};

test("ease families hit endpoints and stay in-range at midpoint", () => {
  for (const [name, fn] of Object.entries(families)) {
    assert.ok(Math.abs(fn(0) - 0) < 1e-9, `${name}(0)=0`);
    assert.ok(Math.abs(fn(1) - 1) < 1e-9, `${name}(1)=1`);
    const mid = fn(0.5);
    assert.ok(mid >= 0 && mid <= 1, `${name}(0.5) in [0,1] (got ${mid})`);
  }
});

test("squishRateFunc(smooth, 0.25, 0.75)(0.5) ~= smooth(0.5)", () => {
  const squished = squishRateFunc(smooth, 0.25, 0.75);
  assert.ok(Math.abs(squished(0.5) - smooth(0.5)) < 1e-9);
});

test("runningStart dips below 0 then returns to 1", () => {
  const early = runningStart(0.2);
  assert.ok(early < 0, `expected dip below 0, got ${early}`);
  assert.ok(Math.abs(runningStart(0) - 0) < 1e-9);
  assert.ok(Math.abs(runningStart(1) - 1) < 1e-9);
});

// Regression lock: capture today's exact hardcoded-constant output before
// trusting the parameterized factories' default-argument path collapses to
// the same thing (verified once already via a git-snapshot diff when this
// was implemented; this test keeps that guarantee enforced going forward).
test("back/elastic factories at default args are byte-identical to the plain exports", () => {
  for (const t of [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1]) {
    assert.equal(easeInBackFactory()(t), easeInBack(t));
    assert.equal(easeOutBackFactory()(t), easeOutBack(t));
    assert.equal(easeInOutBackFactory()(t), easeInOutBack(t));
    assert.equal(easeInElasticFactory()(t), easeInElastic(t));
    assert.equal(easeOutElasticFactory()(t), easeOutElastic(t));
    assert.equal(easeInOutElasticFactory()(t), easeInOutElastic(t));
  }
});

test("back factories with a custom overshoot diverge from the default in the expected direction", () => {
  const bigOvershoot = easeOutBackFactory(4)(0.9);
  const defaultOvershoot = easeOutBack(0.9);
  assert.notEqual(bigOvershoot, defaultOvershoot);
  // A larger overshoot constant should push the curve further past 1 at some
  // point in [0,1] than the default -- sample the max value across the range.
  let maxDefault = -Infinity, maxBig = -Infinity;
  const big = easeOutBackFactory(4);
  for (let t = 0; t <= 1; t += 0.01) {
    maxDefault = Math.max(maxDefault, easeOutBack(t));
    maxBig = Math.max(maxBig, big(t));
  }
  assert.ok(maxBig > maxDefault, `larger overshoot (${maxBig}) should overshoot further than default (${maxDefault})`);
});

test("elastic factories with custom amplitude/period diverge from the default", () => {
  const custom = easeOutElasticFactory(2, 0.5)(0.3);
  const def = easeOutElastic(0.3);
  assert.notEqual(custom, def);
  // Endpoints must still hold regardless of parameters.
  const fn = easeOutElasticFactory(2, 0.5);
  assert.equal(fn(0), 0);
  assert.equal(fn(1), 1);
});

test('running("backOut:2") / running("elasticOut:1,0.3") resolve via the registered factories', () => {
  const viaName = running("backOut:2");
  const direct = easeOutBackFactory(2);
  for (const t of [0, 0.3, 0.6, 0.9, 1]) {
    assert.ok(Math.abs(viaName(t) - direct(t)) < 1e-9);
  }
  // "1,0.3" are elastic's own defaults, so this should match the plain export.
  const viaNameDefault = running("elasticOut:1,0.3");
  for (const t of [0, 0.3, 0.6, 0.9, 1]) {
    assert.ok(Math.abs(viaNameDefault(t) - easeOutElastic(t)) < 1e-9);
  }
});

test("constants have expected values", () => {
  assert.equal(SMALL_BUFF, 0.1);
  assert.equal(FRAME_HEIGHT, 8);
  assert.deepEqual(X_AXIS, [1, 0, 0]);
  assert.equal(LineJointType.ROUND, "round");
  assert.ok(QUALITIES.production);
  assert.equal(QUALITIES.production.fps, 60);
});
