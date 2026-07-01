import { test } from "node:test";
import assert from "node:assert/strict";
import { use, registry } from "../src/index.ts";
import { VMobject } from "../src/mobject/VMobject.ts";
import { Color } from "../src/core/color.ts";
import { running } from "../src/animation/rate_functions.ts";

test("built-ins are registered into the registry", () => {
  assert.ok(registry.has("mobject", "Circle"));
  assert.ok(registry.has("mobject", "Sphere"));
  assert.ok(registry.has("animation", "Create"));
  assert.ok(registry.has("animation", "Transform"));
  assert.ok(registry.has("rateFunction", "smooth"));
  assert.ok(registry.has("color", "RED"));
  assert.ok(registry.has("scene", "ThreeDScene"));
  assert.ok(registry.bases.Mobject && registry.bases.Animation && registry.bases.Color);
});

test("use() installs a plugin (mobject/animation/rate/color)", () => {
  class Star2 extends VMobject {}
  const myRate = (t: number) => t * t;
  use({
    name: "demo-plugin",
    install(api) {
      api.registerMobject("Star2", Star2);
      api.registerRateFunction("myrate", myRate);
      api.registerColor("brandTeal", "#00B3A4");
    },
  });
  assert.equal(registry.get("mobject", "Star2"), Star2);
  assert.equal(running("myrate"), myRate); // plugin rate resolvable by name
  assert.equal(Color.parse("brandTeal").toHex().toUpperCase(), "#00B3A4");
  assert.ok(registry.plugins.some((p) => p.name === "demo-plugin"));
});

test("named built-in colors resolve via Color.parse", () => {
  assert.equal(Color.parse("RED").toHex().toUpperCase(), "#FC6255");
  assert.equal(Color.parse("#123456").toHex().toUpperCase(), "#123456"); // hex still works
});

test("use() accepts a bare install function and is chainable", () => {
  const r = use((api) => api.registerColor("brandX", "#010203"));
  assert.equal(r, registry);
  assert.equal(Color.parse("brandX").toHex(), "#010203");
});

test("the sample heart plugin builds a Heart mobject", async () => {
  const heartPlugin = (await import("../examples/plugins/heart-plugin.ts")).default;
  use(heartPlugin);
  const Heart = registry.get("mobject", "Heart");
  assert.ok(Heart);
  const h = new Heart();
  assert.ok(h.points.length > 3 && h.points.every((p: number[]) => p.every(Number.isFinite)));
  assert.ok(registry.get("animation", "Heartbeat"));
  assert.equal(running("thump")(0.5), 1); // 0.5 - 0.5*cos(pi) = 1
});
