// Shared ffmpeg helpers for the Node backends. Both the sequential renderer
// (node.ts) and the parallel segment renderer (node-parallel.ts) drive ffmpeg
// the same way, so these live in one leaf module to keep partial-movie files
// byte-compatible across both cache paths. Node-only (spawns the `ffmpeg` CLI).

/// <reference types="node" />
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync, readdirSync, renameSync } from "node:fs";
import { dirname, join, extname, basename } from "node:path";
import { threadId } from "node:worker_threads";

// Process- and thread-unique, monotonically-increasing suffix for temp partial
// files (see encodeFrames() below). worker_threads share one process.pid, so
// pid alone can't distinguish concurrent workers -- threadId does (0 = main
// thread, unique per Worker). The counter guards against two temp files from
// the SAME thread landing in the same call. Deliberately not Date.now()/
// Math.random(): this is a filesystem-safety concern, not scene/animation
// content, so it doesn't touch this project's render-determinism contract --
// but a plain counter is simpler and just as sufficient here regardless.
let _tempFileCounter = 0;
function tempSuffix(): string {
  return `pid${process.pid}-t${threadId}-${_tempFileCounter++}`;
}

// The temp path a caller should write to before renameSync()-ing into
// `outPath` (see encodeFrames() below for why: atomic rename is what makes
// concurrent readers only ever see "doesn't exist yet" or "fully written").
// Shared so every writer of a `outPath`-shaped file -- not just
// encodeFrames() -- can use the same safe write pattern instead of writing
// straight to the real output path.
export function tempPathFor(outPath: string): string {
  const ext = extname(outPath);
  const stem = basename(outPath, ext);
  return join(dirname(outPath), `${stem}.tmp-${tempSuffix()}${ext}`);
}

// Start an ffmpeg process reading PNGs (default) or straight-alpha RGBA from
// stdin. Keep PNG input for existing callers; Node video renderers select RGBA.
// Codec/pixel-format is chosen by `format` ("webm" | "gif" | "mov" |
// otherwise mp4/h264). `transparent` is accepted for signature compatibility but
// unused here — transparency is decided upstream by picking the .mov (prores)
// container, since h264 cannot store an alpha channel.
export function startFfmpeg(
  { fps, pixelWidth, pixelHeight, outPath, format, verbose, inputFormat = "png" }: any,
) {
  const input = inputFormat === "rgba"
    ? ["-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${pixelWidth}x${pixelHeight}`,
      // @napi-rs/canvas's PNGs carry sRGB tags. Rawvideo has no header, so
      // supply the same input tags to preserve color-managed playback.
      "-color_range", "pc", "-color_primaries", "bt709", "-color_trc", "iec61966-2-1"]
    : ["-f", "image2pipe"];
  const args = [
    "-y",
    ...input,
    "-framerate", String(fps),
    "-i", "-",
    "-s", `${pixelWidth}x${pixelHeight}`,
  ];
  if (format === "webm") {
    // VP9 with alpha (yuva420p) — transparent by default.
    args.push("-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30");
  } else if (format === "gif") {
    args.push("-vf", `fps=${fps},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`);
  } else if (format === "mov") {
    // ProRes 4444 preserves an alpha channel — the transparent-capable path.
    args.push("-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le");
  } else {
    // mp4 / h264. h264 cannot store alpha; transparency uses the .mov fallback.
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "18", "-movflags", "+faststart");
  }
  args.push(outPath);
  return spawn("ffmpeg", args, { stdio: ["pipe", "inherit", verbose ? "inherit" : "ignore"] });
}

// Await the write callback so at most one frame is pending, even for large
// RGBA buffers. The encoder owns the stream's error listener (see below).
export function writeToStream(stream: any, buf: any): Promise<void> {
  return new Promise<void>((res, rej) => {
    stream.write(buf, (error: Error | null | undefined) => error ? rej(error) : res());
  });
}

