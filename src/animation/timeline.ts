// GSAP-style Timeline builder. Lets you place animations at relative or
// absolute positions on a shared timeline, then compile them into a single
// AnimationGroup whose children play in their resolved absolute [start,end]
// windows — ready to hand to `scene.play(...)`.
//
// This does NOT modify composition.ts. It composes AnimationGroup: build a
// group from the collected animations, then overwrite its `timings`, `maxEnd`,
// `groupRunTime` and `runTime` with the explicitly resolved absolute schedule.
// AnimationGroup.begin() recomputes `scaledTimings` from `timings` using
// `scale = maxEnd`, so each child ends up dispatched over `[start/dur,end/dur]`.
// Children before their window receive local alpha 0, after their window 1 —
// exactly AnimationGroup semantics.

import { AnimationGroup } from "./composition.ts";

export interface TimelineOptions {
  fps?: number;
  defaults?: { runTime?: number; rateFunc?: (t: number) => number };
}

interface TimelineEntry {
  anim: any;
  start: number;
  end: number;
}

export class Timeline {
  fps: number;
  defaults: { runTime?: number; rateFunc?: (t: number) => number };
  private entries: TimelineEntry[];
  private labels: Map<string, number>;
  private cursor: number; // current end cursor (seconds)
  private prevStart: number;
  private prevEnd: number;

  constructor(opts: TimelineOptions = {}) {
    this.fps = opts.fps ?? 60;
    this.defaults = opts.defaults ?? {};
    this.entries = [];
    this.labels = new Map();
    this.cursor = 0;
    this.prevStart = 0;
    this.prevEnd = 0;
  }

  // Resolve a position expression to an absolute start time in seconds.
  // Grammar:
  //   number        -> absolute start
  //   "+=1"/"-=0.5" -> relative to the current end cursor
  //   "<"           -> start of the previous add; "<0.5" -> 0.5s after prev start
  //   ">"           -> end of the previous add;   ">-0.25" -> 0.25s before prev end
  //   "label"       -> at a previously-added label
  //   undefined     -> ">" (sequential, at current end cursor)
  private resolve(position?: string | number): number {
    if (position === undefined) return this.cursor;
    if (typeof position === "number") return position;

    const p = position.trim();

    // Relative to cursor: "+=n" / "-=n"
    if (p.startsWith("+=")) return this.cursor + parseFloat(p.slice(2));
    if (p.startsWith("-=")) return this.cursor - parseFloat(p.slice(2));

    // Relative to previous start: "<" with optional signed offset
    if (p.startsWith("<")) {
      const rest = p.slice(1).trim();
      const off = rest === "" ? 0 : parseFloat(rest);
      return this.prevStart + (Number.isNaN(off) ? 0 : off);
    }

    // Relative to previous end: ">" with optional signed offset
    if (p.startsWith(">")) {
      const rest = p.slice(1).trim();
      const off = rest === "" ? 0 : parseFloat(rest);
      return this.prevEnd + (Number.isNaN(off) ? 0 : off);
    }

    // Bare numeric string -> absolute
    const asNum = Number(p);
    if (!Number.isNaN(asNum)) return asNum;

    // Label lookup
    if (this.labels.has(p)) return this.labels.get(p)!;

    throw new Error(`Timeline: unknown position "${position}"`);
  }

  // `forNestedTimeline`: bypass defaults.runTime -- a nested Timeline's own
  // resolved duration must never be overridden by this timeline's defaults.
  private childRunTime(animation: any, forNestedTimeline = false): number {
    if (!forNestedTimeline && this.defaults.runTime != null) return this.defaults.runTime;
    return animation.runTime ?? 1;
  }

  add(animation: any, position?: string | number): this {
    // A nested Timeline is built into its own AnimationGroup (with its own
    // internally-resolved absolute schedule) and placed as ONE child at the
    // resolved position -- previously this fell through to the plain
    // "anim = animation" branch below, pushing the raw, un-built Timeline
    // object (which has no .runTime), so childRunTime() silently fell back
    // to its `?? 1` default instead of the nested timeline's real duration.
    const isNestedTimeline = animation instanceof Timeline;
    const anim = isNestedTimeline
      ? animation.build()
      : (animation && animation._isAnimateBuilder ? animation.build() : animation);

    // Defaults (rateFunc/runTime) apply to leaf animations authored directly
    // on this Timeline, not to a nested Timeline's own already-resolved
    // internal schedule -- overwriting its resolved `runTime` here would
    // silently reflow every child inside it to a single new duration.
    if (!isNestedTimeline) {
      // Apply default rate function if provided and the animation exposes one.
      if (this.defaults.rateFunc && anim && typeof anim === "object") {
        anim.rateFunc = this.defaults.rateFunc;
      }
      // Apply default runTime to the animation object so downstream consumers agree.
      if (this.defaults.runTime != null && anim && typeof anim === "object") {
        anim.runTime = this.defaults.runTime;
      }
    }

    const start = Math.max(0, this.resolve(position));
    const end = start + this.childRunTime(anim, isNestedTimeline);

    this.entries.push({ anim, start, end });
    this.prevStart = start;
    this.prevEnd = end;
    this.cursor = Math.max(this.cursor, end);
    return this;
  }

  addLabel(name: string, position?: string | number): this {
    const at = Math.max(0, this.resolve(position));
    this.labels.set(name, at);
    // A label acts like a zero-length marker; treat it as the new "previous"
    // anchor so subsequent "<"/">" reads relative to it behave intuitively.
    this.prevStart = at;
    this.prevEnd = at;
    return this;
  }

  get duration(): number {
    let max = 0;
    for (const e of this.entries) max = Math.max(max, e.end);
    return max;
  }

  build(): any {
    const dur = this.duration || 1;
    const group = new AnimationGroup(this.entries.map((e) => e.anim));

    // Overwrite AnimationGroup's sequential timings with our absolute windows.
    group.timings = this.entries.map((e) => ({
      anim: e.anim,
      start: e.start,
      end: e.end,
    }));
    group.maxEnd = dur;
    group.groupRunTime = dur;
    group.runTime = dur;
    return group;
  }
}

export function timeline(opts?: TimelineOptions): Timeline {
  return new Timeline(opts);
}
