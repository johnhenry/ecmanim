// One-command fix for "the gallery is all 'not yet rendered'" on a fresh
// clone: renders every demo the manifest doesn't already have a video for,
// then extracts thumbnails and rebuilds the HTML. Renders sequentially (not
// in parallel) to avoid contending over the same ffmpeg/canvas resources,
// and keeps going past a single demo's failure so one broken demo can't
// block the other ~195.
//
//   npm run gallery:render-missing                      # everything missing
//   npm run gallery:render-missing -- --category d3-parity
//   npm run gallery:render-missing -- --limit 5          # smoke-test a few first
//
// Quality defaults to "low" (fast) -- override with ECMANIM_DEMO_QUALITY for
// campaigns that read it (all 11 parity campaigns; the 24 top-level feature
// demos hardcode their own quality per file and ignore this env var).

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest } from "./manifest.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = dirname(HERE);
const REPO_ROOT = dirname(EXAMPLES_DIR);

const args = process.argv.slice(2);
const categoryFilter = args.includes("--category") ? args[args.indexOf("--category") + 1] : null;
const limitArg = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1], 10) : Infinity;

const manifest = buildManifest();
let queue = manifest.categories
  .filter((c) => !categoryFilter || c.key === categoryFilter)
  .flatMap((c) => c.demos.filter((d) => !d.video));

if (categoryFilter && queue.length === 0 && !manifest.categories.some((c) => c.key === categoryFilter)) {
  console.error(`Unknown category "${categoryFilter}". Valid: ${manifest.categories.map((c) => c.key).join(", ")}`);
  process.exit(1);
}
queue = queue.slice(0, limitArg);

if (queue.length === 0) {
  console.log("Nothing to render -- every demo already has a video. Run `npm run gallery:thumbs` if thumbnails are still missing.");
  process.exit(0);
}

console.log(`Rendering ${queue.length} missing demo(s) at ECMANIM_DEMO_QUALITY=${process.env.ECMANIM_DEMO_QUALITY ?? "low"}...`);
console.log(`This can take a while for a full run -- ^C any time and re-run later; already-rendered demos are skipped.\n`);

let ok = 0;
const failed: { id: string; file: string }[] = [];

for (const [i, demo] of queue.entries()) {
  const label = `[${i + 1}/${queue.length}] ${demo.id}`;
  process.stdout.write(`${label} ... `);
  try {
    execFileSync("npx", ["tsx", join(EXAMPLES_DIR, demo.file)], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ECMANIM_DEMO_QUALITY: process.env.ECMANIM_DEMO_QUALITY ?? "low" },
      timeout: 5 * 60 * 1000,
    });
    console.log("done");
    ok++;
  } catch (err) {
    console.log("FAILED");
    const out = [(err as any).stdout, (err as any).stderr].filter(Boolean).map(String).join("\n");
    console.error(out.trim().split("\n").slice(-8).join("\n")); // last few lines are usually the actual error
    failed.push({ id: demo.id, file: demo.file });
  }
}

console.log(`\n${ok}/${queue.length} rendered.`);
if (failed.length > 0) {
  console.log(`Failed (${failed.length}): ${failed.map((f) => f.id).join(", ")}`);
  console.log(`Run one directly to see the full error, e.g.: npx tsx examples/${failed[0].file}`);
}

console.log(`\nExtracting thumbnails and rebuilding the gallery...`);
execFileSync("node", ["--experimental-strip-types", "--no-warnings", join(HERE, "thumbs.ts")], { cwd: REPO_ROOT, stdio: "inherit" });
execFileSync("node", ["--experimental-strip-types", "--no-warnings", join(HERE, "build.ts")], { cwd: REPO_ROOT, stdio: "inherit" });
