import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Enforces the informal convention this codebase already relies on (issue
// #16's fix depended on it, for example): browser-safe modules must never
// import `node:*` directly, since they're loaded in an unbundled browser
// with no polyfills for them. Built as a DENYLIST (not an allowlist) so it
// self-maintains as new browser-safe files are added -- only the files
// below are permitted to import node:*; every other src/**/*.ts file is
// scanned and ALL violations are collected into one failure, rather than
// stopping at the first.

const NODE_ONLY_ALLOWLIST = new Set([
  "node.ts",
  "node-gl.ts",
  "node-parallel.ts",
  "renderer/ffmpeg.ts",
  "renderer/fonts-node.ts",
  "video-node.ts",
  // The render service is a Node-only subsystem (protocol.ts stays node-free).
  "service/queue.ts",
  "service/storage.ts",
  "service/webhooks.ts",
]);

const NODE_IMPORT_RE = /from\s+["']node:[^"']+["']|require\(\s*["']node:[^"']+["']\s*\)/;

function walk(dir: string, root: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, root, out);
    } else if (entry.endsWith(".ts")) {
      out.push(relative(root, full));
    }
  }
}

function allSourceFiles(): string[] {
  const root = join(import.meta.dirname, "..", "src");
  const out: string[] = [];
  walk(root, root, out);
  return out.sort();
}

test("no browser-safe module imports node:* directly", () => {
  const root = join(import.meta.dirname, "..", "src");
  const violations: string[] = [];
  for (const rel of allSourceFiles()) {
    if (NODE_ONLY_ALLOWLIST.has(rel)) continue;
    const content = readFileSync(join(root, rel), "utf8");
    if (NODE_IMPORT_RE.test(content)) violations.push(rel);
  }
  assert.deepEqual(violations, [], `these files import node:* but aren't in NODE_ONLY_ALLOWLIST: ${violations.join(", ")}`);
});

test("the allowlist itself hasn't gone stale", () => {
  const root = join(import.meta.dirname, "..", "src");
  const staleEntries: string[] = [];
  for (const rel of NODE_ONLY_ALLOWLIST) {
    const content = readFileSync(join(root, rel), "utf8");
    if (!NODE_IMPORT_RE.test(content)) staleEntries.push(rel);
  }
  assert.deepEqual(
    staleEntries,
    [],
    `these allowlisted files no longer import node:* at all -- remove them from NODE_ONLY_ALLOWLIST: ${staleEntries.join(", ")}`,
  );
});
