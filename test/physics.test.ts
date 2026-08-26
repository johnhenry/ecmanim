import { test } from "node:test";
import assert from "node:assert/strict";
import { electricFieldFunc, magneticFieldFunc, ElectricField, MagneticField, thinLensRefract } from "../src/physics/fields.ts";
import { LinearWave, StandingWave } from "../src/physics/waves.ts";
import { SimpleEngine, physics, Pendulum } from "../src/physics/rigid.ts";
import { Dot, Square } from "../src/mobject/geometry.ts";
import { Scene } from "../src/scene/Scene.ts";

test("electric field points away from a + charge and weakens with distance", () => {
  const E = electricFieldFunc([{ position: [0, 0, 0], magnitude: 1 }]);
  const near = E([1, 0, 0]);
  const far = E([3, 0, 0]);
  assert.ok(near[0] > 0, "points in +x away from the charge on the +x axis");
  assert.ok(Math.abs(near[1]) < 1e-9);
  assert.ok(Math.hypot(near[0], near[1]) > Math.hypot(far[0], far[1]), "weaker farther away");
});

test("magnetic field is perpendicular to the radial vector", () => {
  const B = magneticFieldFunc([{ position: [0, 0, 0], magnitude: 1 }]);
  const b = B([1, 0, 0]); // r=+x → ẑ×r = +y
  assert.ok(Math.abs(b[0]) < 1e-9);
  assert.ok(b[1] > 0);
});

test("ElectricField / MagneticField build arrow fields (submobjects)", () => {
  const ef = new ElectricField([{ position: [0, 0, 0], magnitude: 1 }]);
  const mf = new MagneticField([{ position: [0, 0, 0], magnitude: 1 }]);
  assert.ok(ef.submobjects.length > 0);
  assert.ok(mf.submobjects.length > 0);
});

test("thinLensRefract bends a parallel ray toward the focal point", () => {
  const dir = thinLensRefract(1, [1, 0, 0], 2); // ray at height 1, f=2 → slope -0.5
  assert.ok(dir[1] < 0, "bends downward toward axis");
});

test("LinearWave samples a sine and advances with setTime", () => {
  const w = new LinearWave({ xRange: [0, 4, 0.5], amplitude: 1, wavelength: 4, frequency: 1 });
  assert.ok(w.points.length >= 8);
  const y0 = w.points[2][1];
  w.setTime(0.25);
  const y1 = w.points[2][1];
  assert.notEqual(y0, y1, "point moved after advancing time");
});

test("StandingWave has a node where sin(kx)=0", () => {
  const w = new StandingWave({ xRange: [0, 4, 0.1], amplitude: 1, wavelength: 4 });
  // At x=0, sin(k·0)=0 → y ~ 0 for all time.
  w.setTime(0.3);
  assert.ok(Math.abs(w.points[0][1]) < 1e-6);
});

test("SimpleEngine: a body falls under gravity", () => {
  const eng = new SimpleEngine({ gravity: [0, -9.8, 0] });
  const d = new Dot({ point: [0, 5, 0] });
  eng.addBody(d, { mass: 1 });
  const y0 = d.getCenter()[1];
  eng.step(0.1); eng.step(0.1);
  assert.ok(d.getCenter()[1] < y0, "moved down");
});

test("SimpleEngine: floor collision reverses vertical velocity", () => {
  const eng = new SimpleEngine({ gravity: [0, 0, 0], floor: 0, restitution: 0.8 });
  const d = new Dot({ point: [0, 0.1, 0], radius: 0.2 });
  const body = eng.addBody(d, { velocity: [0, -2, 0] });
  eng.step(0.1); // moves below floor → bounce
  assert.ok(body.velocity[1] > 0, "velocity flipped upward");
});

test("physics(scene) attaches a stepping carrier", () => {
  const s = new Scene({ fps: 30 });
  const before = s.mobjects.length;
  const eng = physics(s, { gravity: [0, -9.8, 0] });
  assert.ok(eng instanceof SimpleEngine);
  assert.equal(s.mobjects.length, before + 1);
});

test("Pendulum swings and roughly conserves energy", () => {
  const p = new Pendulum({ length: 2, initialAngle: 0.4, gravity: 9.8 });
  const e0 = p.energy();
  const theta0 = p.theta;
  for (let i = 0; i < 50; i++) p.update(0.02); // ~1s
  assert.notEqual(p.theta, theta0, "angle evolved");
  const e1 = p.energy();
  assert.ok(Math.abs(e1 - e0) / Math.abs(e0) < 0.1, `energy conserved within 10%: ${e0} -> ${e1}`);
});

test("SimpleEngine: a non-finite velocity warns once, resets to zero, and never corrupts the mobject's point data", () => {
  // Regression: SimpleEngine.step() had no guard at all against a non-finite
  // velocity (e.g. set directly by a caller, or produced by some other
  // updater) -- it flowed straight into `b.mob.shift(delta)`, writing NaN
  // into the mobject's point data. This is worse than the Rapier adapters'
  // bug (which merely freeze silently): here the corruption is silent AND
  // permanent, since NaN point data can't be un-NaN'd by further shifts.
  const eng = new SimpleEngine({ gravity: [0, -9.8, 0] });
  const d = new Dot({ point: [0, 5, 0] });
  const body = eng.addBody(d, { velocity: [NaN, 0, 0] });
  const before = d.points.map((p: any) => p.slice());

  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: any[]) => { warnings.push(String(args[0])); };
  try {
    eng.step(0.1);
    // Corrupt it again on a later frame -- still only ONE warning total for
    // this body (no per-frame log spam once a body is known-bad).
    body.velocity = [NaN, 0, 0];
    eng.step(0.1);
  } finally {
    console.warn = origWarn;
  }

  assert.equal(warnings.length, 1, `should warn exactly once, not once per frame, got: ${JSON.stringify(warnings)}`);
  assert.match(warnings[0], /non-finite/i);
  assert.deepEqual(body.velocity, [0, 0, 0], "a non-finite velocity should be reset to zero, not left NaN");
  for (let i = 0; i < before.length; i++) {
    assert.ok(d.points[i].every((v: number, j: number) => v === before[i][j]), "point data must be untouched, never NaN-corrupted");
  }
});

test("SimpleEngine: angularVelocity spins a body kinematically", () => {
  const eng = new SimpleEngine({ gravity: [0, 0, 0] });
  const sq = new Square({ sideLength: 2 });
  eng.addBody(sq, { angularVelocity: Math.PI / 2 }); // quarter turn per second
  const corner0 = sq.points[0].slice();
  eng.step(1); // one second -> 90 degrees
  const c = sq.getCenter();
  const p = sq.points[0];
  // Rotating [x,y] by 90° about center maps (dx,dy) -> (-dy,dx).
  const dx0 = corner0[0] - c[0], dy0 = corner0[1] - c[1];
  assert.ok(Math.abs((p[0] - c[0]) - (-dy0)) < 1e-6, "x rotated");
  assert.ok(Math.abs((p[1] - c[1]) - dx0) < 1e-6, "y rotated");
});
