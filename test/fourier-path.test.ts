import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dftOfPath,
  samplePath,
  FourierPath,
} from "../src/mobject/fourier_path.ts";
import type { FourierCoefficient } from "../src/mobject/fourier_path.ts";
import { Circle } from "../src/mobject/geometry.ts";
import { TracedPath } from "../src/animation/changing.ts";

const TAU = 2 * Math.PI;

// Analytic sum of epicycles at time t.
function reconstruct(coeffs: FourierCoefficient[], t: number): [number, number] {
  let x = 0;
  let y = 0;
  for (const { freq, amp, phase } of coeffs) {
    const a = phase + TAU * freq * t;
    x += amp * Math.cos(a);
    y += amp * Math.sin(a);
  }
  return [x, y];
}

test("dftOfPath of a pure unit circle has a single dominant freq-1 coefficient", () => {
  const N = 64;
  const pts: Array<[number, number]> = [];
  for (let n = 0; n < N; n++) {
    pts.push([Math.cos((TAU * n) / N), Math.sin((TAU * n) / N)]);
  }
  const coeffs = dftOfPath(pts);
  assert.equal(coeffs.length, N);
  assert.equal(coeffs[0].freq, 1);
  assert.ok(Math.abs(coeffs[0].amp - 1) < 1e-9, `amp ${coeffs[0].amp}`);
  assert.ok(Math.abs(coeffs[0].phase) < 1e-9, `phase ${coeffs[0].phase}`);
  for (const c of coeffs.slice(1)) {
    assert.ok(c.amp < 1e-9, `freq ${c.freq} amp ${c.amp}`);
  }
});

test("dftOfPath sorts by descending amplitude and truncates to nVectors", () => {
  const N = 32;
  const pts: Array<[number, number]> = [];
  for (let n = 0; n < N; n++) {
    const t = n / N;
    const [x, y] = reconstruct(
      [
        { freq: 1, amp: 1, phase: 0 },
        { freq: 3, amp: 0.5, phase: 0 },
      ],
      t,
    );
    pts.push([x, y]);
  }
  const coeffs = dftOfPath(pts, 2);
  assert.equal(coeffs.length, 2);
  assert.equal(coeffs[0].freq, 1);
  assert.equal(coeffs[1].freq, 3);
  assert.ok(coeffs[0].amp >= coeffs[1].amp);
});

test("dftOfPath of a known 2-term curve reconstructs the original samples", () => {
  const terms: FourierCoefficient[] = [
    { freq: 2, amp: 0.7, phase: 0.4 },
    { freq: -3, amp: 0.3, phase: -1.1 },
  ];
  const N = 64;
  const pts: Array<[number, number]> = [];
  for (let n = 0; n < N; n++) pts.push(reconstruct(terms, n / N));

  const coeffs = dftOfPath(pts);
  // The two real terms dominate, in descending-amplitude order.
  assert.equal(coeffs[0].freq, 2);
  assert.ok(Math.abs(coeffs[0].amp - 0.7) < 1e-9);
  assert.ok(Math.abs(coeffs[0].phase - 0.4) < 1e-9);
  assert.equal(coeffs[1].freq, -3);
  assert.ok(Math.abs(coeffs[1].amp - 0.3) < 1e-9);
  assert.ok(Math.abs(coeffs[1].phase - -1.1) < 1e-9);

  // Summing the epicycles at several t (not only sample points — the signal
  // is band-limited) matches the original curve.
  for (const t of [0, 0.13, 0.37, 0.5, 0.77]) {
    const [rx, ry] = reconstruct(coeffs, t);
    const [ex, ey] = reconstruct(terms, t);
    assert.ok(Math.abs(rx - ex) < 1e-6, `x at t=${t}: ${rx} vs ${ex}`);
    assert.ok(Math.abs(ry - ey) < 1e-6, `y at t=${t}: ${ry} vs ${ey}`);
  }
});

test("samplePath on a Circle returns n points on the circle radius", () => {
  const circle = new Circle({ radius: 1 });
  const n = 32;
  const pts = samplePath(circle, n);
  assert.equal(pts.length, n);
  for (const [x, y] of pts) {
    assert.ok(Math.abs(Math.hypot(x, y) - 1) < 1e-3, `r=${Math.hypot(x, y)}`);
  }
});

