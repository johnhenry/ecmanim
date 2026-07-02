// Browser frame providers + a loadVideo() factory for VideoMobject.
//
// This is the browser-oriented counterpart to the Node ffmpeg-backed provider.
// It must remain IMPORT-SAFE under plain Node (no DOM): the classes are defined
// unconditionally, but NOTHING at module top-level touches `document`,
// `HTMLVideoElement`, `Image`, `createImageBitmap`, or WebCodecs. Those are only
// referenced inside methods / the async factory, guarded by runtime checks, so
// simply `import`ing this module in Node never throws. Real browser behavior is
// exercised by the orchestrator under the GPU lock; our Node tests use fakes.
//
// Three providers implement the isomorphic VideoFrameProvider contract:
//   - WebCodecsProvider   — frame-accurate + single-pass. Demuxes an mp4/mov with
//                           mp4box.js and decodes the whole stream through a
//                           WebCodecs VideoDecoder, then resamples to ImageBitmaps.
//                           Preferred by loadVideo("auto") when supported.
//   - PreCapturedProvider — frame-accurate, dependency-free fallback. Seeks the
//                           <video> once per frame and captures it. Works for any
//                           playable format; slower (O(frames) seeks).
//   - LiveVideoProvider   — low-latency real-time playback. frameAt(t) nudges
//                           video.currentTime and returns the <video> element as
//                           the drawable (not frame-accurate).
// All expose the same synchronous frameAt(t) array lookup the VideoMobject
// per-frame updater needs.

import { VideoMobject } from "./mobject/video_mobject.ts";
import type { VideoFrameProvider, VideoMobjectConfig } from "./mobject/video_mobject.ts";

/** True only when a DOM is present. Never dereferences DOM types at import. */
const hasDOM = typeof document !== "undefined";

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

// ---------------------------------------------------------------------------
// LiveVideoProvider
// ---------------------------------------------------------------------------
// Wraps a ready <video> element (metadata already loaded). For real-time play(),
// frameAt(t) does a best-effort seek (sets currentTime) and returns the element
// itself as the drawable — the renderer draws whatever the element is currently
// showing. This is intentionally NOT frame-accurate: it trades determinism for
// low latency, which is the right call for live on-screen playback.
export class LiveVideoProvider implements VideoFrameProvider {
  readonly fps: number;
  private video: any;

  constructor(video: any, fps: number = 30) {
    this.video = video;
    this.fps = fps;
  }

  get duration(): number {
    const d = this.video?.duration;
    return Number.isFinite(d) ? d : 0;
  }
  get width(): number {
    return this.video?.videoWidth ?? 0;
  }
  get height(): number {
    return this.video?.videoHeight ?? 0;
  }

  frameAt(timeSeconds: number): any {
    const v = this.video;
    if (!v) return null;
    const t = clamp(timeSeconds, 0, this.duration || 0);
    // Best-effort nudge. The decode is async in the element; we don't await it,
    // so what actually gets drawn is "close enough" to t for live playback.
    try {
      if (Math.abs((v.currentTime ?? 0) - t) > 1e-3) v.currentTime = t;
    } catch {
      /* seeking may be rejected mid-load; ignore */
    }
    return v;
  }

  dispose(): void {
    try {
      this.video?.pause?.();
    } catch {
      /* ignore */
    }
    this.video = null;
  }
}

// ---------------------------------------------------------------------------
// PreCapturedProvider
// ---------------------------------------------------------------------------
// Frame-accurate and dependency-free. In init(), it walks the clip one frame at
// a time (t = i / fps), seeks the <video> to each target time, awaits the
// `seeked` event, and draws the frame into an offscreen canvas which is then
// snapshotted to an ImageBitmap (or the canvas itself as a fallback). The result
// is a flat array of drawables. frameAt(t) is then a pure synchronous lookup:
//   frames[clamp(round(t * fps), 0, n - 1)]
//
// This provider is dependency-free and works for any format the browser's
// <video> can play. For mp4/mov, the WebCodecsProvider below is faster (a single
// decode pass instead of O(frames) seeks) and is preferred by loadVideo("auto");
// this seek-and-capture path remains the universal fallback.
export class PreCapturedProvider implements VideoFrameProvider {
  readonly fps: number;
  private _duration: number;
  private _width: number;
  private _height: number;
  private frames: any[];
  private video: any;

