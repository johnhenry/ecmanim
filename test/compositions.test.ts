import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registerComposition, getComposition, listCompositions,
  compositionsToJSON, unregisterComposition, _clearCompositions,
} from "../src/scene/compositions.ts";

class SceneA { static schema = { spec: { title: { type: "string", default: "hi" } } }; }
class SceneB {}

test("register/get/list compositions", () => {
  _clearCompositions();
  registerComposition("intro", SceneA, { description: "an intro", fps: 30, width: 1920, height: 1080 });
  registerComposition("outro", SceneB, { fps: 24 });
  assert.equal(listCompositions().length, 2);
  const intro = getComposition("intro");
  assert.equal(intro?.description, "an intro");
  assert.equal(intro?.scene, SceneA);
  // schema picked up from the static on the class
  assert.ok(intro?.schema);
});

test("compositionsToJSON is serializable and includes schema spec", () => {
  _clearCompositions();
  registerComposition("intro", SceneA, { fps: 30, width: 100, height: 100 });
  const json = compositionsToJSON();
  assert.equal(json.length, 1);
  assert.equal(json[0].name, "intro");
  assert.equal(json[0].fps, 30);
  assert.deepEqual(json[0].schema, { title: { type: "string", default: "hi" } });
  // round-trips through JSON
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(json)));
});

test("unregister + clear", () => {
  _clearCompositions();
  registerComposition("x", SceneB);
  assert.equal(unregisterComposition("x"), true);
  assert.equal(getComposition("x"), undefined);
  assert.equal(listCompositions().length, 0);
});
