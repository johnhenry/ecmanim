// Frame-snapshot test utilities: render a Scene at chosen frame indices with
// the real CPU pipeline (Camera + CanvasRenderer + @napi-rs/canvas), then
// compare raw RGBA against golden PNGs committed under test/golden/.
//
// The CPU renderer is deterministic for fixed inputs, so pixel comparison is
// meaningful. Comparison still uses a small tolerance (antialiasing can shift
// by a hair across canvas versions): a pixel "differs" when any channel is off
// by more than PER_CHANNEL; the snapshot fails when more than MAX_DIFF_RATIO
// of pixels differ. Regenerate goldens with: UPDATE_SNAPSHOTS=1 npm test

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Scene } from "../src/scene/Scene.ts";
import { Camera, CanvasRenderer } from "../src/renderer/CanvasRenderer.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const GOLDEN_DIR = join(HERE, "golden");

const PER_CHANNEL = 8;        // |channel delta| above this marks the pixel as differing
const MAX_DIFF_RATIO = 0.005; // >0.5% differing pixels fails the snapshot

export interface CaptureOptions {
  width?: number;
  height?: number;
  fps?: number;
  background?: string;
}

let canvasMod: any = null;
export async function loadNapiCanvas(): Promise<any> {
  if (canvasMod) return canvasMod;
  try {
    canvasMod = await import("@napi-rs/canvas");
  } catch {
    canvasMod = null;
  }
  return canvasMod;
}

/**
 * Run a Scene through the real render loop and capture raw RGBA at the given
 * frame indices. Frames beyond the scene's end capture the final state.
 */
export async function captureFrames(
  SceneClass: any,
  frames: number[],
  opts: CaptureOptions = {},
): Promise<Map<number, { data: Uint8ClampedArray; width: number; height: number }>> {
  const mod = await loadNapiCanvas();
  if (!mod) throw new Error("@napi-rs/canvas unavailable");
  const width = opts.width ?? 480;
  const height = opts.height ?? 270;
  const fps = opts.fps ?? 15;
  const background = opts.background ?? "#000000";

  const canvas = mod.createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const camera = new Camera({ pixelWidth: width, pixelHeight: height, background });
  const renderer = new CanvasRenderer(ctx, camera);

  const wanted = new Set(frames.map((f) => Math.max(0, Math.floor(f))));
  const captured = new Map<number, { data: Uint8ClampedArray; width: number; height: number }>();

  const scene: Scene = SceneClass.prototype instanceof Scene
    ? new SceneClass({ fps, camera })
    : new Scene({ fps, camera });
  if (!(SceneClass.prototype instanceof Scene)) {
    throw new Error("captureFrames expects a Scene subclass");
  }

  scene.frameHandler = async (mobjects: any[], frame: number) => {
    if (wanted.has(frame) && !captured.has(frame)) {
      renderer.renderScene(mobjects);
      const img = ctx.getImageData(0, 0, width, height);
      captured.set(frame, { data: new Uint8ClampedArray(img.data), width, height });
    }
  };
  await scene.construct();

  // Any requested frame past the end of the scene: capture the final state.
  for (const f of wanted) {
    if (!captured.has(f)) {
      renderer.renderScene(scene.mobjects);
      const img = ctx.getImageData(0, 0, width, height);
      captured.set(f, { data: new Uint8ClampedArray(img.data), width, height });
    }
  }
  return captured;
}

/** Encode an RGBA capture to PNG bytes (for writing goldens). */
export async function encodePNG(cap: { data: Uint8ClampedArray; width: number; height: number }): Promise<Buffer> {
  const mod = await loadNapiCanvas();
  const canvas = mod.createCanvas(cap.width, cap.height);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(cap.width, cap.height);
  img.data.set(cap.data);
  ctx.putImageData(img, 0, 0);
  return canvas.toBuffer("image/png");
}

/** Decode a golden PNG back to raw RGBA. */
export async function decodePNG(path: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const mod = await loadNapiCanvas();
  const img = await mod.loadImage(readFileSync(path));
  const canvas = mod.createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height);
  return { data: new Uint8ClampedArray(d.data), width: img.width, height: img.height };
}

export interface DiffResult {
  ok: boolean;
  diffRatio: number;
  meanAbs: number;
  differing: number;
  total: number;
}

export interface DiffTolerance {
  perChannel?: number;   // default PER_CHANNEL (8) -- looser values suit less machine-stable content (e.g. system-font text)
  maxDiffRatio?: number; // default MAX_DIFF_RATIO (0.005)
}

/** Tolerance diff of two same-size RGBA buffers. */
export function diffRGBA(
  a: { data: Uint8ClampedArray; width: number; height: number },
  b: { data: Uint8ClampedArray; width: number; height: number },
  tolerance: DiffTolerance = {},
): DiffResult {
  const perChannel = tolerance.perChannel ?? PER_CHANNEL;
  const maxDiffRatio = tolerance.maxDiffRatio ?? MAX_DIFF_RATIO;
  if (a.width !== b.width || a.height !== b.height) {
    return { ok: false, diffRatio: 1, meanAbs: 255, differing: a.width * a.height, total: a.width * a.height };
  }
  const total = a.width * a.height;
  let differing = 0;
  let sumAbs = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let maxD = 0;
    for (let c = 0; c < 3; c++) { // ignore alpha (opaque canvases)
      const d = Math.abs(a.data[i + c] - b.data[i + c]);
      sumAbs += d;
      if (d > maxD) maxD = d;
    }
    if (maxD > perChannel) differing++;
  }
  const diffRatio = differing / total;
  const meanAbs = sumAbs / (total * 3);
  return { ok: diffRatio <= maxDiffRatio, diffRatio, meanAbs, differing, total };
}

/**
 * Assert a capture matches its golden. When UPDATE_SNAPSHOTS=1 (or the golden
 * is missing and CREATE_MISSING_SNAPSHOTS != 0), writes the golden instead.
 * Returns a human-readable failure string, or null on pass/update.
 */
export async function matchSnapshot(
  name: string,
  cap: { data: Uint8ClampedArray; width: number; height: number },
): Promise<string | null> {
  mkdirSync(GOLDEN_DIR, { recursive: true });
  const goldenPath = join(GOLDEN_DIR, `${name}.png`);
  const update = process.env.UPDATE_SNAPSHOTS === "1";
  if (update || !existsSync(goldenPath)) {
    writeFileSync(goldenPath, await encodePNG(cap));
    return null;
  }
  const golden = await decodePNG(goldenPath);
  const d = diffRGBA(golden, cap);
  if (d.ok) return null;
  // Write the failing render next to the golden for human inspection.
  const actualPath = join(GOLDEN_DIR, `${name}.actual.png`);
  writeFileSync(actualPath, await encodePNG(cap));
  return `snapshot "${name}" differs: ${(d.diffRatio * 100).toFixed(2)}% of pixels ` +
    `(${d.differing}/${d.total}) beyond ±${PER_CHANNEL}/channel, mean |Δ|=${d.meanAbs.toFixed(2)}. ` +
    `Actual written to ${actualPath}; regenerate with UPDATE_SNAPSHOTS=1 if the change is intended.`;
}