  // The constructor is also the TEST SEAM: pass injected `frames` (+ dims) to
  // build an instance with pre-populated frames and NO real <video>, so the
  // time -> index math can be unit-tested under Node without a browser. When a
  // real <video> is provided, call init() to actually capture the frames.
  constructor(opts: {
    video?: any;
    fps?: number;
    frames?: any[];
    duration?: number;
    width?: number;
    height?: number;
  } = {}) {
    this.video = opts.video ?? null;
    this.fps = opts.fps ?? 30;
    this.frames = opts.frames ? opts.frames.slice() : [];
    // Derive metadata from injected values, else from the element (if present).
    this._width = opts.width ?? this.video?.videoWidth ?? 0;
    this._height = opts.height ?? this.video?.videoHeight ?? 0;
    this._duration =
      opts.duration ??
      (Number.isFinite(this.video?.duration) ? this.video.duration : 0) ??
      0;
    // If frames were injected but no explicit duration, derive it from count.
    if (opts.frames && opts.duration == null && this.fps > 0) {
      this._duration = this.frames.length / this.fps;
    }
  }

  get duration(): number {
    return this._duration;
  }
  get width(): number {
    return this._width;
  }
  get height(): number {
    return this._height;
  }

  /** Number of captured frames (test/introspection helper). */
  get frameCount(): number {
    return this.frames.length;
  }

  // Capture every frame of the clip. Browser-only (needs a DOM + a real
  // <video>). Idempotent-ish: re-running re-captures from scratch.
  async init(): Promise<this> {
    if (!hasDOM) {
      throw new Error(
        "PreCapturedProvider.init() is browser-only: no document available (run under a browser / the GPU-locked orchestrator)",
      );
    }
    const v = this.video;
    if (!v) {
      throw new Error("PreCapturedProvider.init() requires a <video> element");
    }

    const duration = Number.isFinite(v.duration) ? v.duration : 0;
    this._duration = duration;
    this._width = v.videoWidth ?? 0;
    this._height = v.videoHeight ?? 0;

    const w = this._width;
    const h = this._height;
    if (!w || !h) {
      throw new Error("PreCapturedProvider.init(): video has no intrinsic dimensions (metadata not loaded?)");
    }

    // Offscreen drawing surface: prefer OffscreenCanvas, fall back to a DOM
    // <canvas>. Both expose a 2D context and are drawImage-able.
    const canvas: any =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(w, h)
        : document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");

    const total = Math.max(1, Math.round(duration * this.fps));
    const frames: any[] = [];
    for (let i = 0; i < total; i++) {
      const t = Math.min(i / this.fps, Math.max(0, duration - 1e-4));
      await seekTo(v, t);
      ctx.drawImage(v, 0, 0, w, h);
      frames.push(await snapshot(canvas, ctx, w, h));
    }
    this.frames = frames;
    return this;
  }

  frameAt(timeSeconds: number): any {
    const n = this.frames.length;
    if (n === 0) return null;
    const t = clamp(timeSeconds, 0, this._duration || 0);
    const idx = clamp(Math.round(t * this.fps), 0, n - 1);
    return this.frames[idx];
  }

  dispose(): void {
    for (const f of this.frames) {
      try {
        f?.close?.(); // ImageBitmap.close() frees GPU memory when available
      } catch {
        /* ignore */
      }
    }
    this.frames = [];
    try {
      this.video?.pause?.();
    } catch {
      /* ignore */
    }
    this.video = null;
  }
}

// Seek a <video> to `t` and resolve once the `seeked` event fires. Resolves
// immediately if the element is already at (near) that time.
function seekTo(video: any, t: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (Math.abs((video.currentTime ?? 0) - t) < 1e-4 && video.readyState >= 2) {
      resolve();
      return;
    }
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    try {
      video.currentTime = t;
    } catch {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    }
  });
}

