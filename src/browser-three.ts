// WebGL browser backend: same API as ./browser.js (play / record) but renders
// with Three.js on the GPU. Reuses the identical Scene / mobjects / animations.
//
//   import { play, Scene, Sphere, Create } from "ecmanim/browser-three";
//   await play(MyScene, { canvas, camera: new ThreeDCamera({ phi: 70*DEGREES }) });
//
// Three.js is loaded lazily (via an import map or bundler) or can be injected as
// options.three.

import { ThreeRenderer } from "./renderer/ThreeRenderer.ts";
import { Camera } from "./renderer/CanvasRenderer.ts";
import { ThreeDCamera } from "./scene/three_d.ts";
import { Scene } from "./scene/Scene.ts";
import { makeScene, runConstruct } from "./scene/orchestrate.ts";
import { QUALITIES } from "./index.ts";

export * from "./index.ts";
export { ThreeRenderer };

// Options accepted by the WebGL browser backend's play() / record(). All optional.
export interface ThreeOptions {
  canvas?: any;
  background?: string;
  loop?: boolean;
  quality?: string;
  pixelWidth?: number;
  pixelHeight?: number;
  fps?: number;
  camera?: any;
  mode?: string;
  antialias?: boolean;
  bitrate?: number;
  three?: any;
  // Post-processing pass config (bloom/film/glitch/LUT/custom shaders) --
  // see src/renderer/three_post.ts. Loaded via enablePostProcessing() before
  // the render loop starts.
  postProcessing?: import("./renderer/three_post.ts").PostProcessingConfig;
  [key: string]: any;
}

// import("three") result is treated as `any` (may lack precise types here).
async function loadThree(options: ThreeOptions): Promise<any> {
  return options.three ?? (await import("three"));
}



function resolveCamera(options: ThreeOptions, pixelWidth: number, pixelHeight: number, background: string): any {
  let camera = options.camera;
  if (!camera) camera = options.mode === "2d" ? new Camera() : new ThreeDCamera();
  camera.pixelWidth = pixelWidth;
  camera.pixelHeight = pixelHeight;
  if (camera.frameWidth == null) camera.frameWidth = (camera.frameHeight * pixelWidth) / pixelHeight;
  camera.background = background;
  return camera;
}

// Live real-time playback on a canvas, GPU-rendered.
export async function play(sceneOrConstruct: any, options: ThreeOptions = {}) {
  const { canvas, background = "#000000", loop = false } = options;
  if (!canvas) throw new Error("browser-three play() requires an options.canvas element");
  const THREE = await loadThree(options);

  const q = QUALITIES[options.quality ?? "medium"] ?? QUALITIES.medium;
  const pixelWidth = options.pixelWidth ?? canvas.width ?? q.pixelWidth;
  const pixelHeight = options.pixelHeight ?? canvas.height ?? q.pixelHeight;
  const fps = options.fps ?? q.fps;
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;

  const camera = resolveCamera(options, pixelWidth, pixelHeight, background);
  const renderer = new ThreeRenderer(THREE, { canvas, camera, background, antialias: options.antialias ?? true });
  if (options.postProcessing) await renderer.enablePostProcessing(options.postProcessing);
  const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));

  do {
    const scene = makeScene(sceneOrConstruct, { fps, camera });
    const start = performance.now();
    let frame = 0;
    scene.frameHandler = async (mobjects: any) => {
      renderer.render(mobjects);
      frame++;
      const target = start + (frame * 1000) / fps;
      while (performance.now() < target) await nextFrame();
    };
    await runConstruct(sceneOrConstruct, scene);
  } while (loop);

  return { canvas, renderer };
}

// Record a scene to a WebM Blob, GPU-rendered.
export async function record(sceneOrConstruct: any, options: ThreeOptions = {}) {
  const THREE = await loadThree(options);
  const q = QUALITIES[options.quality ?? "medium"] ?? QUALITIES.medium;
  const pixelWidth = options.pixelWidth ?? q.pixelWidth;
  const pixelHeight = options.pixelHeight ?? q.pixelHeight;
  const fps = options.fps ?? q.fps;
  const background = options.background ?? "#000000";

  const canvas = options.canvas ?? document.createElement("canvas");
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const camera = resolveCamera(options, pixelWidth, pixelHeight, background);
  const renderer = new ThreeRenderer(THREE, { canvas, camera, background, antialias: options.antialias ?? true });
  if (options.postProcessing) await renderer.enablePostProcessing(options.postProcessing);

  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  const chunks: any[] = [];
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: options.bitrate ?? 8_000_000 });
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.start();

  const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));
  const scene = makeScene(sceneOrConstruct, { fps, camera });
  // MediaRecorder timestamps captured frames by real wall-clock time (there is
  // no way to hand it synthetic per-frame durations), so each frame must be
  // paced to its real target time — exactly like play() below — or rAF firing
  // faster than `fps` (e.g. unthrottled headless Chrome) compresses the whole
  // clip into a fraction of its intended runTime.
  const start = performance.now();
  let frame = 0;
  scene.frameHandler = async (mobjects: any) => {
    renderer.render(mobjects);
    if (track.requestFrame) track.requestFrame();
    frame++;
    const target = start + (frame * 1000) / fps;
    // ALWAYS yield at least one rAF per frame (do-while, not while): when a
    // single render exceeds the frame budget -- e.g. post-processing bloom
    // under software GL -- a plain while-loop's condition is already false,
    // the page never yields to the browser's rendering steps, the canvas
    // never PRESENTS, and requestFrame() captures nothing: the recording
    // comes out as a header-only ~110-byte WebM with zero frames. One
    // guaranteed yield lets presentation (and the queued capture) happen.
    do { await nextFrame(); } while (performance.now() < target);
  };
  await runConstruct(sceneOrConstruct, scene);

  await new Promise<void>((res) => { recorder.onstop = () => res(); recorder.stop(); });
  return new Blob(chunks, { type: "video/webm" });
}
