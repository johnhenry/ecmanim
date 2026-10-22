import { test } from "node:test";
import assert from "node:assert/strict";

import { KeyframeTrack } from "../src/animation/keyframe_track.ts";
import type { Keyframe } from "../src/animation/keyframe_track.ts";
import { running, linear, easeInCubic, easeOutCubic, smoothstep } from "../src/animation/rate_functions.ts";
import * as V from "../src/core/math/vector.ts";
// Side-effect import: seeds the registry (string eases, "bezier:" factory).
import "../src/index.ts";

// Frozen copy of the pre-#65 valueAt() algorithm. The "no new fields" path of
// the real implementation must reproduce it exactly (Object.is, not approx).
function legacyValueAt<T>(kfs: Keyframe<T>[], t: number, interp: (a: T, b: T, x: number) => T): T {
  if (kfs.length === 1 || t <= kfs[0].t) return kfs[0].value;
  if (t >= kfs[kfs.length - 1].t) return kfs[kfs.length - 1].value;
  let i = 0;
  while (i < kfs.length - 1 && kfs[i + 1].t < t) i++;
  const k0 = kfs[i];
  const k1 = kfs[i + 1];
  const span = k1.t - k0.t || 1e-9;
  const rawAlpha = Math.max(0, Math.min(1, (t - k0.t) / span));
  const ease = k1.ease != null ? running(k1.ease) : linear;
  return interp(k0.value, k1.value, ease(rawAlpha));
}

const vlerp = (a: any, b: any, x: number) => V.lerp(a, b, x);
const samples = (n: number, lo: number, hi: number) =>
  Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);

test("byte-identical valueAt when no new fields are used (numbers, vectors, ease kinds)", () => {
  const fn = (x: number) => x * x;
  const numeric: Keyframe<number>[] = [
    { t: 0, value: 1 },
    { t: 0.7, value: 4, ease: "easeInOutSine" },
    { t: 1.3, value: -2, ease: fn },
    { t: 1.3, value: 9 }, // zero-length interval
    { t: 2.9, value: 3, ease: "bezier:0.42,0,0.58,1" },
    { t: 4, value: 3, ease: "easeInCubic" },
  ];
  const track = new KeyframeTrack(numeric);
  for (const t of samples(400, -0.5, 4.5)) {
    assert.ok(Object.is(track.valueAt(t), legacyValueAt(numeric, t, vlerp)), `t=${t}`);
  }
  const vec: Keyframe<number[]>[] = [
    { t: 0, value: [0, 1] },
    { t: 1, value: [5, -3], ease: "smooth" },
    { t: 3, value: [2, 2], ease: "unknownNameFallsBackToSmooth" },
  ];
  const vtrack = new KeyframeTrack(vec);
  for (const t of samples(200, -1, 4)) {
    assert.deepEqual(vtrack.valueAt(t), legacyValueAt(vec, t, vlerp), `t=${t}`);
  }
  // Pinned literals (independent of the reference copy above).
  const two = new KeyframeTrack([{ t: 0, value: 0 }, { t: 1, value: 10 }]);
  assert.equal(two.valueAt(0.25), 2.5);
  assert.equal(two.valueAt(0.5), 5);
});

test("explicit easeMode: 'incoming' is identical to the default", () => {
  const kfs: Keyframe<number>[] = [
    { t: 0, value: 0 },
    { t: 1, value: 3, ease: "easeInCubic" },
    { t: 2, value: 1, ease: "easeOutCubic" },
  ];
  const a = new KeyframeTrack(kfs);
  const b = new KeyframeTrack(kfs, { easeMode: "incoming" });
  for (const t of samples(100, 0, 2)) assert.ok(Object.is(a.valueAt(t), b.valueAt(t)));
});

test("easeOut on k0 governs its segment and beats k1.ease", () => {
  const track = new KeyframeTrack<number>([
    { t: 0, value: 0, easeOut: "easeInCubic" },
    { t: 2, value: 10, ease: "easeOutCubic" },
  ]);
  assert.ok(Math.abs(track.valueAt(0.5) - 10 * easeInCubic(0.25)) < 1e-12);
  assert.ok(Math.abs(track.valueAt(1.5) - 10 * easeInCubic(0.75)) < 1e-12);
});

