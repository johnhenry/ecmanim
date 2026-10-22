// ParticleSystem additive options (#71): turbulence, blendMode, material.
// Defaults are proven byte-identical in particles-defaults.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ParticleSystem } from "../src/mobject/particles.ts";
import { simplex3D } from "../src/core/noise.ts";

const base = { seed: 5, rate: 20, emitterRadius: 0.3, gravity: -1, autoAdvance: false } as const;
const snap = (ps: ParticleSystem, t: number) => JSON.stringify(ps.sampleParticles(t).map((p) => [p.x, p.y, p.size, p.opacity, p.life]));

test("turbulence: unset or amplitude 0 leaves positions untouched", () => {
  const plain = new ParticleSystem({ ...base });
  const zero = new ParticleSystem({ ...base, turbulence: { amplitude: 0, frequency: 1 } });
  for (const t of [0.4, 1.7, 3]) assert.equal(snap(zero, t), snap(plain, t));
});

test("turbulence: displaces particles, closed-form (seek/shuffle safe)", () => {
  const mk = () => new ParticleSystem({ ...base, turbulence: { amplitude: 0.5, frequency: 1.3, seed: 9 } });
  const plain = new ParticleSystem({ ...base });
  const a = mk(), b = mk();
  assert.notEqual(snap(a, 1.5), snap(plain, 1.5));
  const times = [2.5, 0.3, 1.5, 0.9];
  const first = times.map((t) => snap(a, t));
  const rev = [...times].reverse().map((t) => snap(b, t)).reverse();
  assert.deepEqual(first, rev);
});

test("turbulence: displacement is zero at birth and bounded by 2*amplitude per axis", () => {
  const amp = 0.4;
  const plain = new ParticleSystem({ ...base, rate: 0 }).burst(1, 30);
  const turb = new ParticleSystem({ ...base, rate: 0, turbulence: { amplitude: amp, frequency: 2 } }).burst(1, 30);
  assert.equal(snap(turb, 1), snap(plain, 1));
  const p = plain.sampleParticles(2.2), q = turb.sampleParticles(2.2);
  assert.equal(p.length, q.length);
  let moved = 0;
  for (let i = 0; i < p.length; i++) {
    assert.ok(Math.abs(q[i].x - p[i].x) <= 2 * amp + 1e-9);
    assert.ok(Math.abs(q[i].y - p[i].y) <= 2 * amp + 1e-9);
    if (q[i].x !== p[i].x) moved++;
  }
  assert.ok(moved > 0);
});

test("turbulence: seed defaults to the system seed; different seeds differ", () => {
  const s = (turbSeed?: number, seed = 5) => new ParticleSystem({ ...base, seed, turbulence: { amplitude: 0.5, frequency: 1, seed: turbSeed } });
  assert.equal(snap(s(undefined), 1.5), snap(s(5), 1.5));
  assert.notEqual(snap(s(1), 1.5), snap(s(2), 1.5));
});

test("turbulence amplitude is included in the bounding box", () => {
  const plain = new ParticleSystem({ ...base });
  const turb = new ParticleSystem({ ...base, turbulence: { amplitude: 0.5, frequency: 1 } });
  assert.ok(turb.points[1][0] - plain.points[1][0] >= 2 * 0.5 - 1e-9);
  // every sampled particle stays inside the box
  const xs = turb.points.map((p) => p[0]), ys = turb.points.map((p) => p[1]);
  for (const t of [0.5, 1, 2, 4]) for (const p of turb.sampleParticles(t)) {
    assert.ok(p.x >= Math.min(...xs) && p.x <= Math.max(...xs) && p.y >= Math.min(...ys) && p.y <= Math.max(...ys));
  }
});

test("turbulence uses simplex3D of (spawn pos, age): known sample", () => {
  const n = simplex3D(11);
  const ps = new ParticleSystem({ seed: 1, rate: 0, turbulence: { amplitude: 1, frequency: 1, seed: 11 } }).burst(0, 1, { speed: 0 });
  const plain = new ParticleSystem({ seed: 1, rate: 0 }).burst(0, 1, { speed: 0 });
  const a = ps.sampleParticles(0.5)[0], b = plain.sampleParticles(0.5)[0];
  // spawn at origin (no emitter radius); dx = n(0,0,age) - n(0,0,0)
  const dx = n(0, 0, 0.5) - n(0, 0, 0);
  assert.ok(Math.abs(a.x - b.x - dx) < 1e-9, `${a.x - b.x} vs ${dx}`);
});

test("blendMode maps to compositeOperation; unset leaves it untouched", () => {
  assert.equal(new ParticleSystem({}).compositeOperation, undefined);
  assert.equal(new ParticleSystem({ blendMode: "normal" }).compositeOperation, undefined);
  assert.equal(new ParticleSystem({ blendMode: "add" }).compositeOperation, "lighter");
  assert.equal(new ParticleSystem({ blendMode: "screen" }).compositeOperation, "screen");
});

test("material: shape stays as alias; material wins", () => {
  assert.equal(new ParticleSystem({}).material, "circle");
  assert.equal(new ParticleSystem({ shape: "square" }).material, "square");
  assert.equal(new ParticleSystem({ shape: "square" }).shape, "square");
  assert.equal(new ParticleSystem({ shape: "square", material: "star" }).material, "star");
  assert.equal(new ParticleSystem({ material: "soft" }).material, "soft");
  assert.equal(new ParticleSystem({ material: "soft" }).shape, "circle");
});

test("copy keeps turbulence/material/blend", () => {
  const ps = new ParticleSystem({ ...base, material: "star", blendMode: "add", turbulence: { amplitude: 0.3, frequency: 1 } });
  const c = ps.copy();
  assert.equal(snap(c, 1.2), snap(ps, 1.2));
  assert.equal(c.material, "star");
  assert.equal(c.compositeOperation, "lighter");
});