// Snapshot the drawn canvas into a stable drawable. Prefer createImageBitmap
// (an immutable, cheap-to-draw bitmap). Fall back to cloning the canvas pixels
// so later frames don't overwrite this one.
async function snapshot(canvas: any, ctx: any, w: number, h: number): Promise<any> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(canvas);
    } catch {
      /* fall through to canvas clone */
    }
  }
  // Fallback: copy pixels into a fresh canvas so the frame is retained.
  const out: any =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(w, h)
      : document.createElement("canvas");
  out.width = w;
  out.height = h;
  out.getContext("2d").drawImage(canvas, 0, 0);
  return out;
}

// ---------------------------------------------------------------------------
// WebCodecsProvider
// ---------------------------------------------------------------------------
// Frame-accurate AND single-pass: instead of seeking a <video> once per frame
// (O(frames) sequential seeks), it demuxes the container with mp4box.js and
// decodes the whole stream in one pass through a WebCodecs `VideoDecoder`, then
// resamples the decoded frames onto the target fps grid as ImageBitmaps. Same
// synchronous frameAt() contract as PreCapturedProvider, so VideoMobject is
// unchanged — this is a drop-in accuracy/perf upgrade.
//
// Requirements: a browser with WebCodecs (`VideoDecoder`) and an mp4/mov source
// (mp4box demuxes ISO-BMFF; h264/h265/av1). For other formats or when WebCodecs
// is unavailable, loadVideo("auto") falls back to PreCapturedProvider. mp4box is
// imported LAZILY (never at module top level) so unbundled browser loading and
// Node import-safety are preserved.
export class WebCodecsProvider implements VideoFrameProvider {
  readonly fps: number;
  private _duration: number;
  private _width: number;
  private _height: number;
  private frames: any[];

  // Same test seam as PreCapturedProvider: inject `frames` (+ dims) to unit-test
  // the time -> index math under Node without a browser / WebCodecs.
  constructor(opts: { fps?: number; frames?: any[]; duration?: number; width?: number; height?: number } = {}) {
    this.fps = opts.fps ?? 30;
    this.frames = opts.frames ? opts.frames.slice() : [];
    this._width = opts.width ?? 0;
    this._height = opts.height ?? 0;
    this._duration = opts.duration ?? (this.fps > 0 ? this.frames.length / this.fps : 0);
  }

  // Demux + decode `url` into a resampled ImageBitmap array. Rejects (so the
  // caller can fall back) when WebCodecs/mp4box/the codec isn't available.
  static async create(url: string, fps: number): Promise<WebCodecsProvider> {
    const { frames, duration, width, height } = await demuxAndDecode(url, fps);
    return new WebCodecsProvider({ fps, frames, duration, width, height });
  }

  get duration(): number { return this._duration; }
  get width(): number { return this._width; }
  get height(): number { return this._height; }
  /** Number of resampled frames (test/introspection helper). */
  get frameCount(): number { return this.frames.length; }

  frameAt(timeSeconds: number): any {
    const n = this.frames.length;
    if (n === 0) return null;
    const t = clamp(timeSeconds, 0, this._duration || 0);
    return this.frames[clamp(Math.round(t * this.fps), 0, n - 1)];
  }

  dispose(): void {
    for (const f of this.frames) {
      try { f?.close?.(); } catch { /* ignore */ }
    }
    this.frames = [];
  }
}

/** True when the WebCodecs decode API is present (false in Node / older browsers). */
export function webCodecsAvailable(): boolean {
  const g: any = globalThis as any;
  return typeof g.VideoDecoder === "function" && typeof g.EncodedVideoChunk === "function";
}

// Pull the codec description (avcC / hvcC / av1C / vpcC box bytes) that
// VideoDecoder.configure() needs for h264/h265/av1. Returns undefined for codecs
// that don't require one.
function codecDescription(file: any, trackId: number, DataStream: any): Uint8Array | undefined {
  const trak = file.getTrackById(trackId);
  const entries = trak?.mdia?.minf?.stbl?.stsd?.entries ?? [];
  for (const entry of entries) {
    const box = entry.avcC || entry.hvcC || entry.av1C || entry.vpcC;
    if (box) {
      const ds = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
      box.write(ds);
      return new Uint8Array(ds.buffer, 8); // strip the 8-byte box header
    }
  }
  return undefined;
}

