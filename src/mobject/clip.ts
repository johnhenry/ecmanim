// Clip: a nested animation with its own local clock (epic #61, #72).
//
// Clip is a Group whose content is evaluated at LOCAL time -- a pure function
// of absolute time -- rather than being driven by the scene's unscaled `dt`.
// Content is any child exposing `setTime(t)` (Skeleton with a bound pose
// track, particle presets, Lottie-style players, other Clips) or a builder
// `(t, clip) => void`. Like Skeleton/ParticleSystem, nothing here integrates
// dt for its *result*: `setTime(t)` / `seek(t)` map t -> localTime(t) -> content,
// so scrubbing, onion skins and parallel segment rendering can evaluate any t.
// The only stateful part is the clock that `update(dt)` advances for live play.
//
// Time model (t = the clip's own clock, seconds since it started):
//   raw       = t * speed + startOffset
//   loop        local = raw wrapped into [0, duration)
//   once-hold   local = raw clamped to [0, duration]   (holds the last frame)
//   once-hide   as once-hold while raw in [0, duration]; hidden outside it
//   single-frame local = startOffset, always (a pinned still frame)
// Without `duration` there is nothing to wrap/clamp against: local = raw
// (clamped at 0 for once-*), and once-hide never hides.
import { Group, Mobject } from "./Mobject.ts";

export type ClipMode = "loop" | "once-hold" | "once-hide" | "single-frame";

/** A builder is called with the clip's local time and the clip itself. */
export type ClipBuilder = (t: number, clip: Clip) => void;
export type ClipContent = Mobject | ClipBuilder;

export interface ClipConfig {
  /** Playback mode (default "loop"). */
  mode?: ClipMode;
  /** Length of the content's timeline in seconds (> 0). Required to loop/hold/hide. */
  duration?: number;
  /** Playback rate multiplier (default 1; negative plays backwards). */
  speed?: number;
  /** Content time (seconds) at clip time 0 (default 0). */
  startOffset?: number;
  /** Render the content into its own offscreen layer (CompositeGroup behaviour). Canvas backends only. Default false. */
  isolate?: boolean;
}

const MODES: readonly ClipMode[] = ["loop", "once-hold", "once-hide", "single-frame"];
const hasSetTime = (m: any): boolean => typeof m?.setTime === "function";

export class Clip extends Group {
  mode: ClipMode;
  duration: number | undefined;
  speed: number;
  startOffset: number;
  /** The clip's own clock (seconds): advanced by update(dt), set by setTime/seek. */
  clock = 0;
  private _builders: ClipBuilder[] = [];
  /** Content stashed while a once-hide clip is hidden (renders nothing). */
  private _stash: Mobject[] | null = null;

  constructor(content: ClipContent | ClipContent[], config: ClipConfig = {}) {
    super();
    const { mode = "loop", duration, speed = 1, startOffset = 0, isolate = false } = config;
    if (!MODES.includes(mode)) throw new Error(`Clip: unknown mode "${mode}" (expected ${MODES.join(" | ")})`);
    if (duration !== undefined && !(Number.isFinite(duration) && duration > 0)) {
      throw new Error(`Clip: duration must be a finite number > 0 (got ${duration})`);
    }
    if (!Number.isFinite(speed)) throw new Error(`Clip: speed must be finite (got ${speed})`);
    if (!Number.isFinite(startOffset)) throw new Error(`Clip: startOffset must be finite (got ${startOffset})`);
    this.mode = mode;
    this.duration = duration;
    this.speed = speed;
    this.startOffset = startOffset;
    if (isolate) (this as any)._isCompositeGroup = true;
    for (const c of Array.isArray(content) ? content : [content]) {
      if (typeof c === "function") this._builders.push(c);
      else this.add(c);
    }
    this._armDriver();
  }

  /** The driver updater advances the clock and re-evaluates; hashExtra salts wait() fingerprints. */
  private _armDriver(): void {
    this.addUpdater(
      (_m, dt) => { this.clock += dt; this._evaluate(); },
      { hashExtra: () => `clip:${this.mode}:${this.duration ?? ""}:${this.speed}:${this.startOffset}:${this.clock.toFixed(6)}:${this._stash ? "h" : "v"}` },
    );
  }

  private _raw(t: number): number { return t * this.speed + this.startOffset; }

  /** Pure: content time for clip time `t`. */
  localTime(t: number): number {
    const raw = this._raw(t);
    const d = this.duration;
    switch (this.mode) {
      case "single-frame": return this.startOffset;
      case "loop": return d === undefined ? raw : ((raw % d) + d) % d;
      default: {
        const lo = Math.max(raw, 0);
        return d === undefined ? lo : Math.min(lo, d);
      }
    }
  }

  /** Pure: is the content shown at clip time `t`? (Only once-hide with a duration ever hides.) */
  isVisibleAt(t: number): boolean {
    if (this.mode !== "once-hide" || this.duration === undefined) return true;
    const raw = this._raw(t);
    return raw >= 0 && raw <= this.duration;
  }

  /** Set the clip's clock to `t` and evaluate the content (deterministic). */
  setTime(t: number): this {
    this.clock = t;
    return this._evaluate();
  }

  /** Alias of setTime(). */
  seek(t: number): this { return this.setTime(t); }

  private _evaluate(): this {
    const t = this.clock;
    const visible = this.isVisibleAt(t);
    if (!visible) {
      if (!this._stash) { this._stash = this.submobjects; this.submobjects = []; }
      return this;
    }
    if (this._stash) { this.submobjects = [...this._stash, ...this.submobjects]; this._stash = null; }
    const lt = this.localTime(t);
    for (const m of this.submobjects) if (hasSetTime(m)) (m as any).setTime(lt);
    for (const b of this._builders) b(lt, this);
    return this;
  }

  /**
   * Runs this clip's own updaters (including the clock driver) but does NOT
   * recurse into time-driven children: the default recursion would hand them
   * the scene's unscaled dt. Children without `setTime` keep their normal
   * update recursion. Honors `updatingSuspended` (so `play()` pauses the clock
   * unless the animation sets `suspendMobjectUpdating: false`; `seek()` still works).
   */
  override update(dt: number): this {
    if (this.updatingSuspended) return this;
    for (const fn of this.updaters) fn(this, dt);
    for (const m of this.submobjects) if (!hasSetTime(m)) m.update(dt);
    return this;
  }

  /** Deep copy with an independent clock; `Mobject.copy()` alone drops the driver updater. */
  override copy(): this {
    const c = super.copy();
    if (this._stash) c._stash = this._stash.map((m) => m.copy());
    c._builders = [...this._builders];
    c.updaters = [];
    c._armDriver();
    return c;
  }
}

