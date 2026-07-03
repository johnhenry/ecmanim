import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStudioHarness, startStudio } from "../src/studio/dev_server.ts";
import { schemaToControls } from "../src/studio/props.ts";

test("buildStudioHarness embeds importmap, scene import, player, and SSE reload", () => {
  const html = buildStudioHarness({ sceneModuleUrl: "/scene.js", sceneExport: "default", browserUrl: "/dist/browser.js", studioUrl: "/dist/studio.js", quality: "medium", background: "#000", interactive: false });
  assert.match(html, /importmap/);
  assert.match(html, /"ecmanim\/browser":"\/dist\/browser\.js"/);
  assert.match(html, /"ecmanim\/studio":"\/dist\/studio\.js"/);
  assert.match(html, /<manim-player/);
  assert.match(html, /import\("\/scene\.js\?t="/); // cache-busted dynamic import
  assert.match(html, /EventSource\("\/__studio_events"\)/);
  assert.ok(!/undefined/.test(html));
});

test("schemaToControls maps field types to controls", () => {
  const schema = { spec: {
    title: { type: "string", default: "hi", description: "the title" },
    size: { type: "number", min: 1, max: 10, default: 5 },
    dark: { type: "boolean", default: true },
    accent: { type: "color", default: "#f00" },
    mode: { type: "enum", values: ["a", "b"], default: "a" },
  } };
  const controls = schemaToControls(schema);
  assert.equal(controls.length, 5);
  const by = Object.fromEntries(controls.map((c) => [c.name, c]));
  assert.equal(by.title.control, "text");
  assert.equal(by.size.control, "number");
  assert.equal(by.size.min, 1);
  assert.equal(by.dark.control, "checkbox");
  assert.equal(by.accent.control, "color");
  assert.equal(by.mode.control, "select");
  assert.deepEqual(by.mode.options, ["a", "b"]);
});

test("startStudio serves the harness and closes cleanly", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const os = await import("node:os"); const path = await import("node:path");
  const dir = mkdtempSync(path.join(os.tmpdir(), "mjs-studio-"));
  writeFileSync(path.join(dir, "scene.js"), "export default class {}\n");
  const studio = await startStudio({ sceneModule: "scene.js", root: dir, port: 0 });
  try {
    assert.match(studio.url, /^http:\/\/127\.0\.0\.1:\d+\//);
    const html = await fetch(studio.url).then((r) => r.text());
    assert.match(html, /manim-player/);
    // static file served
    const js = await fetch(studio.url + "scene.js").then((r) => r.text());
    assert.match(js, /export default/);
  } finally {
    studio.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
