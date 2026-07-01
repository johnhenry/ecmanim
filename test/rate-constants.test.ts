import { test } from "node:test";
import assert from "node:assert/strict";
import {
  smooth,
  squishRateFunc,
  runningStart,
  easeInOutBounce,
  easeInOutBack,
  easeInOutElastic,
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

test("constants have expected values", () => {
  assert.equal(SMALL_BUFF, 0.1);
  assert.equal(FRAME_HEIGHT, 8);
  assert.deepEqual(X_AXIS, [1, 0, 0]);
  assert.equal(LineJointType.ROUND, "round");
  assert.ok(QUALITIES.production);
  assert.equal(QUALITIES.production.fps, 60);
});
