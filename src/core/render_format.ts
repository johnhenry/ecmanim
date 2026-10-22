// Shared output-format resolution for the Node render paths. Previously this
// logic was duplicated inline in node.ts (render) and node-parallel.ts
// (resolveRender); both now call here so they cannot drift. Isomorphic and
// node-free. Behaviour for every pre-existing format string is unchanged and
// pinned by test/render-format.test.ts.

/** Which encoder backs the file formats that can use either. */
export type EncoderKind = "ffmpeg" | "js";

/** Formats only the first-party JS encoders can produce. */
const JS_ONLY_FORMATS = new Set(["apng", "zip"]);
/** Formats that need ffmpeg (video codecs); rejected with encoder: "js". */
const FFMPEG_ONLY_FORMATS = new Set(["mp4", "webm", "mov"]);

/** Default format ("mp4") and the "png" -> "png-sequence" alias. */
export function normalizeFormat(format?: string): string {
  let f = format ?? "mp4";
  if (f === "png") f = "png-sequence";
  return f;
}

/** Container extension used for cached partial-movie files. */
export function partialExtension(format: string): "webm" | "mov" | "mp4" {
  return format === "webm" ? "webm" : format === "mov" ? "mov" : "mp4";
}

/** True when frames go through src/encoders instead of ffmpeg. */
export function isJsEncoderFormat(format: string, encoder?: EncoderKind): boolean {
  return JS_ONLY_FORMATS.has(format) || (format === "gif" && encoder === "js");
}

export interface ResolveFormatInput {
  format?: string;
  output?: string;
  transparent?: boolean;
  encoder?: EncoderKind;
}

/**
 * Resolve the effective { format, output }. transparent mp4 has no clean path,
 * so it falls back to a .mov/prores4444 container (manim's behaviour).
 */
export function resolveOutputFormat(input: ResolveFormatInput): { format: string; output: string } {
  const encoder = input.encoder ?? "ffmpeg";
  if (encoder !== "ffmpeg" && encoder !== "js") {
    throw new Error(`render(): unknown encoder ${JSON.stringify(input.encoder)} (expected "ffmpeg" | "js")`);
  }
  const transparent = input.transparent ?? false;
  let format = normalizeFormat(input.format);
  if (encoder === "js" && FFMPEG_ONLY_FORMATS.has(format)) {
    throw new Error(
      `render(): encoder: "js" cannot produce format "${format}" (video codecs need ffmpeg). ` +
      `Use format "apng", "zip" or "gif" with encoder: "js", or drop the encoder option.`,
    );
  }
  let output = input.output ?? (JS_ONLY_FORMATS.has(format) ? `output.${format}` : "output.mp4");
  if (transparent && format === "mp4") {
    format = "mov";
    output = output.replace(/\.mp4$/i, ".mov");
    if (!/\.mov$/i.test(output)) output += ".mov";
  }
  if (transparent && format === "mov") {
    if (!/\.mov$/i.test(output)) output = output.replace(/\.[^.]+$/, ".mov");
  }
  return { format, output };
}