test("FourierPath chain tip at t=0 equals sum of amp*e^{i phase}", () => {
  const coefficients: FourierCoefficient[] = [
    { freq: 1, amp: 1, phase: 0.5 },
    { freq: -2, amp: 0.5, phase: 1.2 },
    { freq: 4, amp: 0.25, phase: -0.7 },
  ];
  const fp = new FourierPath({ coefficients });
  let re = 0;
  let im = 0;
  for (const { amp, phase } of coefficients) {
    re += amp * Math.cos(phase);
    im += amp * Math.sin(phase);
  }
  const tip = fp.tip;
  assert.ok(Math.abs(tip[0] - re) < 1e-9, `${tip[0]} vs ${re}`);
  assert.ok(Math.abs(tip[1] - im) < 1e-9, `${tip[1]} vs ${im}`);

  // The center offset shifts the tip rigidly.
  const fp2 = new FourierPath({ coefficients, center: [3, -2, 0] });
  assert.ok(Math.abs(fp2.tip[0] - (re + 3)) < 1e-9);
  assert.ok(Math.abs(fp2.tip[1] - (im - 2)) < 1e-9);
});

test("setTime is deterministic and scrub-safe", () => {
  const coefficients: FourierCoefficient[] = [
    { freq: 1, amp: 1, phase: 0.5 },
    { freq: -2, amp: 0.5, phase: 1.2 },
    { freq: 3, amp: 0.1, phase: 2.0 },
  ];
  const a = new FourierPath({ coefficients });
  const b = new FourierPath({ coefficients });
  a.setTime(0.37);
  b.setTime(0.37);
  assert.deepEqual(a.tip, b.tip);

  // Scrubbing: visiting other times and coming back reproduces the pose.
  const before = a.tip;
  a.setTime(0.9);
  a.setTime(0.01);
  a.setTime(0.37);
  assert.deepEqual(a.tip, before);
  // Geometry too, not just the tip.
  assert.deepEqual(
    a.vectors.map((v) => v.points),
    b.vectors.map((v) => v.points),
  );
});

test("FourierPath built from a path traces that path", () => {
  const circle = new Circle({ radius: 1.5 });
  const fp = new FourierPath({
    path: circle,
    nVectors: 8,
    samples: 64,
    showCircles: false,
  });
  assert.equal(fp.vectors.length, 8);
  assert.equal(fp.circles.length, 0);
  for (const t of [0, 0.25, 0.6, 0.9]) {
    fp.setTime(t);
    const [x, y] = fp.tip;
    assert.ok(Math.abs(Math.hypot(x, y) - 1.5) < 1e-2, `r=${Math.hypot(x, y)} at t=${t}`);
  }
});

test("showCircles builds one guide circle per vector", () => {
  const coefficients: FourierCoefficient[] = [
    { freq: 1, amp: 1, phase: 0 },
    { freq: 2, amp: 0.5, phase: 0 },
  ];
  const fp = new FourierPath({ coefficients });
  assert.equal(fp.vectors.length, 2);
  assert.equal(fp.circles.length, 2);
  assert.ok(Math.abs(fp.circles[0].getWidth() - 2) < 1e-2); // radius = amp
});

test("attachTo advances the clock by dt*speed and composes with TracedPath", () => {
  const coefficients: FourierCoefficient[] = [
    { freq: 1, amp: 1, phase: 0 },
    { freq: -2, amp: 0.4, phase: 0.3 },
  ];
  const added: unknown[] = [];
  const fakeScene = { add: (...mobs: unknown[]) => added.push(...mobs) };
  const fp = new FourierPath({ coefficients, speed: 0.5 });
  fp.attachTo(fakeScene);
  assert.ok(added.includes(fp));

  const trail = new TracedPath(() => fp.tip);
  trail.update(0); // records the t=0 tip

  // dt=0.2 at speed 0.5 → t = 0.1.
  fp.update(0.2);
  const twin = new FourierPath({ coefficients }).setTime(0.1);
  assert.deepEqual(fp.tip, twin.tip);

  trail.update(0.2);
  assert.ok(trail.points.length > 0);
  const last = trail.points[trail.points.length - 1];
  assert.ok(Math.abs(last[0] - fp.tip[0]) < 1e-9);
  assert.ok(Math.abs(last[1] - fp.tip[1]) < 1e-9);
});
