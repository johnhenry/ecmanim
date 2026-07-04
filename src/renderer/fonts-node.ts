// Auto-register system fonts for @napi-rs/canvas, which ships with none. We ask
// fontconfig (fc-match) to resolve a sans-serif family and register its
// regular/bold/italic files under the "sans-serif" alias so Text works out of
// the box. Falls back to scanning common font directories.

/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import opentype from "opentype.js";
import { setDefaultFontSync } from "../mobject/vectorized_text.ts";

function fcMatch(pattern: string) {
  try {
    const out = execFileSync("fc-match", ["-f", "%{file}", pattern], { encoding: "utf8" });
    return out.trim() || null;
  } catch {
    return null;
  }
}

function scanForFont() {
  const roots = [
    "/run/current-system/sw/share/fonts",
    "/usr/share/fonts",
    "/usr/local/share/fonts",
    join(process.env.HOME || "", ".nix-profile/share/fonts"),
    join(process.env.HOME || "", ".local/share/fonts"),
    // macOS
    "/System/Library/Fonts/Supplemental",
    "/System/Library/Fonts",
    "/Library/Fonts",
    join(process.env.HOME || "", "Library/Fonts"),
  ];
  const wanted = [/DejaVuSans\.ttf$/i, /LiberationSans-Regular\.ttf$/i, /NotoSans-Regular\.ttf$/i, /Arial\.ttf$/i];
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || !existsSync(dir)) return;
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e);
      let s;
      try { s = statSync(p); } catch { continue; }
      if (s.isDirectory()) walk(p, depth + 1);
      else if (wanted.some((re) => re.test(p))) found.push(p);
    }
  };
  for (const r of roots) walk(r, 0);
  return found[0] || null;
}

// Resolve a concrete TTF/OTF file path for a fontconfig pattern (for opentype.js
// glyph extraction). Returns null if fontconfig / no font is available.
export function resolveFontPath(pattern = "sans-serif") {
  const p = fcMatch(pattern);
  if (p && existsSync(p) && /\.(ttf|otf)$/i.test(p)) return p;
  return scanForFont();
}

// Load a system font as an opentype.js Font (for VText / MathTex glyph outlines)
// and register it as the library default. Node-only. Synchronous so it can
// be used as the lazy auto-loader `getDefaultFont()` calls on first use
// (issue #16) -- the whole resolve+read+parse pipeline was already
// synchronous under the hood; only the (no longer needed) dynamic imports
// of opentype.js/vectorized_text.ts made this function itself async before.
export function loadVectorFontSync(pattern = "sans-serif") {
  const path = resolveFontPath(pattern);
  if (!path) return null;
  const buf = readFileSync(path);
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  setDefaultFontSync(font);
  return font;
}

// Async wrapper kept for existing call sites (render()'s delayRenderUntil
// gate, node-parallel.ts) and for callers who prefer an awaitable API.
export async function loadVectorFont(pattern = "sans-serif") {
  return loadVectorFontSync(pattern);
}

let registered = false;

export function autoRegisterFonts(GlobalFonts: any, { alias = "sans-serif", force = false } = {}) {
  if (!GlobalFonts) return false;
  if (registered && !force) return true;
  if (GlobalFonts.families && GlobalFonts.families.length > 0 && !force) {
    registered = true;
    return true;
  }

  const candidates = [
    fcMatch("sans-serif"),
    fcMatch("sans-serif:bold"),
    fcMatch("sans-serif:italic"),
    fcMatch("sans-serif:bold:italic"),
    fcMatch("monospace"),
    fcMatch("serif"),
  ].filter(Boolean);

  const scanned = scanForFont();
  if (scanned) candidates.push(scanned);

  let ok = false;
  const seen = new Set();
  for (const path of candidates) {
    if (!path || seen.has(path) || !existsSync(path)) continue;
    seen.add(path);
    try {
      // Register under both the alias and its own family name.
      GlobalFonts.registerFromPath(path, alias);
      ok = true;
    } catch { /* ignore individual failures */ }
  }
  registered = ok;
  return ok;
}
