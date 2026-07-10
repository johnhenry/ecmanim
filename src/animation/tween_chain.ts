// Motion-Canvas-style tween ergonomics (campaign 1, cluster MC1):
//
//   await scene.play(tweenTo(circle, { x: 300 }, 1).to({ x: -300 }, 1));
//   await scene.play(tweenSignal(radius, 2, 1.5).wait(0.5).back(1));
//   await scene.play(tween(2, t => circle.moveTo([map(-300, 300, t), 0, 0])));
//   await scene.play(springTween(PlopSpring, -400, 400, v => dot.setX(v)));
//
// One Animation subclass (TweenChain) drives everything: an adapter reads/
// writes a STATE object, and segments are piecewise (target, duration, ease)
// entries resolved lazily at begin() so chains observe the live state when
// they actually start (matching MC semantics, and composing with play()).

import { Animation } from "./Animation.ts";
import type { AnimationConfig } from "./Animation.ts";
import { smooth, linear } from "./rate_functions.ts";
import { springRate } from "./spring.ts";
import type { SpringConfig } from "./spring.ts";
import { Color } from "../core/color.ts";
import { mulberry32 } from "../core/noise.ts";
import * as V from "../core/math/vector.ts";

export type Ease = (t: number) => number;

/** Linear interpolation — Motion Canvas's `map(from, to, t)`. */
export function map(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

// ---------------------------------------------------------------------------
// State adapters
// ---------------------------------------------------------------------------

type State = Record<string, any>;

interface TweenAdapter {
  /** Read the current state of every prop the chain touches. */
  read(props: string[]): State;
  /** Apply an interpolated state. */
  apply(state: State): void;
}

const lerpValue = (a: any, b: any, t: number): any => {
  if (typeof a === "number" && typeof b === "number") return map(a, b, t);
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => map(v, b[i] ?? v, t));
  if (a instanceof Color || b instanceof Color || typeof a === "string" || typeof b === "string") {
    return Color.lerp(Color.parse(a), Color.parse(b), t);
  }
  return t < 1 ? a : b;
};

// Mobject props: how to read the current value and write an absolute one.
// rotation/scale have no retained state on world-space mobjects, so the
// adapter tracks the last APPLIED value ON THE MOBJECT (persisting across
// chains -- Motion Canvas scale/rotation are absolute node properties, so
// `tweenTo(m, {scale: 1.5})` in one chain and `{scale: 1}` in a later one
// must agree about what 1 means) and applies deltas.
function mobjectAdapter(mob: any): TweenAdapter {
  const getRotation = () => (mob.__tweenRotation ?? 0) as number;
  const getScale = () => (mob.__tweenScale ?? 1) as number;
  const readers: Record<string, () => any> = {
    x: () => mob.getCenter()[0],
    y: () => mob.getCenter()[1],
    position: () => [...mob.getCenter()],
    opacity: () => mob.opacity ?? 1,
    fill: () => mob.fillColor ?? mob.color,
    stroke: () => mob.strokeColor ?? mob.color,
    fillOpacity: () => mob.fillOpacity ?? 1,
    strokeWidth: () => mob.strokeWidth ?? 0,
    width: () => mob.getWidth(),
    height: () => mob.getHeight(),
    rotation: () => getRotation(),
    scale: () => getScale(),
    end: () => mob.strokeEnd ?? 1,
    start: () => mob.strokeStart ?? 0,
  };
  const writers: Record<string, (v: any) => void> = {
    x: (v) => mob.setX(v),
    y: (v) => mob.setY(v),
    position: (v) => mob.moveTo(v),
    opacity: (v) => (typeof mob.setOpacity === "function" ? mob.setOpacity(v) : (mob.opacity = v)),
    // Color writers walk the WHOLE family: vector Text/Code/VGroup keep
    // their drawable glyphs in submobjects, and the renderer paints leaves
    // -- setting only the container's fillColor tweens nothing visible.
    fill: (v) => {
      const fam = typeof mob.getFamily === "function" ? mob.getFamily() : [mob];
      for (const m of fam) {
        if (typeof m.setFill === "function") m.setFill(v, m.fillOpacity ?? 1);
        else m.fillColor = Color.parse(v);
      }
    },
    stroke: (v) => {
      const fam = typeof mob.getFamily === "function" ? mob.getFamily() : [mob];
      for (const m of fam) {
        if (typeof m.setStroke === "function") m.setStroke(v);
        else m.strokeColor = Color.parse(v);
      }
    },
    fillOpacity: (v) => (mob.fillOpacity = v),
    strokeWidth: (v) => (mob.strokeWidth = v),
    width: (v) => { const w = mob.getWidth(); if (w > 1e-12) mob.stretch(v / w, 0); },
    height: (v) => { const h = mob.getHeight(); if (h > 1e-12) mob.stretch(v / h, 1); },
    rotation: (v) => { mob.rotate(v - getRotation()); mob.__tweenRotation = v; },
    scale: (v) => { const cur = getScale(); if (cur > 1e-12) mob.scale(v / cur); mob.__tweenScale = v; },
    end: (v) => (mob.strokeEnd = v),
    start: (v) => (mob.strokeStart = v),
  };
  return {
    read: (props) => {
      const s: State = {};
      for (const p of props) {
        const r = readers[p];
        if (!r) throw new Error(`tweenTo: unsupported property "${p}" (supported: ${Object.keys(readers).join(", ")})`);
        s[p] = r();
      }
      return s;
    },
    apply: (state) => {
      for (const [p, v] of Object.entries(state)) writers[p]?.(v);
    },
  };
}

