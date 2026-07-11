// Campaign 8 (p5.js generative subset) Phase 2 gap-fill: deterministic
// mass-spring softbody simulation, reference examples/p5-parity/ref/10-softbody-spring.js.

import { test } from "node:test";
import assert from "node:assert/strict";

import { SoftBodySimulation, SoftBody } from "../src/mobject/soft_body.ts";

// --- Determinism ---------------------------------------------------------

test("SoftBodySimulation: two fresh sims with the same config/seed and the same step sequence produce IDENTICAL positions at every step", () => {
  const config = { nodeCount: 6, radius: 1.2, seed: 42, initialJitter: 0.3, springing: 0.15, damping: 0.97 };
  const simA = new SoftBodySimulation(config);
  const simB = new SoftBodySimulation(config);

  // A scripted, reproducible target path -- a small circle -- driven by a
  // varying dt sequence (not a fixed dt) to make sure step() has no hidden
  // dependence on a constant timestep.
  const targetAt = (t: number): [number, number] => [Math.cos(t) * 2, Math.sin(t) * 2];

  let t = 0;
  for (let i = 0; i < 300; i++) {
    const dt = 1 / 30 + ((i % 5) - 2) * 0.001; // small jitter in dt, same for both sims
    t += dt;
    const target = targetAt(t);
    simA.step(dt, target);
    simB.step(dt, target);
    assert.deepEqual(simA.positions(), simB.positions(), `positions diverged at step ${i}`);
    assert.deepEqual(simA.velocities(), simB.velocities(), `velocities diverged at step ${i}`);
  }
});

test("SoftBodySimulation: constructing with the same seed twice gives identical initial (jittered) positions", () => {
  const config = { nodeCount: 7, radius: 1, seed: 7, initialJitter: 0.5 };
  const simA = new SoftBodySimulation(config);
  const simB = new SoftBodySimulation(config);
  assert.deepEqual(simA.positions(), simB.positions());
});

// --- Physical sanity: converges toward a stationary target ---------------

test("SoftBodySimulation: nodes move substantially toward a stationary target over many steps", () => {
  const sim = new SoftBodySimulation({ nodeCount: 5, radius: 1.5, seed: 1 });
  const target: [number, number] = [8, 6]; // far from the initial circle (radius 1.5 at origin)

  const avgDist = (): number => {
    const positions = sim.positions();
    const total = positions.reduce((sum, [x, y]) => sum + Math.hypot(x - target[0], y - target[1]), 0);
    return total / positions.length;
  };

  const initialAvgDist = avgDist();
  const dt = 1 / 30;
  for (let i = 0; i < 200; i++) sim.step(dt, target);
  const finalAvgDist = avgDist();

  assert.ok(
    finalAvgDist < initialAvgDist * 0.25,
    `expected substantial convergence: initial=${initialAvgDist}, final=${finalAvgDist}`,
  );
});

// --- Numerical stability guard --------------------------------------------

test("SoftBodySimulation: high damping (~1) with an oscillating target stays bounded across many steps (no NaN/Infinity/divergence)", () => {
  const sim = new SoftBodySimulation({ nodeCount: 5, radius: 1.5, seed: 3, damping: 0.999, springing: 0.12 });
  const dt = 1 / 30;
  let maxSpeed = 0;

  for (let i = 0; i < 5000; i++) {
    const target: [number, number] = [Math.sin(i * 0.05) * 5, Math.cos(i * 0.03) * 5];
    sim.step(dt, target);
    for (const [vx, vy] of sim.velocities()) {
      assert.ok(Number.isFinite(vx) && Number.isFinite(vy), `non-finite velocity at step ${i}: [${vx}, ${vy}]`);
      maxSpeed = Math.max(maxSpeed, Math.hypot(vx, vy));
    }
    for (const [x, y] of sim.positions()) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y), `non-finite position at step ${i}: [${x}, ${y}]`);
    }
  }

  // A generous bound -- this is a regression guard against runaway
  // divergence, not a tight physical prediction.
  assert.ok(maxSpeed < 1000, `expected bounded velocities, got max speed ${maxSpeed}`);
});

// --- SoftBody mobject wrapper ---------------------------------------------

test("SoftBody: constructing produces a valid closed-curve visual", () => {
  const body = new SoftBody({ nodeCount: 5, radius: 1.5, seed: 1 });
  assert.equal(body.submobjects.length, 1, "expected a single Spline child");
  const curve = body.submobjects[0] as any;
  assert.ok(curve.points.length > 0, "curve should have geometry");
  // A closed spline through 5 anchors has 5 cubic bezier segments -> 1 + 5*3 points.
  assert.equal(curve.points.length, 1 + 5 * 3);
});

test("SoftBody: .step(dt, target) updates the visual without throwing", () => {
  const body = new SoftBody({ nodeCount: 6, radius: 1, seed: 2 });
  const before = body.positions().map((p) => [...p]);

  assert.doesNotThrow(() => {
    for (let i = 0; i < 50; i++) body.step(1 / 30, [5, 3]);
  });

  const after = body.positions();
  assert.notDeepEqual(before, after, "node positions should have changed after stepping");

  const curve = body.submobjects[0] as any;
  for (const p of curve.points) {
    assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]), "curve geometry should stay finite");
  }
});
