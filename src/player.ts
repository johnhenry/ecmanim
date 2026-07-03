// A frame-recording Player for scrubbable, random-access playback of a Scene.
//
// Unlike the live browser backend (browser.ts), which renders a Scene in real
// time, the Player RECORDS every emitted frame into an in-memory array so the
// UI can seek to any frame instantly (a timeline scrubber) and replay the clip
// decoupled from how long it took to compute.
//
// It is browser-oriented — it renders to an offscreen canvas, snapshots frames
// as ImageBitmap (or ImageData), draws to a display <canvas>, and plays back via
// requestAnimationFrame. But it is written defensively so it also imports and
// (partially) runs in Node: the recording step falls back to @napi-rs/canvas +
// raw pixel buffers when browser globals are missing, and playback becomes a
// no-op. `any` is used freely for the host canvas APIs.

import { Camera, CanvasRenderer } from "./renderer/CanvasRenderer.ts";
import { Scene } from "./scene/Scene.ts";
import { makeScene, runConstruct } from "./scene/orchestrate.ts";

// Quality presets (kept local so this module has no dependency on index.ts,
// which pulls in the full library graph — the Player is meant to be small and
// embeddable).
const QUALITIES: Record<string, { pixelWidth: number; pixelHeight: number; fps: number }> = {
  low: { pixelWidth: 854, pixelHeight: 480, fps: 15 },
  medium: { pixelWidth: 1280, pixelHeight: 720, fps: 30 },
  high: { pixelWidth: 1920, pixelHeight: 1080, fps: 60 },
  fourk: { pixelWidth: 3840, pixelHeight: 2160, fps: 60 },
};

/** A single recorded frame. Exactly one of these payload fields is populated. */
export interface RecordedFrame {
  /** Browser fast-path: a decoded bitmap ready to drawImage(). */
  bitmap?: any; // ImageBitmap
  /** Fallback: raw pixel data (browser ImageData, or a Node substitute). */
  imageData?: any;
  /** Node fallback: the raw RGBA buffer + dims when no ImageData exists. */
  buffer?: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

export interface PlayerOptions {
  /** Display canvas the Player draws recorded frames onto (browser). Optional. */
  canvas?: any;
  /** Camera config (merged into the recording Camera). */
  camera?: any;
  /** Background color for the recording. */
  background?: string;
  /** Quality preset name: low | medium | high | fourk. */
  quality?: string;
  pixelWidth?: number;
  pixelHeight?: number;
  fps?: number;
}

// --- Small host-capability probes (browser vs Node) ---------------------------
const G: any = globalThis as any;
const hasDocument = typeof G.document !== "undefined";
const hasCreateImageBitmap = typeof G.createImageBitmap === "function";
const hasRAF = typeof G.requestAnimationFrame === "function";
const hasOffscreen = typeof G.OffscreenCanvas === "function";

/** Create an offscreen 2D drawing surface, in the browser or Node. */
async function makeOffscreen(width: number, height: number): Promise<{ canvas: any; ctx: any; kind: string }> {
  if (hasOffscreen) {
    const canvas = new G.OffscreenCanvas(width, height);
    return { canvas, ctx: canvas.getContext("2d"), kind: "offscreen" };
  }
  if (hasDocument) {
    const canvas = G.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return { canvas, ctx: canvas.getContext("2d"), kind: "dom" };
  }
  // Node fallback: @napi-rs/canvas (an optionalDependency of this package).
  try {
    const mod: any = await import("@napi-rs/canvas");
    const canvas = mod.createCanvas(width, height);
    return { canvas, ctx: canvas.getContext("2d"), kind: "napi" };
  } catch {
    throw new Error(
      "Player.record(): no canvas backend available. In the browser this needs " +
      "OffscreenCanvas or a <canvas>; in Node install @napi-rs/canvas.",
    );
  }
}

/** Snapshot the current contents of an offscreen surface into a RecordedFrame. */
async function snapshot(canvas: any, ctx: any, width: number, height: number): Promise<RecordedFrame> {
  // Fast path: a decoded bitmap the display canvas can blit directly.
  if (hasCreateImageBitmap) {
    try {
      const bitmap = await G.createImageBitmap(canvas);
      return { bitmap, width, height };
    } catch { /* fall through to pixel snapshots */ }
  }
  // Pixel path: works in the browser (ImageData) and Node (@napi-rs getImageData).
  try {
    const imageData = ctx.getImageData(0, 0, width, height);
    return { imageData, width, height };
  } catch { /* fall through to a raw buffer */ }
  // Last resort (Node napi): copy raw RGBA pixels so we at least retain frame data.
  try {
    const buffer: Uint8Array = canvas.data ? canvas.data() : new Uint8Array(width * height * 4);
    return { buffer, width, height };
  } catch {
    return { width, height };
  }
}



export class Player {
  /** All recorded frames, in order. Index === frame number. */
  frames: RecordedFrame[];
  fps: number;
  /** Display canvas + 2D ctx (browser). Undefined when running headless. */
  canvas: any;
  ctx: any;
  pixelWidth: number;
  pixelHeight: number;
  background: string;
  cameraConfig: any;