// A signal (or any getter/setter function pair) as a single-prop adapter.
function signalAdapter(signal: any): TweenAdapter {
  return {
    read: () => ({ value: signal.peek ? signal.peek() : signal() }),
    apply: (state) => signal(state.value),
  };
}

// ---------------------------------------------------------------------------
// TweenChain
// ---------------------------------------------------------------------------

interface Segment {
  /** Target state (partial); null = hold (wait). "BACK" = chain-start state. */
  target: State | null | "BACK";
  duration: number;
  ease: Ease;
}

export class TweenChain extends Animation {
  private adapter: TweenAdapter;
  private segments: Segment[] = [];
  private props: Set<string> = new Set();
  // Resolved at begin(): per-segment [fromState, toState].
  private resolved: Array<{ from: State; to: State; startT: number; endT: number }> = [];

  constructor(mobjectForScene: any, adapter: TweenAdapter, config: AnimationConfig = {}) {
    // rateFunc linear at the top level: each segment applies its own ease.
    super(mobjectForScene, { rateFunc: linear, ...config });
    this.adapter = adapter;
  }

  /** Append a tween segment toward `target` over `duration` seconds. A raw
   *  (non-object) target is sugar for `{ value }` — the signal-adapter prop
   *  — so `tweenSignal(sig, 1, 2).to(0, 2)` works like MC's signal chains. */
  to(target: State | number | string, duration: number, ease: Ease = smooth): this {
    const t: State = (target !== null && typeof target === "object")
      ? target as State
      : { value: target };
    for (const k of Object.keys(t)) this.props.add(k);
    this.segments.push({ target: t, duration, ease });
    this.runTime = this.totalDuration();
    return this;
  }

  /** Hold the current state for `duration` seconds. */
  wait(duration: number): this {
    this.segments.push({ target: null, duration, ease: linear });
    this.runTime = this.totalDuration();
    return this;
  }

  /** Tween back to the state captured at the START of the chain. */
  back(duration: number, ease: Ease = smooth): this {
    this.segments.push({ target: "BACK", duration, ease });
    this.runTime = this.totalDuration();
    return this;
  }

  private totalDuration(): number {
    return this.segments.reduce((s, seg) => s + seg.duration, 0) || 1e-6;
  }

  /** Content fingerprint for Scene.hashAnimations: two chains over the same
   *  mobject with the same runTime but different props/targets must hash
   *  differently (an `end` tween is not a `fillOpacity` tween). */
  _hashExtra(): string {
    return this.segments.map((seg) => {
      const t = seg.target === null ? "hold" : seg.target === "BACK" ? "back"
        : Object.entries(seg.target).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(",");
      return `${t}@${seg.duration}`;
    }).join("|");
  }

  setup(): void {
    const props = [...this.props];
    const chainStart = this.adapter.read(props);
    let cursor = { ...chainStart };
    const total = this.totalDuration();
    let t = 0;
    this.resolved = this.segments.map((seg) => {
      const from = { ...cursor };
      let to: State;
      if (seg.target === null) to = { ...cursor };
      else if (seg.target === "BACK") to = { ...chainStart };
      else to = { ...cursor, ...seg.target };
      cursor = { ...to };
      const startT = t / total;
      t += seg.duration;
      return { from, to, startT, endT: t / total };
    });
  }

  interpolateMobject(alpha: number): void {
    if (!this.resolved.length) return;
    // Find the active segment (or clamp to the last).
    let seg = this.resolved[this.resolved.length - 1];
    let local = 1;
    for (let i = 0; i < this.resolved.length; i++) {
      const s = this.resolved[i];
      if (alpha <= s.endT || i === this.resolved.length - 1) {
        seg = s;
        const span = s.endT - s.startT;
        local = span > 1e-12 ? Math.max(0, Math.min(1, (alpha - s.startT) / span)) : 1;
        break;
      }
    }
    const eased = this.segments[this.resolved.indexOf(seg)]?.ease(local) ?? local;
    const state: State = {};
    for (const k of Object.keys(seg.to)) state[k] = lerpValue(seg.from[k], seg.to[k], eased);
    this.adapter.apply(state);
  }
}

