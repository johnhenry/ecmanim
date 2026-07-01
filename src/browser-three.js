// WebGL browser backend: same API as ./browser.js (play / record) but renders
// with Three.js on the GPU. Reuses the identical Scene / mobjects / animations.
//
//   import { play, Scene, Sphere, Create } from "manim-js/browser-three";
//   await play(MyScene, { canvas, camera: new ThreeDCamera({ phi: 70*DEGREES }) });
//
// Three.js is loaded lazily (via an import map or bundler) or can be injected as
// options.three.

import { ThreeRenderer } from "./renderer/ThreeRenderer.js";
import { Camera } from "./renderer/CanvasRenderer.js";
import { ThreeDCamera } from "./scene/three_d.js";
import { Scene } from "./scene/Scene.js";
import { QUALITIES } from "./index.js";

export * from "./index.js";
export { ThreeRenderer };

async function loadThree(options) {
  return options.three ?? (await import("three"));
}

function makeScene(sceneOrConstruct, config) {
  if (sceneOrConstruct.prototype instanceof Scene) return new sceneOrConstruct(config);
  return new Scene(config);
}

async function runConstruct(sceneOrConstruct, scene) {
  if (typeof sceneOrConstruct === "function" && !(sceneOrConstruct.prototype instanceof Scene)) {
    await sceneOrConstruct(scene);
  } else {
    await scene.render();
  }
}

function resolveCamera(options, pixelWidth, pixelHeight, background) {
  let camera = options.camera;
  if (!camera) camera = options.mode === "2d" ? new Camera() : new ThreeDCamera();
  camera.pixelWidth = pixelWidth;
  camera.pixelHeight = pixelHeight;
  if (camera.frameWidth == null) camera.frameWidth = (camera.frameHeight * pixelWidth) / pixelHeight;
  camera.background = background;
  return camera;
}

// Live real-time playback on a canvas, GPU-rendered.
export async function play(sceneOrConstruct, options = {}) {
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
  const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

  do {
    const scene = makeScene(sceneOrConstruct, { fps, camera });
    const start = performance.now();
    let frame = 0;
    scene.frameHandler = async (mobjects) => {
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
export async function record(sceneOrConstruct, options = {}) {
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

  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: options.bitrate ?? 8_000_000 });
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.start();

  const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
  const scene = makeScene(sceneOrConstruct, { fps, camera });
  scene.frameHandler = async (mobjects) => {
    renderer.render(mobjects);
    if (track.requestFrame) track.requestFrame();
    await nextFrame();
  };
  await runConstruct(sceneOrConstruct, scene);

  await new Promise((res) => { recorder.onstop = res; recorder.stop(); });
  return new Blob(chunks, { type: "video/webm" });
}