  /** The Scene instance from the most recent record() — exposes onLog, sections, etc. */
  scene?: Scene;

  /** UI hook: called with (frameIndex, timeSeconds) whenever a frame is displayed. */
  onFrame?: (frameIndex: number, time: number) => void;

  private _playing: boolean;
  private _rafId: any;
  private _current: number;
  private _playStartWall: number;
  private _playStartFrame: number;

  // Live-redraw support (Studio interactive camera): the recording Camera
  // instance, a renderer bound to the DISPLAY canvas (separate from the
  // offscreen recording renderer in record()), and a reference to the LAST
  // frame's live mobjects — retained as a single overwritten reference (not
  // per-frame storage) purely so a pointer-driven camera controller can
  // re-render the currently-paused frame on demand. `frames[]` stays
  // rasterized bitmaps only; this is an additive, opt-in path alongside it.
  private _camera: Camera | null = null;
  private _liveRenderer: CanvasRenderer | null = null;
  private _lastMobjects: any[] | null = null;

  constructor(opts: PlayerOptions = {}) {
    const q = QUALITIES[opts.quality ?? "medium"] ?? QUALITIES.medium;
    this.canvas = opts.canvas;
    this.pixelWidth = opts.pixelWidth ?? this.canvas?.width ?? q.pixelWidth;
    this.pixelHeight = opts.pixelHeight ?? this.canvas?.height ?? q.pixelHeight;
    this.fps = opts.fps ?? q.fps;
    this.background = opts.background ?? "#000000";
    this.cameraConfig = opts.camera ?? {};
    this.frames = [];
    this._playing = false;
    this._rafId = null;
    this._current = 0;
    this._playStartWall = 0;
    this._playStartFrame = 0;

    if (this.canvas) {
      // Size the display canvas to the recording resolution.
      this.canvas.width = this.pixelWidth;
      this.canvas.height = this.pixelHeight;
      this.ctx = this.canvas.getContext?.("2d");
    }
  }

  get frameCount(): number {
    return this.frames.length;
  }

  /** Total clip duration in seconds. */
  get duration(): number {
    return this.frames.length / this.fps;
  }

  /** The currently displayed frame index. */
  get currentFrame(): number {
    return this._current;
  }

  /** The recording Camera, for a Studio interactive-camera controller to mutate. */
  get camera(): Camera | null {
    return this._camera;
  }

  /** Wall-clock time of the currently displayed frame. */
  get currentTime(): number {
    return this._current / this.fps;
  }

  /**
   * Run a Scene (or a bare construct function) and record EVERY emitted frame
   * into `this.frames`. Decoupled from real time — as fast as the machine can
   * compute. After this resolves, seek()/play() give random-access playback.
   */
  async record(sceneOrConstruct: any): Promise<void> {
    const camera = new Camera({
      pixelWidth: this.pixelWidth,
      pixelHeight: this.pixelHeight,
      background: this.background,
      ...this.cameraConfig,
    });

    const { canvas: off, ctx: offCtx } = await makeOffscreen(this.pixelWidth, this.pixelHeight);
    const renderer = new CanvasRenderer(offCtx, camera);

    this._camera = camera;
    this._liveRenderer = this.ctx ? new CanvasRenderer(this.ctx, camera) : null;
    this._lastMobjects = null;

    const scene = makeScene(sceneOrConstruct, { fps: this.fps, camera });
    this.scene = scene;
    this.frames = [];
    this._current = 0;

    scene.frameHandler = async (mobjects: any) => {
      this._lastMobjects = mobjects;
      renderer.renderScene(mobjects);
      const frame = await snapshot(off, offCtx, this.pixelWidth, this.pixelHeight);
      this.frames.push(frame);
    };

    scene.log("record", "recording started", {
      pixelWidth: this.pixelWidth, pixelHeight: this.pixelHeight, fps: this.fps,
    });
    await runConstruct(sceneOrConstruct, scene);
    scene.log("record", "recording finished", { frames: this.frames.length, duration: this.duration });

    // Show the first frame if we have a display surface.
    if (this.frames.length) this.seek(0);
  }

  /** Draw a stored frame to the display canvas and fire onFrame. */
  seek(frameIndex: number): void {
    if (this.frames.length === 0) return;
    const i = Math.max(0, Math.min(this.frames.length - 1, Math.floor(frameIndex)));
    this._current = i;
    this._draw(this.frames[i]);
    this.onFrame?.(i, i / this.fps);
  }

