// F4 — parallel segment rendering orchestration + worker entry (NODE-ONLY).
//
// Reuses the EXISTING partial-movie-file cache (see node.ts): each play()/wait()
// segment is encoded to `partial/{hash}.{ext}` and the final video is the ffmpeg
// concat of those partials in play order. The only thing this file changes is
// WHERE each segment is encoded — instead of one process rendering every
// segment sequentially, we shard the segments across worker_threads.
//
// PARALLELISM MECHANISM: worker_threads. Node runs `.ts` natively in this
// project, and `new Worker(fileURL_to_ts)` inherits that — verified working
// (workerData passes through, the worker's own `.ts` imports resolve). We do NOT
// use child_process; worker_threads is lighter and shares the module cache
// warm-up cost less. (If a future Node dropped native `.ts` in workers, the
// fallback would be child_process spawning `node <this-file>`; not needed here.)
//
// DETERMINISM REQUIREMENT: construct() MUST be deterministic. Each worker
// re-runs the *entire* construct() (advancing time through skipped segments to
// keep mobject state correct) and only emits frames for its assigned segments.
// The content hash of a segment must therefore be identical across workers and
// across runs. Unseeded Math.random(), Date.now(), or other nondeterminism in
// construct() will produce mismatched hashes / wrong frames. Seed any randomness.
//
// Only the standard mp4/webm(/mov) cache path is parallelized. saveLastFrame and
// png-sequence are NOT supported here (they have no segment/partial model) — the
// caller should use node.ts render() for those.

/// <reference types="node" />
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import os from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { Camera, CanvasRenderer } from "./renderer/CanvasRenderer.ts";
import { Scene, computeRenderConfigHash, computeParamsHash } from "./scene/Scene.ts";
import { QUALITIES } from "./index.ts";
import { QUALITY_PRESETS, config as manimConfig } from "./_config.ts";
import { discoverSegments, partitionSegments } from "./scene/render_frame.ts";
import type { SegmentRecord } from "./scene/render_frame.ts";
// Shared ffmpeg helpers — the single source of truth for both the sequential
// (node.ts) and parallel cache paths, keeping partial files byte-compatible.
import { encodeFrames, concatPartials, remuxCopy } from "./renderer/ffmpeg.ts";

export interface RenderParallelOptions {
  fps?: number;
  quality?: string;
  format?: string;
  outPath?: string;
  output?: string; // alias for outPath (parity with node.ts render())
  background?: string;
  pixelWidth?: number;
  pixelHeight?: number;
  resolution?: [number, number];
  workers?: number;
  verbose?: boolean;
  disableCaching?: boolean;
  camera?: any;
  /** Scene params, validated by the scene's static `schema` (same contract
   *  as node.ts render()). Salted into the partial cache key — personalized
   *  renders never collide on cached partials. */
  params?: Record<string, any>;
  /** Progress at worker-completion granularity (segmentsTotal known upfront
   *  from the discovery manifest). */
  onProgress?: (p: { segmentsDone: number; segmentsTotal: number }) => void;
  [k: string]: any;
}

// Resolve schema-validated params (undefined when the caller didn't opt in).
// Deterministic: workers and the concat step must derive the SAME resolved
// params (and thus the same cache salt) independently.
async function resolveParams(target: any, params: Record<string, any> | undefined): Promise<Record<string, any> | undefined> {
  if (params === undefined) return undefined;
  const { resolveSceneMetadata } = await import("./scene/scene_params.ts");
  const resolved = await resolveSceneMetadata(target, params);
  return resolved.params;
}

// ---------------------------------------------------------------------------
// Shared dimension/fps/format resolution — mirrors node.ts render() so partials
// produced here are byte-compatible with (and reusable by) node.ts's cache.
// ---------------------------------------------------------------------------
interface Resolved {
  fps: number;
  pixelWidth: number;
  pixelHeight: number;
  background: string;
  format: string;
  partialExt: string;
  outPath: string;
  cacheDir: string;
}