test("easeOut accepts RateFunc, bezier strings, linear, easeIn/easeOut aliases", () => {
  const mk = (easeOut: any) =>
    new KeyframeTrack<number>([{ t: 0, value: 0, easeOut }, { t: 1, value: 1 }]);
  assert.equal(mk((x: number) => x * x).valueAt(0.5), 0.25);
  assert.equal(mk("linear").valueAt(0.3), 0.3);
  assert.ok(Math.abs(mk("easeIn").valueAt(0.5) - easeInCubic(0.5)) < 1e-12);
  assert.ok(Math.abs(mk("easeOut").valueAt(0.5) - easeOutCubic(0.5)) < 1e-12);
  const bz = running("bezier:0.1,0.9,0.3,1");
  assert.ok(Math.abs(mk("bezier:0.1,0.9,0.3,1").valueAt(0.4) - bz(0.4)) < 1e-12);
});

test("hold: step, value of k0 until the next key's exact time", () => {
  const track = new KeyframeTrack<number>([
    { t: 0, value: 1, easeOut: "hold" },
    { t: 1, value: 5 },
    { t: 2, value: 9 },
  ]);
  assert.equal(track.valueAt(0), 1);
  assert.equal(track.valueAt(0.999), 1);
  assert.equal(track.valueAt(1), 5);
  assert.equal(track.valueAt(1.5), 7); // next segment unaffected (linear)
  const vec = new KeyframeTrack<number[]>([
    { t: 0, value: [1, 2], easeOut: "hold" },
    { t: 1, value: [3, 4] },
  ]);
  assert.deepEqual(vec.valueAt(0.5), [1, 2]);
});

test("auto: two isolated keys use smoothstep", () => {
  const track = new KeyframeTrack<number>([
    { t: 0, value: 2, easeOut: "auto" },
    { t: 2, value: 6 },
  ]);
  for (const t of samples(20, 0, 2)) {
    assert.ok(Math.abs(track.valueAt(t) - (2 + 4 * smoothstep(t / 2))) < 1e-12);
  }
});

test("auto: continuous velocity across interior keys, rest at run ends", () => {
  const track = new KeyframeTrack<number>([
    { t: 0, value: 0, easeOut: "auto" },
    { t: 1, value: 1, easeOut: "auto" },
    { t: 3, value: 4, easeOut: "auto" },
    { t: 4, value: 5 },
  ]);
  const eps = 1e-5;
  const slope = (t: number) => (track.valueAt(t + eps) - track.valueAt(t - eps)) / (2 * eps);
  for (const k of [1, 3]) {
    assert.ok(Math.abs(slope(k - 1e-3) - slope(k + 1e-3)) < 5e-3, `velocity at key ${k}`);
    assert.ok(slope(k) > 0.1, "moves through interior keys");
  }
  assert.ok(Math.abs(slope(1e-4)) < 1e-2, "starts from rest");
  assert.ok(Math.abs(slope(4 - 1e-4)) < 1e-2, "ends at rest");
});

test("auto: flat spans and direction reversals have zero tangent, no overshoot", () => {
  const track = new KeyframeTrack<number>([
    { t: 0, value: 0, easeOut: "auto" },
    { t: 1, value: 5, easeOut: "auto" }, // reversal
    { t: 2, value: 0, easeOut: "auto" },
    { t: 3, value: 0, easeOut: "auto" }, // flat
    { t: 4, value: 3 },
  ]);
  const eps = 1e-6;
  const slope = (t: number) => (track.valueAt(t + eps) - track.valueAt(t - eps)) / (2 * eps);
  assert.ok(Math.abs(slope(1)) < 1e-4);
  assert.ok(Math.abs(slope(2.0)) < 1e-3);
  for (const t of samples(100, 2, 3)) assert.equal(track.valueAt(t), 0);
});