// A streaming, atomic encoder. Attach lifecycle listeners immediately: ffmpeg
// can fail while construct() is still running or while a raw frame is writing.
// The completion promise resolves with an error rather than rejecting before
// finish() is awaited. abort() reaps the child BEFORE removing its temp file.
export function createFfmpegEncoder(opts: any) {
  const { outPath } = opts;
  mkdirSync(dirname(outPath), { recursive: true });
  const tempPath = tempPathFor(outPath);
  const ff = startFfmpeg({ ...opts, outPath: tempPath });
  let error: Error | undefined;
  let exited = false;
  let finished = false;
  ff.on("error", (e) => { error ??= e; });
  ff.stdin.on("error", (e) => { error ??= e; });
  const closed = new Promise<Error | undefined>((resolve) => {
    ff.once("close", (code) => {
      exited = true;
      if (code !== 0) error ??= new Error("ffmpeg partial exited " + code);
      resolve(error);
    });
  });
  return {
    async write(frame: Uint8Array) {
      if (error) throw error;
      if (finished || exited) throw new Error("ffmpeg encoder is closed");
      if (opts.inputFormat === "rgba" && frame.byteLength !== opts.pixelWidth * opts.pixelHeight * 4) {
        throw new Error("RGBA frame size must equal pixelWidth * pixelHeight * 4");
      }
      await writeToStream(ff.stdin, frame);
    },
    async finish() {
      if (finished) return;
      ff.stdin.end();
      const failure = await closed;
      if (failure) throw failure;
      renameSync(tempPath, outPath);
      finished = true;
    },
    async abort() {
      // SIGTERM can leave ffmpeg blocked on stdin on macOS. This output is
      // being discarded, so use unconditional termination and wait for close.
      if (!exited) ff.kill("SIGKILL");
      await closed;
      rmSync(tempPath, { force: true });
    },
  };
}

// Encode an array of PNG buffers (or RGBA with inputFormat: "rgba") to a file.
// Streaming renderers use createFfmpegEncoder directly to bound memory use.
//
// Writes to a TEMP path in the same directory and renameSync()s it to the
// real `outPath` only after ffmpeg exits 0 -- never straight to `outPath`.
// `partial/{hash}.{ext}` is a SHARED cache directory: node-parallel.ts's
// workers write into it concurrently for one render, and separate Node
// processes rendering DIFFERENT scenes at the same time (e.g. several parity
// demos rendered in parallel) can too. Writing directly to the final path let
// a concurrent reader's `existsSync(partialPath)` check see a file that was
// still mid-write -- reading it then returned truncated/incomplete content,
// or (if two segments happened to share a content hash, e.g. a false
// positive from a since-fixed hashing blind spot) one process's read could
// land mid-stream of a COMPLETELY UNRELATED render, splicing foreign footage
// into its own output (confirmed reproducible during the Reveal.js/Slidev
// campaign's parallel port wave). `rename()` on the same filesystem is
// atomic on POSIX (and effectively atomic in practice on Windows via
// fs.renameSync) -- a concurrent reader now only ever sees "doesn't exist
// yet" or "fully written," never a partial state.
export async function encodeFrames(frames: any[], opts: any): Promise<void> {
  const encoder = createFfmpegEncoder(opts);
  try {
    for (const buf of frames) await encoder.write(buf);
    await encoder.finish();
  } catch (err) {
    await encoder.abort();
    throw err;
  }
}

// Run a one-shot ffmpeg command. Resolves true on exit 0; on failure either
// rejects (throwOnFail) or resolves false so callers can attempt a fallback.
export function runFfmpeg(args: string[], verbose: boolean, throwOnFail = false): Promise<boolean> {
  return new Promise<boolean>((res, rej) => {
    const ff = spawn("ffmpeg", args, { stdio: ["ignore", "inherit", verbose ? "inherit" : "ignore"] });
    ff.on("close", (code: number) => {
      if (code === 0) res(true);
      else if (throwOnFail) rej(new Error("ffmpeg exited " + code));
      else res(false);
    });
    ff.on("error", (e) => (throwOnFail ? rej(e) : res(false)));
  });
}

// Concatenate partial movie files into the final output using ffmpeg's concat
// demuxer (stream copy — no re-encode). Falls back to a re-encode concat if
// stream-copy fails (e.g. mismatched partials).
export async function concatPartials(partials: string[], outPath: string, verbose: boolean): Promise<void> {
  const listPath = outPath.replace(/\.[^.]+$/, "") + ".concat.txt";
  const body = partials.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
  writeFileSync(listPath, body);
  const args = ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath];
  const ok = await runFfmpeg(args, verbose);
  if (!ok) {
    // Re-encode fallback.
    const args2 = ["-y", "-f", "concat", "-safe", "0", "-i", listPath, outPath];
    await runFfmpeg(args2, verbose, true);
  }
  if (existsSync(listPath)) rmSync(listPath);
}

// Copy/remux a single partial to the final output (stream copy).
export async function remuxCopy(src: string, outPath: string, verbose: boolean): Promise<void> {
  const ok = await runFfmpeg(["-y", "-i", src, "-c", "copy", outPath], verbose);
  if (!ok) await runFfmpeg(["-y", "-i", src, outPath], verbose, true);
}

