// Studio overlays (epic #61, #74): onion-skin ghosts and motion-path trails
// layered over a Player canvas.
//
// Layout: everything up to "DOM glue" is pure and DOM-free (offset/frame
// planning, speed->colour, path sampling, ghost cloning) and unit-tested
// directly. The glue (renderOnionRaster, renderMotionPath, attachOnionSkin,
// attachMotionPath) only talks to a 2D context / canvas-shaped object handed
// in by the caller, so it runs under fakes in Node and on real canvases in the
// browser. Nothing here runs at import time.
//
// Onion skin has two modes:
//   * raster  -- composite the Player's already-recorded frames at +-k with a
//                tint and falling opacity (any scene, O(count) blits);
//   * vector  -- clone a time-pure mobject (anything with `setTime(t)`, e.g.
//                Skeleton / Clip) and evaluate the clone at t +- k*step. Cheap
//                and crisp; `sampleSceneAt` (O(n) replay) is only the fallback
//                for scenes that are not time-pure, and is left to the caller.
//
// Motion path samples a Skeleton joint or a mobject centre over [t0, t1],
// colours each segment by speed and marks keyframe times from a KeyframeTrack.

import { CanvasRenderer } from "../renderer/CanvasRenderer.ts";

// --- onion planning (pure) ----------------------------------------------------

export interface OnionOptions {
  /** Ghosts per side. Default 2. */
  count?: number;
  /** Spacing between ghosts: frames for raster, seconds for vector. Default 1 frame / 1 s. */
  step?: number;
  /** Show earlier ghosts. Default true. */
  past?: boolean;
  /** Show later ghosts. Default true. */
  future?: boolean;
  /** Tint of earlier ghosts. Default "#ff5555". */
  prevColor?: string;
  /** Tint of later ghosts. Default "#55aaff". */
  nextColor?: string;
  /** Opacity of the nearest ghost; farther ones fade linearly. Default 0.4. */
  opacity?: number;
}

export interface OnionOffset { offset: number; side: "prev" | "next"; k: number }

/** Ghost offsets in draw order: farthest past ... nearest past, nearest future ... farthest future. */
export function onionOffsets(opts: OnionOptions = {}): OnionOffset[] {
  const count = Math.max(0, Math.floor(opts.count ?? 2));
  const step = opts.step ?? 1;
  const out: OnionOffset[] = [];
  if (opts.past !== false) for (let k = count; k >= 1; k--) out.push({ offset: -k * step, side: "prev", k });
  if (opts.future !== false) for (let k = 1; k <= count; k++) out.push({ offset: k * step, side: "next", k });
  return out;
}

function ghostStyle(o: OnionOffset, opts: OnionOptions): { tint: string; opacity: number } {
  const count = Math.max(1, Math.floor(opts.count ?? 2));
  const base = opts.opacity ?? 0.4;
  return {
    tint: o.side === "prev" ? (opts.prevColor ?? "#ff5555") : (opts.nextColor ?? "#55aaff"),
    opacity: base * ((count - o.k + 1) / count),
  };
}

export interface OnionFrame extends OnionOffset { frame: number; tint: string; opacity: number }

/** Recorded-frame indices to composite around `current`, clamped to [0, totalFrames). `step` is in frames. */
export function onionFrames(current: number, totalFrames: number, opts: OnionOptions = {}): OnionFrame[] {
  const out: OnionFrame[] = [];
  for (const o of onionOffsets(opts)) {
    const frame = Math.round(current + o.offset);
    if (frame < 0 || frame >= totalFrames || frame === current) continue;
    out.push({ ...o, frame, ...ghostStyle(o, opts) });
  }
  return out;
}

export interface OnionTime extends OnionOffset { t: number; tint: string; opacity: number }

