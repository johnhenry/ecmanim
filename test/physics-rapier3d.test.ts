import { test } from "node:test";
import assert from "node:assert/strict";
import { Rapier3DEngine, rapier3d } from "../src/physics/rapier3d.ts";
import { Cube } from "../src/mobject/surface.ts";

// Rapier is an optional dependency. If it isn't installed, skip the cases that
// need it (CI installs it via `npm ci`, so they run there).
let RAPIER: any = null;
try { RAPIER = await import("@dimforge/rapier3d-compat"); } catch { /* not installed */ }
const maybe = RAPIER
  ? test
  : (name: string, fn: any) => test(name, { skip: "@dimforge/rapier3d-compat not installed" }, () => {});

// (d) Module import must be side-effect-free — importing it must NOT init WASM.
test("rapier3d: module exports are present without initializing WASM", () => {
  assert.equal(typeof rapier3d, "function");
  assert.equal(typeof Rapier3DEngine.create, "function");
});

// (a) A dynamic body falls under gravity.
maybe("rapier3d: a body falls under gravity", async () => {
  const eng = await Rapier3DEngine.create({ gravity: [0, -9.8, 0], rapier: RAPIER });
  const cube = new Cube({ sideLength: 1, point: [0, 5, 0] });
  eng.addBody(cube, {});
  const y0 = cube.getCenter()[1];
  for (let i = 0; i < 30; i++) eng.step(1 / 60);
  assert.ok(cube.getCenter()[1] < y0 - 0.1, "cube moved down under gravity");
});

// (b) A body rests on the floor without sinking through it.
maybe("rapier3d: a body rests on the floor without sinking", async () => {
  const eng = await Rapier3DEngine.create({ gravity: [0, -9.8, 0], floor: 0, rapier: RAPIER });
  const cube = new Cube({ sideLength: 2, point: [0, 3, 0] }); // half-extent 1
  eng.addBody(cube, {});
  for (let i = 0; i < 240; i++) eng.step(1 / 60); // ~4s to settle
  const bottom = cube.getBoundaryPoint([0, -1, 0])[1];
  assert.ok(bottom > -0.06, `bottom should rest at ~0, got ${bottom}`);
  assert.ok(bottom < 0.2, `bottom should not float well above the floor, got ${bottom}`);
});

// Regression: step() used a truthy guard (`if (dp[0] || ...)`) that treats
// NaN exactly like 0 (`Boolean(NaN) === false`), so a non-finite solver
// output silently no-op'd forever with no signal anything was wrong -- and
// `lastPos`/`lastQuat` were still overwritten with NaN unconditionally,
// permanently poisoning every later frame's delta too. Stub the underlying
// Rapier rigid body to simulate exactly that (a diverging/ill-conditioned
// solve), and confirm it now warns once and leaves the mobject untouched.
maybe("rapier3d: a non-finite (NaN) solver output warns once and doesn't corrupt the mobject's points", async () => {
  const eng = await Rapier3DEngine.create({ gravity: [0, -9.8, 0], rapier: RAPIER });
  const cube = new Cube({ sideLength: 1, point: [0, 5, 0] });
  const body = eng.addBody(cube, {});
  const before = cube.getFamily().flatMap((m: any) => (m.points ?? []).map((p: any) => p.slice()));

  body.rb.translation = () => ({ x: NaN, y: NaN, z: NaN });
  body.rb.rotation = () => ({ x: 0, y: 0, z: 0, w: NaN });

  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: any[]) => { warnings.push(String(args[0])); };
  try {
    eng.step(1 / 60);
    eng.step(1 / 60); // a second NaN frame from the same body must not re-warn
  } finally {
    console.warn = origWarn;
  }

  assert.equal(warnings.length, 1, `should warn exactly once, not once per frame, got: ${JSON.stringify(warnings)}`);
  assert.match(warnings[0], /non-finite/i);
  const after = cube.getFamily().flatMap((m: any) => (m.points ?? []).map((p: any) => p.slice()));
  assert.equal(after.length, before.length);
  for (let i = 0; i < before.length; i++) {
    assert.ok(after[i].every((v: number, j: number) => v === before[i][j]), "point data must be untouched, never NaN-corrupted");
  }
});

// Cube is a VGroup — its vertices live in the face submobjects, so read the
// first point from the mobject family.
function firstFamilyPoint(mob: any): number[] {
  for (const m of mob.getFamily()) if (m.points?.length) return m.points[0];
  throw new Error("no points in family");
}

// (c) Delta-rotation sync actually rotates the mobject's points (exercises the
// quaternion-order + axis-angle path) while the center stays put.
maybe("rapier3d: angular velocity rotates the body's points about its center", async () => {
  const eng = await Rapier3DEngine.create({ gravity: [0, 0, 0], rapier: RAPIER });
  const cube = new Cube({ sideLength: 2, point: [0, 0, 0] });
  eng.addBody(cube, { angularVelocity: [0, 0, 4] }); // spin about Z
  const p0 = firstFamilyPoint(cube).slice();
  const c0 = cube.getCenter();
  for (let i = 0; i < 40; i++) eng.step(1 / 60);
  const p1 = firstFamilyPoint(cube);
  const c1 = cube.getCenter();
  const moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const centerDrift = Math.hypot(c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]);
  assert.ok(moved > 0.1, `a corner point should have rotated, moved=${moved}`);
  assert.ok(centerDrift < 0.05, `center should stay put, drift=${centerDrift}`);
});
