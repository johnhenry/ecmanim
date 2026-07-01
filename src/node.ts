// Node backend: render a Scene to an MP4 (or frames) using @napi-rs/canvas and
// ffmpeg. This is the "runs everywhere manim runs" path.

/// <reference types="node" />
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, renameSync, existsSync, rmSync, readdirSync } from "node:fs";
import { dirname, resolve, join, basename } from "node:path";
import { Camera, CanvasRenderer } from "./renderer/CanvasRenderer.ts";
import { autoRegisterFonts, loadVectorFont } from "./renderer/fonts-node.ts";
import { Scene } from "./scene/Scene.ts";
import { QUALITIES } from "./index.ts";
import { config as manimConfig, resolveConfig, loadConfigFile, QUALITY_PRESETS } from "./_config.ts";

export * from "./index.ts";
export { config, resolveConfig, loadConfigFile, QUALITY_PRESETS } from "./_config.ts";

// Options accepted by render(). All fields are optional; sensible defaults are
// applied inside the function.
export interface RenderOptions {
  output?: string;
  quality?: string;
  background?: string;
  format?: string; // "mp4" | "png-sequence" | "webm" | "gif" | "mov" | "png"
  fps?: number;
  pixelWidth?: number;
  pixelHeight?: number;
  resolution?: [number, number]; // [w, h] override; wins over quality/pixel*
  camera?: any;
  verbose?: boolean;
  vectorFont?: string;
  fonts?: Array<{ path: string; name: string }>;
  // manim-parity additions:
  saveLastFrame?: boolean;            // write only the final frame as PNG, no video
  transparent?: boolean;              // preserve alpha (mp4 -> .mov prores4444 fallback)
  fromAnimationNumber?: number | null; // render only play() indices >= this
  uptoAnimationNumber?: number | null; // render only play() indices <= this
  disableCaching?: boolean;           // bypass the partial-movie-file cache
  saveSections?: boolean;             // write per-section videos + JSON index
  [key: string]: any;
}

// @napi-rs/canvas is dynamically imported and may lack precise types here; treat
// its surface as `any`.
async function loadCanvas(): Promise<any> {
  try {
    return await import("@napi-rs/canvas");
  } catch (e: any) {
    throw new Error(
      "@napi-rs/canvas is required for Node rendering. Install it with:\n" +
      "  npm install @napi-rs/canvas\n" +
      "(prebuilt binaries, no system Cairo needed).\nOriginal error: " + e.message,
    );
  }
}

