// Regression for the single-stream export path (src/node.ts, the path used
// when caching is disabled or a --from/--upto range filter is active): it
// used to spawn ffmpeg writing DIRECTLY to the final `outPath`. If the
// scene's construct() threw partway through rendering (after ffmpeg had
// already received some frames but before ffmpeg.stdin.end() /
// the close-event wait were ever reached), two things went wrong:
//   1. The ffmpeg child was orphaned -- left running, hanging on stdin
//      waiting for frames that would never arrive.
//   2. `outPath` was left holding a partial/unfinalized file at the REAL
//      output location (ffmpeg had already opened and started writing it).
// Fix: render to a temp path (same atomic-rename pattern encodeFrames()
// already uses for partial-movie segments) inside a try/finally that kills
// the ffmpeg child and removes the temp file on any failure, so a crash can
// never leave a broken file at outPath or a hung ffmpeg process behind.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function hasBin(bin: string): boolean {
  try {
    const r = spawnSync(bin, ["-version"], { stdio: "ignore" });
    return r.status === 0;
  } catch {
    return false;
  }
}
const FFMPEG = hasBin("ffmpeg");

test(
  "render() single-stream path: a construct() that throws mid-render leaves no orphaned ffmpeg and no partial file at outPath",
  { skip: !FFMPEG ? "ffmpeg not available" : false },
  async () => {
    const { render } = await import("../src/node.ts");
    const { Circle } = await import("../src/mobject/geometry.ts");

    const dir = mkdtempSync(join(tmpdir(), "mjs-ffmpeg-crash-"));
    const outPath = join(dir, "out.mp4");
    try {
      const scene = async (s: any) => {
        s.add(new Circle({ radius: 1 }));
        // Emit a few real frames first, so ffmpeg has genuinely started
        // writing before the crash -- this is what makes the "partial file
        // left at outPath" failure mode reproducible (a crash before any
        // frame is emitted wouldn't exercise that path).
        await s.wait(0.3);
        throw new Error("synthetic mid-render failure");
      };

      await assert.rejects(
        () => render(scene, { output: outPath, quality: "low", fps: 10, disableCaching: true, verbose: false }),
        /synthetic mid-render failure/,
      );

      assert.ok(!existsSync(outPath), "no partial/corrupt file should be left at the real outPath after a mid-render crash");
      const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp-"));
      assert.deepEqual(leftovers, [], `the temp file should be cleaned up on failure, found: ${leftovers}`);

      // Give a killed child a moment to actually exit, then confirm no
      // process is still referencing this render's temp directory (i.e. no
      // orphaned ffmpeg left hanging on stdin).
      await new Promise((r) => setTimeout(r, 300));
      const ps = execFileSync("ps", ["-A", "-o", "command"]).toString();
      assert.ok(!ps.includes(dir), "no orphaned ffmpeg process should remain referencing the render's temp directory");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
