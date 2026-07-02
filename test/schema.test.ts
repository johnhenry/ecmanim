import { test } from "node:test";
import assert from "node:assert/strict";

import { defineSchema } from "../src/core/schema.ts";
import { resolveSceneMetadata } from "../src/scene/scene_params.ts";

// ---------------------------------------------------------------------------
// defineSchema.parse
// ---------------------------------------------------------------------------
test("parse fills defaults", () => {
  const S = defineSchema({
    title: { type: "string", default: "Hello" },
    count: { type: "number", default: 3 },
  });
  assert.deepEqual(S.parse({}), { title: "Hello", count: 3 });
  assert.deepEqual(S.parse({ count: 7 }), { title: "Hello", count: 7 });
});

test("parse throws on missing required field", () => {
  const S = defineSchema({ name: { type: "string" } });
  assert.throws(() => S.parse({}), /field 'name': required/);
});

test("parse keeps optional missing fields out", () => {
  const S = defineSchema({ note: { type: "string", optional: true } });
  assert.deepEqual(S.parse({}), {});
});

test("parse throws on wrong type", () => {
  const S = defineSchema({ count: { type: "number" } });
  assert.throws(() => S.parse({ count: "nope" }), /expected a finite number/);

  const B = defineSchema({ flag: { type: "boolean" } });
  assert.throws(() => B.parse({ flag: "true" }), /expected a boolean/);

  const St = defineSchema({ label: { type: "string" } });
  assert.throws(() => St.parse({ label: 42 }), /expected a string/);
});

test("parse rejects non-finite numbers", () => {
  const S = defineSchema({ x: { type: "number" } });
  assert.throws(() => S.parse({ x: NaN }), /expected a finite number/);
  assert.throws(() => S.parse({ x: Infinity }), /expected a finite number/);
});

test("parse enforces min/max", () => {
  const S = defineSchema({ n: { type: "number", min: 0, max: 10 } });
  assert.equal(S.parse({ n: 5 }).n, 5);
  assert.throws(() => S.parse({ n: -1 }), /must be >= 0/);
  assert.throws(() => S.parse({ n: 11 }), /must be <= 10/);
});

test("parse enforces enum membership", () => {
  const S = defineSchema({ mode: { type: "enum", values: ["fast", "slow"] } });
  assert.equal(S.parse({ mode: "fast" }).mode, "fast");
  assert.throws(() => S.parse({ mode: "medium" }), /must be one of \[fast, slow\]/);
});

test("parse accepts colors leniently but rejects bad hex", () => {
  const S = defineSchema({ c: { type: "color" } });
  assert.equal(S.parse({ c: "#ff0000" }).c, "#ff0000");
  assert.equal(S.parse({ c: "red" }).c, "red");
  assert.throws(() => S.parse({ c: "#zz" }), /invalid hex color/);
  assert.throws(() => S.parse({ c: "" }), /non-empty color string/);
});

test("parse rejects unknown keys", () => {
  const S = defineSchema({ a: { type: "number", default: 1 } });
  assert.throws(() => S.parse({ a: 2, bogus: 5 }), /unknown key 'bogus'/);
});

test("safeParse returns ok:true on valid input", () => {
  const S = defineSchema({ a: { type: "number", default: 1 } });
  const r = S.safeParse({ a: 4 });
  assert.deepEqual(r, { ok: true, value: { a: 4 } });
});

test("safeParse returns ok:false with an error string on invalid input", () => {
  const S = defineSchema({ a: { type: "number" } });
  const r = S.safeParse({ a: "bad" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /expected a finite number/);
});

// ---------------------------------------------------------------------------
// resolveSceneMetadata
// ---------------------------------------------------------------------------
test("resolveSceneMetadata: hook computes durationInFrames merged over defaults", async () => {
  const scene = {
    calculateMetadata({ params, defaults }: any) {
      return { durationInFrames: params.seconds * defaults.fps };
    },
  };
  const { metadata } = await resolveSceneMetadata(scene, { seconds: 3 }, { fps: 30, width: 1920 });
  assert.equal(metadata.durationInFrames, 90);
  assert.equal(metadata.fps, 30); // preserved from defaults
  assert.equal(metadata.width, 1920);
});

test("resolveSceneMetadata: async hook is awaited", async () => {
  const scene = {
    async calculateMetadata({ params }: any) {
      return { durationInFrames: params.n };
    },
  };
  const { metadata } = await resolveSceneMetadata(scene, { n: 42 }, {});
  assert.equal(metadata.durationInFrames, 42);
});

test("resolveSceneMetadata: schema validates/defaults params", async () => {
  const schema = defineSchema({
    fps: { type: "number", default: 60 },
    label: { type: "string", default: "scene" },
  });
  const scene = { schema };
  const { params } = await resolveSceneMetadata(scene, {}, {});
  assert.deepEqual(params, { fps: 60, label: "scene" });
});

test("resolveSceneMetadata: schema on a class (static) with a class instance", async () => {
  class MyScene {
    static schema = defineSchema({ count: { type: "number", default: 5 } });
    static calculateMetadata({ params }: any) {
      return { durationInFrames: params.count * 10 };
    }
  }
  const { metadata, params } = await resolveSceneMetadata(new MyScene(), {}, { fps: 24 });
  assert.equal(params.count, 5);
  assert.equal(metadata.durationInFrames, 50);
  assert.equal(metadata.fps, 24);
});

test("resolveSceneMetadata: no schema + no hook returns defaults unchanged", async () => {
  const defaults = { fps: 30, durationInFrames: 100 };
  const { metadata, params } = await resolveSceneMetadata({}, { a: 1 }, defaults);
  assert.deepEqual(metadata, defaults);
  assert.deepEqual(params, { a: 1 });
});
