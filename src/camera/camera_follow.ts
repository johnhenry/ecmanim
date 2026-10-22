// CameraFollow: a "follow cam" for a moving target -- dead zone + hysteresis,
// look-ahead, critically damped smoothing and auto-zoom to fit the target's
// bounding box (epic #61, #69).
//
// Following is PATH-DEPENDENT (the dead zone and hysteresis carry state), so it
// cannot be a closed-form function of time like the shake presets. Instead it
// is BAKED: `bakeCameraMotion()` steps the follower at a fixed dt over an
// explicit window and returns a `KeyframeTrack` of `[centerX, centerY, height]`
// that can be sampled at any absolute time (seek / parallel safe).
//
// Targets must therefore be functions of time (`(t) => point | {center, width,
// height}`) -- the bake has to be able to ask "where is the target at t?"
// without running the scene.

import { KeyframeTrack } from "../animation/keyframe_track.ts";

/** What a target reports at one instant. A bare point is a zero-size target. */
export type CameraFollowSample =
  | number[]
  | { center: number[]; width?: number; height?: number };

export type CameraFollowTarget = (t: number) => CameraFollowSample;

export interface CameraFollowConfig {
  /** Where the target is, as a function of time since the bake's start. */
  target: CameraFollowTarget;
  /** World-unit box around the camera centre inside which the target may roam
   *  without the camera moving (default 2 x 1.2). {0,0} = always follow. */
  deadZone?: { width: number; height: number };
  /** 0..1. Once the camera is chasing on an axis it keeps chasing until the
   *  target is back within `deadZone * (1 - hysteresis)` of the centre, which
   *  stops it chattering at the zone edge (default 0.5). */
  hysteresis?: number;
  /** Seconds of target velocity to lead by (default 0). */
  lookAhead?: number;
  /** Critically damped smoothing time of the position, in seconds; roughly the
   *  time to close ~90% of a gap (default 0.35). */
  smoothTime?: number;
  /** Fit the target's bounding box. Without it the height stays constant. */
  autoZoom?: {
    /** Fractional padding around the target box (default 0.3). */
    margin?: number;
    /** Camera height clamp in world units (defaults 2 and 40). */
    minHeight?: number;
    maxHeight?: number;
  };
  /** Smoothing time of the zoom (default `smoothTime * 1.5`). */
  zoomSmoothTime?: number;
}

export interface BakeCameraMotionOptions {
  /** Window length in seconds. */
  duration: number;
  /** Fixed step (default 1/60). The bake is a pure function of this value, so
   *  it is part of the determinism contract. */
  dt?: number;
  /** Camera centre at the start (default [0, 0, 0]). */
  center?: number[];
  /** Camera height at the start (default 8). */
  height?: number;
  /** Width / height of the frame, used to fit a target's width (default 16/9). */
  aspect?: number;
}

interface Axis { pos: number; vel: number; chasing: boolean }

// Exact critically damped step toward `goal` (no integration error, any dt).
function smoothDamp(a: { pos: number; vel: number }, goal: number, smoothTime: number, dt: number): void {
  const omega = 2 / Math.max(1e-4, smoothTime);
  const change = a.pos - goal;
  const temp = (a.vel + omega * change) * dt;
  const e = Math.exp(-omega * dt);
  a.vel = (a.vel - omega * temp) * e;
  a.pos = goal + (change + temp) * e;
}

function read(s: CameraFollowSample): { x: number; y: number; w: number; h: number } {
  if (Array.isArray(s)) return { x: s[0] ?? 0, y: s[1] ?? 0, w: 0, h: 0 };
  return { x: s.center[0] ?? 0, y: s.center[1] ?? 0, w: s.width ?? 0, h: s.height ?? 0 };
}

export class CameraFollow {
  readonly config: Required<Pick<CameraFollowConfig, "deadZone" | "hysteresis" | "lookAhead" | "smoothTime">> &
    CameraFollowConfig;

  constructor(config: CameraFollowConfig) {
    this.config = {
      ...config,
      deadZone: config.deadZone ?? { width: 2, height: 1.2 },
      hysteresis: Math.min(1, Math.max(0, config.hysteresis ?? 0.5)),
      lookAhead: config.lookAhead ?? 0,
      smoothTime: config.smoothTime ?? 0.35,
    };
  }

  /** Step the follower over [0, duration] and return the baked track. */
  bake(options: BakeCameraMotionOptions): KeyframeTrack<number[]> {
    return bakeCameraMotion(this, options);
  }
}

/**
 * Bake a `CameraFollow` at a fixed dt into a `KeyframeTrack<number[]>` of
 * `[centerX, centerY, height]`, keyed by time since the window start. Sample
 * it with `track.valueAt(t - start)`.
 */
export function bakeCameraMotion(follow: CameraFollow, options: BakeCameraMotionOptions): KeyframeTrack<number[]> {
  const c = follow.config;
  const dt = options.dt ?? 1 / 60;
  const aspect = options.aspect ?? 16 / 9;
  const x: Axis = { pos: options.center?.[0] ?? 0, vel: 0, chasing: false };
  const y: Axis = { pos: options.center?.[1] ?? 0, vel: 0, chasing: false };
  const baseHeight = options.height ?? 8;
  const hz = { pos: baseHeight, vel: 0 };
  const zoomTime = c.zoomSmoothTime ?? c.smoothTime * 1.5;
  const margin = c.autoZoom?.margin ?? 0.3;
  const minH = c.autoZoom?.minHeight ?? 2;
  const maxH = c.autoZoom?.maxHeight ?? 40;

  const frames: Array<{ t: number; value: number[] }> = [{ t: 0, value: [x.pos, y.pos, hz.pos] }];
  const n = Math.max(1, Math.ceil(options.duration / dt - 1e-9));
  const halfW = c.deadZone.width / 2, halfH = c.deadZone.height / 2;
  const h = c.hysteresis;

  const stepAxis = (a: Axis, target: number, half: number): void => {
    const off = target - a.pos;
    if (!a.chasing && Math.abs(off) > half) a.chasing = true;
    else if (a.chasing && Math.abs(off) <= half * (1 - h)) a.chasing = false;
    // Chasing: head for the target itself, so the camera re-centres rather
    // than crawling along the zone edge. Otherwise hold still.
    smoothDamp(a, a.chasing ? target : a.pos, c.smoothTime, dt);
  };

  for (let i = 1; i <= n; i++) {
    const t = Math.min(i * dt, options.duration);
    const s = read(c.target(t));
    let tx = s.x, ty = s.y;
    if (c.lookAhead !== 0) {
      const p = read(c.target(Math.max(0, t - dt)));
      tx += ((s.x - p.x) / dt) * c.lookAhead;
      ty += ((s.y - p.y) / dt) * c.lookAhead;
    }
    stepAxis(x, tx, halfW);
    stepAxis(y, ty, halfH);
    if (c.autoZoom) {
      const want = Math.min(maxH, Math.max(minH, Math.max(s.h, s.w / aspect) * (1 + margin)));
      smoothDamp(hz, want, zoomTime, dt);
    }
    frames.push({ t, value: [x.pos, y.pos, hz.pos] });
  }
  return new KeyframeTrack<number[]>(frames, { duration: options.duration });
}