/** Times (seconds) to evaluate a time-pure mobject at, clamped to [0, duration]. `step` is in seconds. */
export function onionTimes(t: number, duration: number, opts: OnionOptions = {}): OnionTime[] {
  const out: OnionTime[] = [];
  for (const o of onionOffsets(opts)) {
    const tt = t + o.offset;
    if (tt < 0 || tt > duration) continue;
    out.push({ ...o, t: tt, ...ghostStyle(o, opts) });
  }
  return out;
}

// --- speed colour (pure) --------------------------------------------------------

export interface SpeedColorOptions {
  /** Colour at speed 0. Default "#3b82f6". */
  slow?: string;
  /** Colour at maxSpeed. Default "#ef4444". */
  fast?: string;
}

function parseHex(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) throw new Error(`speedColor: expected a #rrggbb colour, got "${c}"`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const hex2 = (v: number) => Math.round(v).toString(16).padStart(2, "0");

/** Linear slow->fast colour ramp as "#rrggbb"; speed is clamped to [0, maxSpeed]. */
export function speedColor(speed: number, maxSpeed: number, opts: SpeedColorOptions = {}): string {
  const a = parseHex(opts.slow ?? "#3b82f6");
  const b = parseHex(opts.fast ?? "#ef4444");
  const u = maxSpeed > 0 ? Math.max(0, Math.min(1, speed / maxSpeed)) : 0;
  return "#" + [0, 1, 2].map((i) => hex2(a[i] + (b[i] - a[i]) * u)).join("");
}

// --- motion-path sampling (pure) ------------------------------------------------

/** What to trace: a `t -> [x, y]` function, a Skeleton joint, or a time-pure mobject's centre. */
export type MotionSource =
  | ((t: number) => number[])
  | { skeleton: any; joint: string; track?: { valueAt(t: number): any } }
  | { mobject: any };

export interface MotionSample { t: number; x: number; y: number; speed: number }
export interface MotionPath { samples: MotionSample[]; maxSpeed: number; length: number }

function positionFn(source: MotionSource): (t: number) => number[] {
  if (typeof source === "function") return source;
  if ("skeleton" in source) {
    const probe = source.skeleton.copy(); // never disturb the live rig
    return (t) => {
      if (source.track) probe.setPose(source.track.valueAt(t));
      else probe.setTime(t);
      return probe.model.jointPosition(source.joint);
    };
  }
  const probe = source.mobject.copy();
  if (typeof probe.setTime !== "function") throw new Error("sampleMotionPath: mobject has no setTime(); pass a function source instead");
  return (t) => { probe.setTime(t); return probe.getCenter(); };
}

/**
 * Sample `source` every `step` seconds over [t0, t1] (t1 is always included).
 * `speed` is the finite-difference speed in world units per second; the first
 * sample borrows the first segment's speed.
 */
export function sampleMotionPath(source: MotionSource, t0: number, t1: number, step: number): MotionPath {
  if (!(step > 0)) throw new Error("sampleMotionPath: step must be > 0");
  const at = positionFn(source);
  const times: number[] = [];
  const n = Math.max(0, Math.floor((t1 - t0) / step + 1e-9));
  for (let i = 0; i <= n; i++) times.push(t0 + i * step);
  if (t1 - times[times.length - 1] > 1e-9) times.push(t1);
  const samples: MotionSample[] = times.map((t) => { const p = at(t); return { t, x: p[0], y: p[1], speed: 0 }; });
  let length = 0;
  for (let i = 1; i < samples.length; i++) {
    const d = Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
    length += d;
    const dt = samples[i].t - samples[i - 1].t;
    samples[i].speed = dt > 0 ? d / dt : 0;
  }
  if (samples.length > 1) samples[0].speed = samples[1].speed;
  return { samples, maxSpeed: samples.reduce((m, s) => Math.max(m, s.speed), 0), length };
}

export interface KeyMarker { t: number; x: number; y: number; index: number }

/** One marker per keyframe of `track`, positioned where `source` is at that keyframe's time. */
export function sampleKeyframeMarkers(source: MotionSource, track: { keyframes: Array<{ t: number }> }): KeyMarker[] {
  const at = positionFn(source);
  return track.keyframes.map((k, index) => { const p = at(k.t); return { t: k.t, x: p[0], y: p[1], index }; });
}

export interface PathSegment { x0: number; y0: number; x1: number; y1: number; color: string; speed: number }

/** World-space polyline segments, each coloured by its end sample's speed. */
export function motionPathSegments(path: MotionPath, opts: SpeedColorOptions = {}): PathSegment[] {
  const out: PathSegment[] = [];
  for (let i = 1; i < path.samples.length; i++) {
    const a = path.samples[i - 1], b = path.samples[i];
    out.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, speed: b.speed, color: speedColor(b.speed, path.maxSpeed, opts) });
  }
  return out;
}

