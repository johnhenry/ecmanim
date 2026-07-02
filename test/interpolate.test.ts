import { test } from "node:test";
import assert from "node:assert/strict";
import { interpolate } from "../src/animation/interpolate.ts";

const close = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

test("basic 2-point mapping", () => {
  close(interpolate(0, [0, 1], [0, 100]), 0);
  close(interpolate(1, [0, 1], [0, 100]), 100);
  close(interpolate(0.5, [0, 1], [0, 100]), 50);
  close(interpolate(0.25, [0, 1], [0, 100]), 25);
});

test("2-point mapping with non-zero output range", () => {
  close(interpolate(0.5, [0, 1], [10, 20]), 15);
  close(interpolate(5, [0, 10], [-100, 100]), 0);
});

test("multi-segment mapping (3+ points)", () => {
  const input = [0, 1, 2];
  const output = [0, 100, 0];
  close(interpolate(0, input, output), 0);
  close(interpolate(0.5, input, output), 50);
  close(interpolate(1, input, output), 100);
  close(interpolate(1.5, input, output), 50);
  close(interpolate(2, input, output), 0);
});

test("multi-segment with uneven spacing", () => {
  const input = [0, 2, 10];
  const output = [0, 20, 100];
  // First segment slope = 10/unit
  close(interpolate(1, input, output), 10);
  // Second segment slope = 80/8 = 10/unit
  close(interpolate(6, input, output), 60);
});

test("easing applied to local segment parameter", () => {
  const quad = (t: number) => t * t;
  // Local t at midpoint = 0.5, eased to 0.25 -> output 25.
  close(interpolate(0.5, [0, 1], [0, 100], { easing: quad }), 25);
  // Endpoints unaffected by easing that fixes 0 and 1.
  close(interpolate(0, [0, 1], [0, 100], { easing: quad }), 0);
  close(interpolate(1, [0, 1], [0, 100], { easing: quad }), 100);
});

test("easing applied per-segment in multi-segment range", () => {
  const quad = (t: number) => t * t;
  const input = [0, 1, 2];
  const output = [0, 10, 20];
  // Second segment: input 1.5 -> localT 0.5 -> eased 0.25 -> lerp(10,20,0.25)=12.5
  close(interpolate(1.5, input, output, { easing: quad }), 12.5);
});

// ---- Extrapolation: LEFT (input below inputRange[0]) ----

test("extrapolateLeft: extend (default)", () => {
  // Slope of first segment is 100; extend below 0.
  close(interpolate(-0.5, [0, 1], [0, 100]), -50);
});

test("extrapolateLeft: clamp", () => {
  close(
    interpolate(-5, [0, 1], [10, 100], { extrapolateLeft: "clamp" }),
    10,
  );
});

test("extrapolateLeft: identity", () => {
  close(
    interpolate(-5, [0, 1], [10, 100], { extrapolateLeft: "identity" }),
    -5,
  );
});

test("extrapolateLeft: wrap", () => {
  // range = 1; input -0.25 wraps to 0.75 -> output 75.
  close(
    interpolate(-0.25, [0, 1], [0, 100], { extrapolateLeft: "wrap" }),
    75,
  );
});

// ---- Extrapolation: RIGHT (input above inputRange[last]) ----

test("extrapolateRight: extend (default)", () => {
  // Slope of last segment is 100; extend above 1.
  close(interpolate(1.5, [0, 1], [0, 100]), 150);
});

test("extrapolateRight: clamp", () => {
  close(
    interpolate(5, [0, 1], [10, 100], { extrapolateRight: "clamp" }),
    100,
  );
});

test("extrapolateRight: identity", () => {
  close(
    interpolate(5, [0, 1], [10, 100], { extrapolateRight: "identity" }),
    5,
  );
});

test("extrapolateRight: wrap", () => {
  // range = 1; input 1.25 wraps to 0.25 -> output 25.
  close(
    interpolate(1.25, [0, 1], [0, 100], { extrapolateRight: "wrap" }),
    25,
  );
});

test("wrap works with a non-unit range", () => {
  // range = 10; input 12 wraps to 2 -> output 20.
  close(
    interpolate(12, [0, 10], [0, 100], { extrapolateRight: "wrap" }),
    20,
  );
  // input -3 wraps to 7 -> output 70.
  close(
    interpolate(-3, [0, 10], [0, 100], { extrapolateLeft: "wrap" }),
    70,
  );
});

// ---- Error cases ----

test("throws on length mismatch", () => {
  assert.throws(
    () => interpolate(0.5, [0, 1], [0, 100, 200]),
    /same length/,
  );
});

test("throws when fewer than 2 elements", () => {
  assert.throws(() => interpolate(0.5, [0], [0]), /at least 2/);
});

test("throws on non-monotonic (non-increasing) input range", () => {
  assert.throws(
    () => interpolate(0.5, [0, 1, 1], [0, 50, 100]),
    /strictly monotonically increasing/,
  );
  assert.throws(
    () => interpolate(0.5, [0, 2, 1], [0, 50, 100]),
    /strictly monotonically increasing/,
  );
  assert.throws(
    () => interpolate(0.5, [1, 0], [0, 100]),
    /strictly monotonically increasing/,
  );
});
