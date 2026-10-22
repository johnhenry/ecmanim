// CLI `--encoder` flag validation. Isomorphic and node-free so it is unit
// testable without spawning the CLI. Returns {} when the flag is absent so the
// options handed to render() are exactly what they were before the flag existed.

import type { EncoderKind } from "./render_format.ts";

const VIDEO_FORMATS = new Set(["mp4", "webm", "mov", "png"]);

/** Validate `--encoder` against `--format`; throws a user-facing Error. */
export function cliEncoderOption(args: { encoder?: unknown; format?: unknown }): { encoder?: EncoderKind } {
  if (args.encoder === undefined) return {};
  const enc = args.encoder;
  if (enc !== "ffmpeg" && enc !== "js") {
    throw new Error(`unknown --encoder ${JSON.stringify(enc)} (expected ffmpeg | js)`);
  }
  if (enc === "js") {
    const fmt = typeof args.format === "string" ? args.format : "mp4";
    if (VIDEO_FORMATS.has(fmt)) {
      throw new Error(
        `--encoder js cannot produce "${fmt}" (video codecs and PNG sequences need ffmpeg/canvas). ` +
        `Use --format apng, zip or gif with --encoder js, or drop --encoder.`,
      );
    }
  }
  return { encoder: enc };
}