// --- vector onion ghosts (pure: no DOM) -----------------------------------------

export interface VectorGhost extends OnionTime { mobject: any }

/**
 * Clone `mobject` once per ghost and evaluate each clone at its time via
 * `setTime`. The source is never touched. Requires a time-pure mobject.
 */
export function onionVectorGhosts(mobject: any, t: number, duration: number, opts: OnionOptions = {}): VectorGhost[] {
  if (typeof mobject?.setTime !== "function") throw new Error("onionVectorGhosts: mobject has no setTime(); use the raster onion skin instead");
  return onionTimes(t, duration, opts).map((o) => {
    const g = mobject.copy();
    g.setTime(o.t);
    g.setColor(o.tint);
    g.setOpacity(o.opacity);
    return { ...o, mobject: g };
  });
}

// --- DOM glue ---------------------------------------------------------------------

export type CanvasFactory = (w: number, h: number) => any;

const defaultCreateCanvas: CanvasFactory = (w, h) => {
  const doc = (globalThis as any).document;
  if (!doc) throw new Error("overlays: no document; pass createCanvas");
  const c = doc.createElement("canvas");
  c.width = w; c.height = h;
  return c;
};

export interface RasterOnionOptions extends OnionOptions {
  /** Scratch-canvas factory used for tinting. Without one (and without a DOM) ghosts are drawn untinted. */
  createCanvas?: CanvasFactory;
}

/**
 * Composite the Player's recorded frames around `current` onto `ctx` with
 * tint + opacity. Does not clear `ctx`. Returns the ghosts drawn.
 */
export function renderOnionRaster(ctx: any, player: any, current: number, opts: RasterOnionOptions = {}): OnionFrame[] {
  const ghosts = onionFrames(current, player.frames.length, opts);
  const w = player.pixelWidth, h = player.pixelHeight;
  const make = opts.createCanvas ?? ((globalThis as any).document ? defaultCreateCanvas : undefined);
  const scratch = make ? make(w, h) : null;
  const sctx = scratch?.getContext("2d");
  ctx.save();
  for (const g of ghosts) {
    if (sctx) {
      sctx.globalCompositeOperation = "source-over";
      sctx.clearRect(0, 0, w, h);
      player.drawFrameTo(sctx, g.frame);
      sctx.globalCompositeOperation = "source-atop";
      sctx.fillStyle = g.tint;
      sctx.globalAlpha = 0.5;
      sctx.fillRect(0, 0, w, h);
      sctx.globalAlpha = 1;
      ctx.globalAlpha = g.opacity;
      ctx.drawImage(scratch, 0, 0);
    } else {
      ctx.globalAlpha = g.opacity;
      player.drawFrameTo(ctx, g.frame);
    }
  }
  ctx.restore();
  return ghosts;
}

export interface MotionPathRenderOptions extends SpeedColorOptions {
  /** Trail stroke width in pixels. Default 3. */
  lineWidth?: number;
  /** Keyframe markers (from sampleKeyframeMarkers). */
  markers?: KeyMarker[];
  markerRadius?: number;
  markerColor?: string;
}

