// Fourier epicycles ("But what is a Fourier series?", 2019 — 3b1b canon 01).
// A closed 2D path is decomposed into rotating vectors via a complex DFT: each
// coefficient {freq, amp, phase} is one epicycle. FourierPath builds the chain
// of vectors (tip-to-tail) with optional guide circles; `setTime(t)` poses the
// whole chain deterministically for t in [0, 1) so it composes with scrubbing
// and the render cache, and `tip` feeds TracedPath for the glowing trail.
//
// Isomorphic: no node: imports, no DOM. Pure math + existing mobjects.

import { Group } from "./Mobject.ts";
import type { Mobject } from "./Mobject.ts";
import type { VMobject } from "./VMobject.ts";
import { Circle, Line } from "./geometry.ts";
import type { ColorLike } from "../core/types.ts";

const TAU = 2 * Math.PI;

/** One epicycle: a vector of length `amp` rotating at `freq` revolutions per
 *  path-traversal, starting at angle `phase` (radians) at t = 0. */
export interface FourierCoefficient {
  freq: number;
  amp: number;
  phase: number;
}

/**
 * Plain O(N²) complex DFT of a sampled 2D path (points treated as x + iy).
 * Frequencies use the standard symmetric ordering k ∈ [-⌊N/2⌋, ⌊N/2⌋ + N - 1]
 * i.e. [-N/2, N/2), so low-|freq| terms dominate for smooth closed paths.
 *
 *   c_k = (1/N) Σ_n (x_n + i·y_n) · e^{-2πi·k·n/N}
 *
 * Returns coefficients sorted by DESCENDING amplitude (ties broken by
 * ascending |freq|, then ascending freq, for determinism), optionally
 * truncated to the `nVectors` largest.
 */
export function dftOfPath(
  points: Array<[number, number]>,
  nVectors?: number,
): FourierCoefficient[] {
  const N = points.length;
  if (N === 0) return [];
  const kMin = -Math.floor(N / 2);
  const out: FourierCoefficient[] = [];
  for (let j = 0; j < N; j++) {
    const k = kMin + j;
    let re = 0;
    let im = 0;
    for (let n = 0; n < N; n++) {
      const x = points[n][0];
      const y = points[n][1];
      const ang = (-TAU * k * n) / N;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      // (x + iy)(c + is) = (xc - ys) + i(xs + yc)
      re += x * c - y * s;
      im += x * s + y * c;
    }
    re /= N;
    im /= N;
    out.push({ freq: k, amp: Math.hypot(re, im), phase: Math.atan2(im, re) });
  }
  out.sort(
    (a, b) =>
      b.amp - a.amp ||
      Math.abs(a.freq) - Math.abs(b.freq) ||
      a.freq - b.freq,
  );
  return nVectors != null ? out.slice(0, Math.max(0, nVectors)) : out;
}

/**
 * Sample `n` [x, y] points along a VMobject's outline via
 * `pointFromProportion(i/n)` (handles multi-subpath VMobjects). The endpoint
 * proportion 1 is excluded so closed paths aren't double-sampled at the seam.
 */
export function samplePath(mob: VMobject, n: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const p = mob.pointFromProportion(i / n);
    out.push([p[0], p[1] ?? 0]);
  }
  return out;
}

/** Stroke styling shared by the epicycle vectors and guide circles. */
export interface EpicycleStyle {
  strokeColor?: ColorLike;
  strokeWidth?: number;
  strokeOpacity?: number;
}

export interface FourierPathConfig {
  /** Precomputed coefficients (wins over `path`). */
  coefficients?: FourierCoefficient[];
  /** Path to decompose when `coefficients` is not given. */
  path?: VMobject;
  /** Keep only the `nVectors` largest coefficients (with `path`). */
  nVectors?: number;
  /** Number of samples taken along `path` (default 256). */
  samples?: number;
  /** World-space anchor of the first vector's base (default origin). */
  center?: number[];
  /** Draw a faint guide circle of radius `amp` at each vector's base. */
  showCircles?: boolean;
  circleStyle?: EpicycleStyle;
  vectorStyle?: EpicycleStyle;
  /** Revolutions (full path traversals) per second for attachTo (default 0.1). */
  speed?: number;
}

