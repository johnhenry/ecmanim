#!/usr/bin/env node
// manim-js CLI — a JavaScript port of manim's `manim` command.
//
//   manim-js render <file> [scene] [flags]
//   manim-js cfg [--write]
//   manim-js init [file]
//   manim-js plugins
//   manim-js checkhealth
//
// The scene file may either:
//   (a) export a Scene subclass (default export, or named via [scene]/-a), or
//   (b) export default an async function (scene) => { ... }, or
//   (c) render itself on import (fallback).

import { pathToFileURL } from "node:url";
import { resolve, basename, dirname, join } from "node:path";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";

// ---------------------------------------------------------------------------
// argv parsing
// ---------------------------------------------------------------------------

// Short flags that take a value.
const SHORT_VALUE: Record<string, string> = {
  o: "output",
  q: "quality",
  r: "resolution",
  f: "format",
  n: "from_upto",
  c: "config",
};
// Short boolean flags.
const SHORT_BOOL: Record<string, string> = {
  s: "save_last_frame",
  t: "transparent",
  a: "write_all",
  v: "verbose",
  h: "help",
};

function parseArgs(argv: string[]) {
  const args: any = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { args._.push(...argv.slice(i + 1)); break; }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      // Value-taking long flags: anything whose next token isn't another flag.
      if (next !== undefined && !next.startsWith("-") && !BOOL_LONG.has(key)) {
        args[key] = next; i++;
      } else {
        args[key] = true;
      }
    } else if (a.startsWith("-") && a.length >= 2) {
      // Possibly bundled short flags, e.g. -st. Handle each char.
      const chars = a.slice(1).split("");
      for (let c = 0; c < chars.length; c++) {
        const ch = chars[c];
        if (SHORT_VALUE[ch]) {
          // consumes the next argv token (only valid as the last char of a bundle)
          args[SHORT_VALUE[ch]] = argv[++i];
        } else if (SHORT_BOOL[ch]) {
          args[SHORT_BOOL[ch]] = true;
        } else {
          args[ch] = true;
        }
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

// Long flags that are always boolean (never consume the next token).
const BOOL_LONG = new Set([
  "save_last_frame", "transparent", "write_all", "verbose", "help",
  "disable_caching", "flush_cache", "save_sections", "write",
]);

// ---------------------------------------------------------------------------
// help text
// ---------------------------------------------------------------------------

const HELP = `manim-js — a JavaScript port of manim (Mathematical Animation Engine)

Usage:
  manim-js render <file> [scene] [options]
  manim-js cfg [--write]
  manim-js init [file]
  manim-js plugins
  manim-js checkhealth

Render options:
  -o, --output <path>        Output file (default: media/<Scene>.<ext>)
  -q, --quality <preset>     low | medium | high | fourk | production  (default: medium)
  -r, --resolution <WxH>     Explicit resolution, e.g. 1920x1080 (overrides quality)
      --fps <n>              Frames per second (overrides preset)
  -f, --format <fmt>         mp4 | webm | gif | mov | png  (default: mp4)
  -s, --save_last_frame      Write only the final frame as a PNG (no video)
  -t, --transparent          Preserve alpha (mp4 falls back to .mov / ProRes 4444)
  -a, --write_all            Render every exported Scene in the file
  -n, --from_upto <a,b>      Render only play() indices in [a, b]  (e.g. -n 2,5)
      --disable_caching      Bypass the partial-movie-file cache
      --flush_cache          Delete the media/partial cache before rendering
      --save_sections        Also write per-section videos + a JSON index
  -c, --config <file>        Load a manim.config.{js,json}
      --bg <color>           Background color (default: #000000)
      --renderer <r>         canvas | webgl  (canvas default; webgl documented)
  -v, --verbose              Verbose ffmpeg output
  -h, --help                 Show this help

Subcommands:
  cfg          Print the resolved default config (--write to save manim.config.json)
  init [file]  Scaffold a starter scene file (default: scene.js)
  plugins      List registered mobjects/animations/scenes from the registry
  checkhealth  Report node / ffmpeg / @napi-rs/canvas / font availability

Examples:
  manim-js render examples/basic.ts BasicScene -q high -o out.mp4
  manim-js render myscene.js --scene IntroScene --format webm
  manim-js render scene.js -s               # just the final frame as PNG
  manim-js render scene.js -n 2,5           # only animations 2..5
`;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function nodePath(rel: string): string {
  return pathToFileURL(resolve(new URL(rel, import.meta.url).pathname)).href;
}

function parseResolution(s: string): [number, number] | undefined {
  const m = /^(\d+)\s*[xX]\s*(\d+)$/.exec(String(s).trim());
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

function parseFromUpto(s: string): { from: number | null; upto: number | null } {
  const parts = String(s).split(",").map((x) => x.trim());
  const from = parts[0] !== "" && parts[0] !== undefined ? Number(parts[0]) : null;
  const upto = parts[1] !== "" && parts[1] !== undefined ? Number(parts[1]) : null;
  return { from: Number.isFinite(from as number) ? from : null, upto: Number.isFinite(upto as number) ? upto : null };
}

// ---------------------------------------------------------------------------
// subcommands
// ---------------------------------------------------------------------------

async function cmdCfg(args: any) {
  const cfg = await import(nodePath("../src/_config.ts"));
  if (args.config) await cfg.loadConfigFile(args.config);
  const resolved = cfg.resolveConfig({
    quality: args.quality,
    format: args.format,
    background: args.bg,
  });
  if (args.write) {
    const out = resolve("manim.config.json");
    writeFileSync(out, JSON.stringify(resolved, null, 2));
    console.log(`Wrote ${out}`);
  } else {
    console.log(cfg.configToJSON(resolved));
  }
}

const STARTER = `// A starter manim-js scene. Render with:
//   manim-js render scene.js MyScene -q medium
import { Scene, Circle, Square, Text, Create, Transform, FadeOut, BLUE, YELLOW } from "manim-js/node";

export class MyScene extends Scene {
  async construct() {
    const title = new Text("Hello, manim-js", { fontSize: 0.8, color: YELLOW, point: [0, 3, 0] });
    await this.play(new Create(title));

    const circle = new Circle({ radius: 1.5, color: BLUE, fillColor: BLUE, fillOpacity: 0.5 });
    await this.play(new Create(circle));

    this.nextSection("transform");
    const square = new Square({ sideLength: 2.4 });
    await this.play(new Transform(circle, square));
    await this.wait(0.5);
    await this.play(new FadeOut(circle), new FadeOut(title));
  }
}
`;

function cmdInit(args: any) {
  const file = args._[1] ?? "scene.js";
  const out = resolve(file);
  if (existsSync(out) && !args.force) {
    console.error(`Refusing to overwrite existing file: ${out} (pass --force)`);
    process.exit(1);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, STARTER);
  console.log(`Scaffolded starter scene -> ${out}`);
  console.log(`Render it with:  manim-js render ${file} MyScene`);
}

async function cmdPlugins() {
  const mod = await import(nodePath("../src/index.ts"));
  const reg = mod.registry;
  const kinds: Array<["mobject" | "animation" | "rateFunction" | "color" | "renderer" | "scene", string]> = [
    ["mobject", "Mobjects"],
    ["animation", "Animations"],
    ["scene", "Scenes"],
    ["rateFunction", "Rate functions"],
    ["renderer", "Renderers"],
    ["color", "Colors"],
  ];
  console.log(`Registered plugins: ${reg.plugins.length}`);
  for (const p of reg.plugins) {
    console.log(`  - ${p.name ?? "(anonymous)"}${p.version ? " v" + p.version : ""}`);
  }
  for (const [kind, label] of kinds) {
    const names = reg.list(kind);
    console.log(`\n${label} (${names.length}):`);
    if (names.length) console.log("  " + names.sort().join(", "));
  }
}

async function cmdCheckhealth() {
  const rows: Array<[string, boolean, string]> = [];

  // node
  rows.push(["node", true, process.version]);

  // ffmpeg
  let ffmpegOk = false, ffmpegVer = "not found";
  try {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("ffmpeg", ["-version"], { encoding: "utf8" });
    ffmpegVer = out.split("\n")[0];
    ffmpegOk = true;
  } catch { /* not found */ }
  rows.push(["ffmpeg", ffmpegOk, ffmpegVer]);

  // ffprobe
  let ffprobeOk = false, ffprobeVer = "not found";
  try {
    const { execFileSync } = await import("node:child_process");
    ffprobeVer = execFileSync("ffprobe", ["-version"], { encoding: "utf8" }).split("\n")[0];
    ffprobeOk = true;
  } catch { /* not found */ }
  rows.push(["ffprobe", ffprobeOk, ffprobeVer]);

  // @napi-rs/canvas
  let canvasOk = false, canvasInfo = "not installed";
  try {
    const c = await import("@napi-rs/canvas");
    canvasOk = true;
    canvasInfo = typeof c.createCanvas === "function" ? "available" : "loaded (no createCanvas?)";
  } catch (e: any) { canvasInfo = e?.message?.split("\n")[0] ?? "not installed"; }
  rows.push(["@napi-rs/canvas", canvasOk, canvasInfo]);

  // fonts
  let fontOk = false, fontInfo = "unknown";
  try {
    const c: any = await import("@napi-rs/canvas");
    const { autoRegisterFonts } = await import(nodePath("../src/renderer/fonts-node.ts"));
    autoRegisterFonts(c.GlobalFonts);
    const n = c.GlobalFonts?.families?.length ?? 0;
    fontOk = n > 0;
    fontInfo = `${n} font family(ies) registered`;
  } catch (e: any) { fontInfo = e?.message?.split("\n")[0] ?? "unavailable"; }
  rows.push(["fonts", fontOk, fontInfo]);

  console.log("manim-js checkhealth\n");
  for (const [name, ok, info] of rows) {
    console.log(`  [${ok ? "OK " : "!! "}] ${name.padEnd(16)} ${info}`);
  }
  const allOk = rows.every((r) => r[1]);
  console.log(`\n${allOk ? "All checks passed." : "Some checks failed (see above)."}`);
  return allOk;
}

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

async function cmdRender(args: any) {
  const file = args._[1];
  if (!file || !existsSync(resolve(file))) {
    console.error(`Scene file not found: ${file}`);
    process.exit(1);
  }

  const nodeMod: any = await import(nodePath("../src/node.ts"));
  const { render, Scene, flushCache } = nodeMod;

  // Load a config file if requested, so its defaults participate.
  if (args.config) await nodeMod.loadConfigFile(args.config);

  const mod = await import(pathToFileURL(resolve(file)).href);

  // Which scene(s) to render.
  const positionalScene = args._[2]; // `render file Scene`
  const sceneName = args.scene ?? positionalScene;

  const isScene = (v: any) => typeof v === "function" && v.prototype instanceof Scene;

  // Build the list of targets.
  let targets: Array<{ name: string; target: any }> = [];
  if (args.write_all) {
    for (const [k, v] of Object.entries(mod)) if (isScene(v)) targets.push({ name: k, target: v });
    if (!targets.length && isScene(mod.default)) targets.push({ name: "default", target: mod.default });
  } else if (sceneName && mod[sceneName]) {
    targets.push({ name: sceneName, target: mod[sceneName] });
  } else if (mod.default) {
    targets.push({ name: sceneName ?? "default", target: mod.default });
  } else {
    for (const [k, v] of Object.entries(mod)) {
      if (isScene(v)) { targets.push({ name: k, target: v }); break; }
    }
  }

  if (!targets.length) {
    console.log("No exported Scene found — assuming the file renders on import.");
    return;
  }

  // Resolve common options.
  const quality = args.quality ?? "medium";
  let format = args.format ?? "mp4";
  const saveLastFrame = !!args.save_last_frame;
  const transparent = !!args.transparent;
  const resolution = args.resolution ? parseResolution(args.resolution) : undefined;
  const { from: fromAnimationNumber, upto: uptoAnimationNumber } =
    args.from_upto ? parseFromUpto(args.from_upto) : { from: null, upto: null };
  const disableCaching = !!args.disable_caching;
  const saveSections = !!args.save_sections;

  // Choose output extension.
  const extFor = (fmt: string) => {
    if (saveLastFrame) return "png";
    if (fmt === "png") return "png-sequence-dir";
    if (transparent && fmt === "mp4") return "mov";
    return fmt === "png-sequence" ? "mp4" : fmt;
  };

  if (args.renderer && args.renderer === "webgl") {
    console.log("Note: the WebGL renderer runs in the browser (see examples/browser-three). " +
      "The Node CLI renders with the canvas renderer.");
  }

  for (const { name, target } of targets) {
    const ext = extFor(format);
    const baseName = name && name !== "default" ? name : basename(file).replace(/\.[^.]+$/, "");
    const defaultOut = join("media", `${baseName}.${ext === "png-sequence-dir" ? "mp4" : ext}`);
    const output = (targets.length === 1 && args.output) ? args.output : defaultOut;

    if (args.flush_cache) {
      try { flushCache(output); console.log(`Flushed cache for ${output}`); } catch { /* ignore */ }
    }

    await render(target, {
      output,
      quality,
      format,
      resolution,
      background: args.bg ?? undefined,
      fps: args.fps ? Number(args.fps) : undefined,
      saveLastFrame,
      transparent,
      fromAnimationNumber,
      uptoAnimationNumber,
      disableCaching,
      saveSections,
      verbose: !!args.verbose,
    });
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (args.help || (!cmd)) { console.log(HELP); process.exit(cmd ? 0 : 1); }

  switch (cmd) {
    case "render": return cmdRender(args);
    case "cfg": return cmdCfg(args);
    case "init": return cmdInit(args);
    case "plugins": return cmdPlugins();
    case "checkhealth": {
      const ok = await cmdCheckhealth();
      process.exit(ok ? 0 : 1);
    }
    default:
      console.error(`Unknown command: ${cmd}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