// Render a Scene subclass (or a construct function) to a video file.
//   await render(MyScene, { output: "out.mp4", quality: "medium" })
//   await render(async (scene) => { ... }, { output: "out.mp4" })
export async function render(sceneOrConstruct: any, options: RenderOptions = {}) {
  const verbose = options.verbose ?? true;

  // Resolve dimensions / fps: resolution > pixel* > quality preset. We use the
  // layered config so a loaded manim.config file's defaults participate, but
  // explicit options always win.
  const quality = options.quality ?? "medium";
  const q = QUALITIES[quality] ?? QUALITIES.medium;
  let pixelWidth = options.pixelWidth ?? manimConfig.pixelWidth ?? q.pixelWidth;
  let pixelHeight = options.pixelHeight ?? manimConfig.pixelHeight ?? q.pixelHeight;
  if (options.quality && QUALITY_PRESETS[options.quality]) {
    pixelWidth = options.pixelWidth ?? QUALITY_PRESETS[options.quality].pixelWidth;
    pixelHeight = options.pixelHeight ?? QUALITY_PRESETS[options.quality].pixelHeight;
  }
  if (options.resolution) { [pixelWidth, pixelHeight] = options.resolution; }
  const fps = options.fps ?? (options.quality && QUALITY_PRESETS[options.quality]?.fps) ?? manimConfig.fps ?? q.fps;

  const background = options.background ?? manimConfig.background ?? "#000000";
  const transparent = options.transparent ?? false;
  const saveLastFrame = options.saveLastFrame ?? false;
  const disableCaching = options.disableCaching ?? manimConfig.disable_caching ?? false;
  const saveSections = options.saveSections ?? manimConfig.save_sections ?? false;
  const fromNum = options.fromAnimationNumber ?? null;
  const uptoNum = options.uptoAnimationNumber ?? null;

  // Resolve the output path + effective format. transparent mp4 has no clean
  // path, so fall back to a .mov/prores4444 container (manim's behavior).
  let output = options.output ?? "output.mp4";
  let format = options.format ?? "mp4"; // "mp4" | "png-sequence" | "webm" | "gif" | "mov" | "png"
  if (format === "png") format = "png-sequence";
  if (transparent && format === "mp4") {
    format = "mov";
    output = output.replace(/\.mp4$/i, ".mov");
    if (!/\.mov$/i.test(output)) output += ".mov";
  }
  if (transparent && format === "mov") {
    // ensure .mov extension
    if (!/\.mov$/i.test(output)) output = output.replace(/\.[^.]+$/, ".mov");
  }

  const { createCanvas, GlobalFonts } = await loadCanvas();
  autoRegisterFonts(GlobalFonts);
  await loadVectorFont(options.vectorFont ?? "sans-serif").catch(() => null); // for VText
  // Warm MathJax so MathTex(...) construction is synchronous inside construct().
  await import("./mobject/mathtex.ts").then((m) => m.initMathTex()).catch(() => null);
  if (options.fonts && GlobalFonts) {
    for (const f of options.fonts) GlobalFonts.registerFromPath(f.path, f.name);
  }

  const canvas = createCanvas(pixelWidth, pixelHeight);
  const ctx = canvas.getContext("2d");
  // options.camera may be a ready-made Camera instance (e.g. a ThreeDCamera) or
  // a plain config object.
  const camera = options.camera instanceof Camera
    ? options.camera
    : new Camera({ pixelWidth, pixelHeight, background, ...options.camera });
  camera.pixelWidth = pixelWidth;
  camera.pixelHeight = pixelHeight;
  if (!camera.background) camera.background = background;
  const renderer = new CanvasRenderer(ctx, camera);

  const outPath = resolve(output);
  mkdirSync(dirname(outPath), { recursive: true });

  const scene = sceneOrConstruct.prototype instanceof Scene
    ? new sceneOrConstruct({ fps, camera })
    : new Scene({ fps, camera });

  // Range filtering (from/upto animation number). When active we mark segments
  // outside the range as skipped so their frames are not emitted, but time still
  // advances so downstream mobject state is correct.
  if (fromNum != null || uptoNum != null) {
    scene.onSegment = (rec) => {
      const below = fromNum != null && rec.index < fromNum;
      const above = uptoNum != null && rec.index > uptoNum;
      return (below || above) ? { skip: true } : undefined;
    };
  }

  // --- saveLastFrame: render everything, keep only the final drawn frame, write
  //     it as a single PNG, and return (no video). ---
  if (saveLastFrame) {
    const pngPath = outPath.replace(/\.[^.]+$/, "") + ".png";
    let lastBuf: any = null;
    scene.frameHandler = async (mobjects) => {
      renderer.renderScene(mobjects);
      lastBuf = canvas.toBuffer("image/png");
    };
    await runConstruct(sceneOrConstruct, scene);
    if (!lastBuf) { renderer.renderScene(scene.mobjects); lastBuf = canvas.toBuffer("image/png"); }
    writeFileSync(pngPath, lastBuf);
    if (verbose) console.log(`✓ Saved last frame -> ${pngPath}`);
    return { output: pngPath, frames: 1, fps, pixelWidth, pixelHeight, sounds: scene.sounds?.length ?? 0, lastFrame: true };
  }

  // --- png-sequence: write numbered PNGs to a directory. ---
  if (format === "png-sequence") {
    const frameDir = outPath.replace(/\.[^.]+$/, "") + "_frames";
    mkdirSync(frameDir, { recursive: true });
    let frameIndex = 0;
    let emitted = 0;
    scene.frameHandler = async (mobjects) => {
      renderer.renderScene(mobjects);
      emitted++;
      writeFileSync(`${frameDir}/frame_${String(frameIndex++).padStart(6, "0")}.png`, canvas.toBuffer("image/png"));
    };
    await runConstruct(sceneOrConstruct, scene);
    if (emitted === 0) await scene.emitFrame();
    if (verbose) console.log(`✓ Rendered ${emitted} frames @ ${fps}fps -> ${frameDir}`);
    return { output: frameDir, frames: emitted, fps, pixelWidth, pixelHeight, sounds: scene.sounds?.length ?? 0 };
  }

  // --- Caching path: render each play()/wait segment to its own partial movie
  //     file keyed by content hash; reuse unchanged partials; concat to final. ---
  const cacheDir = join(dirname(outPath), "partial");
  let emitted = 0;
  let reusedPartials = 0;
  const useCache = !disableCaching && (fromNum == null && uptoNum == null);

  if (useCache) {
    mkdirSync(cacheDir, { recursive: true });
    const partialExt = format === "webm" ? "webm" : format === "mov" ? "mov" : "mp4";

    // Group emitted frames by segment id. `-1` is the pre-first-play bucket
    // (initial frames). Each play()/wait bumps activeSeg to rec.index; a segment
    // whose partial already exists on disk is skipped (frames not re-buffered).
    const segMap = new Map<number, any[]>();       // segId -> PNG buffers
    const segHashes = new Map<number, string>();   // segId -> content hash
    let activeSeg = -1;

    scene.onSegment = (rec) => {
      activeSeg = rec.index;
      segHashes.set(rec.index, rec.hash);
      const partialPath = join(cacheDir, `${rec.hash}.${partialExt}`);
      const reuse = existsSync(partialPath);
      if (reuse) reusedPartials++;
      return reuse ? { skip: true } : undefined;
    };
    scene.frameHandler = async (mobjects) => {
      renderer.renderScene(mobjects);
      emitted++;
      const buf = canvas.toBuffer("image/png");
      if (!segMap.has(activeSeg)) segMap.set(activeSeg, []);
      segMap.get(activeSeg)!.push(buf);
    };

    await runConstruct(sceneOrConstruct, scene);
    if (emitted === 0 && segMap.size === 0) { await scene.emitFrame(); }

    // Encode any freshly-rendered segments to their partial files.
    for (const [id, frames] of segMap) {
      const hash = id < 0 ? "init" : (segHashes.get(id) ?? `seg${id}`);
      const partialPath = join(cacheDir, `${hash}.${partialExt}`);
      if (!existsSync(partialPath) && frames.length) {
        await encodeFrames(frames, { fps, pixelWidth, pixelHeight, outPath: partialPath, format, transparent, verbose });
      }
    }

    // Build the concat order: the init bucket first, then one partial per
    // play()/wait record (in play order). Reused segments contribute their
    // existing on-disk partial.
    const concatList: string[] = [];
    if (segMap.has(-1)) {
      const p = join(cacheDir, `init.${partialExt}`);
      if (existsSync(p)) concatList.push(p);
    }
    for (const rec of scene.playRecords) {
      const p = join(cacheDir, `${rec.hash}.${partialExt}`);
      if (existsSync(p)) concatList.push(p);
    }

    if (concatList.length === 0) {
      // No segments at all — encode whatever the init bucket has straight to out.
      const initFrames = segMap.get(-1) ?? [];
      if (initFrames.length) await encodeFrames(initFrames, { fps, pixelWidth, pixelHeight, outPath, format, transparent, verbose });
    } else if (concatList.length === 1) {
      await remuxCopy(concatList[0], outPath, verbose);
    } else {
      await concatPartials(concatList, outPath, verbose);
    }

    if (scene.sounds && scene.sounds.length) {
      await muxAudio(outPath, scene.sounds, format, verbose);
    }
    if (saveSections) await writeSections(scene, outPath, format, verbose);

    if (verbose) {
      console.log(`✓ Rendered ${emitted} frames @ ${fps}fps -> ${outPath} (${reusedPartials} partial(s) reused)`);
    }
    return { output: outPath, frames: emitted, fps, pixelWidth, pixelHeight, sounds: scene.sounds?.length ?? 0, reusedPartials, cached: true };
  }

  // --- Single-stream path (caching disabled or range filtering active). ---
  const ffmpeg = startFfmpeg({ fps, pixelWidth, pixelHeight, outPath, format, transparent, verbose });
  scene.frameHandler = async (mobjects) => {
    renderer.renderScene(mobjects);
    emitted++;
    const buf = canvas.toBuffer("image/png");
    await writeToStream(ffmpeg.stdin, buf);
  };

  await runConstruct(sceneOrConstruct, scene);
  if (emitted === 0) await scene.emitFrame();

  ffmpeg.stdin.end();
  await new Promise<void>((res, rej) => {
    ffmpeg.on("close", (code: number) => (code === 0 ? res() : rej(new Error("ffmpeg exited " + code))));
    ffmpeg.on("error", rej);
  });

  if (scene.sounds && scene.sounds.length) {
    await muxAudio(outPath, scene.sounds, format, verbose);
  }
  if (saveSections) await writeSections(scene, outPath, format, verbose);

  if (verbose) {
    console.log(`✓ Rendered ${emitted} frames @ ${fps}fps -> ${outPath}`);
  }
  return { output: outPath, frames: emitted, fps, pixelWidth, pixelHeight, sounds: scene.sounds?.length ?? 0 };
}

