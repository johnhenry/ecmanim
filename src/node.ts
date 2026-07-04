// Node backend: render a Scene to an MP4 (or frames) using @napi-rs/canvas and
// ffmpeg. This is the "runs everywhere manim runs" path.

/// <reference types="node" />
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, renameSync, existsSync, rmSync, readdirSync } from "node:fs";
import { dirname, resolve, join, basename } from "node:path";
import { Camera, CanvasRenderer } from "./renderer/CanvasRenderer.ts";
import { autoRegisterFonts, loadVectorFont, loadVectorFontSync, resolveFontPath } from "./renderer/fonts-node.ts";
import { registerNodeFontAutoLoader } from "./mobject/vectorized_text.ts";
import { Scene } from "./scene/Scene.ts";
import { makeScene, runConstruct } from "./scene/orchestrate.ts";
import { QUALITIES } from "./index.ts";
import { config as manimConfig, resolveConfig, loadConfigFile, QUALITY_PRESETS } from "./_config.ts";
import { startFfmpeg, writeToStream, encodeFrames, runFfmpeg, concatPartials, remuxCopy } from "./renderer/ffmpeg.ts";

// Once ecmanim/node has been imported, Text/VText/VectorDecimalNumber lazily
// auto-resolve a default system font the first time none is registered yet
// (issue #16) -- so a caller who measures/constructs Text ahead of a
// render() call no longer needs to remember an explicit loadVectorFont()
// call to avoid the raster/CHAR_ASPECT estimate fallback. Registration
// itself is free; the actual fc-match/directory-scan cost is only paid
// lazily, on that first real lookup.
registerNodeFontAutoLoader(() => loadVectorFontSync());

export * from "./index.ts";
// Force-load (and register as the library default) a specific system vector
// font ahead of time -- e.g. to pick a non-default `pattern`, or to pay the
// fc-match/scan cost eagerly instead of at the first Text construction.
// Text/VText already auto-load a default font lazily on first use (above),
// so this is no longer required just to avoid the raster/estimate fallback.
export { loadVectorFont, loadVectorFontSync, resolveFontPath };
export { MathTexDvisvgm, mathTexDvisvgm, mathTexDvisvgmOrFallback, texToSVGViaDvisvgm, detectDvisvgmToolchain } from "./mobject/mathtex_dvisvgm.ts";
export { config, resolveConfig, loadConfigFile, QUALITY_PRESETS } from "./_config.ts";
// Parallel segment rendering (worker_threads over the partial-movie cache).
export { renderParallel, renderSegmentRange } from "./node-parallel.ts";
export { discoverSegments, partitionSegments } from "./scene/render_frame.ts";
export type { SegmentRecord } from "./scene/render_frame.ts";
// Opt-in headless GPU/WebGL rendering (drives the Three.js backend inside a
// CDP-accessible Chrome; see docs/renderers.md).
export { renderGL } from "./node-gl.ts";
export type { RenderGLOptions } from "./node-gl.ts";
export { probeCDP, connectCDP } from "./renderer/cdp.ts";
// VideoMobject (Node): ffmpeg-backed frame extraction + decode cache.
export { loadVideo } from "./video-node.ts";
export type { LoadVideoOptions } from "./video-node.ts";
export { probeVideo, extractFrames } from "./renderer/ffmpeg.ts";
export type { ProbeResult } from "./renderer/ffmpeg.ts";
// Watermark overlay (Phase 5) — also applied automatically via the `watermark` render option.
export { applyWatermark } from "./core/watermark.ts";
export type { WatermarkConfig, WatermarkPosition } from "./core/watermark.ts";
// Voiceover / TTS-synced narration (Phase 3).
export { voiceover, parseBookmarks, VoiceoverTracker } from "./voiceover/voiceover.ts";
export type { VoiceoverOptions, Bookmark } from "./voiceover/voiceover.ts";
export {
  registerTTSProvider, getTTSProvider, listTTSProviders, resolveTTSProvider,
  audioDurationSeconds, silentProvider, systemProvider, openaiProvider, elevenLabsProvider,
} from "./voiceover/providers.ts";
export type { TTSProvider, TTSResult, TTSSynthesizeOptions, WordBoundary } from "./voiceover/providers.ts";

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
  // Remotion-style additions:
  params?: Record<string, any>;       // scene params validated by a static `schema`
  // Phase 1 additions:
  style?: string;                     // named STYLE_PRESET (e.g. "3b1b-dark")
  aspectRatio?: string;               // named ASPECT_RATIO_PRESET (e.g. "9:16") or "W:H"
  stillFrame?: number;                // capture exactly this frame index as PNG (see renderStill)
  watermark?: import("./core/watermark.ts").WatermarkConfig; // burn a text/image watermark
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

// Render a single still frame (by frame index or time in seconds) to a PNG.
//   await renderStill(MyScene, { output: "poster.png", time: 1.5 })
export async function renderStill(
  sceneOrConstruct: any,
  options: RenderOptions & { frame?: number; time?: number } = {},
) {
  const fps = options.fps ?? (options.quality ? QUALITIES[options.quality]?.fps : undefined) ?? QUALITIES.medium.fps;
  const frame = options.frame ?? Math.round((options.time ?? 0) * fps);
  return render(sceneOrConstruct, { ...options, output: options.output ?? "still.png", stillFrame: frame });
}

