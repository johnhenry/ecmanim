import { test } from "node:test";
import assert from "node:assert/strict";
import { Easing } from "../src/animation/easing.ts";

const close = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ~= ${b}`);

const samples = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];

test("in is identity over the base function", () => {
  const f = (t: number) => t * t * 0.7 + t * 0.3;
  for (const t of samples) {
    assert.equal(Easing.in(f)(t), f(t));
  }
});

test("out mirrors the base function", () => {
  const f = Easing.quad;
  for (const t of samples) {
    close(Easing.out(f)(t), 1 - f(1 - t));
  }
});

test("inOut endpoints and midpoint for quad", () => {
  const io = Easing.inOut(Easing.quad);
  close(io(0), 0);
  close(io(1), 1);
  close(io(0.5), 0.5);
});

test("inOut is continuous & monotonic for quad", () => {
  const io = Easing.inOut(Easing.quad);
  let prev = -Infinity;
  for (let t = 0; t <= 1.0000001; t += 0.05) {
    const v = io(t);
    assert.ok(v >= prev - 1e-12, `monotonic at t=${t}: ${v} < ${prev}`);
    prev = v;
  }
});

test("bezier(0,0,1,1) is linear (y ~= x)", () => {
  const b = Easing.bezier(0, 0, 1, 1);
  for (const t of samples) {
    close(b(t), t, 1e-6);
  }
});

test("bezier endpoints are 0 and 1", () => {
  const b = Easing.bezier(0.42, 0, 0.58, 1);
  close(b(0), 0);
  close(b(1), 1);
});

test("ease-in-out bezier is monotonic and ~0.5 at t=0.5", () => {
  const b = Easing.bezier(0.42, 0, 0.58, 1);
  let prev = -Infinity;
  for (let t = 0; t <= 1.0000001; t += 0.02) {
    const v = b(t);
    assert.ok(v >= prev - 1e-12, `monotonic at t=${t}: ${v} < ${prev}`);
    assert.ok(v >= -1e-9 && v <= 1 + 1e-9, `in-range at t=${t}: ${v}`);
    prev = v;
  }
  // Symmetric ease-in-out passes through 0.5 at its midpoint.
  close(b(0.5), 0.5, 1e-6);
});

test("base curves map 0 -> 0 and 1 -> 1", () => {
  const curves: [string, (t: number) => number][] = [
    ["linear", Easing.linear],
    ["quad", Easing.quad],
    ["cubic", Easing.cubic],
    ["poly(4)", Easing.poly(4)],
    ["sin", Easing.sin],
    ["circle", Easing.circle],
  ];
  for (const [name, f] of curves) {
    close(f(0), 0, 1e-12);
    close(f(1), 1, 1e-12);
    assert.ok(!Number.isNaN(f(0)) && !Number.isNaN(f(1)), `${name} produced NaN`);
  }
  // exp is a standard ease-in that hits 1 at t=1 but is ~0 (not exactly 0) at t=0.
  close(Easing.exp(1), 1, 1e-12);
  assert.ok(Math.abs(Easing.exp(0)) < 1e-2, "exp(0) should be near 0");
});