// --- Video input probing / frame extraction (for VideoMobject; see video-node.ts) ---

// Metadata about a source clip, as returned by ffprobe.
export interface ProbeResult {
  duration: number;   // seconds
  width: number;      // px
  height: number;     // px
  fps: number;        // frames per second (avg_frame_rate, resolved from a fraction)
  hasAudio: boolean;  // true if the file carries at least one audio stream
}

// Parse a possibly-fractional rate string like "30000/1001" or "30/1" or "25".
// Returns 0 for empty / "0/0" so callers can fall back to a default.
function parseRate(s: string | undefined): number {
  if (!s) return 0;
  const m = String(s).split("/");
  if (m.length === 2) {
    const num = Number(m[0]);
    const den = Number(m[1]);
    if (!den || !Number.isFinite(num) || !Number.isFinite(den)) return 0;
    return num / den;
  }
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

// Probe a media file with ffprobe, returning duration/dimensions/fps/hasAudio.
// Uses `-show_streams -show_format -of json` and reads the first video stream
// for geometry/fps; duration prefers format.duration, then the video stream's.
export function probeVideo(path: string): Promise<ProbeResult> {
  return new Promise<ProbeResult>((res, rej) => {
    const args = ["-v", "error", "-show_streams", "-show_format", "-of", "json", path];
    const pf = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    pf.stdout.on("data", (d) => (out += d));
    pf.stderr.on("data", (d) => (err += d));
    pf.on("error", rej);
    pf.on("close", (code: number) => {
      if (code !== 0) return rej(new Error("ffprobe exited " + code + (err ? ": " + err : "")));
      let json: any;
      try {
        json = JSON.parse(out);
      } catch (e: any) {
        return rej(new Error("ffprobe: unparseable JSON: " + e.message));
      }
      const streams: any[] = json.streams ?? [];
      const video = streams.find((s) => s.codec_type === "video");
      const hasAudio = streams.some((s) => s.codec_type === "audio");
      if (!video) return rej(new Error("ffprobe: no video stream in " + path));

      const width = Number(video.width) || 0;
      const height = Number(video.height) || 0;
      // Prefer avg_frame_rate; fall back to r_frame_rate; then 0 (caller defaults).
      const fps = parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate) || 0;
      // Duration: format-level is most reliable across containers; then stream.
      const duration =
        Number(json.format?.duration) ||
        Number(video.duration) ||
        0;

      res({ duration, width, height, fps, hasAudio });
    });
  });
}

// Extract numbered PNG frames from `path` into `opts.dir` at `opts.fps`. Optional
// `scale` ([w,h] or a single width, height auto with -1) applies a scale filter;
// `start`/`end` trim via -ss/-to (input-side -ss for speed, output-side -to).
// Returns the sorted list of written PNG paths.
//
// Frames are named frame_000001.png, frame_000002.png, … (ffmpeg's %06d, 1-based).
export async function extractFrames(
  path: string,
  opts: { fps: number; scale?: [number, number] | number; dir: string; start?: number; end?: number; verbose?: boolean },
): Promise<string[]> {
  const { fps, scale, dir, start, end } = opts;
  mkdirSync(dir, { recursive: true });

  const filters: string[] = [`fps=${fps}`];
  if (scale != null) {
    if (Array.isArray(scale)) filters.push(`scale=${scale[0]}:${scale[1]}`);
    else filters.push(`scale=${scale}:-1`);
  }

  const args: string[] = ["-y"];
  // Input-side seek is fast (keyframe-accurate). For frame-accuracy we let the
  // fps filter resample, which is deterministic for a given (start, fps).
  if (start != null && start > 0) args.push("-ss", String(start));
  args.push("-i", path);
  if (end != null) {
    // -to is relative to the (already -ss'd) input timeline in modern ffmpeg when
    // -ss precedes -i; pass the clip end minus start as duration to be safe.
    const dur = start != null && start > 0 ? Math.max(0, end - start) : end;
    args.push("-t", String(dur));
  }
  args.push("-vf", filters.join(","));
  // Deterministic PNGs (no timestamps embedded) so content hashing is stable.
  args.push("-vsync", "0", "-frame_pts", "0");
  const pattern = join(dir, "frame_%06d.png");
  args.push(pattern);

  await runFfmpeg(args, opts.verbose === true, true);

  // Collect + sort the written PNGs.
  const files = readdirSync(dir)
    .filter((f) => /^frame_\d+\.png$/.test(f))
    .sort();
  return files.map((f) => join(dir, f));
}