// Render a Scene subclass (or a construct function) to a video file.
//   await render(MyScene, { output: "out.mp4", quality: "medium" })
//   await render(async (scene) => { ... }, { output: "out.mp4" })
export async function render(sceneOrConstruct: any, options: RenderOptions = {}) {
  const verbose = options.verbose ?? true;

  // F8: resolve schema-validated params + calculateMetadata (Remotion-style). A
  // scene may expose a static `schema` (validates options.params) and/or a
  // static/instance `calculateMetadata` computing fps/width/height. Its result
  // is a fallback layer below explicit options.
  let sceneMeta: any = {};
  try {
    const { resolveSceneMetadata } = await import("./scene/scene_params.ts");
    const resolved = await resolveSceneMetadata(sceneOrConstruct, options.params);
    sceneMeta = resolved.metadata ?? {};
  } catch (e) {
    if (options.params !== undefined) throw e; // opted in -> surface schema errors
  }

  // Resolve dimensions / fps: resolution > pixel* > quality preset. We use the
  // layered config so a loaded manim.config file's defaults participate, but
  // explicit options always win.
  const quality = options.quality ?? "medium";
  const q = QUALITIES[quality] ?? QUALITIES.medium;
  let pixelWidth = options.pixelWidth ?? sceneMeta.width ?? manimConfig.pixelWidth ?? q.pixelWidth;
  let pixelHeight = options.pixelHeight ?? sceneMeta.height ?? manimConfig.pixelHeight ?? q.pixelHeight;
  if (options.quality && QUALITY_PRESETS[options.quality]) {
    pixelWidth = options.pixelWidth ?? QUALITY_PRESETS[options.quality].pixelWidth;
    pixelHeight = options.pixelHeight ?? QUALITY_PRESETS[options.quality].pixelHeight;
  }
  if (options.resolution) { [pixelWidth, pixelHeight] = options.resolution; }
  // Phase 1: style/aspect presets. Aspect ratio overrides dimensions; the style
  // preset supplies a background/font look. Explicit options still win.
  const { resolveStyle, resolveAspectRatio } = await import("./core/presets.ts");
  const stylePreset = resolveStyle(options.style);
  if (options.aspectRatio) {
    const ar = resolveAspectRatio(options.aspectRatio, options.pixelHeight ?? undefined);
    if (ar) {
      pixelWidth = options.pixelWidth ?? ar.pixelWidth;
      pixelHeight = options.pixelHeight ?? ar.pixelHeight;
    }
  }
  const fps = options.fps ?? (options.quality && QUALITY_PRESETS[options.quality]?.fps) ?? sceneMeta.fps ?? manimConfig.fps ?? q.fps;

  const background = options.background ?? stylePreset?.background ?? manimConfig.background ?? "#000000";
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
  // F5: register the async-asset preloads as delayRender blockers, then await the
  // gate. This unifies font/MathJax warm-up with any user delayRender() calls so
  // render() only proceeds once every registered asset has resolved.
  const { delayRenderUntil, waitForRender } = await import("./core/async_gate.ts");
  delayRenderUntil(loadVectorFont(options.vectorFont ?? stylePreset?.font ?? "sans-serif").catch(() => null), "font"); // for VText
  // Warm MathJax so MathTex(...) construction is synchronous inside construct().
  delayRenderUntil(import("./mobject/mathtex.ts").then((m) => m.initMathTex()).catch(() => null), "mathjax");
  await waitForRender();
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

  const scene = makeScene(sceneOrConstruct, { fps, camera });

  // Range filtering (from/upto animation number). When active we mark segments
  // outside the range as skipped so their frames are not emitted, but time still
  // advances so downstream mobject state is correct.
  if (fromNum != null || uptoNum != null) {
    scene.onSegment = (rec: { index: number; kind: string; hash: string; startFrame: number }) => {
      const below = fromNum != null && rec.index < fromNum;
      const above = uptoNum != null && rec.index > uptoNum;
      return (below || above) ? { skip: true } : undefined;
    };
  }

  // --- renderStill: capture exactly one frame (by index) as PNG and return. ---
  if (options.stillFrame != null) {
    const target = Math.max(0, Math.floor(options.stillFrame));
    const pngPath = outPath.replace(/\.[^.]+$/, "") + ".png";
    let captured: any = null;
    scene.frameHandler = async (mobjects: any, frame: number) => {
      if (frame === target && captured == null) {
        renderer.renderScene(mobjects);
        captured = canvas.toBuffer("image/png");
      }
    };
    await runConstruct(sceneOrConstruct, scene);
    if (captured == null) { renderer.renderScene(scene.mobjects); captured = canvas.toBuffer("image/png"); }
    writeFileSync(pngPath, captured);
    if (verbose) console.log(`✓ Saved still frame ${target} -> ${pngPath}`);
    return { output: pngPath, frame: target, fps, pixelWidth, pixelHeight, sounds: 0, still: true };
  }

  // --- svg: emit resolution-independent vector output. With saveLastFrame a
  //     single .svg; otherwise a numbered .svg sequence. Uses the SVGRenderer
  //     (same camera projection as canvas). See docs/renderers.md. ---
  if (format === "svg") {
    const { SVGRenderer } = await import("./renderer/SVGRenderer.ts");
    const svg = new SVGRenderer(camera, { background: transparent ? null : (background as string) });
    if (saveLastFrame) {
      const svgPath = outPath.replace(/\.[^.]+$/, "") + ".svg";
      let last = "";
      scene.frameHandler = async (mobjects: any[]) => { last = svg.renderToString(mobjects); };
      await runConstruct(sceneOrConstruct, scene);
      if (!last) last = svg.renderToString(scene.mobjects);
      writeFileSync(svgPath, last);
      if (verbose) console.log(`✓ Saved SVG -> ${svgPath}`);
      return { output: svgPath, frames: 1, fps, pixelWidth, pixelHeight, sounds: scene.sounds?.length ?? 0, sections: scene.sections, lastFrame: true };
    }
    const frameDir = outPath.replace(/\.[^.]+$/, "") + "_svg";
    mkdirSync(frameDir, { recursive: true });
    let frameIndex = 0, emitted = 0;
    scene.frameHandler = async (mobjects: any[]) => {
      emitted++;
      writeFileSync(`${frameDir}/frame_${String(frameIndex++).padStart(6, "0")}.svg`, svg.renderToString(mobjects));
    };
    await runConstruct(sceneOrConstruct, scene);
    if (verbose) console.log(`✓ Wrote ${emitted} SVG frames -> ${frameDir}`);
    return { output: frameDir, frames: emitted, fps, pixelWidth, pixelHeight, sounds: scene.sounds?.length ?? 0, sections: scene.sections };
  }

  // --- saveLastFrame: render everything, keep only the final drawn frame, write
  //     it as a single PNG, and return (no video). ---
  if (saveLastFrame) {
    const pngPath = outPath.replace(/\.[^.]+$/, "") + ".png";
    let lastBuf: any = null;
    scene.frameHandler = async (mobjects: any[]) => {
      renderer.renderScene(mobjects);
      lastBuf = canvas.toBuffer("image/png");
    };
    await runConstruct(sceneOrConstruct, scene);
    if (!lastBuf) { renderer.renderScene(scene.mobjects); lastBuf = canvas.toBuffer("image/png"); }
    writeFileSync(pngPath, lastBuf);
    if (verbose) console.log(`✓ Saved last frame -> ${pngPath}`);
    return { output: pngPath, frames: 1, fps, pixelWidth, pixelHeight, sounds: scene.sounds?.length ?? 0, sections: scene.sections, lastFrame: true };
  }

  // --- png-sequence: write numbered PNGs to a directory. ---
  if (format === "png-sequence") {
    const frameDir = outPath.replace(/\.[^.]+$/, "") + "_frames";
    mkdirSync(frameDir, { recursive: true });
    let frameIndex = 0;
    let emitted = 0;
    scene.frameHandler = async (mobjects: any[]) => {
      renderer.renderScene(mobjects);
      emitted++;
      writeFileSync(`${frameDir}/frame_${String(frameIndex++).padStart(6, "0")}.png`, canvas.toBuffer("image/png"));
    };
    await runConstruct(sceneOrConstruct, scene);
    if (emitted === 0) await scene.emitFrame();
    if (verbose) console.log(`✓ Rendered ${emitted} frames @ ${fps}fps -> ${frameDir}`);
    return { output: frameDir, frames: emitted, fps, pixelWidth, pixelHeight, sounds: scene.sounds?.length ?? 0, sections: scene.sections };
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

    scene.onSegment = (rec: { index: number; kind: string; hash: string; startFrame: number }) => {
      activeSeg = rec.index;
      segHashes.set(rec.index, rec.hash);
      const partialPath = join(cacheDir, `${rec.hash}.${partialExt}`);
      const reuse = existsSync(partialPath);
      if (reuse) reusedPartials++;
      return reuse ? { skip: true } : undefined;
    };
    scene.frameHandler = async (mobjects: any[]) => {
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
    if (options.watermark) await (await import("./core/watermark.ts")).applyWatermark(outPath, options.watermark);
    return { output: outPath, frames: emitted, fps, pixelWidth, pixelHeight, sounds: scene.sounds?.length ?? 0, sections: scene.sections, reusedPartials, cached: true };
  }

  // --- Single-stream path (caching disabled or range filtering active). ---
  const ffmpeg = startFfmpeg({ fps, pixelWidth, pixelHeight, outPath, format, transparent, verbose });
  scene.frameHandler = async (mobjects: any[]) => {
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
  if (options.watermark) await (await import("./core/watermark.ts")).applyWatermark(outPath, options.watermark);
  return { output: outPath, frames: emitted, fps, pixelWidth, pixelHeight, sounds: scene.sounds?.length ?? 0, sections: scene.sections };
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