  /** Seek to a time in seconds. */
  seekTime(seconds: number): void {
    this.seek(Math.round(seconds * this.fps));
  }

  /**
   * Re-render the LAST recorded frame's live mobjects straight to the display
   * canvas, reflecting the current state of `this.camera` (e.g. after a
   * Studio interactive-camera pan/zoom/orbit). Unlike seek()/_draw(), this
   * does not read from `frames[]` — it re-runs `renderScene()` against the
   * live mobject list, so camera changes are visible immediately without a
   * re-record. No-op headless (no display canvas) or before any frame has
   * been recorded.
   */
  rerenderCurrentFrame(): void {
    if (!this._liveRenderer || !this._lastMobjects) return;
    this._liveRenderer.renderScene(this._lastMobjects);
  }

  private _draw(frame: RecordedFrame): void {
    if (!this.ctx || !frame) return;
    try {
      if (frame.bitmap) {
        this.ctx.drawImage(frame.bitmap, 0, 0, this.pixelWidth, this.pixelHeight);
      } else if (frame.imageData) {
        this.ctx.putImageData(frame.imageData, 0, 0);
      }
      // A raw buffer with no ImageData can't be blitted portably; skip drawing.
    } catch { /* unsupported drawable in this host — ignore */ }
  }

  /** Real-time playback of the recorded frames via requestAnimationFrame. */
  play(): void {
    if (this._playing || this.frames.length === 0) return;
    if (!hasRAF) return; // headless: nothing to animate against
    this._playing = true;
    // If we're at the end, restart from the top.
    if (this._current >= this.frames.length - 1) this._current = 0;
    this._playStartWall = (G.performance?.now?.() ?? Date.now());
    this._playStartFrame = this._current;

    const tick = () => {
      if (!this._playing) return;
      const now = (G.performance?.now?.() ?? Date.now());
      const elapsed = (now - this._playStartWall) / 1000;
      const target = this._playStartFrame + Math.round(elapsed * this.fps * this.playbackRate);
      // Presenter mode: pause (or loop) at the end of the current section.
      if (this.presenterMode) {
        const sec = this.sectionContaining(this._current);
        if (sec && target >= sec.endFrame - 1) {
          if (String(sec.type).includes("loop")) {
            this._playStartWall = now; this._playStartFrame = sec.startFrame;
            this.seek(sec.startFrame);
            this._rafId = G.requestAnimationFrame(tick);
            return;
          }
          this.seek(sec.endFrame - 1);
          this.pause();
          return;
        }
      }
      if (target >= this.frames.length - 1) {
        this.seek(this.frames.length - 1);
        this.pause();
        return;
      }
      this.seek(target);
      this._rafId = G.requestAnimationFrame(tick);
    };
    this._rafId = G.requestAnimationFrame(tick);
  }

  /** Stop real-time playback (holds the current frame). */
  pause(): void {
    this._playing = false;
    if (this._rafId != null && typeof G.cancelAnimationFrame === "function") {
      G.cancelAnimationFrame(this._rafId);
    }
    this._rafId = null;
  }

  /** Whether real-time playback is currently running. */
  get playing(): boolean {
    return this._playing;
  }

  // --- presenter controls (Phase 4) ----------------------------------------
  /** Playback speed multiplier (1 = normal; supports fast/slow). */
  playbackRate = 1;
  /** Audio volume in [0,1] (stored; the <manim-player> reads it). */
  volume = 1;
  /** When true, playback pauses (or loops) at each section boundary. */
  presenterMode = false;

  setPlaybackRate(rate: number): void { this.playbackRate = Math.max(0.05, rate); }
  setVolume(v: number): void { this.volume = Math.max(0, Math.min(1, v)); }

  /** The recorded scene's sections (empty if none). */
  sections(): any[] {
    return (this.scene as any)?.sections ?? [];
  }

  /** The section containing a frame index, if any. */
  sectionContaining(frame: number): any | undefined {
    for (const s of this.sections()) if (frame >= s.startFrame && frame < s.endFrame) return s;
    return undefined;
  }

  /** Seek to the start of a section (by name or index). */
  seekToSection(nameOrIndex: string | number): void {
    const secs = this.sections();
    const sec = typeof nameOrIndex === "number" ? secs[nameOrIndex] : secs.find((s) => s.name === nameOrIndex);
    if (sec) this.seek(sec.startFrame);
  }

  /** Jump to the next / previous section boundary (presenter navigation). */
  nextSection(): void {
    const secs = this.sections();
    const next = secs.find((s) => s.startFrame > this._current);
    if (next) this.seek(next.startFrame);
    else this.seek(this.frames.length - 1);
  }
  prevSection(): void {
    const secs = this.sections();
    let target = 0;
    for (const s of secs) if (s.startFrame < this._current - 1) target = s.startFrame;
    this.seek(target);
  }
}