// Fetch + demux (mp4box) + decode (WebCodecs) `url`, returning frames resampled
// onto the target fps grid as ImageBitmaps. Throws on any unsupported step.
async function demuxAndDecode(
  url: string,
  targetFps: number,
): Promise<{ frames: any[]; duration: number; width: number; height: number }> {
  const g: any = globalThis as any;
  if (!webCodecsAvailable()) throw new Error("WebCodecs (VideoDecoder) is not available");
  if (typeof createImageBitmap !== "function") throw new Error("createImageBitmap is not available");
  const mp4box: any = await import("mp4box");
  const createFile = mp4box.createFile ?? mp4box.default?.createFile;
  const DataStream = mp4box.DataStream ?? mp4box.default?.DataStream;
  if (!createFile || !DataStream) throw new Error("mp4box: createFile/DataStream unavailable");

  const resp = await fetch(url);
  if (!resp.ok) throw new Error("WebCodecs demux: fetch failed " + resp.status);
  const buf: any = await resp.arrayBuffer();

  const file = createFile();
  const chunks: any[] = [];
  let track: any = null;

  // mp4box parses and delivers samples SYNCHRONOUSLY during appendBuffer/flush,
  // so extraction must be armed inside onReady (before the data is processed) —
  // and onSamples set up beforehand — otherwise start() runs too late and no
  // samples are ever delivered.
  await new Promise<void>((resolve, reject) => {
    file.onError = (e: any) => reject(new Error("mp4box: " + e));
    file.onReady = (info: any) => {
      track = info.videoTracks && info.videoTracks[0];
      if (!track) { reject(new Error("no video track (WebCodecs path needs an mp4/mov)")); return; }
      file.setExtractionOptions(track.id, null, { nbSamples: track.nb_samples });
      file.start();
    };
    file.onSamples = (_id: number, _user: any, samples: any[]) => {
      for (const s of samples) {
        chunks.push(new g.EncodedVideoChunk({
          type: s.is_sync ? "key" : "delta",
          timestamp: Math.round((s.cts * 1e6) / s.timescale),
          duration: Math.round((s.duration * 1e6) / s.timescale),
          data: s.data,
        }));
      }
      if (track && chunks.length >= track.nb_samples) resolve();
    };
    buf.fileStart = 0;
    file.appendBuffer(buf);
    file.flush();
  });

  const width = track.video?.width ?? track.track_width;
  const height = track.video?.height ?? track.track_height;
  const config: any = { codec: track.codec, codedWidth: width, codedHeight: height };
  const desc = codecDescription(file, track.id, DataStream);
  if (desc) config.description = desc;

  if (g.VideoDecoder.isConfigSupported) {
    const sup = await g.VideoDecoder.isConfigSupported(config);
    if (!sup?.supported) throw new Error("WebCodecs: unsupported codec " + track.codec);
  }

  const decoded: any[] = [];
  let decodeErr: any = null;
  const decoder = new g.VideoDecoder({
    output: (frame: any) => decoded.push(frame),
    error: (e: any) => { decodeErr = decodeErr ?? e; },
  });
  decoder.configure(config);
  for (const c of chunks) decoder.decode(c);
  await decoder.flush();
  try { decoder.close(); } catch { /* ignore */ }
  if (decodeErr) throw decodeErr;
  if (decoded.length === 0) throw new Error("WebCodecs: decoded no frames");

  // Presentation order (B-frames decode out of order).
  decoded.sort((a, b) => a.timestamp - b.timestamp);
  const duration = track.duration && track.timescale
    ? track.duration / track.timescale
    : decoded.length / targetFps;

  // Resample onto the target fps grid -> stable ImageBitmaps, then release the
  // (memory-heavy) VideoFrames.
  const total = Math.max(1, Math.round(duration * targetFps));
  const frames: any[] = [];
  let cursor = 0;
  for (let i = 0; i < total; i++) {
    const tUs = (i / targetFps) * 1e6;
    while (cursor + 1 < decoded.length && decoded[cursor + 1].timestamp <= tUs) cursor++;
    frames.push(await createImageBitmap(decoded[Math.min(cursor, decoded.length - 1)]));
  }
  for (const vf of decoded) { try { vf.close(); } catch { /* ignore */ } }

  return { frames, duration, width, height };
}

