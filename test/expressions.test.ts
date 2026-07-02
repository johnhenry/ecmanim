import { test } from "node:test";
import assert from "node:assert/strict";
import { mulberry32, wiggle, remap, ramp, valueAtTime, compose } from "../src/animation/expressions.ts";

test("mulberry32 is deterministic and seed-sensitive", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
  const c = mulberry32(43);
  assert.notEqual(c(), seqA[0]);
});

test("wiggle is deterministic and ORDER-INDEPENDENT (pure of t)", () => {
  const w = wiggle(1, 2, 7);
  // Sample in two different orders; values at the same t must match.
  const forward = [0.1, 0.5, 0.9, 1.3].map((t) => w(t));
  const w2 = wiggle(1, 2, 7);
  const backward = [1.3, 0.9, 0.5, 0.1].map((t) => w2(t)).reverse();
  assert.deepEqual(forward, backward);
});

test("wiggle stays within amplitude and is roughly centered", () => {
  const amp = 0.4;
  const w = wiggle(amp, 3, 1);
  let sum = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const v = w(i * 0.05);
    assert.ok(Math.abs(v) <= amp + 1e-9, `|${v}| <= ${amp}`);
    sum += v;
  }
  assert.ok(Math.abs(sum / N) < 0.1, "mean near 0");
});

test("wiggle with different seeds differs", () => {
  assert.notEqual(wiggle(1, 2, 1)(0.37), wiggle(1, 2, 2)(0.37));
});

test("remap maps endpoints/midpoint, clamps, and eases", () => {
  const r = remap(0, 10, 100, 200);
  assert.equal(r(0), 100);
  assert.equal(r(10), 200);
  assert.equal(r(5), 150);
  assert.equal(r(-5), 100, "clamps below");
  assert.equal(r(999), 200, "clamps above");
  const eased = remap(0, 1, 0, 1, (t) => t * t);
  assert.ok(Math.abs(eased(0.5) - 0.25) < 1e-9);
});

test("ramp endpoints + clamp + easing", () => {
  const r = ramp(2, 6);
  assert.equal(r(0), 2);
  assert.equal(r(1), 6);
  assert.equal(r(0.5), 4);
  assert.equal(r(-1), 2);
  assert.equal(r(2), 6);
});

test("compose applies left→right, valueAtTime samples", () => {
  const f = compose((x) => x + 1, (x) => x * 3);
  assert.equal(f(2), 9); // (2+1)*3
  assert.equal(valueAtTime((t) => t * t, 4), 16);
});