function resolveRender(options: RenderParallelOptions): Resolved {
  const quality = options.quality ?? "medium";
  const q = (QUALITIES as any)[quality] ?? (QUALITIES as any).medium;
  let pixelWidth = options.pixelWidth ?? manimConfig.pixelWidth ?? q.pixelWidth;
  let pixelHeight = options.pixelHeight ?? manimConfig.pixelHeight ?? q.pixelHeight;
  if (options.quality && QUALITY_PRESETS[options.quality]) {
    pixelWidth = options.pixelWidth ?? QUALITY_PRESETS[options.quality].pixelWidth;
    pixelHeight = options.pixelHeight ?? QUALITY_PRESETS[options.quality].pixelHeight;
  }
  if (options.resolution) [pixelWidth, pixelHeight] = options.resolution;
  const fps = options.fps
    ?? (options.quality ? QUALITY_PRESETS[options.quality]?.fps : undefined)
    ?? manimConfig.fps ?? q.fps;

  const background = options.background ?? manimConfig.background ?? "#000000";
  let format = options.format ?? "mp4";
  if (format === "png") format = "png-sequence";
  const partialExt = format === "webm" ? "webm" : format === "mov" ? "mov" : "mp4";

  const outPath = resolve(options.outPath ?? options.output ?? "output.mp4");
  const cacheDir = join(dirname(outPath), "partial");
  return { fps, pixelWidth, pixelHeight, background, format, partialExt, outPath, cacheDir };
}

// ---------------------------------------------------------------------------
// Scene module loading — dynamic import by path + export name. A module may
// export a Scene subclass, a Scene instance factory, or a plain construct fn.
// ---------------------------------------------------------------------------
async function loadSceneTarget(sceneModulePath: string, sceneExportName: string): Promise<any> {
  const url = pathToFileURL(resolve(sceneModulePath)).href;
  const mod = await import(url);
  const exp = mod[sceneExportName] ?? (sceneExportName === "default" ? mod.default : undefined);
  if (exp == null) {
    throw new Error(`Scene export "${sceneExportName}" not found in ${sceneModulePath}`);
  }
  return exp;
}

// Best-effort warmups mirroring node.ts render(): register fonts + warm MathJax
// so a scene that builds Text/MathTex during construct() works inside a worker.
async function warmupBackend(canvasMod: any, vectorFont?: string, fonts?: Array<{ path: string; name: string }>) {
  try {
    const { autoRegisterFonts, loadVectorFont } = await import("./renderer/fonts-node.ts");
    autoRegisterFonts(canvasMod.GlobalFonts);
    await loadVectorFont(vectorFont ?? "sans-serif").catch(() => null);
    if (fonts && canvasMod.GlobalFonts) {
      for (const f of fonts) canvasMod.GlobalFonts.registerFromPath(f.path, f.name);
    }
  } catch { /* fonts optional */ }
  try {
    await import("./mobject/mathtex.ts").then((m: any) => m.initMathTex());
  } catch { /* MathJax optional */ }
}

async function loadCanvasMod(): Promise<any> {
  try {
    return await import("@napi-rs/canvas");
  } catch (e: any) {
    throw new Error("@napi-rs/canvas is required for Node rendering. npm install @napi-rs/canvas\n" + e.message);
  }
}

// Build a Scene instance from a loaded target, wiring the CanvasRenderer, and
// returning both the scene and a function that runs its construct(). Shared by
// discovery (via render_frame) and the worker render path.
function buildScene(target: any, opts: { fps: number; camera: Camera; params?: Record<string, any> }): { scene: Scene; run: () => Promise<void> } {
  const { fps, camera, params } = opts;
  if (target instanceof Scene) {
    const scene = target;
    (scene as any).fps = fps;
    (scene as any).camera = camera;
    if (params !== undefined) scene.params = params;
    return { scene, run: async () => { await scene.render(); } };
  }
  if (typeof target === "function" && target.prototype instanceof Scene) {
    const scene = new target({ fps, camera, ...(params !== undefined ? { params } : {}) });
    return { scene, run: async () => { await scene.render(); } };
  }
  if (typeof target === "function") {
    // Plain construct(scene) function; params ride as the 2nd argument
    // (same contract as orchestrate.ts's runConstruct props).
    const scene = new Scene({ fps, camera, ...(params !== undefined ? { params } : {}) });
    return { scene, run: async () => { await target(scene, params); scene.finalizeSections(); } };
  }
  const scene = new Scene({ fps, camera, ...(params !== undefined ? { params } : {}) });
  return { scene, run: async () => { await scene.render(); } };
}