// ---------------------------------------------------------------------------
// loadVideo() factory
// ---------------------------------------------------------------------------
export interface LoadVideoBrowserOptions extends VideoMobjectConfig {
  /** Capture / index framerate (default 30). */
  fps?: number;
  /**
   * Provider selection (default "auto"):
   *   - "auto":       WebCodecs single-pass decode for an mp4/mov URL when the
   *                   browser supports it, else falls back to "precapture".
   *   - "webcodecs":  force the WebCodecs path (throws if unsupported).
   *   - "precapture": frame-accurate seek-and-capture (dependency-free).
   *   - "live":       low-latency real-time <video> (not frame-accurate).
   */
  mode?: "auto" | "webcodecs" | "precapture" | "live";
  /** crossOrigin attribute for the created <video> (default "anonymous"). */
  crossOrigin?: string;
}

// Create a VideoMobject in the browser. `mode` picks the provider; "auto"
// (default) prefers the WebCodecs single-pass decoder for URL sources and
// transparently falls back to seek-and-capture when it can't be used.
export async function loadVideo(
  src: string | any,
  options: LoadVideoBrowserOptions = {},
): Promise<VideoMobject> {
  if (!hasDOM) {
    throw new Error(
      "loadVideo() is browser-only: no document available. Use the Node backend's loadVideo (ffmpeg) under Node, or run this under a browser.",
    );
  }

  const fps = options.fps ?? 30;
  const mode = options.mode ?? "auto";

  // WebCodecs decodes from bytes (a URL), not an existing element.
  const wantWebCodecs =
    mode === "webcodecs" ||
    (mode === "auto" && typeof src === "string" && webCodecsAvailable());
  if (wantWebCodecs) {
    try {
      const provider = await WebCodecsProvider.create(src as string, fps);
      return new VideoMobject(provider, options);
    } catch (e) {
      if (mode === "webcodecs") throw e; // explicit request -> surface the error
      // "auto": fall through to the dependency-free seek-and-capture path.
    }
  }

  const video = await normalizeVideo(src, options.crossOrigin ?? "anonymous");
  if (mode === "live") {
    return new VideoMobject(new LiveVideoProvider(video, fps), options);
  }
  const pre = new PreCapturedProvider({ video, fps });
  await pre.init();
  return new VideoMobject(pre, options);
}

// Turn `src` into a ready <video> (metadata loaded). Accepts an existing
// HTMLVideoElement (used as-is, only awaiting metadata if not yet ready) or a
// URL string (a fresh element is created and configured).
async function normalizeVideo(src: string | any, crossOrigin: string): Promise<any> {
  let video: any;
  const isElement =
    typeof HTMLVideoElement !== "undefined" && src instanceof HTMLVideoElement;

  if (isElement) {
    video = src;
  } else if (typeof src === "string") {
    video = document.createElement("video");
    video.crossOrigin = crossOrigin;
    video.src = src;
  } else {
    // Duck-typed element (e.g. a test double that isn't a real HTMLVideoElement).
    video = src;
  }

  video.muted = true;
  video.playsInline = true;
  // Load enough to know duration/dimensions and to allow seeking.
  video.preload = "auto";

  await waitForMetadata(video);
  return video;
}

// Resolve once the element's metadata (duration + dimensions) is available.
function waitForMetadata(video: any): Promise<void> {
  const ready = () =>
    video.readyState >= 1 && Number.isFinite(video.duration) && video.videoWidth > 0;
  return new Promise<void>((resolve, reject) => {
    if (ready()) {
      resolve();
      return;
    }
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("loadVideo(): failed to load video metadata"));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("error", onError);
    // Nudge the load if the element hasn't started.
    try {
      video.load?.();
    } catch {
      /* ignore */
    }
  });
}
