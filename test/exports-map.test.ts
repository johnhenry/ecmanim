// package.json `exports` / `main` / `types` / `bin` targets must exist in
// dist/ after `npm run build` and be included in the published tarball
// (epic #61, child #63). Skipped -- loudly, with the reason -- when dist/ has
// not been built; CI runs `build` before `test`, so it is exercised there.
// Run `npm run build` first to exercise it locally.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const DIST_BUILT = existsSync(join(ROOT, "dist", "index.js"));
const SKIP = DIST_BUILT ? false : "dist/ is not built (run `npm run build` first) -- exports-map check skipped";

/** Every file path referenced by exports / main / types / bin. */
function targets(): Array<{ from: string; file: string }> {
  const out: Array<{ from: string; file: string }> = [];
  const walk = (from: string, v: unknown) => {
    if (typeof v === "string") out.push({ from, file: v });
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(`${from}.${k}`, x);
  };
  walk("exports", pkg.exports);
  if (pkg.main) walk("main", pkg.main);
  if (pkg.types) walk("types", pkg.types);
  if (pkg.bin) walk("bin", pkg.bin);
  return out;
}

test("exports-map: package.json declares targets under ./dist/", () => {
  const ts = targets();
  assert.ok(ts.length >= 20, "expected at least the 10 documented subpaths x (types, default)");
  assert.ok(ts.some((t) => t.from === "exports../skeletal.types" && t.file === "./dist/skeletal.d.ts"), "./skeletal subpath (epic #61, #64)");
  for (const { from, file } of ts) assert.ok(file.startsWith("./dist/"), `${from} -> ${file} is not under ./dist/`);
});

test("exports-map: every target exists in dist/", { skip: SKIP }, () => {
  const missing = targets().filter(({ file }) => !existsSync(join(ROOT, file)));
  assert.deepEqual(
    missing.map((m) => `${m.from} -> ${m.file}`),
    [],
    "package.json points at files that `npm run build` did not produce",
  );
});

test("exports-map: every target is in the npm tarball (npm pack --dry-run)", { skip: SKIP }, () => {
  // --ignore-scripts: do NOT trigger `prepare` (which would rebuild dist).
  const raw = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const packed = new Set<string>(JSON.parse(raw)[0].files.map((f: { path: string }) => f.path));
  const missing = targets()
    .map(({ from, file }) => ({ from, file, rel: file.replace(/^\.\//, "") }))
    .filter(({ rel }) => !packed.has(rel));
  assert.deepEqual(
    missing.map((m) => `${m.from} -> ${m.file}`),
    [],
    "targets exist on disk but are not published (check package.json `files`)",
  );
});