// Run a Scene subclass's construct() (or a plain construct function).
async function runConstruct(sceneOrConstruct: any, scene: Scene): Promise<void> {
  if (typeof sceneOrConstruct === "function" && !(sceneOrConstruct.prototype instanceof Scene)) {
    await sceneOrConstruct(scene);
    scene.finalizeSections();
  } else {
    await scene.render();
  }
}

/** Delete the partial-movie-file cache directory next to an output path. */
export function flushCache(outputOrDir: string): void {
  const p = resolve(outputOrDir);
  // Accept either an output file (whose sibling `partial/` is cleared) or a dir.
  let dir = p;
  try {
    if (existsSync(p) && !readdirSync(p)) { /* is dir */ }
  } catch { dir = dirname(p); }
  const partial = existsSync(join(p, "partial")) ? join(p, "partial") : join(dirname(p), "partial");
  if (existsSync(partial)) rmSync(partial, { recursive: true, force: true });
}

// Encode an in-memory array of PNG frame buffers to a movie file.
async function encodeFrames(frames: any[], opts: any): Promise<void> {
  const { outPath } = opts;
  mkdirSync(dirname(outPath), { recursive: true });
  const ff = startFfmpeg(opts);
  for (const buf of frames) await writeToStream(ff.stdin, buf);
  ff.stdin.end();
  await new Promise<void>((res, rej) => {
    ff.on("close", (code: number) => (code === 0 ? res() : rej(new Error("ffmpeg partial exited " + code))));
    ff.on("error", rej);
  });
}

