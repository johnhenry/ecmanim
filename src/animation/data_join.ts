// Keyed data join (D3-parity campaign, cluster D6): d3's
// selection.join(enter, update, exit) for mobjects. TransformMatchingAuto
// reconciles two already-built mobject TREES; this reconciles a mobject set
// against a DATA ARRAY via a key function — the primitive the bar-chart-race
// pattern needs (enter bars appear, update bars tween, exit bars leave, all
// keyed by name, re-run every keyframe).

import { Mobject } from "../mobject/Mobject.ts";
import { Animation, FadeIn, FadeOut } from "./Animation.ts";
import { AnimationGroup } from "./composition.ts";

export interface DataJoinConfig<T> {
  /** Build a mobject for an ENTERING datum (placed at its final state). */
  make: (d: T, i: number) => Mobject;
  /** Reconcile an EXISTING mobject to its new datum: return an Animation
   *  (e.g. a tweenTo chain) to animate it, or mutate directly and return
   *  nothing. */
  update?: (mob: Mobject, d: T, i: number) => Animation | void;
  /** Position/style an entering mobject BEFORE its FadeIn (d3's
   *  enter-at-previous-neighbor trick). */
  enterFrom?: (mob: Mobject, d: T, i: number) => void;
  /** Animation to play on an EXITING mobject alongside its FadeOut (e.g.
   *  slide it to where it "would have gone"). */
  exitTo?: (mob: Mobject) => Animation | void;
  runTime?: number;
  lagRatio?: number;
}

export interface DataJoinResult<T> {
  /** Newly created mobjects, in data order. */
  enter: Mobject[];
  /** [mobject, datum] pairs that persisted. */
  update: Array<[Mobject, T]>;
  /** Mobjects whose key vanished (FadeOut+removed by the animation). */
  exit: Mobject[];
  /** The full post-join mobject set, in NEW data order — feed it to the
   *  next dataJoin call. */
  mobs: Mobject[];
  /** Play this: FadeIn(enter) + update animations + FadeOut(exit). */
  animation: AnimationGroup;
}

/**
 * Reconcile `oldMobs` (from a previous join, or []) against `newData`:
 *
 * ```ts
 * let join = dataJoin([], frame0, (d) => d.name, { make, update });
 * scene.add(...join.mobs);
 * for (const frame of frames) {
 *   join = dataJoin(join.mobs, frame, (d) => d.name, { make, update });
 *   await scene.play(join.animation);
 * }
 * ```
 *
 * Keys are stamped on the mobjects (`__joinKey`), so consecutive joins
 * track identity without external bookkeeping.
 */
export function dataJoin<T>(
  oldMobs: Mobject[],
  newData: T[],
  keyFn: (d: T, i: number) => string,
  config: DataJoinConfig<T>,
): DataJoinResult<T> {
  const { make, update, enterFrom, exitTo, runTime, lagRatio } = config;

  const byKey = new Map<string, Mobject>();
  for (const mob of oldMobs) {
    const k = (mob as any).__joinKey;
    if (k != null) byKey.set(k, mob);
  }

  const enter: Mobject[] = [];
  const updatePairs: Array<[Mobject, T]> = [];
  const mobs: Mobject[] = [];
  const anims: Animation[] = [];
  const seen = new Set<string>();

  newData.forEach((d, i) => {
    const key = keyFn(d, i);
    seen.add(key);
    const existing = byKey.get(key);
    if (existing) {
      updatePairs.push([existing, d]);
      mobs.push(existing);
      const anim = update?.(existing, d, i);
      if (anim) anims.push(anim);
    } else {
      const mob = make(d, i);
      (mob as any).__joinKey = key;
      enterFrom?.(mob, d, i);
      enter.push(mob);
      mobs.push(mob);
      anims.push(new FadeIn(mob));
    }
  });

  const exit: Mobject[] = [];
  for (const [k, mob] of byKey) {
    if (seen.has(k)) continue;
    exit.push(mob);
    const extra = exitTo?.(mob);
    if (extra) anims.push(extra);
    anims.push(new FadeOut(mob)); // remover: leaves the scene at finish
  }

  const groupConfig: any = {};
  if (runTime != null) groupConfig.runTime = runTime;
  if (lagRatio != null) groupConfig.lagRatio = lagRatio;
  const animation = new AnimationGroup(anims, groupConfig);
  if (runTime != null) {
    animation.runTime = runTime;
    for (const a of anims) a.runTime = runTime;
  }

  return { enter, update: updatePairs, exit, mobs, animation };
}

/**
 * Interpolate between keyed snapshots (the bar-chart-race keyframe
 * expansion): given [tA, MapA] and [tB, MapB] of key -> value, produce `k`
 * intermediate Maps (inclusive of A, exclusive of B) whose values lerp and
 * whose key set is the union (missing = 0, matching d3's `(prev || d)`).
 */
export function interpolateFrames<K>(
  a: [number, Map<K, number>],
  b: [number, Map<K, number>],
  k: number,
): Array<[number, Map<K, number>]> {
  const [ta, ma] = a;
  const [tb, mb] = b;
  const keys = new Set<K>([...ma.keys(), ...mb.keys()]);
  const out: Array<[number, Map<K, number>]> = [];
  for (let i = 0; i < k; i++) {
    const t = i / k;
    const m = new Map<K, number>();
    for (const key of keys) {
      const va = ma.get(key) ?? 0;
      const vb = mb.get(key) ?? 0;
      m.set(key, va * (1 - t) + vb * t);
    }
    out.push([ta * (1 - t) + tb * t, m]);
  }
  return out;
}

/** Rank a keyed frame descending by value (ties broken by key order for
 *  determinism); returns [{key, value, rank}] limited to `n` ranks — ranks
 *  beyond n are clamped to n (d3's bar-chart-race convention, so exiting
 *  bars slide to just off the bottom). */
export function rankFrame<K>(
  frame: Map<K, number>,
  n = Infinity,
): Array<{ key: K; value: number; rank: number }> {
  const entries = [...frame.entries()].sort(
    (a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])),
  );
  return entries.map(([key, value], i) => ({ key, value, rank: Math.min(i, n) }));
}
