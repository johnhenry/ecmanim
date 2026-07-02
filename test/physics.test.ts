import { test } from "node:test";
import assert from "node:assert/strict";
import { electricFieldFunc, magneticFieldFunc, ElectricField, MagneticField, thinLensRefract } from "../src/physics/fields.ts";
import { LinearWave, StandingWave } from "../src/physics/waves.ts";
import { SimpleEngine, physics, Pendulum } from "../src/physics/rigid.ts";
import { Dot } from "../src/mobject/geometry.ts";
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
