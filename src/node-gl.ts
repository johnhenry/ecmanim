// Opt-in headless GPU / WebGL render path for Node (`renderGL`).
//
// This renders a Scene through the EXISTING Three.js/WebGL browser backend
// (./browser-three.ts) inside a headless Chrome that exposes WebGL2 via Mesa
// llvmpipe, then captures the resulting video back to disk here in Node. It is
// the GPU-quality alternative to the default CPU Canvas-2D renderer in
// ./node.ts: it gives real per-pixel lighting, hardware MSAA and GPU strokes,
// and it runs with NO physical GPU (software rasterization inside Chrome).
//
// How it works:
//   1. An ephemeral static file server (node:http) serves the project `root`
//      (which must contain dist/browser-three.js) plus a generated harness HTML.
//   2. The harness imports { record } from the served browser-three bundle and
//      imports the user's scene module, calls record() to get a WebM Blob, and
//      base64-encodes it onto window.__glResult.
//   3. A zero-dep CDP client (./renderer/cdp.ts) drives a headless Chrome to
//      load that harness, waits for window.__glDone, and reads the base64 back.
//   4. The bytes are decoded to a temp .webm and (optionally) transcoded to
//      mp4/mov via the shared ffmpeg helpers (./renderer/ffmpeg.ts).
//
// DETERMINISM WARNING: unlike the CPU renderer, GL output depends on the GPU
// driver / Mesa version / Chrome build, so it is NOT bit-reproducible. Do not
// feed GL output into the content-hash partial-movie cache used by node.ts —
// treat each renderGL() as a fresh, standalone encode.
//
// Node-only: uses node:http, node:fs, node:path and global fetch/WebSocket.

/// <reference types="node" />

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { writeFileSync, mkdirSync, existsSync, rmSync, statSync } from "node:fs";
import { resolve, join, dirname, extname } from "node:path";
import { tmpdir } from "node:os";
import { QUALITIES } from "./index.ts";
import { runFfmpeg, remuxCopy } from "./renderer/ffmpeg.ts";
import { connectCDP, probeCDP } from "./renderer/cdp.ts";

export interface RenderGLOptions {
  sceneModule: string;      // path (relative to `root`) to a BROWSER-importable ES module exporting the scene
  sceneExport?: string;     // named export (default "default")
  root?: string;            // dir to serve over http (default process.cwd()); must contain dist/browser-three.js
  cdpUrl?: string;          // default "http://localhost:9222" (or env MANIM_CDP_URL)
  output?: string;          // default "output.mp4"
  format?: string;          // "webm" (native) | "mp4" | "mov"  (mp4/mov => transcode via ffmpeg)
  fps?: number;
  quality?: string;
  pixelWidth?: number;
  pixelHeight?: number;
  background?: string;
  camera?: any;
  mode?: string;
  antialias?: boolean;
  // Post-processing pass config (src/renderer/three_post.ts). Threaded to
  // browser-three's record() through the harness page, which JSON.stringifys
  // the record options -- so this must stay JSON-serializable: use lut.url
  // (not lut.texture) and plain-value custom uniforms via this path.
  postProcessing?: import("./renderer/three_post.ts").PostProcessingConfig;
  verbose?: boolean;
  timeoutMs?: number;       // how long to wait for the page to finish (default 120000)
}

export interface RenderGLResult {
  output: string;
  format: string;
  bytes: number;
  renderer: "gl";
}

const DEFAULT_CDP_URL = "http://localhost:9222";

// Minimal MIME table for the ephemeral static server.
const MIME: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".ts": "text/javascript",
  ".json": "application/json",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".map": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
};

