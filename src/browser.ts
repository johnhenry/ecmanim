// Browser backend: play a Scene live on a <canvas> in real time, and/or record
// it to a WebM Blob via MediaRecorder. This is the "plus the browser" path — it
// reuses the exact same Scene / mobjects / renderer as the Node backend.

import { Camera, CanvasRenderer } from "./renderer/CanvasRenderer.ts";
import { Scene } from "./scene/Scene.ts";
import { QUALITIES } from "./index.ts";

// GIF/MP4 encoders. These are plain, browser-safe ESM/CJS modules, so importing
// them here does NOT run any browser-only code — the module graph loads fine in
// Node (used by some tests that import this file). gifenc ships as CJS whose
// named exports Node's ESM loader cannot statically detect, so we import the
// gifenc / mp4-muxer are imported LAZILY (only when recordGif/recordMp4 run) so
// that importing this module — and the unbundled browser demos — never needs a
// bare "gifenc"/"mp4-muxer" specifier to resolve. Loaded on first use.
async function loadGifenc(): Promise<any> {
  const pkg: any = await import("gifenc");
  // Browser ESM exposes named exports on the namespace; Node CJS puts them on
  // `default`. Prefer whichever actually carries GIFEncoder.
  return pkg.GIFEncoder ? pkg : (pkg.default ?? pkg);
}
async function loadMp4Muxer(): Promise<any> {
  return await import("mp4-muxer");
}

export * from "./index.ts";

// The <manim-player> Web Component wraps the Player. It references HTMLElement,
// so it lives on the browser entry only (never index.ts). Import is Node-safe:
// the class body is built lazily and defineManimPlayer() no-ops without a DOM.
export { ManimPlayerElement, defineManimPlayer } from "./web-component.ts";

// VideoMobject (browser): <video>/WebCodecs-backed frame providers.
export { loadVideo, LiveVideoProvider, PreCapturedProvider, WebCodecsProvider, webCodecsAvailable } from "./video-browser.ts";
export type { LoadVideoBrowserOptions } from "./video-browser.ts";

// Options accepted by the browser backend's play() / record(). All optional.
export interface BrowserOptions {
  canvas?: any;
  background?: string;
  loop?: boolean;
  quality?: string;
  pixelWidth?: number;
  pixelHeight?: number;
  fps?: number;
  camera?: any;
  mimeType?: string;
  bitrate?: number;
  [key: string]: any;
}

function makeScene(sceneOrConstruct: any, config: any) {
  if (sceneOrConstruct.prototype instanceof Scene) return new sceneOrConstruct(config);
  return new Scene(config);
}

async function runConstruct(sceneOrConstruct: any, scene: any) {
  if (typeof sceneOrConstruct === "function" && !(sceneOrConstruct.prototype instanceof Scene)) {
    await sceneOrConstruct(scene);
  } else {
    await scene.render();
  }
}

// Play a scene live on a canvas element at real-time speed.
//   await play(MyScene, { canvas, quality: "medium" })
export async function play(sceneOrConstruct: any, options: BrowserOptions = {}) {
  const { canvas, background = "#000000", loop = false } = options;
  if (!canvas) throw new Error("browser play() requires an options.canvas element");

  const q = QUALITIES[options.quality ?? "medium"] ?? QUALITIES.medium;
  const pixelWidth = options.pixelWidth ?? canvas.width ?? q.pixelWidth;
  const pixelHeight = options.pixelHeight ?? canvas.height ?? q.pixelHeight;
  const fps = options.fps ?? q.fps;
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;

  const ctx = canvas.getContext("2d");
  const camera = new Camera({ pixelWidth, pixelHeight, background, ...options.camera });
  const renderer = new CanvasRenderer(ctx, camera);

  const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));

  do {
    const scene = makeScene(sceneOrConstruct, { fps, camera });
    const start = performance.now();
    let frame = 0;
    const played = new Set<any>();
    scene.frameHandler = async (mobjects: any) => {
      renderer.renderScene(mobjects);
      // Fire scheduled sounds as the animation clock reaches them.
      for (const s of scene.sounds) {
        if (!played.has(s) && (s.time ?? 0) <= scene.time) {
          played.add(s);
          playSound(s);
        }
      }
      frame++;
      // Throttle to real-time based on target fps.
      const target = start + (frame * 1000) / fps;
      while (performance.now() < target) await nextFrame();
    };
    await runConstruct(sceneOrConstruct, scene);
  } while (loop);

  return { canvas };
}

function playSound(s: any) {
  try {
    const audio = new Audio(s.file);
    audio.volume = Math.max(0, Math.min(1, s.gain ?? 1));
    audio.play().catch(() => {});
  } catch { /* no audio available */ }
}

// Load an SVG file into an SVGMobject (browser: fetch the URL).
export async function loadSVG(url: string, config: any = {}) {
  const { SVGMobject } = await import("./mobject/svg_mobject.ts");
  const text = await fetch(url).then((r) => r.text());
  return new SVGMobject(text, config);
}

