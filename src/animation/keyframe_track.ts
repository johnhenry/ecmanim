// A unified keyframe-track primitive. Unlike every other easing tool in this
// codebase (which compile to an opaque pure function), a KeyframeTrack keeps
// its structured, mutable keyframe data around for introspection/editing --
// exactly what a Studio scrub UI needs (splice a keyframe in/out and later
// valueAt() calls reflect it immediately).
//
// Two consumption modes, both provided: PlayKeyframeTrack (an Animation, for
// scene.play()-driven use) and raw .valueAt(t) sampling inside a plain
// addUpdater for lower-ceremony use.

import { Animation } from "./Animation.ts";
import type { AnimationConfig } from "./Animation.ts";
import { running, linear } from "./rate_functions.ts";
import * as V from "../core/math/vector.ts";
import type { RateFunc } from "../core/types.ts";
import { resolveOutgoing, autoComponent, autoFallbackAlpha } from "./outgoing_easing.ts";
import type { OutgoingMode } from "./outgoing_easing.ts";

export interface Keyframe<T> {
  t: number;
  value: T;
  /** Eases the transition ARRIVING at this keyframe (from the previous one).
   *  The first keyframe's own `ease` is unused (nothing transitions into it). */
  ease?: RateFunc | string;
  /** Eases the transition LEAVING this keyframe (toward the next one). When set
   *  it governs the k0 -> k1 segment and takes precedence over `k1.ease`.
   *  Besides any rate function / name / `"bezier:x1,y1,x2,y2"` string:
   *  `"auto"` -- monotone cubic (Fritsch-Carlson) across consecutive auto keys,
   *  duration-weighted, no overshoot, rest at the ends of an auto run (numbers
   *  and number[] per component; other value types fall back to smoothstep
   *  alpha with the track's `interpolate`);
   *  `"hold"` -- step: k0's value until k1's exact time;
   *  `"linear"`, `"easeIn"` (cubic in), `"easeOut"` (cubic out). */
  easeOut?: RateFunc | string | "auto" | "hold";
}

export interface KeyframeTrackOptions<T> {
  /** Overrides the inferred duration (default: the last keyframe's `t`). */
  duration?: number;
  /** Custom interpolation, e.g. `Color.lerp` for a color-typed track. Default
   *  dispatch: number/number[] via `V.lerp`, anything else throws naming this
   *  option as the escape hatch. */
  interpolate?: (a: T, b: T, alpha: number) => T;
  /** Which keyframe's `ease` governs a segment when no `easeOut` is set:
   *  `"incoming"` (default, today's behaviour) uses the arriving key's `ease`;
   *  `"outgoing"` uses the leaving key's `ease`. `Keyframe.easeOut` wins either way. */
  easeMode?: "incoming" | "outgoing";
}

function defaultInterpolate<T>(a: T, b: T, alpha: number): T {
  if (typeof a === "number" || Array.isArray(a)) {
    return V.lerp(a as any, b as any, alpha) as any;
  }
  throw new Error(
    "KeyframeTrack: no default interpolation for this value type; pass " +
    "options.interpolate (e.g. Color.lerp, already used by Mobject.interpolate(), " +
    "for a color-typed track).",
  );
}

export class KeyframeTrack<T = number> {
  keyframes: Keyframe<T>[];
  private _duration?: number;
  private _interpolate: (a: T, b: T, alpha: number) => T;
  private _customInterpolate: boolean;
  private _easeMode: "incoming" | "outgoing";

  constructor(keyframes: Keyframe<T>[], options: KeyframeTrackOptions<T> = {}) {
    this.keyframes = [...keyframes].sort((a, b) => a.t - b.t);
    this._duration = options.duration;
    this._interpolate = options.interpolate ?? defaultInterpolate;
    this._customInterpolate = options.interpolate != null;
    this._easeMode = options.easeMode ?? "incoming";
  }

  /** The explicit outgoing mode of segment `i` (i -> i+1), if it has one. */
  private _segmentSpec(i: number): RateFunc | string | undefined {
    const k0 = this.keyframes[i];
    if (k0.easeOut != null) return k0.easeOut;
    if (this._easeMode === "outgoing") return k0.ease;
    return undefined;
  }

  private _isAutoSegment(i: number): boolean {
    if (i < 0 || i >= this.keyframes.length - 1) return false;
    const spec = this._segmentSpec(i);
    return spec === "auto";
  }