export function mimeFor(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

// Resolve pixel dims / fps / cdpUrl from options + quality preset + env. Pure.
export function resolveGLDims(opts: RenderGLOptions): {
  pixelWidth: number; pixelHeight: number; fps: number; cdpUrl: string;
  format: string; output: string; background: string;
} {
  const q = QUALITIES[opts.quality ?? "medium"] ?? QUALITIES.medium;
  const pixelWidth = opts.pixelWidth ?? q.pixelWidth;
  const pixelHeight = opts.pixelHeight ?? q.pixelHeight;
  const fps = opts.fps ?? q.fps;
  const cdpUrl = opts.cdpUrl ?? process.env.MANIM_CDP_URL ?? DEFAULT_CDP_URL;
  const output = opts.output ?? "output.mp4";
  let format = opts.format;
  if (!format) {
    // Infer from output extension, default mp4.
    const ext = extname(output).toLowerCase();
    format = ext === ".webm" ? "webm" : ext === ".mov" ? "mov" : "mp4";
  }
  const background = opts.background ?? "#000000";
  return { pixelWidth, pixelHeight, fps, cdpUrl, format, output, background };
}

// Build the ffmpeg argument vector to transcode the captured WebM into the
// requested container. Pure (returns null when a plain remux/copy suffices).
//   mp4 -> H.264 / yuv420p
//   mov -> ProRes 4444 (prores_ks profile 4)
export function transcodeArgs(tmpWebm: string, output: string, format: string): string[] | null {
  if (format === "webm") return null; // native; caller copies/moves the file
  if (format === "mp4") {
    return [
      "-y", "-i", tmpWebm,
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-preset", "medium", "-crf", "18", "-movflags", "+faststart",
      output,
    ];
  }
  if (format === "mov") {
    return [
      "-y", "-i", tmpWebm,
      "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuv422p10le",
      output,
    ];
  }
  // Unknown format: fall back to a container copy via remuxCopy (null signal).
  return null;
}

// Build the harness HTML. Pure — no I/O. The returned document:
//   * declares an import map so `three` and `ecmanim/browser-three` resolve to
//     the served URLs (browser-three.js imports `three` bare);
//   * imports { record } from browser-three and the scene module's export;
//   * creates a <canvas> sized to the pixel dims and calls record();
//   * base64-encodes the returned Blob (FileReader.readAsDataURL) and sets
//     window.__glResult = { b64, type, error } + window.__glDone = true.
export function buildGLHarness(opts: {
  sceneModuleUrl: string;
  sceneExport: string;
  browserThreeUrl: string;
  threeUrl?: string;
  recordOptions: any;
}): string {
  const { sceneModuleUrl, sceneExport, browserThreeUrl, threeUrl = "/node_modules/three/build/three.module.js", recordOptions } = opts;
  const exportName = sceneExport || "default";
  // A dynamic import() is used (not a static `import ... from`) so the statement
  // can live inside the try/catch and any load error is surfaced on
  // window.__glResult.error rather than being a top-level parse error.
  const importSpec = exportName === "default"
    ? `const Scene = (await import(${JSON.stringify(sceneModuleUrl)})).default;`
    : `const Scene = (await import(${JSON.stringify(sceneModuleUrl)})).${exportName};`;
  const recordJson = JSON.stringify(recordOptions ?? {});
  const width = recordOptions?.pixelWidth ?? 1280;
  const height = recordOptions?.pixelHeight ?? 720;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>ecmanim GL harness</title>
<script type="importmap">
{
  "imports": {
    "three": ${JSON.stringify(threeUrl)},
    "three/addons/": "/node_modules/three/examples/jsm/",
    "ecmanim/browser-three": ${JSON.stringify(browserThreeUrl)}
  }
}
</script>
<style>html,body{margin:0;background:#000;} canvas{display:block;}</style>
</head>
<body>
<canvas id="stage" width="${width}" height="${height}"></canvas>
<script type="module">
  window.__glDone = false;
  window.__glResult = { b64: null, type: null, error: null };
  try {
    const THREE = await import("three");
    const { record } = await import("ecmanim/browser-three");
    ${importSpec}
    const canvas = document.getElementById("stage");
    const recordOptions = Object.assign({}, ${recordJson}, { canvas, three: THREE });
    const blob = await record(Scene, recordOptions);
    const b64 = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onerror = () => rej(fr.error || new Error("FileReader failed"));
      fr.onload = () => {
        const s = String(fr.result || "");
        const comma = s.indexOf(",");
        res(comma >= 0 ? s.slice(comma + 1) : s);
      };
      fr.readAsDataURL(blob);
    });
    window.__glResult = { b64, type: blob.type || "video/webm", error: null };
  } catch (err) {
    window.__glResult = { b64: null, type: null, error: String((err && err.stack) || err) };
  } finally {
    window.__glDone = true;
  }
</script>
</body>
</html>`;
}

const HARNESS_PATH = "/__manim_gl_harness.html";

// Render a scene through the GPU/WebGL backend inside headless Chrome and write
// the captured video to disk. See file header for the design.
export async function renderGL(options: RenderGLOptions): Promise<RenderGLResult> {
  const verbose = options.verbose ?? false;
  const log = (...a: any[]) => { if (verbose) console.log("[renderGL]", ...a); };

  const { pixelWidth, pixelHeight, fps, cdpUrl, format, output, background } = resolveGLDims(options);
  const root = resolve(options.root ?? process.cwd());
  const sceneExport = options.sceneExport ?? "default";
  const timeoutMs = options.timeoutMs ?? 120_000;

  // 1. The GL renderer requires a CDP-accessible Chrome; the CPU renderer needs
  //    none. Fail early with a clear, actionable message.
  if (!(await probeCDP(cdpUrl))) {
    throw new Error(
      `renderGL: no Chrome DevTools endpoint reachable at ${cdpUrl}. ` +
      `The GPU/WebGL render path needs a headless Chrome exposing the DevTools Protocol ` +
      `(e.g. \`google-chrome --headless --remote-debugging-port=9222\`, WebGL2 via Mesa llvmpipe). ` +
      `Set it via options.cdpUrl or env MANIM_CDP_URL. ` +
      `If you don't have one, use the default CPU renderer (render() in "ecmanim/node"), which needs no browser.`,
    );
  }

  // Sanity: the served bundle must exist.
  const bundlePath = join(root, "dist", "browser-three.js");
  if (!existsSync(bundlePath)) {
    throw new Error(
      `renderGL: ${bundlePath} not found. Build the project first (\`npm run build\`) so ` +
      `dist/browser-three.js exists under root (${root}).`,
    );
  }

  // Record options handed to the browser record() call. Only serializable bits;
  // `three` and `canvas` are injected in the harness.
  const recordOptions: any = {
    fps,
    quality: options.quality ?? "medium",
    pixelWidth,
    pixelHeight,
    background,
    mode: options.mode,
    antialias: options.antialias ?? true,
  };
  if (options.camera !== undefined) recordOptions.camera = options.camera;
  if (options.postProcessing !== undefined) recordOptions.postProcessing = options.postProcessing;

  const harnessHtml = buildGLHarness({
    sceneModuleUrl: normalizeServedUrl(options.sceneModule),
    sceneExport,
    browserThreeUrl: "/dist/browser-three.js",
    recordOptions,
  });

  // 2. Start the ephemeral static server on 127.0.0.1 : ephemeral port.
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
      if (urlPath === HARNESS_PATH) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(harnessHtml);
        return;
      }
      // Prevent path traversal; resolve within root.
      const safe = resolve(root, "." + urlPath);
      if (!safe.startsWith(root)) {
        res.writeHead(403); res.end("forbidden"); return;
      }
      const data = await readFile(safe);
      res.writeHead(200, { "content-type": mimeFor(safe) });
      res.end(data);
    } catch {
      res.writeHead(404); res.end("not found");
    }
  });

  let cdp: any = null;
  const tmpWebm = join(tmpdir(), `manim-gl-${process.pid}-${Date.now()}.webm`);

  try {
    const port: number = await new Promise((res, rej) => {
      server.once("error", rej);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        res(typeof addr === "object" && addr ? addr.port : 0);
      });
    });
    log(`static server on http://127.0.0.1:${port} (root=${root})`);

    // 3. Drive Chrome: navigate to the harness, wait for load, poll __glDone.
    cdp = await connectCDP(cdpUrl);
    const harnessUrl = `http://127.0.0.1:${port}${HARNESS_PATH}`;
    log(`navigating headless Chrome to ${harnessUrl}`);
    await cdp.navigate(harnessUrl);
    await cdp.waitForLoad(30_000).catch(() => { /* still poll below */ });

    const deadline = Date.now() + timeoutMs;
    let done = false;
    while (Date.now() < deadline) {
      const r = await cdp.evaluate("window.__glDone === true", { returnByValue: true });
      if (r?.result?.value === true) { done = true; break; }
      await sleep(250);
    }
    if (!done) throw new Error(`renderGL: timed out after ${timeoutMs}ms waiting for the page to finish rendering`);

    // 4. Read the result back.
    const rr = await cdp.evaluate("window.__glResult", { returnByValue: true });
    const result = rr?.result?.value ?? {};
    if (result.error) throw new Error("renderGL: page rendering failed: " + result.error);
    if (!result.b64) throw new Error("renderGL: page produced no video data (empty __glResult.b64)");

    // Decode base64 -> Buffer -> temp .webm.
    const buf = Buffer.from(result.b64, "base64");
    if (buf.length === 0) throw new Error("renderGL: decoded video buffer is empty");
    writeFileSync(tmpWebm, buf);
    log(`captured ${buf.length} bytes of WebM`);

    // 5. Finalize into requested container.
    const outPath = resolve(output);
    mkdirSync(dirname(outPath), { recursive: true });

    if (format === "webm") {
      // Native: just move the bytes into place.
      writeFileSync(outPath, buf);
    } else {
      const args = transcodeArgs(tmpWebm, outPath, format);
      if (args) {
        const ok = await runFfmpeg(args, verbose, false);
        if (!ok) {
          // Fallback: container remux/copy.
          await remuxCopy(tmpWebm, outPath, verbose);
        }
      } else {
        await remuxCopy(tmpWebm, outPath, verbose);
      }
    }

    const bytes = existsSync(outPath) ? statSync(outPath).size : 0;
    if (bytes === 0) throw new Error("renderGL: output file is empty after finalize");
    log(`wrote ${outPath} (${bytes} bytes, format=${format})`);

    return { output: outPath, format, bytes, renderer: "gl" };
  } finally {
    // Always tear down the CDP target, websocket, temp file, and server.
    if (cdp) { try { await cdp.close(); } catch { /* ignore */ } }
    if (existsSync(tmpWebm)) { try { rmSync(tmpWebm, { force: true }); } catch { /* ignore */ } }
    await new Promise<void>((res) => server.close(() => res()));
  }
}

// Ensure a scene-module path is a root-relative served URL ("/path/to/mod.js").
function normalizeServedUrl(p: string): string {
  if (/^https?:\/\//.test(p)) return p;
  let u = p.replace(/\\/g, "/");
  if (!u.startsWith("/")) u = "/" + u;
  return u;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
