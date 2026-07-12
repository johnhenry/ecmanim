// One-command fix for "the gallery is all 'not yet rendered'" on a fresh
// clone: renders every demo the manifest doesn't already have a video for,
// extracting that demo's thumbnail and rebuilding the HTML after EACH one
// (not just once at the end) -- so a browser tab already open on the gallery
// shows new demos landing as they finish, instead of staying blank for the
// whole batch. Renders sequentially (not in parallel) to avoid contending
// over the same ffmpeg/canvas resources, and keeps going past a single
// demo's failure so one broken demo can't block the other ~195.
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

// A plain `.slice(-N)` on combined stdout+stderr cuts off the actual
// "SomeError: message" line whenever the stack trace below it runs longer
// than N lines -- leaving only bare "at ..." frames with no indication of
// WHAT failed or why. Find that line (searching from the end, since a
// module may log unrelated things earlier) and print from there instead.
function extractErrorSummary(err: unknown): string {
  const out = [(err as any).stdout, (err as any).stderr].filter(Boolean).map(String).join("\n").trim();
  if (!out) return (err as Error).message ?? String(err);
  const lines = out.split("\n");
  const errorLineIdx = lines.map((l) => /^\s*\S*Error\b[:\s]/.test(l)).lastIndexOf(true);
  const from = errorLineIdx !== -1 ? errorLineIdx : Math.max(0, lines.length - 12);
  return lines.slice(from, from + 20).join("\n");
}

function rebuildGallery(): void {
  execFileSync("node", ["--experimental-strip-types", "--no-warnings", join(HERE, "thumbs.ts")], { cwd: REPO_ROOT, stdio: "pipe" });
  execFileSync("node", ["--experimental-strip-types", "--no-warnings", join(HERE, "build.ts")], { cwd: REPO_ROOT, stdio: "pipe" });
}

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
    ok++;
    rebuildGallery(); // pick up this one demo immediately -- a page refresh shows it without waiting for the rest
    console.log("done (gallery updated)");
  } catch (err) {
    console.log("FAILED");
    console.error(extractErrorSummary(err));
    failed.push({ id: demo.id, file: demo.file });
  }
}

console.log(`\n${ok}/${queue.length} rendered.`);
if (failed.length > 0) {
  console.log(`Failed (${failed.length}): ${failed.map((f) => f.id).join(", ")}`);
  console.log(`Run one directly to see the full error, e.g.: npx tsx examples/${failed[0].file}`);
}
