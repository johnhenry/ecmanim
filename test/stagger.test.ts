import { test } from "node:test";
import assert from "node:assert/strict";

import { cycle, staggerRange } from "../src/animation/stagger.ts";
import { LaggedStartMap } from "../src/animation/composition.ts";
import { ApplyMethod } from "../src/animation/Animation.ts";
import { Circle } from "../src/mobject/geometry.ts";
import { linear } from "../src/animation/rate_functions.ts";

test("cycle() wraps around, including negative-safe modulo", () => {
  const colorOf = cycle(["red", "green", "blue"]);
  assert.equal(colorOf(null, 0, 3), "red");
  assert.equal(colorOf(null, 1, 3), "green");
  assert.equal(colorOf(null, 2, 3), "blue");
  assert.equal(colorOf(null, 3, 3), "red"); // wraps past the end
  assert.equal(colorOf(null, -1, 3), "blue"); // negative-safe
  assert.throws(() => cycle([]), RangeError);
});

test("staggerRange() distributes linearly by index", () => {
  const delayOf = staggerRange(0, 1);
  assert.equal(delayOf(null, 0, 5), 0);
  assert.equal(delayOf(null, 4, 5), 1);
  assert.ok(Math.abs(delayOf(null, 2, 5) - 0.5) < 1e-9);
  // A single item can't be linearly distributed -- falls back to `from`.
  assert.equal(staggerRange(0.2, 0.8)(null, 0, 1), 0.2);
});

test("LaggedStartMap's factory receives (mobject, index, total)", () => {
  const mobjects = [new Circle(), new Circle(), new Circle()];
  const seen: Array<[number, number]> = [];
  const group = new LaggedStartMap(
    (m: any, index: number, total: number) => {
      seen.push([index, total]);
      return new ApplyMethod(m, "shift", [1, 0, 0]);
    },
    mobjects,
    { lagRatio: 0 },
  );
  assert.deepEqual(seen, [[0, 3], [1, 3], [2, 3]]);
  assert.equal(group.animations.length, 3);
});

test("integration: staggerRange()-driven per-mobject shift distances land correctly after interpolate(1)", () => {
  const mobjects = [new Circle(), new Circle(), new Circle()];
  const distanceOf = staggerRange(1, 3); // index 0 -> 1, index 1 -> 2, index 2 -> 3
  const group = new LaggedStartMap(
    (m: any, index: number, total: number) => {
      const a = new ApplyMethod(m, "shift", [distanceOf(m, index, total), 0, 0]);
      a.rateFunc = linear;
      return a;
    },
    mobjects,
    { lagRatio: 0 },
  );
  group.begin();
  group.interpolate(1);
  assert.ok(Math.abs(mobjects[0].getCenter()[0] - 1) < 1e-6);
  assert.ok(Math.abs(mobjects[1].getCenter()[0] - 2) < 1e-6);
  assert.ok(Math.abs(mobjects[2].getCenter()[0] - 3) < 1e-6);
});
