import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "../src/node.ts";
import { renderParallel } from "../src/node-parallel.ts";
import { probeVideo } from "../src/renderer/ffmpeg.ts";
import { countedHoldScene, referenceHoldScene } from "./fixtures/hold-frame-scene.ts";

const options = { pixelWidth: 96, pixelHeight: 64, fps: 8, verbose: false };
const scenePath = fileURLToPath(new URL("./fixtures/hold-frame-scene.ts", import.meta.url));
function decode(path: string) {
  return execFileSync("ffmpeg", ["-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 4 * 1024 * 1024 });
}

test("static holds rasterize once and preserve single, cached and parallel movies", { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecmanim-hold-"));
  try {
    const reference = join(dir, "reference.mp4"), single = join(dir, "single.mp4");
    const cached = join(dir, "cached", "out.mp4"), baseline = join(dir, "baseline", "out.mp4");
    const parallel = join(dir, "parallel", "out.mp4");
    await render(referenceHoldScene, { ...options, output: reference, disableCaching: true });
    const result = await render(countedHoldScene, { ...options, output: single, disableCaching: true });
    assert.equal(result.frames, 16);
    assert.deepEqual(readFileSync(single), readFileSync(reference), "single-stream MP4 remains byte-identical");
    assert.deepEqual(await probeVideo(single), await probeVideo(reference));
    await render(referenceHoldScene, { ...options, output: baseline });
    const cold = await render(countedHoldScene, { ...options, output: cached });
    assert.equal(cold.frames, 16);
    assert.deepEqual(readFileSync(cached), readFileSync(baseline));
    const warm = await render(countedHoldScene, { ...options, output: cached });
    assert.equal(warm.frames, 0);
    assert.equal(warm.reusedPartials, 4);
    assert.deepEqual(readFileSync(cached), readFileSync(baseline));
    const workers = await renderParallel(scenePath, "countedHoldScene", { ...options, output: parallel, workers: 2 });
    assert.equal(workers.workers, 2);
    assert.deepEqual(decode(parallel), decode(cached));
    const frames = decode(single);
    assert.equal(frames.length, 96 * 64 * 4 * 16);
    const frame = (n: number) => frames.subarray(n * 96 * 64 * 4, (n + 1) * 96 * 64 * 4);
    assert.notDeepEqual(frame(0), frame(4), "mutation between holds is rendered afresh");
    const partials = readdirSync(join(dir, "cached", "partial"));
    assert.equal(partials.length, 4);
    for (const name of partials) {
      const expected = readFileSync(join(dir, "baseline", "partial", name));
      assert.deepEqual(readFileSync(join(dir, "cached", "partial", name)), expected);
      assert.deepEqual(readFileSync(join(dir, "parallel", "partial", name)), expected);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
