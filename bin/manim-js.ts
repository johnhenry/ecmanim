#!/usr/bin/env node
// manim-js CLI: render a scene file to video.
//
//   manim-js render scene.js [--scene Name] [-o out.mp4] [--quality low|medium|high|fourk]
//                            [--format mp4|webm|gif|png-sequence] [--bg "#0d1117"] [--fps N]
//
// The scene file may either:
//   (a) export a Scene subclass (default export, or named via --scene), or
//   (b) export default an async function (scene) => { ... }, or
//   (c) render itself on import (in which case just `node scene.js`).

import { pathToFileURL } from "node:url";
import { resolve, basename } from "node:path";
import { existsSync } from "node:fs";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) { args[key] = next; i++; }
      else args[key] = true;
    } else if (a.startsWith("-") && a.length === 2) {
      const map = { o: "output", q: "quality", s: "scene", f: "format" };
      const key = map[a[1]] ?? a[1];
      args[key] = argv[++i];
    } else {
      args._.push(a);
    }
  }
  return args;
}

const HELP = `manim-js — a JavaScript port of manim

Usage:
  manim-js render <file.js> [options]

Options:
  -o, --output <path>     Output file (default: media/<Scene>.mp4)
  -q, --quality <preset>  low | medium | high | fourk  (default: medium)
  -s, --scene <Name>      Named export to render (default: default export or first Scene)
  -f, --format <fmt>      mp4 | webm | gif | png-sequence  (default: mp4)
      --fps <n>           Frames per second (overrides quality preset)
      --bg <color>        Background color (default: #000000)
  -h, --help              Show this help

Examples:
  manim-js render examples/basic.js -q high -o out.mp4
  manim-js render myscene.js --scene IntroScene --format webm
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (args.help || args.h || !cmd) { console.log(HELP); process.exit(cmd ? 0 : 1); }

  if (cmd !== "render") {
    console.error(`Unknown command: ${cmd}\n`);
    console.log(HELP);
    process.exit(1);
  }

  const file = args._[1];
  if (!file || !existsSync(resolve(file))) {
    console.error(`Scene file not found: ${file}`);
    process.exit(1);
  }

  const mod = await import(pathToFileURL(resolve(file)).href);
  const { render, Scene } = await import(pathToFileURL(resolve(new URL("../src/node.ts", import.meta.url).pathname)).href);

  // Locate the scene to render.
  let target = null;
  let name = args.scene;
  if (name && mod[name]) target = mod[name];
  else if (mod.default) target = mod.default;
  else {
    // First export that is a Scene subclass.
    for (const [k, v] of Object.entries(mod)) {
      if (typeof v === "function" && v.prototype instanceof Scene) { target = v; name = k; break; }
    }
  }

  if (!target) {
    // Assume the file rendered itself on import.
    console.log("No exported Scene found — assuming the file renders on import.");
    return;
  }

  const quality = args.quality ?? "medium";
  const format = args.format ?? "mp4";
  const ext = format === "png-sequence" ? "mp4" : format;
  const output = args.output ?? `media/${name ?? basename(file).replace(/\.[^.]+$/, "")}.${ext}`;

  await render(target, {
    output,
    quality,
    format,
    background: args.bg ?? "#000000",
    fps: args.fps ? Number(args.fps) : undefined,
    verbose: true,
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
