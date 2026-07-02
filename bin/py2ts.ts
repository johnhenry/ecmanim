#!/usr/bin/env node
// py2ts — CLI wrapper around src/tools/py2ts.ts.
//
//   node bin/py2ts.ts input.py [-o output.ts]
//   node bin/py2ts.ts input.py            # prints TS to stdout
//   node bin/py2ts.ts --wildcard input.py # emit `import * as mn`
//
// Converts a Python-manim scene script into TypeScript for ecmanim.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Mirrors src/tools/py2ts.ts's Py2TsOptions. Kept as a local shape rather than
// imported (even type-only) so this file's compile stays fully self-contained
// under bin/ — see nodePath() below for why.
interface Py2TsOptions {
  importFrom?: string;
  wildcardImport?: boolean;
  indent?: string;
}

// Resolve "../src/X.ts" relative to this file for both dev (bin/py2ts.ts,
// "../src/X.ts" is correct as-is) and published (compiled dist/bin/py2ts.js —
// Node refuses type-stripping under node_modules, so published bins must be
// plain JS; the library itself compiles to dist/X.js with no "src/" segment,
// so "../src/X.ts" becomes "../X.js" relative to dist/bin/). See bin/ecmanim.ts.
function nodePath(rel: string): string {
  const resolved = import.meta.url.endsWith(".js")
    ? rel.replace(/^\.\.\/src\//, "../").replace(/\.ts$/, ".js")
    : rel;
  return pathToFileURL(resolve(new URL(resolved, import.meta.url).pathname)).href;
}

const { convert } = await import(nodePath("../src/tools/py2ts.ts"));

function usage(): never {
  process.stderr.write(
    "Usage: node bin/py2ts.ts <input.py> [-o <output.ts>] [--wildcard] [--import-from <spec>]\n",
  );
  process.exit(2);
}

const argv = process.argv.slice(2);
let input: string | undefined;
let output: string | undefined;
const opts: Py2TsOptions = {};

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-o" || a === "--output") {
    output = argv[++i];
  } else if (a === "--wildcard") {
    opts.wildcardImport = true;
  } else if (a === "--import-from") {
    opts.importFrom = argv[++i];
  } else if (a === "-h" || a === "--help") {
    usage();
  } else if (a.startsWith("-")) {
    process.stderr.write(`Unknown flag: ${a}\n`);
    usage();
  } else if (!input) {
    input = a;
  } else {
    process.stderr.write(`Unexpected argument: ${a}\n`);
    usage();
  }
}

if (!input) usage();

let source: string;
try {
  source = readFileSync(input, "utf8");
} catch (err) {
  process.stderr.write(`Cannot read ${input}: ${(err as Error).message}\n`);
  process.exit(1);
}

const ts = convert(source, opts);

if (output) {
  writeFileSync(output, ts, "utf8");
  process.stderr.write(`Wrote ${output}\n`);
} else {
  process.stdout.write(ts);
}