// Load a bitmap for ImageMobject (browser).
export async function loadImage(src: any) {
  if (typeof createImageBitmap === "function" && src instanceof Blob) return createImageBitmap(src);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  if (img.decode) { try { await img.decode(); return img; } catch { /* fall through */ } }
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  return img;
}

// Record a scene to a WebM Blob (offline, as fast as the browser allows).
//   const blob = await record(MyScene, { quality: "high" });
export async function record(sceneOrConstruct: any, options: BrowserOptions = {}) {
  const q = QUALITIES[options.quality ?? "medium"] ?? QUALITIES.medium;
  const pixelWidth = options.pixelWidth ?? q.pixelWidth;
  const pixelHeight = options.pixelHeight ?? q.pixelHeight;
  const fps = options.fps ?? q.fps;
  const background = options.background ?? "#000000";

  const canvas = options.canvas ?? document.createElement("canvas");
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const ctx = canvas.getContext("2d");
  const camera = new Camera({ pixelWidth, pixelHeight, background, ...options.camera });
  const renderer = new CanvasRenderer(ctx, camera);

  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const mime = options.mimeType ?? (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9" : "video/webm");
  const chunks: any[] = [];
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: options.bitrate ?? 8_000_000 });
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.start();

  const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));
  const scene = makeScene(sceneOrConstruct, { fps, camera });
  scene.frameHandler = async (mobjects: any) => {
    renderer.renderScene(mobjects);
    // Push exactly one frame into the capture stream.
    if (track.requestFrame) track.requestFrame();
    await nextFrame();
  };
  await runConstruct(sceneOrConstruct, scene);

  await new Promise<void>((res) => { recorder.onstop = () => res(); recorder.stop(); });
  return new Blob(chunks, { type: "video/webm" });
}

// Convenience: trigger a browser download of a recorded scene.
export async function downloadWebM(sceneOrConstruct: any, filename = "scene.webm", options: BrowserOptions = {}) {
  const blob = await record(sceneOrConstruct, options);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return blob;
}

// ---------------------------------------------------------------------------
// Shared frame-driving helper
// ---------------------------------------------------------------------------
// Sets up a canvas + renderer, drives the Scene's frameHandler exactly like
// record(), and invokes onFrame(ctx, canvas) once per emitted frame. Returns the
// resolved { pixelWidth, pixelHeight, fps }. Browser-only (needs document unless
// a canvas is supplied).
async function driveFrames(
  sceneOrConstruct: any,
  options: BrowserOptions,
  onFrame: (ctx: any, canvas: any, frame: number) => void | Promise<void>,
) {
  const q = QUALITIES[options.quality ?? "medium"] ?? QUALITIES.medium;
  const pixelWidth = options.pixelWidth ?? q.pixelWidth;
  const pixelHeight = options.pixelHeight ?? q.pixelHeight;
  const fps = options.fps ?? q.fps;
  const background = options.background ?? "#000000";

  let canvas = options.canvas;
  if (!canvas) {
    if (typeof document === "undefined") {
      throw new Error("recording requires an options.canvas or a browser document");
    }
    canvas = document.createElement("canvas");
  }
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const ctx = canvas.getContext("2d");
  const camera = new Camera({ pixelWidth, pixelHeight, background, ...options.camera });
  const renderer = new CanvasRenderer(ctx, camera);

  let frame = 0;
  const scene = makeScene(sceneOrConstruct, { fps, camera });
  scene.frameHandler = async (mobjects: any) => {
    renderer.renderScene(mobjects);
    await onFrame(ctx, canvas, frame);
    frame++;
  };
  await runConstruct(sceneOrConstruct, scene);

  return { canvas, ctx, pixelWidth, pixelHeight, fps, frames: frame };
}

// ---------------------------------------------------------------------------
// GIF recording (gifenc)
// ---------------------------------------------------------------------------
// Render each frame, grab pixels, and encode an animated GIF. The frame delay
// is derived from fps. maxColors caps the per-frame palette (<=256).
//   const blob = await recordGif(MyScene, { quality: "medium", fps: 30 });
export async function recordGif(sceneOrConstruct: any, options: BrowserOptions = {}): Promise<Blob> {
  if (typeof document === "undefined" && !options.canvas) {
    throw new Error("recordGif() is browser-only: needs a document or options.canvas");
  }
  const { GIFEncoder, quantize, applyPalette } = await loadGifenc();
  if (typeof GIFEncoder !== "function") {
    throw new Error("recordGif() requires the 'gifenc' package (GIFEncoder/quantize/applyPalette unavailable)");
  }

  const maxColors = Math.max(2, Math.min(256, options.maxColors ?? 256));
  const gif = GIFEncoder();
  let delay = 100; // ms per frame, set once fps is known

  const { fps, frames } = await driveFrames(sceneOrConstruct, options, (ctx, canvas, frame) => {
    if (frame === 0) delay = Math.round(1000 / (options.fps ?? 30));
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    // Per-frame palette so colors track the animation faithfully.
    const palette = quantize(data, maxColors);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, width, height, { palette, delay });
  });
  delay = Math.round(1000 / fps);
  if (frames === 0) {
    throw new Error("recordGif() produced no frames");
  }

  gif.finish();
  const bytes = gif.bytes() as Uint8Array;
  return new Blob([bytes as any], { type: "image/gif" });
}

