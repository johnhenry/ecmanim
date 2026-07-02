// Node backend for VideoMobject: an ffmpeg-backed decode layer that turns a
// video file into a synchronous, in-memory frame provider.
//
// The isomorphic core (src/mobject/video_mobject.ts) requires a
// VideoFrameProvider whose frameAt() is SYNCHRONOUS, because it is called from a
// per-frame updater. To satisfy that, this backend does ALL decoding up front in
// the async loadVideo() factory:
//
//   1. probeVideo() reads the clip's duration/dimensions/fps/hasAudio.
//   2. extractFrames() runs ffmpeg once to write numbered PNGs at the target fps
//      (optionally scaled and/or trimmed to [start, end]).
//   3. FrameCacheProvider.init() decodes every PNG into an @napi-rs/canvas Image
//      and holds them in an array; frameAt(t) is then a cheap index lookup.
//
// ── Memory tradeoff ──────────────────────────────────────────────────────────
// EVERY target frame is decoded and kept resident in memory as an RGBA bitmap.
// For an N-second clip at F fps and W×H pixels the footprint is roughly
// N * F * W * H * 4 bytes. A 10s 1080p clip at 30fps is ~2.5 GB — do not do that.
// Bound it with the `scale`, `fps`, `start` and `end` options: e.g. decode at
// the scene fps (not the source's), downscale to the on-screen size, and trim to
// only the span you actually play. These are the levers; there is intentionally
// no streaming/lazy path, because that would make frameAt() async.
//
// ── Determinism / caching ────────────────────────────────────────────────────
// Extraction is deterministic: the same (file, mtime, fps, scale) always yields
// byte-identical PNGs (ffmpeg's fps filter resamples on a fixed grid, and we
// strip timestamps). We key the on-disk frame cache by a content hash of exactly
// those inputs, so re-running loadVideo() skips ffmpeg entirely when the cache is
// warm. Because the frames are identical run-to-run, a VideoMobject also composes
// cleanly with the renderer's content-hash partial-movie cache in node.ts.

/// <reference types="node" />
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { VideoMobject } from "./mobject/video_mobject.ts";
import type { VideoFrameProvider, VideoMobjectConfig } from "./mobject/video_mobject.ts";
import { probeVideo, extractFrames, runFfmpeg } from "./renderer/ffmpeg.ts";
import { isIIIFManifest, resolveIIIFVideo } from "./metadata.ts";
import type { Chapter } from "./metadata.ts";

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * A VideoFrameProvider backed by a directory of PNG frames that were already
 * extracted at `fps`. init() pre-loads every frame into memory as an
 * @napi-rs/canvas Image; frameAt() is then a synchronous index lookup.
 */
export class FrameCacheProvider implements VideoFrameProvider {
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  private files: string[];
  private frames: any[] = [];

  constructor(opts: {
    dir?: string;
    files?: string[];
    fps: number;
    width: number;
    height: number;
    duration?: number;
  }) {
    this.fps = opts.fps;
    this.width = opts.width;
    this.height = opts.height;
    // Prefer an explicit file list; otherwise enumerate the frame directory.
    this.files = opts.files
      ? [...opts.files].sort()
      : readdirSync(opts.dir!)
          .filter((f) => /^frame_\d+\.png$/.test(f))
          .sort()
          .map((f) => join(opts.dir!, f));
    // duration derives from the number of frames at fps unless given.
    this.duration = opts.duration ?? (this.files.length > 0 ? this.files.length / this.fps : 0);
  }

  /** Decode every PNG frame into an Image and hold it in memory. */
  async init(): Promise<this> {
    const { loadImage } = await import("@napi-rs/canvas");
    this.frames = new Array(this.files.length);
    for (let i = 0; i < this.files.length; i++) {
      this.frames[i] = await loadImage(this.files[i]);
    }
    return this;
  }

  /** Synchronous frame lookup: nearest frame index for the given source time. */
  frameAt(timeSeconds: number): any {
    const n = this.frames.length;
    if (n === 0) return null;
    const t = clamp(timeSeconds, 0, this.duration);
    const idx = clamp(Math.round(t * this.fps), 0, n - 1);
    return this.frames[idx] ?? null;
  }

  /** Release the decoded frames so they can be garbage-collected. */
  dispose(): void {
    this.frames = [];
  }

  /** Number of decoded frames held in memory. */
  get frameCount(): number {
    return this.frames.length;
  }
}