test("auto: monotone data never overshoots segment endpoints (randomised)", () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let trial = 0; trial < 50; trial++) {
    const n = 3 + Math.floor(rnd() * 6);
    const kfs: Keyframe<number>[] = [];
    let t = 0;
    for (let i = 0; i < n; i++) {
      t += 0.05 + rnd() * 3;
      kfs.push({ t, value: Math.round(rnd() * 20) - 10, easeOut: "auto" });
    }
    const track = new KeyframeTrack(kfs);
    for (let i = 0; i < n - 1; i++) {
      const lo = Math.min(kfs[i].value, kfs[i + 1].value) - 1e-12;
      const hi = Math.max(kfs[i].value, kfs[i + 1].value) + 1e-12;
      for (const s of samples(40, kfs[i].t, kfs[i + 1].t)) {
        const v = track.valueAt(s);
        assert.ok(v >= lo && v <= hi, `trial ${trial} seg ${i} t=${s} v=${v}`);
      }
    }
  }
});

test("auto: number[] is solved per component", () => {
  const kfs = [
    { t: 0, value: [0, 10], easeOut: "auto" },
    { t: 1, value: [4, 10], easeOut: "auto" },
    { t: 2, value: [4, 0] },
  ];
  const v = new KeyframeTrack<number[]>(kfs as any);
  const x = new KeyframeTrack<number>(kfs.map((k) => ({ ...k, value: k.value[0] })) as any);
  const y = new KeyframeTrack<number>(kfs.map((k) => ({ ...k, value: k.value[1] })) as any);
  for (const s of samples(30, 0, 2)) {
    assert.deepEqual(v.valueAt(s), [x.valueAt(s), y.valueAt(s)]);
  }
});

test("auto: a non-auto neighbour breaks tangent continuity (run edge rests)", () => {
  const track = new KeyframeTrack<number>([
    { t: 0, value: 0, easeOut: "linear" },
    { t: 1, value: 1, easeOut: "auto" },
    { t: 2, value: 3 },
  ]);
  const eps = 1e-6;
  const slope = (t: number) => (track.valueAt(t + eps) - track.valueAt(t - eps)) / (2 * eps);
  assert.ok(Math.abs(slope(1 + 1e-4)) < 1e-2, "auto segment starts at rest after a linear segment");
});

test("auto on a custom-typed track falls back to smoothstep alpha with the user interpolate", () => {
  const track = new KeyframeTrack<string>(
    [{ t: 0, value: "a", easeOut: "auto" }, { t: 2, value: "b" }],
    { interpolate: (_a, _b, alpha) => String(alpha) },
  );
  assert.equal(track.valueAt(1), String(smoothstep(0.5)));
  assert.equal(track.valueAt(0.5), String(smoothstep(0.25)));
});

test("easeMode 'outgoing': k0.ease (or easeOut) governs k0 -> k1", () => {
  const kfs: Keyframe<number>[] = [
    { t: 0, value: 0, ease: "easeInCubic" },
    { t: 1, value: 1, ease: "easeOutCubic" },
    { t: 2, value: 2 },
  ];
  const track = new KeyframeTrack(kfs, { easeMode: "outgoing" });
  // seg 0->1 uses k0.ease (easeInCubic); seg 1->2 uses k1.ease (easeOutCubic).
  assert.ok(Math.abs(track.valueAt(0.5) - easeInCubic(0.5)) < 1e-12);
  assert.ok(Math.abs(track.valueAt(1.5) - (1 + easeOutCubic(0.5))) < 1e-12);
  // easeOut beats ease in either mode.
  const t2 = new KeyframeTrack<number>(
    [{ t: 0, value: 0, ease: "easeInCubic", easeOut: "linear" }, { t: 1, value: 1 }],
    { easeMode: "outgoing" },
  );
  assert.equal(t2.valueAt(0.5), 0.5);
});

test("easeOut resolves live: mutating keyframes is reflected immediately", () => {
  const track = new KeyframeTrack<number>([{ t: 0, value: 0 }, { t: 1, value: 1 }]);
  assert.equal(track.valueAt(0.5), 0.5);
  track.keyframes[0].easeOut = "hold";
  assert.equal(track.valueAt(0.5), 0);
});