// Convenience: trigger a browser download of a recorded GIF.
export async function downloadGif(sceneOrConstruct: any, filename = "scene.gif", options: BrowserOptions = {}) {
  const blob = await recordGif(sceneOrConstruct, options);
  triggerDownload(blob, filename);
  return blob;
}

// ---------------------------------------------------------------------------
// MP4 recording (WebCodecs + mp4-muxer)
// ---------------------------------------------------------------------------
// Encode each rendered frame with a WebCodecs VideoEncoder (H.264, VP9 fallback)
// and mux into an MP4. Requires a browser with WebCodecs support.
//   const blob = await recordMp4(MyScene, { quality: "high", bitrate: 8_000_000 });
export async function recordMp4(sceneOrConstruct: any, options: BrowserOptions = {}): Promise<Blob> {
  if (typeof document === "undefined" && !options.canvas) {
    throw new Error("recordMp4() is browser-only: needs a document or options.canvas");
  }
  const VE: any = (globalThis as any).VideoEncoder;
  const VF: any = (globalThis as any).VideoFrame;
  if (typeof VE !== "function" || typeof VF !== "function") {
    throw new Error("recordMp4() requires the WebCodecs API (VideoEncoder/VideoFrame) — unavailable in this environment");
  }

  const q = QUALITIES[options.quality ?? "medium"] ?? QUALITIES.medium;
  const pixelWidth = options.pixelWidth ?? q.pixelWidth;
  const pixelHeight = options.pixelHeight ?? q.pixelHeight;
  const fps = options.fps ?? q.fps;
  const bitrate = options.bitrate ?? 8_000_000;

  // Pick a supported codec: prefer H.264, fall back to VP9.
  const avc = "avc1.42001f";
  const vp9 = "vp09.00.10.08";
  let codec = avc;
  let muxerCodec: "avc" | "vp9" = "avc";
  if (typeof VE.isConfigSupported === "function") {
    const avcOk = await VE.isConfigSupported({ codec: avc, width: pixelWidth, height: pixelHeight })
      .then((r: any) => r?.supported).catch(() => false);
    if (!avcOk) {
      const vpOk = await VE.isConfigSupported({ codec: vp9, width: pixelWidth, height: pixelHeight })
        .then((r: any) => r?.supported).catch(() => false);
      if (!vpOk) throw new Error("recordMp4(): neither H.264 nor VP9 is supported by this browser's VideoEncoder");
      codec = vp9;
      muxerCodec = "vp9";
    }
  }

  const { Muxer, ArrayBufferTarget } = await loadMp4Muxer();
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: muxerCodec, width: pixelWidth, height: pixelHeight },
    fastStart: "in-memory",
  } as any);

  const encoder = new VE({
    output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
    error: (e: any) => { throw e; },
  });
  encoder.configure({
    codec,
    width: pixelWidth,
    height: pixelHeight,
    bitrate,
    framerate: fps,
  });

  const frameDurationUs = Math.round(1_000_000 / fps);

  const { frames } = await driveFrames(sceneOrConstruct, { ...options, pixelWidth, pixelHeight, fps }, (_ctx, canvas, frame) => {
    const timestamp = frame * frameDurationUs;
    const vf = new VF(canvas, { timestamp, duration: frameDurationUs });
    // Force a keyframe on the first frame for a clean, seekable file.
    encoder.encode(vf, { keyFrame: frame === 0 });
    vf.close();
  });

  if (frames === 0) {
    throw new Error("recordMp4() produced no frames");
  }

  await encoder.flush();
  encoder.close();
  muxer.finalize();
  return new Blob([target.buffer], { type: "video/mp4" });
}

// Convenience: trigger a browser download of a recorded MP4.
export async function downloadMp4(sceneOrConstruct: any, filename = "scene.mp4", options: BrowserOptions = {}) {
  const blob = await recordMp4(sceneOrConstruct, options);
  triggerDownload(blob, filename);
  return blob;
}

// ---------------------------------------------------------------------------
// Unified dispatcher + download helper
// ---------------------------------------------------------------------------
export interface RecordVideoOptions extends BrowserOptions {
  format?: "webm" | "gif" | "mp4";
}

// Record a scene to the chosen container format.
//   const blob = await recordVideo(MyScene, { format: "mp4", quality: "high" });
export async function recordVideo(sceneOrConstruct: any, options: RecordVideoOptions = {}): Promise<Blob> {
  const format = options.format ?? "webm";
  switch (format) {
    case "gif": return recordGif(sceneOrConstruct, options);
    case "mp4": return recordMp4(sceneOrConstruct, options);
    case "webm": return record(sceneOrConstruct, options);
    default: throw new Error(`recordVideo(): unknown format '${format}' (expected 'webm' | 'gif' | 'mp4')`);
  }
}

// Shared browser-download helper (used by downloadGif / downloadMp4).
function triggerDownload(blob: Blob, filename: string) {
  if (typeof document === "undefined") {
    throw new Error("download helpers are browser-only (no document available)");
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
