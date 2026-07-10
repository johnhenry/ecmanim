// Seeded noise primitives (src/core/noise.ts): determinism, range,
// continuity, fbm behavior — plus the wiggle() bit-compatibility contract
// (vectors captured from the pre-refactor implementation).

import { test } from "node:test";
import assert from "node:assert/strict";
import { valueNoise1D, simplex2D, simplex3D, fbm, fbm3, latticeValue1D } from "../src/core/noise.ts";
import { wiggle } from "../src/animation/expressions.ts";

test("wiggle regression vectors are BIT-IDENTICAL to the pre-refactor implementation", () => {
  // Captured by running the original seededNoise-based wiggle before
  // latticeValue1D was extracted. Any drift here silently re-times every
  // wiggle() animation ever rendered — do not "fix" these numbers.
  const vectors: Array<[number, number, number, number[]]> = [
    [1, 2, 0, [-0.4671415826305747, -0.4937521835824099, -0.8104267865419388, -0.15075432369485497, -0.8265687559376049, 0.4034970606322877]],
    [0.5, 3, 7, [0.39939074614085257, 0.3385767499703283, -0.14956261299084872, 0.030797858024016023, 0.1950270490850899, -0.0819025880855794]],
    [2, 1, 42, [-0.5838240040466189, -0.5597098191750784, 0.09849694697186351, 0.780817897990346, -1.0882216347833933, 0.16493227808410557]],
    [1, 5, 123456, [-0.29177029011771083, 0.7157675282036224, -0.08381530689075589, -0.3150958092883229, -0.4715637309430046, 0.11762801266956215]],
  ];
  const times = [0, 0.13, 0.5, 1.0, 2.37, 10.01];
  for (const [amp, freq, seed, expected] of vectors) {
    const w = wiggle(amp, freq, seed);
    times.forEach((t, k) => assert.equal(w(t), expected[k], `wiggle(${amp},${freq},${seed})(${t})`));
  }
});

test("valueNoise1D agrees with the wiggle lattice at integers and is seed-deterministic", () => {
  const n = valueNoise1D(9);
  for (const i of [0, 1, 5, -3, 100]) {
    assert.equal(n(i), latticeValue1D(9, i));
  }
  // Order-independence: sampling in a different order gives the same values.
  const a = valueNoise1D(9);
  const b = valueNoise1D(9);
  const xs = [2.7, 0.1, -5.5, 2.7, 8.9];
  const fwd = xs.map((x) => a(x));
  const rev = [...xs].reverse().map((x) => b(x)).reverse();
  assert.deepEqual(fwd, rev);
  // Different seed → different field.
  assert.notEqual(valueNoise1D(9)(2.7), valueNoise1D(10)(2.7));
});

test("simplex2D/3D: deterministic per seed, order-independent, in [-1, 1]", () => {
  const s2a = simplex2D(3);
  const s2b = simplex2D(3);
  const s3a = simplex3D(3);
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 500; i++) pts.push([Math.sin(i) * 20, Math.cos(i * 1.7) * 20]);
  // Sample b in reverse order — values must match a's forward pass exactly.
  const fwd = pts.map(([x, y]) => s2a(x, y));
  const rev = [...pts].reverse().map(([x, y]) => s2b(x, y)).reverse();
  assert.deepEqual(fwd, rev);
  for (const v of fwd) assert.ok(v >= -1 && v <= 1, `2D out of range: ${v}`);
  let spread2 = 0;
  for (const v of fwd) spread2 = Math.max(spread2, Math.abs(v));
  assert.ok(spread2 > 0.3, "2D field should actually vary");
  for (let i = 0; i < 200; i++) {
    const v = s3a(Math.sin(i) * 15, Math.cos(i) * 15, i * 0.31);
    assert.ok(v >= -1 && v <= 1, `3D out of range: ${v}`);
  }
  assert.notEqual(simplex2D(1)(4.2, 7.7), simplex2D(2)(4.2, 7.7));
});

test("noise fields are continuous (small step → small delta)", () => {
  const n1 = valueNoise1D(5);
  const s2 = simplex2D(5);
  const eps = 1e-4;
  for (const x of [0.3, 1.9, -2.6, 7.45]) {
    assert.ok(Math.abs(n1(x + eps) - n1(x)) < 0.01, `valueNoise1D jump at ${x}`);
    assert.ok(Math.abs(s2(x + eps, x * 1.3) - s2(x, x * 1.3)) < 0.01, `simplex2D jump at ${x}`);
  }
});

test("fbm: exact octave sum, normalized range, variance below the base field", () => {
  const base = simplex2D(11);
  const one = fbm(base, { octaves: 1 });
  const four = fbm(base, { octaves: 4 });
  // octaves:1 must be the base field itself (norm = 1).
  assert.equal(one(1.234, 5.678), base(1.234, 5.678));
  // The construction is a plain normalized octave sum — verify it exactly.
  const x = 0.37, y = 2.61;
  const manual =
    (base(x, y) + 0.5 * base(2 * x, 2 * y) + 0.25 * base(4 * x, 4 * y) + 0.125 * base(8 * x, 8 * y)) / 1.875;
  assert.ok(Math.abs(four(x, y) - manual) < 1e-12);
  // Averaging decorrelated octaves shrinks variance: Var(fbm) < Var(base).
  const variance = (f: (x: number, y: number) => number): number => {
    let sum = 0, sq = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const v = f(Math.sin(i * 12.9898) * 43.75, Math.cos(i * 78.233) * 43.75);
      sum += v; sq += v * v;
    }
    const mean = sum / N;
    return sq / N - mean * mean;
  };
  assert.ok(variance(four) < variance(one), "normalized fbm should have lower variance than its base noise");
  for (let i = 0; i < 300; i++) {
    const v = four(i * 0.13, i * 0.07);
    assert.ok(v >= -1 && v <= 1, `fbm out of range: ${v}`);
  }
});

test("fbm3 sums 3D octaves deterministically", () => {
  const f = fbm3(simplex3D(21), { octaves: 3 });
  const g = fbm3(simplex3D(21), { octaves: 3 });
  assert.equal(f(0.4, 1.1, 2.2), g(0.4, 1.1, 2.2));
  assert.ok(Math.abs(f(0.4, 1.1, 2.2)) <= 1);
});
