// Node backend: render a Scene to an MP4 (or frames) using @napi-rs/canvas and
// ffmpeg. This is the "runs everywhere manim runs" path.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Camera, CanvasRenderer } from "./renderer/CanvasRenderer.js";
import { autoRegisterFonts } from "./renderer/fonts-node.js";
import { Scene } from "./scene/Scene.js";
import { QUALITIES } from "./index.js";

export * from "./index.js";

async function loadCanvas() {
  try {
    return await import("@napi-rs/canvas");
  } catch (e) {
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
export async function render(sceneOrConstruct, options = {}) {
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
  if (options.fonts && GlobalFonts) {
    for (const f of options.fonts) GlobalFonts.registerFromPath(f.path, f.name);
  }

  const canvas = createCanvas(pixelWidth, pixelHeight);
  const ctx = canvas.getContext("2d");
  const camera = new Camera({ pixelWidth, pixelHeight, background, ...options.camera });
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
    await new Promise((res, rej) => {
      ffmpeg.on("close", (code) => (code === 0 ? res() : rej(new Error("ffmpeg exited " + code))));
      ffmpeg.on("error", rej);
    });
  }

  if (verbose) {
    console.log(`✓ Rendered ${emitted} frames @ ${fps}fps -> ${frameDir ?? outPath}`);
  }
  return { output: frameDir ?? outPath, frames: emitted, fps, pixelWidth, pixelHeight };
}

function startFfmpeg({ fps, pixelWidth, pixelHeight, outPath, format, verbose }) {
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

function writeToStream(stream, buf) {
  return new Promise((res) => {
    if (!stream.write(buf)) stream.once("drain", res);
    else res();
  });
}