// Concatenate partial movie files into the final output using ffmpeg's concat
// demuxer (stream copy — no re-encode). Robust: falls back to re-encode concat
// if stream-copy concat fails (e.g. mismatched partials).
async function concatPartials(partials: string[], outPath: string, verbose: boolean): Promise<void> {
  const listPath = outPath.replace(/\.[^.]+$/, "") + ".concat.txt";
  const body = partials.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
  writeFileSync(listPath, body);
  const args = ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath];
  const ok = await runFfmpeg(args, verbose);
  if (!ok) {
    // Re-encode fallback.
    const args2 = ["-y", "-f", "concat", "-safe", "0", "-i", listPath, outPath];
    await runFfmpeg(args2, verbose, true);
  }
  if (existsSync(listPath)) rmSync(listPath);
}

// Copy/remux a single partial to the final output (stream copy).
async function remuxCopy(src: string, outPath: string, verbose: boolean): Promise<void> {
  const ok = await runFfmpeg(["-y", "-i", src, "-c", "copy", outPath], verbose);
  if (!ok) await runFfmpeg(["-y", "-i", src, outPath], verbose, true);
}

function runFfmpeg(args: string[], verbose: boolean, throwOnFail = false): Promise<boolean> {
  return new Promise<boolean>((res, rej) => {
    const ff = spawn("ffmpeg", args, { stdio: ["ignore", "inherit", verbose ? "inherit" : "ignore"] });
    ff.on("close", (code: number) => {
      if (code === 0) res(true);
      else if (throwOnFail) rej(new Error("ffmpeg exited " + code));
      else res(false);
    });
    ff.on("error", (e) => (throwOnFail ? rej(e) : res(false)));
  });
}