// ---------------------------------------------------------------------------
// PUBLIC: renderSegmentRange — render exactly the assigned segments to their
// partial files. Used by workers (and directly callable / testable).
// ---------------------------------------------------------------------------
export async function renderSegmentRange(
  sceneModulePath: string,
  sceneExportName: string,
  assignedIndices: number[],
  options: RenderParallelOptions,
): Promise<{ encoded: number; reused: number }> {
  const r = resolveRender(options);
  const verbose = options.verbose ?? false;
  const assigned = new Set(assignedIndices);

  const canvasMod = await loadCanvasMod();
  await warmupBackend(canvasMod, options.vectorFont, options.fonts);

  const { createCanvas } = canvasMod;
  const canvas = createCanvas(r.pixelWidth, r.pixelHeight);
  const ctx = canvas.getContext("2d");
  const camera = options.camera instanceof Camera
    ? options.camera
    : new Camera({ pixelWidth: r.pixelWidth, pixelHeight: r.pixelHeight, background: r.background, ...options.camera });
  camera.pixelWidth = r.pixelWidth;
  camera.pixelHeight = r.pixelHeight;
  if (!camera.background) camera.background = r.background;
  // Same factory threading as node.ts -- workers must render effects (and
  // cacheStatic offscreens) identically to the sequential path, or a
  // parallel render's partials would differ from sequential ones.
  const renderer = new CanvasRenderer(ctx, camera, { createCanvas: (w, h) => createCanvas(w, h) });

  // See Scene.ts's computeRenderConfigHash() doc comment. Must use the exact
  // same salt as node.ts's sequential path (and this file's own renderParallel()
  // concat step below) so partials stay byte-compatible/shareable between them
  // -- this file has no `transparent` option (not supported here), so it's
  // always false, matching node.ts's default when unset.
  const target = await loadSceneTarget(sceneModulePath, sceneExportName);
  const params = await resolveParams(target, options.params);
  const cacheConfigHash = computeRenderConfigHash({
    pixelWidth: r.pixelWidth, pixelHeight: r.pixelHeight, background: r.background, fps: r.fps, camera,
  }) + (params !== undefined ? `-p${computeParamsHash(params)}` : "");
  const keyed = (h: string) => `${h}-${cacheConfigHash}`;

  mkdirSync(r.cacheDir, { recursive: true });

  const { scene, run } = buildScene(target, { fps: r.fps, camera, ...(params !== undefined ? { params } : {}) });

  // Per-segment PNG buffers for assigned segments only. Segments NOT assigned to
  // this worker are skipped (frames not emitted) but time still advances — so the
  // scene state entering each assigned segment is identical to a full render.
  const segMap = new Map<number, any[]>();
  const segHashes = new Map<number, string>();
  let activeSeg = -2; // -2 = no active assigned segment; -1 = init bucket
  let reused = 0;

  scene.onSegment = (rec) => {
    segHashes.set(rec.index, rec.hash);
    if (!assigned.has(rec.index)) {
      activeSeg = -2;
      return { skip: true }; // not ours: advance time, no frames
    }
    // Ours: check the cache. If the partial already exists, skip re-encoding.
    const partialPath = join(r.cacheDir, `${keyed(rec.hash)}.${r.partialExt}`);
    if (existsSync(partialPath)) {
      reused++;
      activeSeg = -2;
      return { skip: true };
    }
    activeSeg = rec.index;
    return undefined; // emit frames for this segment
  };

  scene.frameHandler = async (mobjects) => {
    if (activeSeg < 0) return; // only buffer frames for an active assigned segment
    renderer.renderScene(mobjects);
    const buf = canvas.toBuffer("image/png");
    if (!segMap.has(activeSeg)) segMap.set(activeSeg, []);
    segMap.get(activeSeg)!.push(buf);
  };

  await run();

  // Encode each freshly-rendered assigned segment to its partial file.
  let encoded = 0;
  for (const [id, frames] of segMap) {
    if (!frames.length) continue;
    const hash = segHashes.get(id) ?? `seg${id}`;
    const partialPath = join(r.cacheDir, `${keyed(hash)}.${r.partialExt}`);
    if (!existsSync(partialPath)) {
      await encodeFrames(frames, {
        fps: r.fps, pixelWidth: r.pixelWidth, pixelHeight: r.pixelHeight,
        outPath: partialPath, format: r.format, verbose,
      });
      encoded++;
    } else {
      reused++;
    }
  }

  return { encoded, reused };
}

