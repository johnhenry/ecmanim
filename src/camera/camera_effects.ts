// Camera motion effects: seeded, closed-form `(t) => {dx, dy, roll, logZoom}`
// samples layered ON TOP of a camera's framing (epic #61, #69).
//
// Design rules (see docs/camera-motion.md):
//  * Pure functions of absolute time. Nothing here integrates `dt`, so a scene
//    can be seeked, scrubbed, or rendered in parallel segments and still land
//    on the identical frame.
//  * Effects never write into `camera.frameCenter` / `frame` (preRender()
//    overwrites or accumulates those). The composed result lives in the
//    separate `camera.effectOffset / effectRoll / effectLogZoom` fields.
//  * Composition: offsets sum, roll sums, zoom is a sum in log space (i.e.
//    zoom factors multiply).
//
// Sign conventions: `dx, dy` move the CAMERA in world units (content slides the
// opposite way on screen); positive `roll` rolls the camera counter-clockwise
// (the image rotates clockwise, same as `camera.rotation`); positive `logZoom`
// zooms IN by a factor of exp(logZoom).

import { valueNoise1D } from "../core/noise.ts";

export interface CameraEffectSample {
  dx: number;
  dy: number;
  roll: number;
  logZoom: number;
}

/** A camera effect: a pure function from local time (seconds since the
 *  effect's `start`) to a (partial) sample. Missing channels count as 0. */
export type CameraEffectFn = (t: number) => Partial<CameraEffectSample>;

export interface CameraEffectObject {
  evaluate(t: number): Partial<CameraEffectSample>;
  /** Stable description of the effect's parameters, folded into cache keys. */
  fingerprint?(): string;
}

export type CameraEffectLike = CameraEffectFn | CameraEffectObject;

export interface CameraEffectOptions {
  /** Absolute scene time the effect begins (default 0). The effect function
   *  receives `t - start`. */
  start?: number;
  /** Seconds the effect stays active (default: forever). */
  duration?: number;
  /** Seconds to ramp the effect's weight 0 -> 1 after `start` (default 0). */
  fadeIn?: number;
  /** Seconds to ramp the weight 1 -> 0 before `start + duration` (default 0). */
  fadeOut?: number;
}

export interface CameraEffectEntry {
  fx: CameraEffectLike;
  start: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
}

export function makeEffectEntry(fx: CameraEffectLike, opts: CameraEffectOptions = {}): CameraEffectEntry {
  return {
    fx,
    start: opts.start ?? 0,
    duration: opts.duration ?? Infinity,
    fadeIn: Math.max(0, opts.fadeIn ?? 0),
    fadeOut: Math.max(0, opts.fadeOut ?? 0),
  };
}

const smooth01 = (x: number): number => {
  const u = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return u * u * (3 - 2 * u);
};

/** Envelope weight (0..1) of an entry at absolute time `t`. */
export function effectWeight(e: CameraEffectEntry, t: number): number {
  const local = t - e.start;
  if (local < 0 || local > e.duration) return 0;
  let w = 1;
  if (e.fadeIn > 0 && local < e.fadeIn) w *= smooth01(local / e.fadeIn);
  if (e.fadeOut > 0 && Number.isFinite(e.duration) && local > e.duration - e.fadeOut) {
    w *= smooth01((e.duration - local) / e.fadeOut);
  }
  return w;
}

/** Compose every entry at absolute time `t` (offsets + roll + logZoom sum). */
export function evaluateCameraEffects(entries: readonly CameraEffectEntry[], t: number): CameraEffectSample {
  let dx = 0, dy = 0, roll = 0, logZoom = 0;
  for (const e of entries) {
    const w = effectWeight(e, t);
    if (w === 0) continue;
    const s = typeof e.fx === "function" ? e.fx(t - e.start) : e.fx.evaluate(t - e.start);
    dx += (s.dx ?? 0) * w;
    dy += (s.dy ?? 0) * w;
    roll += (s.roll ?? 0) * w;
    logZoom += (s.logZoom ?? 0) * w;
  }
  return { dx, dy, roll, logZoom };
}

function describeEffect(fx: CameraEffectLike): string {
  if (typeof fx !== "function" && typeof fx.fingerprint === "function") return fx.fingerprint();
  return typeof fx === "function" ? fx.toString() : fx.evaluate.toString();
}

export function fingerprintCameraEffects(entries: readonly CameraEffectEntry[]): string {
  return entries
    .map((e) => `${describeEffect(e.fx)}@${e.start},${e.duration},${e.fadeIn},${e.fadeOut}`)
    .join(";");
}

// --- presets -----------------------------------------------------------------

export interface CameraShakeConfig {
  /** Peak displacement in world units (default 0.12). */
  amplitude?: number;
  /** Noise rate in Hz (default 11). */
  frequency?: number;
  /** Peak roll in radians (default 0). */
  roll?: number;
  /** Peak log-zoom wobble (default 0). */
  zoom?: number;
  /** Exponential decay rate in 1/s; 0 = constant intensity (default 0). */
  decay?: number;
  seed?: number;
}

/** Fast, high-frequency noise shake. Bounded by `amplitude`. */
export class CameraShake implements CameraEffectObject {
  amplitude: number;
  frequency: number;
  roll: number;
  zoom: number;
  decay: number;
  seed: number;
  private nx: (x: number) => number;
  private ny: (x: number) => number;
  private nr: (x: number) => number;
  private nz: (x: number) => number;