/** Options for loadVideo(): VideoMobject config plus Node decode/audio knobs. */
export type LoadVideoOptions = VideoMobjectConfig & {
  /** Target decode fps (defaults to the source fps, capped). */
  fps?: number;
  /** Downscale to [w,h] or a target width (height auto). Bounds memory. */
  scale?: [number, number] | number;
  /** Base cache directory (default: <os.tmpdir()>/ecmanim-video). */
  cacheDir?: string;
  /** Scene to schedule audio into (required for audio muxing). */
  scene?: any;
  /** Extract the clip's audio and add it to scene.sounds. */
  audio?: boolean;
  /** Offset (seconds) at which the audio should play (default scene.time). */
  audioOffset?: number;
  /** Audio gain multiplier (default 1). */
  gain?: number;
  /** Log ffmpeg/ffprobe output. */
  verbose?: boolean;
  /**
   * Treat a string `src` as a URL to a IIIF Presentation 3.0 Manifest: fetch it,
   * resolve the video body URL + chapters, then ingest that. A manifest OBJECT
   * (already parsed) is auto-detected regardless of this flag.
   */
  iiif?: boolean;
};

// Cap the decode fps so a source with an absurd rate can't explode memory.
const MAX_DECODE_FPS = 60;

// Build a stable content hash for the frame cache key. `mtimeMs` is null for
// remote sources (e.g. an http(s) URL resolved from a IIIF manifest) where there
// is no local file to stat — in that case the source string alone keys the cache.
function frameCacheKey(src: string, mtimeMs: number | null, fps: number, scale: LoadVideoOptions["scale"], start?: number, end?: number): string {
  const h = createHash("sha1");
  const scaleKey = scale == null ? "none" : Array.isArray(scale) ? scale.join("x") : String(scale);
  const mtimeKey = mtimeMs == null ? "remote" : String(Math.round(mtimeMs));
  h.update([src, mtimeKey, fps, scaleKey, start ?? "", end ?? ""].join("|"));
  return h.digest("hex").slice(0, 16);
}

// Expected frame count for a [start,end] span at fps — used to decide whether a
// warm cache directory already holds a complete extraction.
function expectedFrameCount(duration: number, fps: number, start?: number, end?: number): number {
  const s = start ?? 0;
  const e = end ?? duration;
  const span = Math.max(0, e - s);
  // ffmpeg's fps filter emits ~round(span*fps) frames; allow the cache to be
  // "complete enough" if it has at least most of them (guards off-by-one).
  return Math.max(1, Math.floor(span * fps));
}

/**
 * Decode a video file into a VideoMobject.
 *
 * Probes the clip, extracts frames to a content-hash-keyed cache directory
 * (skipping ffmpeg when the cache is warm), pre-loads them into memory, and
 * returns a VideoMobject wired to that provider. Optionally extracts the clip's
 * audio and schedules it on `options.scene` for the node.ts muxer.
 */
