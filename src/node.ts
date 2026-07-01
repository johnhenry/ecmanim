// Node backend: render a Scene to an MP4 (or frames) using @napi-rs/canvas and
// ffmpeg. This is the "runs everywhere manim runs" path.

/// <reference types="node" />
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Camera, CanvasRenderer } from "./renderer/CanvasRenderer.ts";
import { autoRegisterFonts, loadVectorFont } from "./renderer/fonts-node.ts";
import { Scene } from "./scene/Scene.ts";
import { QUALITIES } from "./index.ts";

export * from "./index.ts";

// Options accepted by render(). All fields are optional; sensible defaults are
// applied inside the function.
export interface RenderOptions {
  output?: string;
  quality?: string;
  background?: string;
  format?: string; // "mp4" | "png-sequence" | "webm" | "gif"
  fps?: number;
  pixelWidth?: number;
  pixelHeight?: number;
  camera?: any;
  verbose?: boolean;
  vectorFont?: string;
  fonts?: Array<{ path: string; name: string }>;
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
  const {
    output = "output.mp4",
    quality = "medium",
    background = "#000000",
    format = "mp4", // "mp4" | "png-sequence" | "webm" | "gif"
    verbose = true,
  } = options;

  const q = QUALITIES[quality] ?? QUALITIES.medium;
  const pixelWidth = options.pixelWidth ?? q.pixelWidth;
  const pixelHeight = options.pixelHeight ?? q.pixelHeight;
  const fps = options.fps ?? q.fps;

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

  let ffmpeg = null;
  let frameDir = null;
  let frameIndex = 0;

  if (format === "png-sequence") {
    frameDir = outPath.replace(/\.[^.]+$/, "") + "_frames";
    mkdirSync(frameDir, { recursive: true });
  } else {
    ffmpeg = startFfmpeg({ fps, pixelWidth, pixelHeight, outPath, format, verbose });
  }

  const scene = sceneOrConstruct.prototype instanceof Scene
    ? new sceneOrConstruct({ fps, camera })
    : new Scene({ fps, camera });

  let emitted = 0;
  scene.frameHandler = async (mobjects) => {
    renderer.renderScene(mobjects);
    emitted++;
    if (frameDir) {
      writeFileSync(`${frameDir}/frame_${String(frameIndex++).padStart(6, "0")}.png`, canvas.toBuffer("image/png"));
    } else {
      const buf = canvas.toBuffer("image/png");
      await writeToStream(ffmpeg.stdin, buf);
    }
  };

  if (typeof sceneOrConstruct === "function" && !(sceneOrConstruct.prototype instanceof Scene)) {
    await sceneOrConstruct(scene);
  } else {
    await scene.render();
  }

  // Ensure at least one frame exists.
  if (emitted === 0) await scene.emitFrame();

  if (ffmpeg) {
    ffmpeg.stdin.end();
    await new Promise<void>((res, rej) => {
      ffmpeg.on("close", (code: number) => (code === 0 ? res() : rej(new Error("ffmpeg exited " + code))));
      ffmpeg.on("error", rej);
    });
  }

  // Mux any scheduled sounds into the finished video.
  if (ffmpeg && scene.sounds && scene.sounds.length) {
    await muxAudio(outPath, scene.sounds, format, verbose);
  }

  if (verbose) {
    console.log(`✓ Rendered ${emitted} frames @ ${fps}fps -> ${frameDir ?? outPath}`);
  }
  return { output: frameDir ?? outPath, frames: emitted, fps, pixelWidth, pixelHeight, sounds: scene.sounds?.length ?? 0 };
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

function startFfmpeg({ fps, pixelWidth, pixelHeight, outPath, format, verbose }: any) {
  const args = [
    "-y",
    "-f", "image2pipe",
    "-framerate", String(fps),
    "-i", "-",
    "-s", `${pixelWidth}x${pixelHeight}`,
  ];
  if (format === "webm") {
    args.push("-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30");
  } else if (format === "gif") {
    args.push("-vf", `fps=${fps},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`);
  } else {
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
