// Campaign 8 (p5.js generative subset) Phase 2 gap-fill: deterministic
// Reynolds flocking (boids) simulation, ported from
// examples/p5-parity/ref/03-flocking-boids.js. Determinism is the critical
// contract here (see src/layout/boids.ts's module comment): the
// partial-movie render cache keys frames by content hash, so re-rendering
// the same scene at the same time must replay the exact same step sequence.

import { test } from "node:test";
import assert from "node:assert/strict";

import { BoidsSimulation } from "../src/layout/boids.ts";
import { BoidsFlock } from "../src/mobject/boids.ts";

// --- Determinism (the critical test) ---------------------------------------

test("two freshly-constructed simulations with the same seed produce identical positions after many steps", () => {
  const a = new BoidsSimulation({ seed: 42, count: 20 });
  const b = new BoidsSimulation({ seed: 42, count: 20 });

  for (let i = 0; i < 50; i++) {
    a.step(0.1);
    b.step(0.1);
  }

  assert.deepEqual(a.positions(), b.positions(), "positions must be byte-identical for the same seed + step sequence");
  assert.deepEqual(a.velocities(), b.velocities(), "velocities must be byte-identical for the same seed + step sequence");
});

test("determinism holds at every intermediate step, not just the final one", () => {
  const a = new BoidsSimulation({ seed: 7, count: 15 });
  const b = new BoidsSimulation({ seed: 7, count: 15 });

  for (let i = 0; i < 50; i++) {
    a.step(1 / 30);
    b.step(1 / 30);
    assert.deepEqual(a.positions(), b.positions(), `positions diverged at step ${i}`);
    assert.deepEqual(a.headings(), b.headings(), `headings diverged at step ${i}`);
  }
});

test("re-running the exact same simulation twice from scratch (repeat-render cache-compat) is byte-identical", () => {
  const run = () => {
    const sim = new BoidsSimulation({ seed: 99, count: 25 });
    for (let i = 0; i < 30; i++) sim.step(1 / 24);
    return sim.positions();
  };
  assert.deepEqual(run(), run(), "identical construction + step sequence must reproduce identical output on repeat render");
});

// --- Seed variation ----------------------------------------------------------

test("different seeds produce different initial positions", () => {
  const a = new BoidsSimulation({ seed: 1, count: 10 });
  const b = new BoidsSimulation({ seed: 2, count: 10 });
  assert.notDeepEqual(a.positions(), b.positions());
});

// --- Bounds / stability ------------------------------------------------------

test("boids stay within bounds (wrapping works) after many steps, no NaN/Infinity", () => {
  const bounds = { width: 14, height: 8 };
  const sim = new BoidsSimulation({ seed: 3, count: 30, bounds });
  for (let i = 0; i < 200; i++) sim.step(1 / 30);

  const hw = bounds.width / 2;
  const hh = bounds.height / 2;
  for (const [x, y, z] of sim.positions()) {
    assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), "position must be finite");
    assert.ok(x >= -hw - 1e-9 && x <= hw + 1e-9, `x=${x} out of bounds [-${hw}, ${hw}]`);
    assert.ok(y >= -hh - 1e-9 && y <= hh + 1e-9, `y=${y} out of bounds [-${hh}, ${hh}]`);
  }
  for (const [vx, vy, vz] of sim.velocities()) {
    assert.ok(Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz), "velocity must be finite");
  }
});

test("no NaN/Infinity across 100 steps, sampled at every step (weaker but reliable regression guard)", () => {
  const sim = new BoidsSimulation({ seed: 11, count: 40 });
  for (let i = 0; i < 100; i++) {
    sim.step(1 / 30);
    for (const p of sim.positions()) {
      assert.ok(p.every((c) => Number.isFinite(c)), `NaN/Infinity in position at step ${i}: ${p}`);
    }
    for (const v of sim.velocities()) {
      assert.ok(v.every((c) => Number.isFinite(c)), `NaN/Infinity in velocity at step ${i}: ${v}`);
    }
  }
});

// --- Flocking behavior sanity check ------------------------------------------

function meanPairwiseDistance(positions: number[][]): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const dx = positions[i][0] - positions[j][0];
      const dy = positions[i][1] - positions[j][1];
      sum += Math.hypot(dx, dy);
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

test("cohesion pulls the flock together: mean pairwise distance shrinks relative to a spread-out random-walk baseline", () => {
  const bounds = { width: 14, height: 8 };

  // Boids simulation: strong cohesion/alignment, weak separation, tight perception.
  const sim = new BoidsSimulation({
    seed: 5,
    count: 30,
    bounds,
    perceptionRadius: 4,
    separationRadius: 0.5,
    maxSpeed: 3,
    maxForce: 0.3,
  });
  for (let i = 0; i < 150; i++) sim.step(1 / 30);
  const flockedDistance = meanPairwiseDistance(sim.positions());

  // Baseline: same seeded PRNG stream driving pure random-walk motion (no
  // flocking forces at all) -- boids should end up measurably tighter than
  // aimless wandering starting from the same initial spread.
  const hw = bounds.width / 2;
  const hh = bounds.height / 2;
  const randomSim = new BoidsSimulation({
    seed: 5,
    count: 30,
    bounds,
    // Zero out all flocking influence: no perception/separation radius, so
    // every steer() branch's count stays 0 and acceleration is always zero
    // -- boids drift in a straight line at their (seeded) initial velocity,
    // wrapping at the bounds, i.e. deterministic pure inertial wandering.
    perceptionRadius: 0,
    separationRadius: 0,
  });
  for (let i = 0; i < 150; i++) randomSim.step(1 / 30);
  const wanderedDistance = meanPairwiseDistance(randomSim.positions());

  assert.ok(
    flockedDistance < wanderedDistance,
    `expected flocking (cohesion) to produce a tighter cluster than aimless wandering: flocked=${flockedDistance} wandered=${wanderedDistance}`,
  );
});

// --- BoidsFlock (Mobject wrapper) --------------------------------------------

test("BoidsFlock constructs the configured count of submobjects", () => {
  const flock = new BoidsFlock({ seed: 1, count: 12 });
  assert.equal(flock.submobjects.length, 12);
});

test("BoidsFlock.step advances the simulation and updates submobject positions without throwing", () => {
  const flock = new BoidsFlock({ seed: 2, count: 8 });
  const before = flock.submobjects.map((m) => m.getCenter());

  assert.doesNotThrow(() => flock.step(1 / 30));

  const after = flock.submobjects.map((m) => m.getCenter());
  assert.equal(before.length, after.length);
  // At least one boid should have visibly moved.
  const moved = before.some((p, i) => Math.hypot(p[0] - after[i][0], p[1] - after[i][1]) > 1e-9);
  assert.ok(moved, "expected submobject centers to change after step()");
});

test("BoidsFlock.step is deterministic: two flocks built the same way match positions after many steps", () => {
  const flockA = new BoidsFlock({ seed: 13, count: 10 });
  const flockB = new BoidsFlock({ seed: 13, count: 10 });
  for (let i = 0; i < 25; i++) {
    flockA.step(1 / 24);
    flockB.step(1 / 24);
  }
  const centersA = flockA.submobjects.map((m) => m.getCenter());
  const centersB = flockB.submobjects.map((m) => m.getCenter());
  assert.deepEqual(centersA, centersB);
});