export async function loadVideo(path: string | any, options: LoadVideoOptions = {}): Promise<VideoMobject> {
  const verbose = options.verbose ?? false;

  // 0. IIIF ingestion. A manifest OBJECT is auto-detected; a URL string is
  //    fetched + parsed only when { iiif: true }. Resolving yields the actual
  //    media URL (local or remote) + chapters to attach to the VideoMobject.
  let source: string = typeof path === "string" ? path : "";
  let iiifChapters: Chapter[] | undefined;
  if (isIIIFManifest(path)) {
    const info = resolveIIIFVideo(path);
    source = info.url;
    iiifChapters = info.chapters;
  } else if (typeof path === "string" && options.iiif === true) {
    const resp = await fetch(path);
    if (!resp.ok) throw new Error("loadVideo: IIIF manifest fetch failed " + resp.status + " for " + path);
    const manifest = await resp.json();
    const info = resolveIIIFVideo(manifest);
    source = info.url;
    iiifChapters = info.chapters;
  }

  // The media source may now be a local path or a remote http(s) URL. ffmpeg /
  // ffprobe accept http(s) URLs directly, so pass those through unchanged; only
  // local files are resolved to an absolute path and stat'd for the cache key.
  const isLocalFile = existsSync(source) || (!/^https?:\/\//i.test(source) && existsSync(resolve(source)));
  const mediaSrc = isLocalFile ? resolve(source) : source;
  if (isLocalFile && !existsSync(mediaSrc)) throw new Error("loadVideo: file not found: " + mediaSrc);
  if (!isLocalFile && !/^https?:\/\//i.test(mediaSrc)) {
    // Not a remote URL and not an existing local file -> genuinely missing.
    throw new Error("loadVideo: file not found: " + mediaSrc);
  }
  const mtimeMs = isLocalFile ? statSync(mediaSrc).mtimeMs : null;

  // Merge any IIIF chapters into the VideoMobject config so mob.chapters is set.
  if (iiifChapters && iiifChapters.length) {
    options = { ...options, chapters: [...(options.chapters ?? []), ...iiifChapters] };
  }

  // 1. Probe.
  const probe = await probeVideo(mediaSrc);
  const sourceFps = probe.fps > 0 ? probe.fps : 30;

  // 2. Choose decode fps (option override, else source, capped).
  const decodeFps = clamp(options.fps ?? sourceFps, 1, MAX_DECODE_FPS);

  const start = options.start;
  const end = options.end;

  // 3. Content-hash cache dir.
  const baseDir = options.cacheDir ?? join(tmpdir(), "ecmanim-video");
  const key = frameCacheKey(mediaSrc, mtimeMs, decodeFps, options.scale, start, end);
  const cacheDir = join(baseDir, key);

  // 4. Extract frames unless the cache already looks complete.
  const want = expectedFrameCount(probe.duration, decodeFps, start, end);
  let files: string[] = [];
  const haveFramesDir = existsSync(cacheDir)
    ? readdirSync(cacheDir).filter((f) => /^frame_\d+\.png$/.test(f)).sort()
    : [];
  // Treat the cache as valid if it holds at least `want` frames (extraction is
  // deterministic, so a full run always produces the same set).
  if (haveFramesDir.length >= want && haveFramesDir.length > 0) {
    if (verbose) console.log(`[loadVideo] frame cache hit (${haveFramesDir.length} frames) -> ${cacheDir}`);
    files = haveFramesDir.map((f) => join(cacheDir, f));
  } else {
    mkdirSync(cacheDir, { recursive: true });
    if (verbose) console.log(`[loadVideo] extracting frames @ ${decodeFps}fps -> ${cacheDir}`);
    files = await extractFrames(mediaSrc, {
      fps: decodeFps,
      scale: options.scale,
      dir: cacheDir,
      start,
      end,
      verbose,
    });
  }

  // 5. Determine on-screen frame dimensions. If scaled, the first decoded Image
  //    carries the true post-scale size; provider reads image.width/height, but
  //    we also feed intrinsic dims so ImageMobject sizing works before decode.
  let outWidth = probe.width;
  let outHeight = probe.height;
  if (options.scale != null) {
    if (Array.isArray(options.scale)) {
      outWidth = options.scale[0];
      outHeight = options.scale[1];
    } else {
      // single width, height auto-preserving aspect
      const aspect = probe.height ? probe.width / probe.height : 1;
      outWidth = options.scale;
      outHeight = Math.round(options.scale / aspect);
    }
  }

  // 6. Build + preload the provider.
  const spanDuration =
    start != null || end != null
      ? Math.max(0, (end ?? probe.duration) - (start ?? 0))
      : probe.duration;
  const provider = new FrameCacheProvider({
    files,
    fps: decodeFps,
    width: outWidth,
    height: outHeight,
    duration: spanDuration || (files.length ? files.length / decodeFps : 0),
  });
  await provider.init();

  // 7. Audio: extract the (trimmed) clip's audio and schedule it on the scene so
  //    node.ts's muxAudio() lays it over the rendered video. Copy the stream when
  //    possible; fall back to an AAC re-encode.
  if (options.audio && probe.hasAudio && options.scene) {
    const audioFile = await extractAudio(mediaSrc, cacheDir, start, end, verbose);
    if (audioFile) {
      options.scene.addSound(audioFile, {
        timeOffset: options.audioOffset ?? options.scene.time ?? 0,
        gain: options.gain ?? 1,
      });
    }
  }

  // 8. Build the VideoMobject from the provider + passthrough config.
  return new VideoMobject(provider, options);
}

// Extract the clip's audio to <cacheDir>/audio.<ext>. Tries a stream copy into a
// matching container first (fast, lossless); on failure re-encodes to AAC (.m4a).
// Returns the written file path, or null if no audio could be produced.
async function extractAudio(
  absPath: string,
  cacheDir: string,
  start: number | undefined,
  end: number | undefined,
  verbose: boolean,
): Promise<string | null> {
  mkdirSync(cacheDir, { recursive: true });

  const trim: string[] = [];
  if (start != null && start > 0) trim.push("-ss", String(start));
  // -t duration (relative to -ss when -ss precedes -i).
  if (end != null) {
    const dur = start != null && start > 0 ? Math.max(0, end - start) : end;
    trim.push("-t", String(dur));
  }

  // Prefer a lossless stream copy into an m4a container (works for aac/alac).
  const copyOut = join(cacheDir, "audio.m4a");
  if (existsSync(copyOut)) return copyOut;
  const copyArgs = ["-y", ...trim, "-i", absPath, "-vn", "-acodec", "copy", copyOut];
  const copied = await runFfmpeg(copyArgs, verbose, false);
  if (copied && existsSync(copyOut)) return copyOut;

  // Fall back to an AAC re-encode (handles opus/vorbis/pcm sources, or when the
  // native codec cannot be muxed into m4a).
  const encOut = join(cacheDir, "audio.aac");
  if (existsSync(encOut)) return encOut;
  const encArgs = ["-y", ...trim, "-i", absPath, "-vn", "-c:a", "aac", "-b:a", "192k", encOut];
  const encoded = await runFfmpeg(encArgs, verbose, false);
  if (encoded && existsSync(encOut)) return encOut;

  return null;
}