/**
 * Chainable property tween on a mobject (MC's `node().x(300, 1).to(...)`):
 *   tweenTo(circle, { x: 300 }, 1).to({ x: -300 }, 1).wait(0.5).back(1)
 */
export function tweenTo(mob: any, target: State, duration: number, ease: Ease = smooth): TweenChain {
  return new TweenChain(mob, mobjectAdapter(mob)).to(target, duration, ease);
}

/**
 * Tween a signal's value (MC's `signal(2, 0.3)`): returns a chainable
 * animation; the signal updates each frame, so bound/computed consumers
 * follow automatically.
 */
export function tweenSignal(signal: any, value: any, duration: number, ease: Ease = smooth): TweenChain {
  // A signal has no mobject; a bare placeholder keeps Animation happy.
  const placeholder = { copy: () => placeholder, getFamily: () => [], submobjects: [], update: () => {} };
  return new TweenChain(placeholder, signalAdapter(signal)).to({ value }, duration, ease);
}

/**
 * Imperative time tween (MC's `tween(duration, cb)`): calls `cb(easedT)`
 * every frame for `duration` seconds.
 */
export function tween(duration: number, cb: (t: number) => void, ease: Ease = linear): Animation {
  const placeholder: any = { copy: () => placeholder, getFamily: () => [], submobjects: [], update: () => {} };
  const anim = new (class extends Animation {
    interpolateMobject(alpha: number): void {
      cb(alpha);
    }
    /** Closure-driven: the callback SOURCE is the only stable content
     *  identity the partial-movie cache can use (deterministic across
     *  re-runs, distinguishes different callbacks of equal duration). */
    _hashExtra(): string {
      return String(cb);
    }
  })(placeholder, { runTime: duration, rateFunc: ease });
  return anim;
}

// ---------------------------------------------------------------------------
// Spring presets + springTween (MC's spring(PlopSpring, from, to, cb))
// ---------------------------------------------------------------------------

export const PlopSpring: SpringConfig = { mass: 0.08, stiffness: 4, damping: 0.24 } as any;
export const SmoothSpring: SpringConfig = { mass: 0.16, stiffness: 1.5, damping: 0.6 } as any;
export const BounceSpring: SpringConfig = { mass: 0.1, stiffness: 5, damping: 0.1 } as any;
export const SwingSpring: SpringConfig = { mass: 0.25, stiffness: 2, damping: 0.3 } as any;
export const JumpSpring: SpringConfig = { mass: 0.05, stiffness: 8, damping: 0.4 } as any;
export const StrikeSpring: SpringConfig = { mass: 0.03, stiffness: 10, damping: 0.5 } as any;

/**
 * Spring-driven value tween: `springTween(PlopSpring, -400, 400, v =>
 * dot.setX(v))`. `settleTolerance` mirrors MC's optional 4th argument
 * (accepted for signature parity; the spring rate runs to settle).
 */
export function springTween(
  preset: SpringConfig | undefined,
  from: number,
  to: number,
  settleToleranceOrCb: number | ((v: number) => void),
  maybeCb?: (v: number) => void,
  config: AnimationConfig = {},
): Animation {
  const cb = typeof settleToleranceOrCb === "function" ? settleToleranceOrCb : maybeCb!;
  const fps = 60;
  const settleFrames = Math.round((config.runTime ?? 2) * fps);
  const rate = springRate(preset, fps, settleFrames);
  const placeholder: any = { copy: () => placeholder, getFamily: () => [], submobjects: [], update: () => {} };
  return new (class extends Animation {
    interpolateMobject(alpha: number): void {
      cb(map(from, to, rate(alpha)));
    }
  })(placeholder, { runTime: config.runTime ?? 2, rateFunc: linear, ...config });
}

// ---------------------------------------------------------------------------
// useRandom — MC's seeded RNG object over mulberry32
// ---------------------------------------------------------------------------

export interface SeededRandom {
  nextFloat(from?: number, to?: number): number;
  nextInt(from: number, to: number): number;
  floatArray(count: number, from?: number, to?: number): number[];
  intArray(count: number, from: number, to: number): number[];
  gauss(mean?: number, stdev?: number): number;
}

/** Deterministic RNG with MC's method surface (`nextInt` upper-exclusive). */
export function useRandom(seed = 0): SeededRandom {
  const rand = mulberry32(seed);
  const nextFloat = (from = 0, to = 1) => from + (to - from) * rand();
  return {
    nextFloat,
    nextInt: (from, to) => Math.floor(nextFloat(from, to)),
    floatArray: (count, from = 0, to = 1) => Array.from({ length: count }, () => nextFloat(from, to)),
    intArray: (count, from, to) => Array.from({ length: count }, () => Math.floor(nextFloat(from, to))),
    gauss: (mean = 0, stdev = 1) => {
      // Box-Muller from two uniform draws.
      const u = Math.max(rand(), 1e-12);
      const v = rand();
      return mean + stdev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}

void V;