  constructor(config: CameraShakeConfig = {}) {
    this.amplitude = config.amplitude ?? 0.12;
    this.frequency = config.frequency ?? 11;
    this.roll = config.roll ?? 0;
    this.zoom = config.zoom ?? 0;
    this.decay = config.decay ?? 0;
    this.seed = config.seed ?? 0;
    const s = this.seed * 4 + 1013;
    this.nx = valueNoise1D(s);
    this.ny = valueNoise1D(s + 1);
    this.nr = valueNoise1D(s + 2);
    this.nz = valueNoise1D(s + 3);
  }

  evaluate(t: number): Partial<CameraEffectSample> {
    if (t < 0) return {};
    const k = this.decay > 0 ? Math.exp(-this.decay * t) : 1;
    const x = t * this.frequency;
    return {
      dx: this.amplitude * k * this.nx(x),
      dy: this.amplitude * k * this.ny(x),
      roll: this.roll * k * this.nr(x),
      logZoom: this.zoom * k * this.nz(x),
    };
  }

  fingerprint(): string {
    return `CameraShake(${this.amplitude},${this.frequency},${this.roll},${this.zoom},${this.decay},${this.seed})`;
  }
}

export interface HandheldConfig {
  /** Drift in world units (default 0.05). */
  amplitude?: number;
  /** Base drift rate in Hz (default 0.6). */
  frequency?: number;
  /** Peak roll in radians (default 0.008). */
  roll?: number;
  seed?: number;
}

/** Slow two-octave wander, like a held camera. */
export class Handheld implements CameraEffectObject {
  amplitude: number;
  frequency: number;
  roll: number;
  seed: number;
  private n: Array<(x: number) => number>;

  constructor(config: HandheldConfig = {}) {
    this.amplitude = config.amplitude ?? 0.05;
    this.frequency = config.frequency ?? 0.6;
    this.roll = config.roll ?? 0.008;
    this.seed = config.seed ?? 0;
    const s = this.seed * 8 + 2027;
    this.n = [0, 1, 2, 3, 4, 5].map((i) => valueNoise1D(s + i));
  }

  private oct(a: (x: number) => number, b: (x: number) => number, t: number): number {
    return (a(t * this.frequency) + 0.5 * b(t * this.frequency * 2.7 + 11.3)) / 1.5;
  }

  evaluate(t: number): Partial<CameraEffectSample> {
    return {
      dx: this.amplitude * this.oct(this.n[0], this.n[1], t),
      dy: this.amplitude * this.oct(this.n[2], this.n[3], t),
      roll: this.roll * this.oct(this.n[4], this.n[5], t),
    };
  }

  fingerprint(): string {
    return `Handheld(${this.amplitude},${this.frequency},${this.roll},${this.seed})`;
  }
}

export interface CameraImpactConfig {
  /** Initial kick distance in world units (default 0.35). */
  magnitude?: number;
  /** Kick direction in radians, world frame (default -PI/2: camera jolts down). */
  angle?: number;
  /** Ring-down rate in Hz (default 3.2). */
  frequency?: number;
  /** Exponential decay rate in 1/s (default 5). */
  decay?: number;
  /** Initial roll kick in radians (default 0). */
  rollKick?: number;
  /** Initial log-zoom kick (default 0). */
  zoomKick?: number;
}

/** A single hit: a damped oscillation along `angle`, peaking at t = 0. */
export class CameraImpact implements CameraEffectObject {
  magnitude: number;
  angle: number;
  frequency: number;
  decay: number;
  rollKick: number;
  zoomKick: number;

  constructor(config: CameraImpactConfig = {}) {
    this.magnitude = config.magnitude ?? 0.35;
    this.angle = config.angle ?? -Math.PI / 2;
    this.frequency = config.frequency ?? 3.2;
    this.decay = config.decay ?? 5;
    this.rollKick = config.rollKick ?? 0;
    this.zoomKick = config.zoomKick ?? 0;
  }

  evaluate(t: number): Partial<CameraEffectSample> {
    if (t < 0) return {};
    const k = Math.exp(-this.decay * t) * Math.cos(2 * Math.PI * this.frequency * t);
    return {
      dx: this.magnitude * Math.cos(this.angle) * k,
      dy: this.magnitude * Math.sin(this.angle) * k,
      roll: this.rollKick * k,
      logZoom: this.zoomKick * k,
    };
  }

  fingerprint(): string {
    return `CameraImpact(${this.magnitude},${this.angle},${this.frequency},${this.decay},${this.rollKick},${this.zoomKick})`;
  }
}

export interface ZoomPulseConfig {
  /** Peak log-zoom (default 0.08 = about 8% punch-in). */
  amount?: number;
  /** Seconds per pulse (default 0.6). */
  period?: number;
  /** Number of pulses (default 1). */
  beats?: number;
}

/** A smooth punch-in/out that returns exactly to rest after `beats` periods. */
export class ZoomPulse implements CameraEffectObject {
  amount: number;
  period: number;
  beats: number;

  constructor(config: ZoomPulseConfig = {}) {
    this.amount = config.amount ?? 0.08;
    this.period = Math.max(1e-6, config.period ?? 0.6);
    this.beats = config.beats ?? 1;
  }

  evaluate(t: number): Partial<CameraEffectSample> {
    const u = t / this.period;
    if (t < 0 || u >= this.beats) return { logZoom: 0 };
    const s = Math.sin(Math.PI * (u - Math.floor(u)));
    return { logZoom: this.amount * s * s };
  }

  fingerprint(): string {
    return `ZoomPulse(${this.amount},${this.period},${this.beats})`;
  }
}
