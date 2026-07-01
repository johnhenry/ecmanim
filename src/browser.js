// Browser backend: play a Scene live on a <canvas> in real time, and/or record
// it to a WebM Blob via MediaRecorder. This is the "plus the browser" path — it
// reuses the exact same Scene / mobjects / renderer as the Node backend.

import { Camera, CanvasRenderer } from "./renderer/CanvasRenderer.js";
import { Scene } from "./scene/Scene.js";
import { QUALITIES } from "./index.js";

export * from "./index.js";

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

// Play a scene live on a canvas element at real-time speed.
//   await play(MyScene, { canvas, quality: "medium" })
export async function play(sceneOrConstruct, options = {}) {
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

  const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

  do {
    const scene = makeScene(sceneOrConstruct, { fps, camera });
    const start = performance.now();
    let frame = 0;
    scene.frameHandler = async (mobjects) => {
      renderer.renderScene(mobjects);
      frame++;
      // Throttle to real-time based on target fps.
      const target = start + (frame * 1000) / fps;
      while (performance.now() < target) await nextFrame();
    };
    await runConstruct(sceneOrConstruct, scene);
  } while (loop);

  return { canvas };
}

// Record a scene to a WebM Blob (offline, as fast as the browser allows).
//   const blob = await record(MyScene, { quality: "high" });
export async function record(sceneOrConstruct, options = {}) {
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
  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: options.bitrate ?? 8_000_000 });
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.start();

  const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
  const scene = makeScene(sceneOrConstruct, { fps, camera });
  scene.frameHandler = async (mobjects) => {
    renderer.renderScene(mobjects);
    // Push exactly one frame into the capture stream.
    if (track.requestFrame) track.requestFrame();
    await nextFrame();
  };
  await runConstruct(sceneOrConstruct, scene);

  await new Promise((res) => { recorder.onstop = res; recorder.stop(); });
  return new Blob(chunks, { type: "video/webm" });
}

// Convenience: trigger a browser download of a recorded scene.
export async function downloadWebM(sceneOrConstruct, filename = "scene.webm", options = {}) {
  const blob = await record(sceneOrConstruct, options);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return blob;
}
