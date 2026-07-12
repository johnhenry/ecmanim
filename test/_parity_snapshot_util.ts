// Golden-frame regression checks for already-rendered parity-campaign demos
// (examples/*-parity/out/*.mp4), as opposed to _snapshot_util.ts's goldens,
// which render synthetic vector-only scenes directly through the CPU
// pipeline. These extract one frame from a real demo's real rendered video
// via ffmpeg and diff it against a committed PNG in test/golden/parity/.
//
// Tolerance is deliberately LOOSER than _snapshot_util.ts's (PER_CHANNEL 8,
// 0.5%): _snapshot_util.ts's scenes are vector-only specifically to be
// stable across machines/font stacks, but these demos are real campaign
// output and many use system-font text (chart labels, titles, captions) --
// anti-aliasing/hinting differs across font stacks and OSes in ways a tight
// per-channel diff would flag as a false regression. This catches gross
// breakage (wrong colors, missing content, crashed/blank frames, layout
// collapse), not sub-pixel font rendering drift.
//
// Baseline goldens should come from the SAME environment CI renders in
// (ubuntu-latest + apt's fonts-dejavu-core, per ci.yml) -- see
// test/golden/parity/README.md for the regeneration procedure if a golden
// was baselined locally and drifts once CI actually runs it.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { decodePNG, diffRGBA, type DiffResult } from "./_snapshot_util.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PARITY_GOLDEN_DIR = join(HERE, "golden", "parity");

const PER_CHANNEL = 20;      // looser than _snapshot_util.ts's 8 -- see file header
const MAX_DIFF_RATIO = 0.03; // looser than _snapshot_util.ts's 0.5% -- see file header

function probeDurationSeconds(mp4Path: string): number {
  const out = execFileSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    mp4Path,
  ], { encoding: "utf8" });
  const d = parseFloat(out.trim());
  return Number.isFinite(d) ? d : 0;
}

/** Extracts one frame (default: 50% through) from an mp4 as raw RGBA, via a temp PNG. */
export async function extractFrameRGBA(
  mp4Path: string,
  seekRatio = 0.5,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const duration = probeDurationSeconds(mp4Path);
  const seekTo = duration > 0 ? duration * seekRatio : 0;
  const tmp = mkdtempSync(join(tmpdir(), "ecmanim-golden-"));
  const pngPath = join(tmp, "frame.png");
  try {
    execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", String(seekTo), "-i", mp4Path, "-frames:v", "1", pngPath]);
    return await decodePNG(pngPath);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export interface ParitySnapshotResult {
  status: "pass" | "fail" | "updated" | "created";
  diff?: DiffResult;
  message: string;
}

/**
 * Assert a demo's already-rendered mp4 matches its committed golden frame.
 * `name` should be `<suite>/<demo>` (e.g. "d3-parity/11-treemap") and maps
 * to test/golden/parity/<suite>/<demo>.png. Does NOT render the demo itself
 * -- throws if the mp4 doesn't exist yet (caller should skip, not render,
 * to keep this test fast and side-effect-free; see golden-parity.test.ts).
 */
export async function matchParitySnapshot(
  name: string,
  mp4Path: string,
  seekRatio = 0.5,
): Promise<ParitySnapshotResult> {
  if (!existsSync(mp4Path)) {
    throw new Error(`matchParitySnapshot: ${mp4Path} doesn't exist -- render it first, this function never renders`);
  }
  const goldenPath = join(PARITY_GOLDEN_DIR, `${name}.png`);
  mkdirSync(dirname(goldenPath), { recursive: true });
  const captured = await extractFrameRGBA(mp4Path, seekRatio);
  const update = process.env.UPDATE_SNAPSHOTS === "1";

  if (update || !existsSync(goldenPath)) {
    const wasNew = !existsSync(goldenPath);
    writeFileSync(goldenPath, await encodeCapturedPNG(captured));
    return { status: wasNew ? "created" : "updated", message: `${wasNew ? "created" : "updated"} golden for "${name}"` };
  }

  const golden = await decodePNG(goldenPath);
  const diff = diffRGBA(golden, captured, { perChannel: PER_CHANNEL, maxDiffRatio: MAX_DIFF_RATIO });
  if (diff.ok) return { status: "pass", diff, message: `"${name}" matches` };

  const actualPath = join(PARITY_GOLDEN_DIR, `${name}.actual.png`);
  mkdirSync(dirname(actualPath), { recursive: true });
  writeFileSync(actualPath, await encodeCapturedPNG(captured));
  return {
    status: "fail",
    diff,
    message:
      `"${name}" differs: ${(diff.diffRatio * 100).toFixed(2)}% of pixels ` +
      `(${diff.differing}/${diff.total}) beyond ±${PER_CHANNEL}/channel, mean |Δ|=${diff.meanAbs.toFixed(2)}. ` +
      `Actual written to ${actualPath}; regenerate with UPDATE_SNAPSHOTS=1 if the change is intended.`,
  };
}

async function encodeCapturedPNG(cap: { data: Uint8ClampedArray; width: number; height: number }): Promise<Buffer> {
  const mod = await import("@napi-rs/canvas");
  const canvas = mod.createCanvas(cap.width, cap.height);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(cap.width, cap.height);
  img.data.set(cap.data);
  ctx.putImageData(img, 0, 0);
  return canvas.toBuffer("image/png");
}
