// A ManimConfig-style layered configuration object, mirroring the structure of
// ManimCommunity's `manim._config`. There is a single mutable `config` object
// holding the defaults; `resolveConfig(overrides)` produces a plain merged
// snapshot (defaults < config-file < overrides) that the render pipeline reads.
//
// The layering order is:
//   1. hard-coded DEFAULTS (below)
//   2. `config` (the mutable process-wide defaults — may be mutated by a loaded
//      config file or by the CLI)
//   3. per-call `overrides` passed to resolveConfig()
//
// Field names use manim's snake_case where manim uses them (output_dir,
// disable_caching, save_last_frame, from/upto_animation_number) but also keep
// the camelCase ergonomics used elsewhere in this port. resolveConfig()
// normalizes so both spellings resolve to the same value.

/** Quality presets mirroring manim's -ql / -qm / -qh / -qk / -qp flags. */
export const QUALITY_PRESETS: Record<string, { pixelWidth: number; pixelHeight: number; fps: number }> = {
  low: { pixelWidth: 854, pixelHeight: 480, fps: 15 },
  medium: { pixelWidth: 1280, pixelHeight: 720, fps: 30 },
  high: { pixelWidth: 1920, pixelHeight: 1080, fps: 60 },
  // manim exposes both "fourk" and "production"; production == 2560x1440@60.
  fourk: { pixelWidth: 3840, pixelHeight: 2160, fps: 60 },
  production: { pixelWidth: 2560, pixelHeight: 1440, fps: 60 },
};

/** Shape of a resolved config snapshot. */
export interface ManimConfig {
  quality: string;
  pixelWidth: number;
  pixelHeight: number;
  fps: number;
  background: string;
  format: string; // mp4 | webm | gif | mov | png | png-sequence
  output_dir: string;
  disable_caching: boolean;
  transparent: boolean;
  save_last_frame: boolean;
  from_animation_number: number | null;
  upto_animation_number: number | null;
  save_sections: boolean;
  renderer: string; // canvas | webgl
  [key: string]: any;
}

/** Hard-coded defaults (layer 1). */
const DEFAULTS: ManimConfig = {
  quality: "medium",
  pixelWidth: 1280,
  pixelHeight: 720,
  fps: 30,
  background: "#000000",
  format: "mp4",
  output_dir: "media",
  disable_caching: false,
  transparent: false,
  save_last_frame: false,
  from_animation_number: null,
  upto_animation_number: null,
  save_sections: false,
  renderer: "canvas",
};

/**
 * The mutable, process-wide defaults object (layer 2). Mutating this changes the
 * defaults for subsequent resolveConfig() calls — this is what loadConfigFile()
 * and the CLI mutate. Mirrors `manim.config`.
 */
export const config: ManimConfig = { ...DEFAULTS };

/** Reset `config` back to the hard-coded defaults. */
export function resetConfig(): ManimConfig {
  for (const k of Object.keys(config)) delete (config as any)[k];
  Object.assign(config, DEFAULTS);
  return config;
}

// Map alternate (snake_case <-> camelCase) spellings so a config file / override
// may use either.
const ALIASES: Record<string, string> = {
  pixel_width: "pixelWidth",
  pixel_height: "pixelHeight",
  frame_rate: "fps",
  disableCaching: "disable_caching",
  saveLastFrame: "save_last_frame",
  fromAnimationNumber: "from_animation_number",
  uptoAnimationNumber: "upto_animation_number",
  outputDir: "output_dir",
  saveSections: "save_sections",
  bg: "background",
};

function normalizeKeys(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[ALIASES[k] ?? k] = v;
  }
  return out;
}

/** Apply a quality preset's dimensions/fps unless explicitly overridden. */
function applyQuality(target: ManimConfig, source: Record<string, any>): void {
  if (source.quality && QUALITY_PRESETS[source.quality]) {
    const q = QUALITY_PRESETS[source.quality];
    // Only fill fields the source did not itself specify.
    if (source.pixelWidth === undefined) target.pixelWidth = q.pixelWidth;
    if (source.pixelHeight === undefined) target.pixelHeight = q.pixelHeight;
    if (source.fps === undefined) target.fps = q.fps;
  }
}

/**
 * Produce a resolved config snapshot: DEFAULTS < config < overrides.
 * `overrides` may use either snake_case or camelCase field names.
 */
export function resolveConfig(overrides: Record<string, any> = {}): ManimConfig {
  const merged: ManimConfig = { ...DEFAULTS, ...config };
  const ov = normalizeKeys(overrides);

  // If a quality is being set (by config or override) and dimensions were not
  // explicitly provided, derive them from the preset.
  const effectiveQuality = ov.quality ?? merged.quality;
  if (effectiveQuality && QUALITY_PRESETS[effectiveQuality]) {
    merged.quality = effectiveQuality;
    // config-level explicit dims win unless override provides them.
    applyQuality(merged, { quality: effectiveQuality, ...ov });
  }

  Object.assign(merged, ov);
  return merged;
}

/**
 * Load a `manim.config.{js,json}` (or a caller-supplied path) and merge it INTO
 * the mutable `config` object (layer 2). Returns the mutated `config`. If no
 * file is found, returns `config` unchanged. Field names may be snake_case or
 * camelCase; a quality preset expands to dimensions/fps.
 */
export async function loadConfigFile(path?: string): Promise<ManimConfig> {
  const { resolve } = await import("node:path");
  const { existsSync, readFileSync } = await import("node:fs");
  const { pathToFileURL } = await import("node:url");

  const candidates = path
    ? [path]
    : ["manim.config.js", "manim.config.mjs", "manim.config.json"];

  let found: string | null = null;
  for (const c of candidates) {
    const p = resolve(c);
    if (existsSync(p)) { found = p; break; }
  }
  if (!found) return config;

  let raw: any;
  if (found.endsWith(".json")) {
    raw = JSON.parse(readFileSync(found, "utf8"));
  } else {
    const mod = await import(pathToFileURL(found).href);
    raw = mod.default ?? mod;
  }
  // A config module may nest the settings under `config` (alongside `plugins`).
  const settings = raw?.config && typeof raw.config === "object" ? raw.config : raw;
  const norm = normalizeKeys(settings);
  applyQuality(config, norm);
  Object.assign(config, norm);
  return config;
}

/** Serialize the current default config to a JSON string (for `cfg` CLI). */
export function configToJSON(cfg: ManimConfig = config): string {
  return JSON.stringify(cfg, null, 2);
}
