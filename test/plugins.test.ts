import { test } from "node:test";
import assert from "node:assert/strict";
import { use, registry, Registry } from "../src/index.ts";
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

test("use(): a plugin whose install() throws is attributed by name, not an opaque crash", () => {
  // Regression: install() previously ran with no try/catch, so a throwing
  // plugin's error propagated straight out with nothing identifying which
  // plugin was at fault. A fresh Registry (not the shared singleton) keeps
  // this isolated from the other tests in this file.
  const r = new Registry();
  const boom = new Error("kaboom");
  assert.throws(
    () => r.use({ name: "bad-plugin", install() { throw boom; } }),
    (err: any) => {
      assert.match(err.message, /bad-plugin/, "the error must name the offending plugin");
      assert.match(err.message, /failed to install/i);
      assert.equal(err.cause, boom, "the original error should be preserved as .cause");
      return true;
    },
  );
  // A failed install() must not register the plugin as if it had succeeded.
  assert.equal(r.plugins.length, 0);
});

test("use(): a throwing UNNAMED plugin is still attributable (not silently opaque)", () => {
  const r = new Registry();
  assert.throws(
    () => r.use({ install() { throw new Error("nope"); } }),
    /failed to install/i,
  );
});

test("use(): a throwing plugin does not corrupt the registry for plugins installed before it", () => {
  const r = new Registry();
  r.use({ name: "good-plugin", install(api) { api.registerColor("goodColor", "#010203"); } });
  assert.throws(() => r.use({ name: "bad-plugin", install() { throw new Error("boom"); } }));
  // The earlier, successfully-installed plugin's registration must survive.
  assert.equal(r.get("color", "goodColor"), "#010203");
  assert.equal(r.plugins.length, 1);
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