// ---------------------------------------------------------------------------
// PUBLIC: renderParallel — orchestrate discovery, sharding, workers, concat.
// ---------------------------------------------------------------------------
export async function renderParallel(
  sceneModulePath: string,
  sceneExportName: string,
  options: RenderParallelOptions = {},
): Promise<{ outPath: string; segments: number; workers: number; reused: number }> {
  const verbose = options.verbose ?? false;
  const r = resolveRender(options);
  const workers = Math.max(1, Math.floor(options.workers ?? Math.max(1, os.cpus().length - 2)));

  // See Scene.ts's computeRenderConfigHash() doc comment and renderSegmentRange()'s
  // matching computation above -- must reconstruct the camera the same way each
  // worker does, so this main-thread concat step's keys agree with what the
  // workers actually wrote to disk.
  const concatCamera = options.camera instanceof Camera
    ? options.camera
    : new Camera({ pixelWidth: r.pixelWidth, pixelHeight: r.pixelHeight, background: r.background, ...options.camera });
  // 1. Discover the segment manifest cheaply (no PNG encoding). Params must
  //    participate in discovery too — they can change the segment structure.
  const target = await loadSceneTarget(sceneModulePath, sceneExportName);
  const params = await resolveParams(target, options.params);
  const cacheConfigHash = computeRenderConfigHash({
    pixelWidth: r.pixelWidth, pixelHeight: r.pixelHeight, background: r.background, fps: r.fps, camera: concatCamera,
  }) + (params !== undefined ? `-p${computeParamsHash(params)}` : "");
  const keyed = (h: string) => `${h}-${cacheConfigHash}`;

  const manifest: SegmentRecord[] = await discoverSegments(
    () => target,
    undefined,
    { fps: r.fps, camera: options.camera, ...(params !== undefined ? { params } : {}) },
  );
  const segmentCount = manifest.length;

  // Fallback to sequential node.ts render() when parallelism wouldn't pay off:
  // too few segments, or a single worker. Also covers segmentCount === 0.
  if (workers <= 1 || segmentCount < 2 * workers) {
    if (verbose) {
      console.log(`[parallel] ${segmentCount} segment(s), ${workers} worker(s) — falling back to sequential render()`);
    }
    const { render } = await import("./node.ts");
    const res = await render(target, {
      output: r.outPath,
      quality: options.quality,
      format: options.format,
      fps: options.fps,
      pixelWidth: options.pixelWidth,
      pixelHeight: options.pixelHeight,
      resolution: options.resolution,
      background: options.background,
      camera: options.camera,
      verbose: options.verbose,
      vectorFont: options.vectorFont,
      fonts: options.fonts,
      params: options.params,
      onProgress: options.onProgress,
    });
    return {
      outPath: res.output ?? r.outPath,
      segments: segmentCount,
      workers: 1,
      reused: (res as any).reusedPartials ?? 0,
    };
  }

  // 2. Partition segment indices across workers, balanced by frame span.
  const buckets = partitionSegments(manifest, workers);

  mkdirSync(r.cacheDir, { recursive: true });

  // 3. Spawn one worker per non-empty bucket; each renders its assigned segments.
  const thisFileUrl = new URL(import.meta.url);
  const workerOpts: RenderParallelOptions = {
    ...options,
    // Functions can't structured-clone into workerData; progress is reported
    // from the main thread as workers finish.
    onProgress: undefined,
    outPath: r.outPath,
    // Force these into the worker so its resolveRender matches ours exactly.
    fps: r.fps,
    pixelWidth: r.pixelWidth,
    pixelHeight: r.pixelHeight,
    format: r.format,
    background: r.background,
    // A live Camera instance can't cross the worker boundary; drop it and let
    // the worker build a fresh Camera from dims/background (parity with node.ts).
    camera: options.camera instanceof Camera ? undefined : options.camera,
  };

  const jobs = buckets
    .map((indices, i) => ({ indices, i }))
    .filter((j) => j.indices.length > 0);

  let totalReused = 0;
  let segmentsDone = 0;
  options.onProgress?.({ segmentsDone: 0, segmentsTotal: segmentCount });
  const results = await Promise.all(jobs.map(({ indices }) =>
    new Promise<{ encoded: number; reused: number }>((res, rej) => {
      const w = new Worker(thisFileUrl, {
        workerData: {
          __manimParallel: true,
          sceneModulePath: resolve(sceneModulePath),
          sceneExportName,
          assignedIndices: indices,
          options: workerOpts,
        },
      });
      w.once("message", (m: any) => {
        if (m && m.ok) {
          segmentsDone += indices.length;
          options.onProgress?.({ segmentsDone, segmentsTotal: segmentCount });
          res({ encoded: m.encoded ?? 0, reused: m.reused ?? 0 });
        } else rej(new Error(m?.error ?? "worker failed"));
      });
      w.once("error", rej);
      w.once("exit", (code) => { if (code !== 0) rej(new Error(`worker exited ${code}`)); });
    }),
  ));
  for (const res of results) totalReused += res.reused;

  // 4. Concat partials in play order (init bucket, if any, would be segment -1;
  //    with a segment-per-play manifest there is no separate init bucket, so the
  //    concat list is simply the manifest's partials in order).
  const concatList: string[] = [];
  const initPartial = join(r.cacheDir, `${keyed("init")}.${r.partialExt}`);
  if (existsSync(initPartial)) concatList.push(initPartial);
  for (const rec of manifest) {
    const p = join(r.cacheDir, `${keyed(rec.hash)}.${r.partialExt}`);
    if (existsSync(p)) concatList.push(p);
  }

  if (concatList.length === 0) {
    throw new Error("renderParallel: no partial files were produced");
  } else if (concatList.length === 1) {
    await remuxCopy(concatList[0], r.outPath, verbose);
  } else {
    await concatPartials(concatList, r.outPath, verbose);
  }

  if (verbose) {
    console.log(`✓ [parallel] ${segmentCount} segment(s), ${jobs.length} worker(s) -> ${r.outPath} (${totalReused} reused)`);
  }

  return { outPath: r.outPath, segments: segmentCount, workers: jobs.length, reused: totalReused };
}