// Write each section to media/sections/<name>.<ext> and a <Scene>.json index in
// manim's sections format: [{ name, type, video, id, ... }].
async function writeSections(scene: Scene, outPath: string, format: string, verbose: boolean): Promise<void> {
  scene.finalizeSections();
  if (!scene.sections || scene.sections.length === 0) return;
  const ext = format === "webm" ? "webm" : format === "mov" ? "mov" : "mp4";
  const sectionsDir = join(dirname(outPath), "sections");
  mkdirSync(sectionsDir, { recursive: true });
  const sceneName = basename(outPath).replace(/\.[^.]+$/, "");
  const fps = scene.fps;
  const index: any[] = [];
  for (const sec of scene.sections) {
    const videoName = `${sceneName}_${String(sec.id).padStart(4, "0")}.${ext}`;
    const videoPath = join(sectionsDir, videoName);
    const start = sec.startFrame / fps;
    const dur = Math.max(0, (sec.endFrame - sec.startFrame) / fps);
    // Extract the section's time range from the full output (re-encode to be safe).
    const args = ["-y", "-ss", String(start), "-i", outPath, "-t", String(dur || 1 / fps), videoPath];
    await runFfmpeg(args, verbose, false);
    index.push({
      name: sec.name,
      type: sec.type,
      video: videoName,
      codec_name: format === "webm" ? "vp9" : format === "mov" ? "prores" : "h264",
      width: scene.camera?.pixelWidth ?? 0,
      height: scene.camera?.pixelHeight ?? 0,
      avg_frame_rate: `${fps}/1`,
      duration: dur,
      nb_frames: sec.endFrame - sec.startFrame,
      id: sec.id,
    });
  }
  writeFileSync(join(sectionsDir, `${sceneName}.json`), JSON.stringify(index, null, 2));
  if (verbose) console.log(`✓ Wrote ${index.length} section(s) -> ${sectionsDir}`);
}

