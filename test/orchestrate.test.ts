import { test } from "node:test";
import assert from "node:assert/strict";
import { Scene } from "../src/scene/Scene.ts";
import { isSceneLike, makeScene, runConstruct } from "../src/scene/orchestrate.ts";

// Simulates issue #3: Node's dynamic import() of the same source through two
// different specifiers (e.g. a scene file importing "ecmanim/node" -> a
// package-exports-resolved dist copy, vs. the CLI importing "../src/node.ts"
// directly) loads two structurally-identical but referentially-distinct
// Scene classes. `instanceof` across that boundary fails even for a
// legitimate Scene subclass. Reproduce the boundary with two independent
// classes shaped exactly like Scene/a Scene subclass, without either one
// extending the real imported `Scene`.
class OtherScene {
  mobjects: any[] = [];
  constructor(_config: any = {}) {}
  async construct(): Promise<void> {}
  async play(..._anims: any[]): Promise<this> { return this; }
  async wait(_duration = 1): Promise<this> { return this; }
  finalizeSections(): void {}
  async render(): Promise<this> {
    await this.construct();
    this.finalizeSections();
    return this;
  }
}

class ForeignUserScene extends OtherScene {
  ran = false;
  async construct(): Promise<void> {
    this.ran = true;
  }
}

test("ForeignUserScene reproduces the instanceof-across-module-copies bug", () => {
  // This is the exact failure mode from issue #3: a real Scene subclass (from
  // the "other" module copy) is NOT an instanceof this file's own Scene.
  assert.equal(ForeignUserScene.prototype instanceof Scene, false);
});

test("isSceneLike duck-types a foreign-but-shaped Scene subclass as true", () => {
  assert.equal(isSceneLike(ForeignUserScene), true);
  assert.equal(isSceneLike(OtherScene), true);
  assert.equal(isSceneLike(Scene), true);

  class RealSubclass extends Scene {}
  assert.equal(isSceneLike(RealSubclass), true);
});

test("isSceneLike rejects non-Scene-shaped values", () => {
  assert.equal(isSceneLike(null), false);
  assert.equal(isSceneLike(undefined), false);
  assert.equal(isSceneLike(42), false);
  assert.equal(isSceneLike({}), false);
  assert.equal(isSceneLike(class {}), false);
  assert.equal(isSceneLike(async () => {}), false); // bare construct function, no prototype methods
  class MissingWait { construct() {} play() {} }
  assert.equal(isSceneLike(MissingWait), false);
});

test("makeScene instantiates a foreign Scene subclass instead of falling back to the base Scene", () => {
  const scene = makeScene(ForeignUserScene, {});
  assert.ok(scene instanceof ForeignUserScene);
  assert.ok(!(scene instanceof Scene)); // proves it's genuinely the foreign copy, not a silent fallback
});

test("makeScene falls back to the base Scene for a bare construct function", () => {
  const construct = async (_scene: Scene) => {};
  const scene = makeScene(construct, {});
  assert.ok(scene instanceof Scene);
});

test("runConstruct drives a foreign Scene subclass via its own render(), not the bare-function path", async () => {
  const scene = makeScene(ForeignUserScene, {}) as ForeignUserScene;
  await runConstruct(ForeignUserScene, scene as unknown as Scene);
  assert.equal(scene.ran, true); // construct() actually ran
});

test("runConstruct still drives a bare construct function and finalizes sections", async () => {
  const scene = new Scene({ fps: 30 });
  let called = false;
  const construct = async (s: Scene) => {
    called = true;
    s.nextSection("only");
  };
  await runConstruct(construct, scene);
  assert.equal(called, true);
  assert.equal(scene.sections.length, 1);
  assert.notEqual(scene.sections[0].endFrame, -1); // finalizeSections() closed it
});
