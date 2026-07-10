// S4: scene params flow into construct() (Scene.params + 2nd-arg for bare
// construct functions), participate in segment discovery, and salt the
// partial-cache key so personalized renders can never collide.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Scene, computeParamsHash, computeRenderConfigHash } from "../src/scene/Scene.ts";
import { makeScene, runConstruct } from "../src/scene/orchestrate.ts";
import { discoverSegments } from "../src/scene/render_frame.ts";
import { Circle } from "../src/mobject/geometry.ts";
import { FadeIn } from "../src/animation/Animation.ts";

test("computeParamsHash: key-order independent, value sensitive", () => {
  const a = computeParamsHash({ city: "Berlin", units: "metric", nested: { x: 1, y: [1, 2] } });
  const b = computeParamsHash({ nested: { y: [1, 2], x: 1 }, units: "metric", city: "Berlin" });
  assert.equal(a, b, "insertion order must not change the hash");
  assert.notEqual(a, computeParamsHash({ city: "Paris", units: "metric", nested: { x: 1, y: [1, 2] } }));
  assert.notEqual(computeParamsHash({}), computeParamsHash({ a: 1 }));
});

test("Scene carries config.params; subclasses read this.params in construct", async () => {
  class Greeting extends Scene {
    built: string | null = null;
    async construct() {
      this.built = String(this.params.name ?? "nobody");
    }
  }
  const scene = makeScene(Greeting, { fps: 10, frameHandler: async () => {}, params: { name: "Ada" } }) as Greeting;
  assert.deepEqual(scene.params, { name: "Ada" });
  await runConstruct(Greeting, scene);
  assert.equal(scene.built, "Ada");
  // Default: empty object, never undefined.
  assert.deepEqual(new Scene().params, {});
});

test("bare construct functions receive params as the 2nd argument", async () => {
  let got: any = "unset";
  const construct = async (_scene: Scene, params?: any) => { got = params; };
  const scene = new Scene({ fps: 10, frameHandler: async () => {} });
  await runConstruct(construct, scene, { count: 3 });
  assert.deepEqual(got, { count: 3 });
});

test("discoverSegments: params change the discovered segment manifest", async () => {
  const construct = async (scene: Scene, params?: any) => {
    const n = params?.plays ?? 1;
    for (let i = 0; i < n; i++) {
      await scene.play(new FadeIn(new Circle({ radius: 1 })), { runTime: 0.2 });
    }
  };
  const one = await discoverSegments(() => construct, undefined, { fps: 10, params: { plays: 1 } });
  const three = await discoverSegments(() => construct, undefined, { fps: 10, params: { plays: 3 } });
  assert.equal(one.length, 1);
  assert.equal(three.length, 3);
});

test("params-salted cache keys: same config, different params → different keys", () => {
  // Mirrors the exact composition node.ts / node-parallel.ts use.
  const base = computeRenderConfigHash({ pixelWidth: 320, pixelHeight: 180, background: "#000", fps: 10 });
  const keyA = `${base}-p${computeParamsHash({ user: "alice" })}`;
  const keyB = `${base}-p${computeParamsHash({ user: "bob" })}`;
  assert.notEqual(keyA, keyB, "personalized renders must not collide on cached partials");
  // And a no-params render doesn't accidentally share with a params one.
  assert.notEqual(base, keyA);
});