// ---------------------------------------------------------------------------
// Worker entry: when this module is loaded as a worker (workerData carries the
// job), run renderSegmentRange and report back. isMainThread guards this so the
// module is import-safe from the main thread and from tests.
// ---------------------------------------------------------------------------
if (!isMainThread && workerData && (workerData as any).__manimParallel) {
  const wd = workerData as any;
  renderSegmentRange(wd.sceneModulePath, wd.sceneExportName, wd.assignedIndices, wd.options)
    .then((r) => parentPort!.postMessage({ ok: true, ...r }))
    .catch((e) => parentPort!.postMessage({ ok: false, error: e?.stack ?? String(e) }));
}

// Allow running directly as `node src/node-parallel.ts` in a child_process
// fallback design (not used by default, but keeps that door open per spec).
// Reads a JSON job from argv[2] if present.
if (isMainThread && process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]) && process.argv[2]) {
  try {
    const job = JSON.parse(process.argv[2]);
    renderSegmentRange(job.sceneModulePath, job.sceneExportName, job.assignedIndices, job.options)
      .then((r) => { process.stdout.write(JSON.stringify({ ok: true, ...r })); process.exit(0); })
      .catch((e) => { process.stderr.write(String(e?.stack ?? e)); process.exit(1); });
  } catch (e) {
    process.stderr.write("bad job json: " + String(e));
    process.exit(2);
  }
}
