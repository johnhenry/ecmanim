import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStudioHarness, startStudio } from "../src/studio/dev_server.ts";
import { schemaToControls } from "../src/studio/props.ts";
import { defineSchema } from "../src/core/schema.ts";

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

test("buildStudioHarness({ waveform: true }) adds a waveform canvas + audio wiring, opt-in", () => {
  const base = { sceneModuleUrl: "/scene.js", sceneExport: "default", browserUrl: "/dist/browser.js", studioUrl: "/dist/studio.js", quality: "medium", background: "#000", interactive: false };
  const withoutWaveform = buildStudioHarness(base);
  assert.ok(!/id="waveform"/.test(withoutWaveform));
  assert.ok(!/undefined/.test(withoutWaveform));

  const withWaveform = buildStudioHarness({ ...base, waveform: true });
  assert.match(withWaveform, /id="waveform"/);
  assert.match(withWaveform, /getAudioData/);
  assert.match(withWaveform, /getWaveformPortion/);
  assert.match(withWaveform, /renderWaveform/);
  assert.ok(!/undefined/.test(withWaveform));
});

test("buildStudioHarness({ props: true }) adds a props panel + schema-driven rerender wiring, opt-in", () => {
  const base = { sceneModuleUrl: "/scene.js", sceneExport: "default", browserUrl: "/dist/browser.js", studioUrl: "/dist/studio.js", quality: "medium", background: "#000", interactive: false };
  const withoutProps = buildStudioHarness(base);
  assert.ok(!/id="props"/.test(withoutProps));
  assert.ok(!/undefined/.test(withoutProps));

  const withProps = buildStudioHarness({ ...base, props: true });
  assert.match(withProps, /id="props"/);
  assert.match(withProps, /schemaToControls/);
  assert.match(withProps, /safeParse/);
  assert.match(withProps, /el\.rerender/);
  assert.ok(!/undefined/.test(withProps));
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

test("schema-to-values round-trip: schemaToControls' defaults match schema.safeParse({})'s applied defaults", () => {
  const schema = defineSchema({
    title: { type: "string", default: "hi" },
    size: { type: "number", min: 1, max: 10, default: 5 },
    dark: { type: "boolean", default: true },
  });
  const controls = schemaToControls(schema);
  const defaults = Object.fromEntries(controls.map((c) => [c.name, c.default]));

  const applied = schema.safeParse({});
  assert.equal(applied.ok, true);
  if (applied.ok) assert.deepEqual(applied.value, defaults);

  // A panel edit (changing "size") still round-trips through safeParse().
  const edited = { ...defaults, size: 8 };
  const result = schema.safeParse(edited);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.size, 8);

  // An out-of-range edit is rejected, not silently clamped.
  const invalid = schema.safeParse({ ...defaults, title: 42 });
  assert.equal(invalid.ok, false);
});

test("startStudio serves the harness and closes cleanly", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const os = await import("node:os"); const path = await import("node:path");
  const dir = mkdtempSync(path.join(os.tmpdir(), "mjs-studio-"));
  writeFileSync(path.join(dir, "scene.js"), "export default class {}\n");
  const studio = await startStudio({ sceneModule: "scene.js", root: dir, port: 0 });
  try {
    assert.match(studio.url, /^http:\/\/127\.0\.0\.1:\d+\//);
    assert.deepEqual(studio.urls, [studio.url]);
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

test("startStudio defaults to a loopback-only bind (127.0.0.1), not reachable from other addresses", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const os = await import("node:os"); const path = await import("node:path");
  const dir = mkdtempSync(path.join(os.tmpdir(), "mjs-studio-"));
  writeFileSync(path.join(dir, "scene.js"), "export default class {}\n");
  const studio = await startStudio({ sceneModule: "scene.js", root: dir, port: 0 });
  try {
    assert.equal(studio.urls.length, 1);
    assert.match(studio.urls[0], /^http:\/\/127\.0\.0\.1:/);
  } finally {
    studio.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("startStudio({ host: '0.0.0.0' }) reports every reachable address (loopback + LAN)", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const os = await import("node:os"); const path = await import("node:path");
  const dir = mkdtempSync(path.join(os.tmpdir(), "mjs-studio-"));
  writeFileSync(path.join(dir, "scene.js"), "export default class {}\n");
  const studio = await startStudio({ sceneModule: "scene.js", root: dir, port: 0, host: "0.0.0.0" });
  try {
    assert.ok(studio.urls.length >= 1);
    assert.match(studio.urls[0], /^http:\/\/127\.0\.0\.1:/, "127.0.0.1 is always listed first");
    assert.equal(studio.url, studio.urls[0]);
    // Every reported URL should actually be reachable.
    for (const u of studio.urls) {
      const html = await fetch(u).then((r) => r.text());
      assert.match(html, /manim-player/);
    }
  } finally {
    studio.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