/** Stroke a speed-coloured trail and keyframe dots through `camera.toPixel`. */
export function renderMotionPath(ctx: any, path: MotionPath, camera: { toPixel(p: number[]): number[] }, opts: MotionPathRenderOptions = {}): void {
  ctx.save();
  ctx.lineWidth = opts.lineWidth ?? 3;
  ctx.lineCap = "round";
  for (const s of motionPathSegments(path, opts)) {
    const [ax, ay] = camera.toPixel([s.x0, s.y0, 0]);
    const [bx, by] = camera.toPixel([s.x1, s.y1, 0]);
    ctx.strokeStyle = s.color;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  ctx.fillStyle = opts.markerColor ?? "#fbbf24";
  for (const m of opts.markers ?? []) {
    const [px, py] = camera.toPixel([m.x, m.y, 0]);
    ctx.beginPath();
    ctx.arc(px, py, opts.markerRadius ?? 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export interface OverlayHandle {
  /** Clear and redraw. Call after every Player seek / camera change. */
  refresh(): void;
  /** Remove the overlay canvas. */
  detach(): void;
  /** The overlay canvas. */
  canvas: any;
}

function mountOverlay(target: any, w: number, h: number, create: CanvasFactory): any {
  const overlay = create(w, h);
  overlay.width = w; overlay.height = h;
  overlay.style = overlay.style ?? {};
  Object.assign(overlay.style, {
    position: "absolute",
    left: `${target.offsetLeft ?? 0}px`,
    top: `${target.offsetTop ?? 0}px`,
    width: target.style?.width ?? `${w}px`,
    height: target.style?.height ?? `${h}px`,
    pointerEvents: "none",
  });
  target.parentNode?.appendChild(overlay);
  return overlay;
}

export interface OnionSkinOverlayOptions extends RasterOnionOptions {
  /** Vector mode: ghost this time-pure mobject instead of compositing recorded frames. `step` is then seconds. */
  vector?: { mobject: any; camera: any; duration: number };
}

/**
 * Layer an onion-skin overlay above `player.canvas` (pointer-transparent, so
 * attachInteractiveCamera on the player canvas keeps working). Call
 * `handle.refresh()` after each seek.
 */
export function attachOnionSkin(player: any, opts: OnionSkinOverlayOptions = {}): OverlayHandle {
  const create = opts.createCanvas ?? defaultCreateCanvas;
  const overlay = mountOverlay(player.canvas, player.pixelWidth, player.pixelHeight, create);
  const ctx = overlay.getContext("2d");
  const refresh = (): void => {
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (opts.vector) {
      const { mobject, camera, duration } = opts.vector;
      const ghosts = onionVectorGhosts(mobject, player.currentTime ?? 0, duration, opts);
      new CanvasRenderer(ctx, camera).renderMobjects(ghosts.map((g) => g.mobject));
    } else {
      renderOnionRaster(ctx, player, player.currentFrame ?? 0, { ...opts, createCanvas: create });
    }
  };
  return { refresh, detach: () => overlay.remove?.(), canvas: overlay };
}

export interface MotionPathOverlayOptions extends MotionPathRenderOptions {
  source: MotionSource;
  t0: number;
  t1: number;
  /** Sampling interval, seconds. */
  step: number;
  /** Mark this track's keyframes on the trail. */
  track?: { keyframes: Array<{ t: number }> };
  createCanvas?: CanvasFactory;
}

/** Layer a speed-coloured motion-path overlay above `target` (the Player canvas). */
export function attachMotionPath(target: any, camera: any, opts: MotionPathOverlayOptions): OverlayHandle {
  const overlay = mountOverlay(target, camera.pixelWidth, camera.pixelHeight, opts.createCanvas ?? defaultCreateCanvas);
  const ctx = overlay.getContext("2d");
  const refresh = (): void => {
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const path = sampleMotionPath(opts.source, opts.t0, opts.t1, opts.step);
    const markers = opts.markers ?? (opts.track ? sampleKeyframeMarkers(opts.source, opts.track) : undefined);
    renderMotionPath(ctx, path, camera, { ...opts, markers });
  };
  return { refresh, detach: () => overlay.remove?.(), canvas: overlay };
}