// Overlay scheduled audio clips onto a rendered video with ffmpeg (delay each to
// its start time, apply gain, mix, and remux keeping the video stream as-is).
async function muxAudio(videoPath: string, sounds: any[], format: string, verbose: boolean) {
  const inputs = ["-i", videoPath];
  const filters: string[] = [];
  const labels: string[] = [];
  sounds.forEach((s: any, i: number) => {
    inputs.push("-i", resolve(s.file));
    const d = Math.max(0, Math.round((s.time ?? 0) * 1000));
    filters.push(`[${i + 1}:a]adelay=${d}|${d},volume=${s.gain ?? 1}[a${i}]`);
    labels.push(`[a${i}]`);
  });
  const filterComplex = sounds.length === 1
    ? filters[0]
    : `${filters.join(";")};${labels.join("")}amix=inputs=${sounds.length}:normalize=0[aout]`;
  const audioLabel = sounds.length === 1 ? "[a0]" : "[aout]";
  const audioCodec = format === "webm" ? "libopus" : "aac";
  const tmp = videoPath.replace(/(\.[^.]+)$/, ".withaudio$1");

  const args = [
    "-y", ...inputs,
    "-filter_complex", filterComplex,
    "-map", "0:v", "-map", audioLabel,
    "-c:v", "copy", "-c:a", audioCodec, tmp,
  ];
  await new Promise<void>((res, rej) => {
    const ff = spawn("ffmpeg", args, { stdio: ["ignore", "inherit", verbose ? "inherit" : "ignore"] });
    ff.on("close", (code: number) => (code === 0 ? res() : rej(new Error("ffmpeg audio mux exited " + code))));
    ff.on("error", rej);
  });
  renameSync(tmp, videoPath);
}

// Load a bitmap for ImageMobject (Node: via @napi-rs/canvas).
export async function loadImage(src: any) {
  const { loadImage: load } = await loadCanvas();
  return load(src);
}

// Convenience: load an image file straight into an ImageMobject.
export async function imageMobject(src: any, config: any = {}) {
  const { ImageMobject } = await import("./mobject/image_mobject.ts");
  return new ImageMobject(await loadImage(src), config);
}

// Load an SVG file into an SVGMobject (Node: read from disk).
export async function loadSVG(path: string, config: any = {}) {
  const { readFileSync } = await import("node:fs");
  const { SVGMobject } = await import("./mobject/svg_mobject.ts");
  return new SVGMobject(readFileSync(resolve(path), "utf8"), config);
}

// Node-only plugin loader (the analog of manim.cfg's `[CLI] plugins`). Accepts a
// config object `{ plugins: [...] }` or a path to a manim.config.{js,json} that
// default-exports one. Each entry is a plugin object or a module specifier whose
// default export is the plugin. Registered via the shared registry.
export async function loadPlugins(config: string | { plugins?: any[] } = "manim.config.js") {
  const { registry } = await import("./index.ts");
  let cfg: any = config;
  if (typeof config === "string") {
    const { pathToFileURL } = await import("node:url");
    const p = resolve(config);
    if (p.endsWith(".json")) {
      const { readFileSync } = await import("node:fs");
      cfg = JSON.parse(readFileSync(p, "utf8"));
    } else {
      const mod = await import(pathToFileURL(p).href);
      cfg = mod.default ?? mod;
    }
  }
  for (const entry of cfg?.plugins ?? []) {
    const plugin = typeof entry === "string" ? (await import(entry)).default : entry;
    if (plugin) registry.use(plugin);
  }
  return registry;
}

function startFfmpeg({ fps, pixelWidth, pixelHeight, outPath, format, transparent, verbose }: any) {
  const args = [
    "-y",
    "-f", "image2pipe",
    "-framerate", String(fps),
    "-i", "-",
    "-s", `${pixelWidth}x${pixelHeight}`,
  ];
  if (format === "webm") {
    // VP9 with alpha (yuva420p) — transparent by default, as before.
    args.push("-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30");
  } else if (format === "gif") {
    args.push("-vf", `fps=${fps},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`);
  } else if (format === "mov") {
    // ProRes 4444 preserves an alpha channel — the transparent-capable mp4 path.
    args.push("-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le");
  } else {
    // mp4 / h264. h264 cannot store alpha, so transparency is only honored via
    // the .mov (prores) fallback chosen in render(); here we keep yuv420p.
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "18", "-movflags", "+faststart");
  }
  args.push(outPath);
  const ff = spawn("ffmpeg", args, { stdio: ["pipe", "inherit", verbose ? "inherit" : "ignore"] });
  return ff;
}

function writeToStream(stream: any, buf: any) {
  return new Promise<void>((res) => {
    if (!stream.write(buf)) stream.once("drain", res);
    else res();
  });
}
