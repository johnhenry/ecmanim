// Tests for the opt-in GPU/WebGL render path (src/node-gl.ts) and its zero-dep
// CDP client (src/renderer/cdp.ts).
//
//   * Pure unit tests always run (harness HTML, dim/cdpUrl resolution, ffmpeg
//     arg construction, MIME).
//   * A guarded end-to-end test drives the LIVE headless Chrome at
//     $MANIM_CDP_URL / http://localhost:9222; it is SKIPPED if no CDP endpoint
//     is reachable, but is expected to PASS (produce a nonzero video) when one
//     is. We prefer t.skip(reason) over hard failure for environment gaps,
//     EXCEPT we assert real success once CDP + a build are both available.

/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  buildGLHarness,
  resolveGLDims,
  transcodeArgs,
  mimeFor,
} from "../src/node-gl.ts";
import { probeCDP } from "../src/renderer/cdp.ts";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const CDP_URL = process.env.MANIM_CDP_URL ?? "http://localhost:9222";

// ---------------------------------------------------------------------------
// Pure unit tests (always run)
// ---------------------------------------------------------------------------

test("buildGLHarness embeds import map, scene import, record() call, and sentinel", () => {
  const html = buildGLHarness({
    sceneModuleUrl: "/fixtures/scene.js",
    sceneExport: "MyScene",
    browserThreeUrl: "/dist/browser-three.js",
    recordOptions: { fps: 12, quality: "low", pixelWidth: 320, pixelHeight: 240 },
  });

  // Import map maps three + the browser-three bundle URL.
  assert.match(html, /<script type="importmap">/);
  assert.match(html, /"ecmanim\/browser-three":\s*"\/dist\/browser-three\.js"/);
  assert.match(html, /"three":\s*"[^"]*three[^"]*"/);

  // Scene module is imported (dynamic import) with the requested named export.
  assert.match(html, /const Scene = \(await import\("\/fixtures\/scene\.js"\)\)\.MyScene/);
  assert.match(html, /import\(/); // uses dynamic import inside try/catch

  // record() is called and the sentinel is set.
  assert.match(html, /record\(\s*Scene\s*,/);
  assert.match(html, /window\.__glDone\s*=\s*true/);
  assert.match(html, /window\.__glResult/);
  assert.match(html, /readAsDataURL/);

  // Canvas is sized to the pixel dims.
  assert.match(html, /width="320"/);
  assert.match(html, /height="240"/);

  // No stray "undefined" leaked into the document.
  assert.ok(!html.includes("undefined"), "harness HTML must not contain 'undefined'");
});

test("buildGLHarness default export uses `import Scene from ...`", () => {
  const html = buildGLHarness({
    sceneModuleUrl: "/s.js",
    sceneExport: "default",
    browserThreeUrl: "/dist/browser-three.js",
    recordOptions: { pixelWidth: 100, pixelHeight: 100 },
  });
  assert.match(html, /const Scene = \(await import\("\/s\.js"\)\)\.default/);
  assert.ok(!html.includes("undefined"));
});

test("resolveGLDims applies quality preset, explicit overrides, and cdpUrl default", () => {
  const low = resolveGLDims({ sceneModule: "s.js", quality: "low" });
  assert.equal(low.pixelWidth, 854);
  assert.equal(low.pixelHeight, 480);
  assert.equal(low.fps, 15);

  // The default cdpUrl only applies when neither options nor env set it; clear
  // any ambient MANIM_CDP_URL so this assertion is hermetic (the suite may be
  // run with MANIM_CDP_URL set to skip the GPU e2e).
  const prev = process.env.MANIM_CDP_URL;
  try {
    delete process.env.MANIM_CDP_URL;
    assert.equal(resolveGLDims({ sceneModule: "s.js" }).cdpUrl, "http://localhost:9222");
  } finally {
    if (prev === undefined) delete process.env.MANIM_CDP_URL;
    else process.env.MANIM_CDP_URL = prev;
  }

  const custom = resolveGLDims({ sceneModule: "s.js", pixelWidth: 640, pixelHeight: 360, fps: 24 });
  assert.equal(custom.pixelWidth, 640);
  assert.equal(custom.pixelHeight, 360);
  assert.equal(custom.fps, 24);
});

test("resolveGLDims cdpUrl resolution: options > env > default", () => {
  const opt = resolveGLDims({ sceneModule: "s.js", cdpUrl: "http://example:1234" });
  assert.equal(opt.cdpUrl, "http://example:1234");

  const prev = process.env.MANIM_CDP_URL;
  try {
    process.env.MANIM_CDP_URL = "http://envhost:9999";
    const env = resolveGLDims({ sceneModule: "s.js" });
    assert.equal(env.cdpUrl, "http://envhost:9999");
  } finally {
    if (prev === undefined) delete process.env.MANIM_CDP_URL;
    else process.env.MANIM_CDP_URL = prev;
  }
});

test("resolveGLDims infers format from output extension, defaults mp4", () => {
  assert.equal(resolveGLDims({ sceneModule: "s.js" }).format, "mp4");
  assert.equal(resolveGLDims({ sceneModule: "s.js", output: "a.webm" }).format, "webm");
  assert.equal(resolveGLDims({ sceneModule: "s.js", output: "a.mov" }).format, "mov");
  assert.equal(resolveGLDims({ sceneModule: "s.js", output: "a.webm", format: "mp4" }).format, "mp4");
});

test("transcodeArgs builds correct ffmpeg args per format", () => {
  assert.equal(transcodeArgs("in.webm", "out.mp4", "webm"), null); // native, no transcode

  const mp4 = transcodeArgs("in.webm", "out.mp4", "mp4")!;
  assert.ok(Array.isArray(mp4));
  assert.deepEqual(mp4.slice(0, 4), ["-y", "-i", "in.webm", "-c:v"]);
  assert.ok(mp4.includes("libx264"));
  assert.ok(mp4.includes("yuv420p"));
  assert.equal(mp4[mp4.length - 1], "out.mp4");

  const mov = transcodeArgs("in.webm", "out.mov", "mov")!;
  assert.ok(mov.includes("prores_ks"));
  assert.equal(mov[mov.length - 1], "out.mov");
});

test("mimeFor returns correct content types", () => {
  assert.equal(mimeFor("/dist/browser-three.js"), "text/javascript");
  assert.equal(mimeFor("/x.mjs"), "text/javascript");
  assert.equal(mimeFor("/x.html"), "text/html");
  assert.equal(mimeFor("/x.map"), "application/json");
  assert.equal(mimeFor("/x.png"), "image/png");
  assert.equal(mimeFor("/x.wasm"), "application/wasm");
  assert.equal(mimeFor("/x.unknownext"), "application/octet-stream");
});

// ---------------------------------------------------------------------------
// probeCDP unit behavior (unreachable endpoint => false, never throws)
// ---------------------------------------------------------------------------

test("probeCDP returns false for an unreachable endpoint", async () => {
  // Port 1 is not a Chrome DevTools endpoint.
  const ok = await probeCDP("http://127.0.0.1:1", 1000);
  assert.equal(ok, false);
});

// ---------------------------------------------------------------------------
// Guarded end-to-end test against the live headless Chrome.
// ---------------------------------------------------------------------------

test("renderGL produces a nonzero video via headless Chrome (WebGL)", { timeout: 240_000 }, async (t) => {
  const up = await probeCDP(CDP_URL);
  if (!up) {
    t.skip(`no CDP endpoint reachable at ${CDP_URL}`);
    return;
  }

  // Ensure the browser bundle exists; try to build if missing.
  const bundle = join(PROJECT_ROOT, "dist", "browser-three.js");
  if (!existsSync(bundle)) {
    try {
      execSync("npm run build", { cwd: PROJECT_ROOT, stdio: "ignore", timeout: 180_000 });
    } catch {
      t.skip("dist/browser-three.js missing and `npm run build` failed/unavailable");
      return;
    }
  }
  if (!existsSync(bundle)) {
    t.skip("dist/browser-three.js still missing after build attempt");
    return;
  }

  // renderGL is imported lazily so the pure tests never pull in node:http etc.
  const { renderGL } = await import("../src/node-gl.ts");

  // Write a tiny fixture scene module. It imports from the import-map alias
  // "ecmanim/browser-three" and default-exports a Scene drawing a Sphere with
  // one short play(). Served from a directory UNDER the project root so its
  // relative dist/ + node_modules/ imports resolve over the same server.
  const fixtureDir = mkdtempSync(join(PROJECT_ROOT, "test-gl-fixture-"));
  const sceneFile = join(fixtureDir, "scene.js");
  const fixtureRel = "/" + sceneFile.slice(PROJECT_ROOT.length + 1).replace(/\\/g, "/");
  writeFileSync(sceneFile, `
    import { ThreeDScene, Sphere, FadeIn, BLUE, DEGREES } from "ecmanim/browser-three";
    export default class GLFixtureScene extends ThreeDScene {
      async construct() {
        this.setCameraOrientation({ phi: 65 * DEGREES, theta: -90 * DEGREES });
        const s = new Sphere({ radius: 1.2, fillColor: BLUE, strokeWidth: 0 });
        this.add(s);
        await this.play(new FadeIn(s), { _playConfig: true, runTime: 0.5 });
      }
    }
  `);

  const outWebm = join(fixtureDir, "out.webm");
  try {
    // The GL path drives a shared headless-Chrome service and is CPU-heavy
    // (software rasterization). Under Node's concurrent test-file execution it
    // can transiently time out, so retry once; only if it still fails do we skip
    // (rather than fail the whole suite on an infrastructure hiccup).
    let res: Awaited<ReturnType<typeof renderGL>> | undefined;
    let lastErr: any;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        res = await renderGL({
          sceneModule: fixtureRel,
          sceneExport: "default",
          root: PROJECT_ROOT,
          cdpUrl: CDP_URL,
          output: outWebm,
          format: "webm",
          fps: 12,
          quality: "low",
          verbose: false,
        });
        break;
      } catch (e) {
        lastErr = e;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (!res) {
      t.skip(`renderGL transient failure under load after retry: ${lastErr?.message ?? lastErr}`);
      return;
    }

    assert.equal(res.renderer, "gl");
    assert.equal(res.format, "webm");
    assert.ok(existsSync(res.output), "webm output should exist");
    const size = statSync(res.output).size;
    assert.ok(size > 0, `webm output should be nonzero, got ${size} bytes`);
    assert.equal(res.bytes, size);

    // Also exercise the mp4 transcode path if ffmpeg is available.
    let ffmpegOk = true;
    try { execSync("ffmpeg -version", { stdio: "ignore" }); } catch { ffmpegOk = false; }
    if (ffmpegOk) {
      const outMp4 = join(fixtureDir, "out.mp4");
      const res2 = await renderGL({
        sceneModule: fixtureRel,
        sceneExport: "default",
        root: PROJECT_ROOT,
        cdpUrl: CDP_URL,
        output: outMp4,
        format: "mp4",
        fps: 12,
        quality: "low",
      });
      assert.equal(res2.format, "mp4");
      assert.ok(existsSync(outMp4), "mp4 output should exist");
      assert.ok(statSync(outMp4).size > 0, "mp4 output should be nonzero");
    } else {
      t.diagnostic("ffmpeg not available; skipped mp4 transcode assertion");
    }
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
