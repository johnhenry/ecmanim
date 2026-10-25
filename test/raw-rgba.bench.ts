// Manual benchmark, excluded from npm test. Run the same file on both commits:
//   node test/raw-rgba.bench.ts [output-dir]
// Three timed runs per path after warmup; 180 frames at 1280x720, 30 fps.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render, Circle, Square } from "../src/node.ts";

const dir = process.argv[2] ?? mkdtempSync(join(tmpdir(), "ecmanim-rgba-bench-"));
async function scene(s: any) {
  const square = new Square({ fillColor: "#e64530", fillOpacity: 1 }).shift([-2, 0, 0]);
  const circle = new Circle({ fillColor: "#3478df", fillOpacity: 0.6 }).shift([2, 0, 0]);
  square.addUpdater((mob: any, dt: number) => mob.rotate(dt));
  s.add(square, circle);
  for (let i = 0; i < 3; i++) { circle.shift([-0.5, 0.25, 0]); await s.wait(2); }
}
await render(scene, { output: join(dir, "warmup.mp4"), resolution: [160, 90], fps: 2, disableCaching: true, verbose: false });
for (const disableCaching of [true, false]) {
  const ms: number[] = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    await render(scene, { output: join(dir, `${disableCaching ? "single" : "cached"}-${i}`, "out.mp4"), resolution: [1280, 720], fps: 30, disableCaching, verbose: false });
    ms.push(Math.round(performance.now() - start));
  }
  console.log(JSON.stringify({ path: disableCaching ? "single-stream" : "cold-cache", ms, medianMs: [...ms].sort((a, b) => a - b)[1], maxRssKiB: process.resourceUsage().maxRSS, dir }));
}