  private _autoValue(i: number, t: number, rawAlpha: number): T {
    const kfs = this.keyframes;
    const k0 = kfs[i];
    const k1 = kfs[i + 1];
    const a = k0.value as any;
    const b = k1.value as any;
    const numeric = !this._customInterpolate && (
      (typeof a === "number" && typeof b === "number") ||
      (Array.isArray(a) && Array.isArray(b) && a.length === b.length)
    );
    if (!numeric) return this._interpolate(k0.value, k1.value, autoFallbackAlpha(rawAlpha));
    const prev = this._isAutoSegment(i - 1) ? kfs[i - 1] : undefined;
    const next = this._isAutoSegment(i + 1) ? kfs[i + 2] : undefined;
    const comp = (c: (v: any) => number) =>
      autoComponent(
        t, k0.t, c(a), k1.t, c(b),
        prev && { t: prev.t, v: c(prev.value) },
        next && { t: next.t, v: c(next.value) },
      );
    if (typeof a === "number") return comp((v) => v) as any;
    const out: number[] = new Array(a.length);
    for (let j = 0; j < a.length; j++) {
      out[j] = comp((v) => (Array.isArray(v) ? v[j] : NaN));
    }
    // Neighbour arrays of a different length would yield NaN: use smoothstep.
    if (out.some((x) => Number.isNaN(x))) {
      return this._interpolate(k0.value, k1.value, autoFallbackAlpha(rawAlpha));
    }
    return out as any;
  }

  addKeyframe(kf: Keyframe<T>): this {
    this.keyframes.push(kf);
    this.keyframes.sort((a, b) => a.t - b.t);
    return this;
  }

  /** Removes the keyframe at `index` in the current (sorted) order. */
  removeKeyframe(index: number): this {
    this.keyframes.splice(index, 1);
    return this;
  }

  get duration(): number {
    if (this._duration != null) return this._duration;
    return this.keyframes.length ? this.keyframes[this.keyframes.length - 1].t : 0;
  }

  valueAt(t: number): T {
    const kfs = this.keyframes;
    if (kfs.length === 0) throw new Error("KeyframeTrack.valueAt(): no keyframes");
    if (kfs.length === 1 || t <= kfs[0].t) return kfs[0].value;
    if (t >= kfs[kfs.length - 1].t) return kfs[kfs.length - 1].value;

    let i = 0;
    while (i < kfs.length - 1 && kfs[i + 1].t < t) i++;
    const k0 = kfs[i];
    const k1 = kfs[i + 1];
    const span = k1.t - k0.t || 1e-9;
    const rawAlpha = Math.max(0, Math.min(1, (t - k0.t) / span));
    const spec = this._segmentSpec(i);
    if (spec != null) {
      const mode: OutgoingMode = resolveOutgoing(spec);
      if (mode.kind === "hold") return t >= k1.t ? k1.value : k0.value;
      if (mode.kind === "auto") return this._autoValue(i, t, rawAlpha);
      return this._interpolate(k0.value, k1.value, mode.fn(rawAlpha));
    }
    if (this._easeMode === "outgoing") return this._interpolate(k0.value, k1.value, rawAlpha);
    const ease = k1.ease != null ? running(k1.ease) : linear;
    return this._interpolate(k0.value, k1.value, ease(rawAlpha));
  }
}

/**
 * scene.play()-driven consumption: `apply(mobject, value)` is called every
 * interpolate() with the track's value at that time. Same "preset suggests a
 * duration, explicit config wins" precedence as transitions.ts's
 * springTiming(): `config.runTime` (if given) always wins over the track's
 * own duration.
 *
 * `mobject` may be null (see `animateSignal()` below) -- begin() skips the
 * usual startState snapshot in that case, since nothing here reads it.
 */
export class PlayKeyframeTrack extends Animation {
  track: KeyframeTrack<any>;
  apply: (mobject: any, value: any) => void;

  constructor(
    mobject: any,
    track: KeyframeTrack<any>,
    apply: (mobject: any, value: any) => void,
    config: AnimationConfig = {},
  ) {
    super(mobject, { rateFunc: config.rateFunc ?? linear, ...config, runTime: config.runTime ?? track.duration });
    this.track = track;
    this.apply = apply;
  }

  begin(): this {
    this.started = true;
    if (this.mobject) this.startState = this.mobject.copy();
    this.setup();
    this.interpolate(0);
    return this;
  }

  interpolateMobject(alpha: number): void {
    this.apply(this.mobject, this.track.valueAt(alpha * this.track.duration));
  }
}

/**
 * Convenience wrapper pointing PlayKeyframeTrack's `apply` at a signal's
 * setter, giving "a signal driven by a keyframe timeline" for free -- this
 * also satisfies the separate "wire signals into tweening" idea with no
 * additional mechanism.
 */
export function animateSignal(
  signal: { set: (v: any) => void },
  track: KeyframeTrack<any>,
  config: AnimationConfig = {},
): PlayKeyframeTrack {
  return new PlayKeyframeTrack(null, track, (_mobject, v) => signal.set(v), config);
}