/**
 * FourierPath: the epicycle chain. Each coefficient (in descending-amplitude
 * order) contributes one Line vector of length `amp` rotating at `freq`
 * revolutions per traversal, anchored at the previous vector's tip, plus an
 * optional faint circle of radius `amp` centered at the vector's base.
 *
 * `setTime(t)` is a deterministic pure function of t (scrub-safe); `tip`
 * returns the current chain-tip world point, so
 * `new TracedPath(() => fourierPath.tip)` traces the reconstructed drawing.
 */
export class FourierPath extends Group {
  coefficients: FourierCoefficient[];
  vectors: Line[];
  circles: Circle[];
  centerPoint: number[];
  showCircles: boolean;
  speed: number;
  private _clock: number;
  private _tip: number[];

  constructor(config: FourierPathConfig = {}) {
    super();
    let coefficients = config.coefficients;
    if (!coefficients) {
      if (!config.path) {
        throw new Error(
          "FourierPath: provide either `coefficients` or a `path` VMobject",
        );
      }
      const pts = samplePath(config.path, config.samples ?? 256);
      coefficients = dftOfPath(pts, config.nVectors);
    }
    this.coefficients = coefficients.map((c) => ({ ...c }));
    this.centerPoint = config.center
      ? [config.center[0], config.center[1] ?? 0, config.center[2] ?? 0]
      : [0, 0, 0];
    this.showCircles = config.showCircles ?? true;
    this.speed = config.speed ?? 0.1;
    this._clock = 0;
    this._tip = [...this.centerPoint];

    const vectorStyle: EpicycleStyle = {
      strokeColor: "#FFFFFF",
      strokeWidth: 2,
      strokeOpacity: 1,
      ...config.vectorStyle,
    };
    const circleStyle: EpicycleStyle = {
      strokeColor: "#58C4DD",
      strokeWidth: 1,
      strokeOpacity: 0.3,
      ...config.circleStyle,
    };

    this.vectors = [];
    this.circles = [];
    // Circles first so the vectors draw on top of their guides.
    for (const c of this.coefficients) {
      if (this.showCircles) {
        const circle = new Circle({
          radius: c.amp,
          fillOpacity: 0,
          ...circleStyle,
        });
        this.circles.push(circle);
        this.add(circle);
      }
    }
    for (const c of this.coefficients) {
      const line = new Line([0, 0, 0], [c.amp, 0, 0], { ...vectorStyle });
      this.vectors.push(line);
      this.add(line);
    }

    this.setTime(0);
  }

  /**
   * Pose the whole chain for time t in [0, 1) — one full traversal of the
   * path. Pure function of t: every vector is placed at absolute coordinates,
   * so calls in any order produce identical geometry (scrub-safe).
   */
  setTime(t: number): this {
    let base = [this.centerPoint[0], this.centerPoint[1], this.centerPoint[2]];
    for (let i = 0; i < this.coefficients.length; i++) {
      const { freq, amp, phase } = this.coefficients[i];
      const angle = phase + TAU * freq * t;
      const tip = [
        base[0] + amp * Math.cos(angle),
        base[1] + amp * Math.sin(angle),
        base[2],
      ];
      if (this.showCircles) this.circles[i].moveTo(base);
      this.vectors[i].putStartAndEndOn(base, tip);
      base = tip;
    }
    this._tip = base;
    return this;
  }

  /** Current chain-tip world point (fresh array — safe to hand to TracedPath). */
  get tip(): number[] {
    return [this._tip[0], this._tip[1], this._tip[2]];
  }

  /**
   * Convenience: add this mobject to `scene` with an updater that advances an
   * internal clock by dt·speed (speed = traversals per second) and re-poses
   * the chain via setTime. Returns this for chaining, e.g.
   * `scene.add(new TracedPath(() => fp.tip)); fp.attachTo(scene);`
   */
  attachTo(scene: { add(...mobs: Mobject[]): unknown }): this {
    this.addUpdater((_m: Mobject, dt: number) => {
      this._clock += dt * this.speed;
      this.setTime(this._clock - Math.floor(this._clock));
    });
    scene.add(this);
    return this;
  }
}
