// The Scene orchestrates mobjects and animations and emits frames at a fixed
// fps. It is backend-agnostic: a backend sets `frameHandler` (called with the
// list of top-level mobjects once per frame) and awaits `render()`.

import type { Mobject } from "../mobject/Mobject.ts";
import { Group } from "../mobject/Mobject.ts";
import type { Camera } from "../renderer/CanvasRenderer.ts";
import { TransformMatchingAuto } from "../animation/auto_matching.ts";
import type { AutoMatchingConfig } from "../animation/auto_matching.ts";
import { PlayableKeyframeTrack } from "../reactive/keyframes.ts";
import type { Keyframe, KeyframeTrackOptions } from "../animation/keyframe_track.ts";

/** A frame callback invoked once per frame with the top-level mobjects. */
export type FrameHandler = (mobjects: Mobject[], frameCount: number, time: number) => void | Promise<void>;

/** A scheduled audio clip. */
export interface SceneSound {
  file: string;
  time: number;
  gain: number;
}

/** Section types, mirroring manim's `PresentationSectionType`. */
export const SectionType = {
  NORMAL: "section.normal",
  SKIP: "section.skip",
  LOOP: "section.loop",
  COMPLETE_LOOP: "section.complete_loop",
} as const;

/**
 * A section boundary, recorded by `nextSection()`. `startFrame` is the frame
 * count at the moment the section began; the backend fills `endFrame` when the
 * next section starts (or at end of render).
 */
export interface SceneSection {
  name: string;
  type: string;
  skipAnimations: boolean;
  startFrame: number;
  endFrame: number;
  id: number;
  /** Presenter-mode speaker notes for this section, if given to nextSection(). */
  notes?: string;
}

/** A descriptor recorded for each play() call, used for content-addressed caching. */
export interface PlayRecord {
  index: number;       // 0-based play() ordinal
  kind: string;        // "play" | "wait"
  hash: string;        // content hash of the animation descriptors
  startFrame: number;  // frame count when this segment began
  endFrame: number;    // frame count when this segment ended
}

/** Configuration accepted by the Scene constructor. */
export interface SceneConfig {
  fps?: number;
  camera?: Camera | null;
  frameHandler?: FrameHandler;
  /** Schema-validated scene params (Remotion-style) — see scene_params.ts. */
  params?: Record<string, any>;
  /** Named time-event durations for waitUntil() (Motion Canvas's editor-
   *  draggable time events, expressed as config): `{ intro: 2.5 }` makes
   *  `waitUntil("intro")` hold 2.5s regardless of its inline fallback. */
  timeEvents?: Record<string, number>;
  [key: string]: any;
}

/** Handle to a background task started with Scene.spawn(). */
export interface TaskHandle {
  /** Stop the task where it is (its current animation is left mid-state). */
  cancel(): void;
  /** Emit frames (holding the scene) until the task runs to completion.
   *  Resolves immediately if the task is already done or canceled. */
  join(): Promise<void>;
  /** True once the task's generator is exhausted or cancel() was called. */
  readonly done: boolean;
}

// Internal background-task record: an iterator of animation steps advanced
// dt-by-dt from the play()/wait() frame loops.
interface BackgroundTask {
  iterator: Iterator<any>;
  current: { anim?: any; runTime: number; elapsed: number } | null;
  done: boolean;
  onDone: Array<() => void>;
}

export class Scene {
  mobjects: Mobject[];
  fps: number;
  camera: Camera | null;
  /** Schema-validated params this render was invoked with (default {}).
   *  Scene subclasses read them in construct() via `this.params`; bare
   *  construct functions receive them as a 2nd argument instead. */
  params: Record<string, any>;
  frameHandler: FrameHandler;
  time: number;
  frameCount: number;
  sounds: SceneSound[];
  /** waitUntil() duration overrides by event name (see SceneConfig.timeEvents). */
  timeEvents: Record<string, number>;
  /** Chronological record of waitUntil() events: name + the scene time at
   *  which each STARTED (tooling / assertions can read the timeline back). */
  timeEventRecords: Array<{ name: string; time: number; duration: number }>;
  private _tasks: BackgroundTask[] = [];
  /** Property-keyframe tracks created via track() (mirrors sounds/sections). */
  keyframeTracks: PlayableKeyframeTrack<any>[];

  // --- Sections (manim's next_section) ---
  sections: SceneSection[];
  private _sectionId: number;

  // --- Per-play tracking (for caching + from/upto animation ranges) ---
  playCount: number;                 // number of play() calls seen so far
  playRecords: PlayRecord[];         // one record per play()/wait segment
  /**
   * Optional hook invoked by a backend at the start of each play()/wait segment,
   * BEFORE any frames are emitted. It receives a descriptor and returns
   * per-segment directives:
   *   { skip: true }  — don't render this segment's frames (still advance time)
   * Used by node.ts for caching and from/upto animation ranges.
   */
  onSegment?: (rec: { index: number; kind: string; hash: string; startFrame: number }) => { skip?: boolean } | undefined;

  /**
   * Optional observability hook. When set, the Scene emits lightweight,
   * structured log events at interesting moments (play/wait start, section
   * boundaries). DEFAULT-OFF: if unset, `log()` is a no-op and there is no
   * behavior change. Useful for embedding the engine in a playground/UI or for
   * tracing what a construct() is doing without touching stdout.
   */
  onLog?: (level: string, msg: string, data?: any) => void;

  constructor(config: SceneConfig = {}) {
    this.mobjects = [];
    this.fps = config.fps ?? 30;
    this.camera = config.camera ?? null;
    this.params = config.params ?? {};
    this.frameHandler = config.frameHandler ?? (async () => {});
    this.time = 0;
    this.frameCount = 0;
    this.sounds = [];
    this.timeEvents = config.timeEvents ?? {};
    this.timeEventRecords = [];
    this.keyframeTracks = [];
    this.sections = [];
    this._sectionId = 0;
    this.playCount = 0;
    this.playRecords = [];
  }

  /**
   * Emit a structured log event through the optional `onLog` hook. A no-op when
   * `onLog` is unset (default), so this is safe to sprinkle through the engine
   * without any behavior or performance cost in the common case.
   */
  log(level: string, msg: string, data?: any): void {
    this.onLog?.(level, msg, data);
  }

  /**
   * Start a new section (manim's `self.next_section(...)`). Records the section
   * boundary at the current frame. The backend uses these boundaries to split
   * the rendered video into per-section files + a JSON index.
   */
  nextSection(name = "unnamed", type: string = SectionType.NORMAL, skipAnimations = false, notes?: string): this {
    // Close the previous section (if any) at the current frame.
    if (this.sections.length) {
      const prev = this.sections[this.sections.length - 1];
      if (prev.endFrame < 0) prev.endFrame = this.frameCount;
    }
    this.sections.push({
      name,
      type,
      skipAnimations,
      startFrame: this.frameCount,
      endFrame: -1,
      id: this._sectionId++,
      notes,
    });
    this.log("section", `section: ${name}`, { name, type, skipAnimations, startFrame: this.frameCount, notes });
    return this;
  }

  /** Close out the final open section (called by the backend at end of render). */
  finalizeSections(): void {
    if (this.sections.length) {
      const last = this.sections[this.sections.length - 1];
      if (last.endFrame < 0) last.endFrame = this.frameCount;
    }
  }

  /**
   * Opt-in Reveal.js Auto-Animate-style section transition: snapshot the
   * scene's current mobjects, let `buildNext()` mutate `this.mobjects` into
   * the next section's state, then `play()` a `TransformMatchingAuto` between
   * the two snapshots instead of a hard cut.
   *
   * This can't hook inside a plain `nextSection()` call itself -- the "after"
   * state doesn't exist yet at that point; it's the author's own code
   * (running after `nextSection()` returns) that builds it. Strictly opt-in:
   * plain `nextSection()` never triggers whole-tree matching, since matching
   * unrelated same-shape elements by default would be surprising.
   */
  async autoAnimateToNextSection(
    name: string,
    buildNext: () => void | Promise<void>,
    config: AutoMatchingConfig & { type?: string; skipAnimations?: boolean } = {},
  ): Promise<this> {
    const before = new Group(...this.mobjects.map((m) => m.copy()));
    await buildNext();
    const after = new Group(...this.mobjects);
    // Swap the live "after" mobjects out for the "before" copies: matched/
    // unmatched-source Transforms/FadeOuts built below animate the "before"
    // copies (disposable stand-ins that are actually in `this.mobjects` so
    // they render), not the true live originals -- Transform.begin() would
    // otherwise snapshot the ALREADY-mutated live state as its own start
    // value and produce no visible motion. Unmatched-target FadeIns
    // introduce the true live (new) mobjects directly.
    this.remove(...after.submobjects);
    this.add(...before.submobjects);
    this.nextSection(name, config.type, config.skipAnimations ?? false);
    await this.play(new TransformMatchingAuto(before, after, config));
    // Land on the true live mobjects (already in their correct final state,
    // untouched throughout) rather than the disposable "before" driver
    // copies, so any later code holding a reference to the originals still
    // affects what's rendered.
    this.remove(...before.submobjects);
    this.add(...after.submobjects);
    return this;
  }

  /**
   * Compute a stable content hash for a set of animations for caching. Based on
   * class names, target mobject ids/point counts, runTime, and the current
   * scene mobject count (so an added mobject invalidates downstream segments).
   */
  hashAnimations(anims: any[], kind: string): string {
    // Content-addressed (like manim): fingerprint the animation classes and the
    // structural shape/position of their targets — NOT object identity — so the
    // same construct() re-run produces the same hash and reuses partials.
    const parts: string[] = [kind, `mob:${this.mobjects.length}`, `fps:${this.fps}`];
    const r = (v: any) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v);
    for (const a of anims) {
      const cls = a?.constructor?.name ?? "anon";
      const mob = a?.mobject;
      // Fingerprint the WHOLE family, not just the top-level mobject: container
      // mobjects (VGroup, vector Text, diagram boards) keep their geometry in
      // submobjects and have no own points — fingerprinting only `mob.points`
      // made their hashes position-blind, which caused stale partial reuse when
      // e.g. a Text moved between renders.
      const fam: any[] = typeof mob?.getFamily === "function" ? mob.getFamily() : (mob ? [mob] : []);
      let npts = 0;
      let firstPt: any[] | null = null;
      let lastPt: any[] | null = null;
      for (const m of fam) {
        const pts = Array.isArray(m?.points) ? m.points : [];
        npts += pts.length;
        if (pts.length) {
          if (!firstPt) firstPt = pts[0];
          lastPt = pts[pts.length - 1];
        }
      }
      const geom = firstPt && lastPt
        ? `${firstPt.map(r).join(",")}~${lastPt.map(r).join(",")}`
        : "";
      // Content the geometry can't see: tween targets, closure sources, and
      // paint. Two equal-duration chains over the same mobject differ only
      // here (an `end` tween vs a `fillOpacity` tween; two different
      // tween(cb) closures) -- without this they collided and the cache
      // replayed the wrong segment WITHIN a single fresh render.
      const extra = typeof a?._hashExtra === "function" ? a._hashExtra() : "";
      const paint = fam.length
        ? `${fam[0]?.fillColor?.toHex?.() ?? ""}${fam[fam.length - 1]?.fillColor?.toHex?.() ?? ""}`
        : "";
      parts.push(`${cls}:${npts}:${fam.length}:${geom}:${paint}:${extra}:${a?.runTime ?? ""}`);
    }
    return fnv1a(parts.join("|"));
  }

  // Schedule an audio clip. Defaults to the current animation time, so calling
  // it between play()/wait() lines lands the sound at that moment. The Node
  // backend muxes these into the video with ffmpeg; the browser backend plays
  // them live during playback.
  addSound(file: string, { timeOffset, gain = 1 }: { timeOffset?: number; gain?: number } = {}): this {
    this.sounds.push({ file, time: timeOffset ?? this.time, gain });
    return this;
  }

  /** Create a property-keyframe track (mirrors addSound()'s ergonomic).
   *  Bind it to a mobject property with bindTrack() (src/reactive/keyframes.ts). */
  track<T = number>(keyframes: Keyframe<T>[], options?: KeyframeTrackOptions<T>): PlayableKeyframeTrack<T> {
    const t = new PlayableKeyframeTrack<T>(keyframes, options);
    this.keyframeTracks.push(t);
    return t;
  }

  add(...mobs: (Mobject | Mobject[])[]): this {
    for (const m of mobs.flat()) {
      if (m && !this.mobjects.includes(m)) this.mobjects.push(m);
    }
    this._restackForeground();
    return this;
  }

  /** Advance exactly ONE frame (Motion Canvas's bare `yield`): emits a
   *  frame and moves the clock by 1/fps. */
  async nextFrame(): Promise<void> {
    await this.wait(1 / this.fps);
  }

  /** Motion-Canvas-style logger handle (their `useLogger()`): levels route
   *  through the scene's onLog hook (no-op unless wired) AND the console
   *  for warn/error, so ports keep their shape. */
  get logger(): { debug: (m: any) => void; info: (m: any) => void; warn: (m: any) => void; error: (m: any) => void } {
    const route = (level: string, consoleToo: boolean) => (msg: any) => {
      this.log(level, typeof msg === "string" ? msg : JSON.stringify(msg));
      if (consoleToo) (console as any)[level === "warn" ? "warn" : "error"](msg);
    };
    return {
      debug: route("debug", false),
      info: route("info", false),
      warn: route("warn", true),
      error: route("error", true),
    };
  }

  /** manim parity (add_foreground_mobject(s)): keep these drawn LAST, above
   *  everything later add()s introduce. */
  addForegroundMobject(...mobs: (Mobject | Mobject[])[]): this {
    for (const m of mobs.flat()) {
      if (m && !this._foreground.includes(m)) this._foreground.push(m);
      if (m && !this.mobjects.includes(m)) this.mobjects.push(m);
    }
    this._restackForeground();
    return this;
  }
  /** Alias matching manim's plural spelling. */
  addForegroundMobjects(...mobs: (Mobject | Mobject[])[]): this {
    return this.addForegroundMobject(...mobs);
  }

  removeForegroundMobject(...mobs: (Mobject | Mobject[])[]): this {
    const set = new Set(mobs.flat());
    this._foreground = this._foreground.filter((m) => !set.has(m));
    return this;
  }

  private _foreground: Mobject[] = [];
  private _restackForeground(): void {
    if (!this._foreground.length) return;
    const fg = this._foreground.filter((m) => this.mobjects.includes(m));
    if (!fg.length) return;
    this.mobjects = [...this.mobjects.filter((m) => !fg.includes(m)), ...fg];
  }

  remove(...mobs: (Mobject | Mobject[])[]): this {
    const set = new Set(mobs.flat());
    this.mobjects = this.mobjects.filter((m) => !set.has(m));
    return this;
  }

  bringToFront(mob: Mobject): this {
    this.remove(mob);
    this.mobjects.push(mob);
    return this;
  }

  clear(): this {
    this.mobjects = [];
    return this;
  }

  // Override in subclasses (or pass config.construct) to define the animation.
  async construct(): Promise<void> {}

  async emitFrame(): Promise<void> {
    await this.frameHandler(this.mobjects, this.frameCount, this.time);
    this.frameCount++;
  }

  updateMobjects(dt: number): void {
    for (const m of this.mobjects) m.update(dt);
  }

  hasUpdaters(): boolean {
    return this.mobjects.some((m) => m.hasUpdaters());
  }

  // Play one or more animations in parallel for max(runTime).
  async play(...animations: any[]): Promise<this> {
    let config: any = {};
    const last = animations[animations.length - 1];
    // A trailing config object is recognized either by the internal
    // `_playConfig: true` marker (still supported), OR structurally: a
    // plain object that isn't animation-shaped (no `.begin`, not an
    // `.animate` builder, not an array). Every real call site in this
    // codebase already marks its config with `_playConfig`, but a bare
    // `{ runTime: ... }` passed WITHOUT the marker previously fell through
    // to `anims` and crashed on `a.begin()` -- a real footgun (see GitHub
    // issue #19) since the marker is undocumented and easy to omit. Any
    // object this check newly accepts as config was previously guaranteed
    // to crash, so this is a strictly safer, backward-compatible fix.
    const looksLikeConfig = last != null && typeof last === "object" && !Array.isArray(last) &&
      (last._playConfig || (typeof last.begin !== "function" && !last._isAnimateBuilder));
    if (animations.length && looksLikeConfig) {
      config = animations.pop();
    }
    const anims = animations.flat().filter(Boolean).map((a) =>
      a && a._isAnimateBuilder ? a.build() : a);
    if (anims.length === 0) return this;

    const playIndex = this.playCount++;

    const runTimeOverride = config.runTime;
    for (const a of anims) {
      if (runTimeOverride != null) a.runTime = runTimeOverride;
      // Suspend the target's updaters while the animation runs so an updater and
      // the animation don't fight over the same mobject (manim's default).
      if (a.suspendMobjectUpdating !== false) a.mobject?.suspendUpdating?.();
      a.begin();
      for (const m of a.getMobjectsToIntroduce()) this.add(m);
    }

    // Notify a backend that a play() segment is starting (for caching / ranges).
    const startFrame = this.frameCount;
    const hash = this.hashAnimations(anims, "play");
    const directive = this.onSegment?.({ index: playIndex, kind: "play", hash, startFrame });
    const skip = !!directive?.skip;

    const totalTime = Math.max(...anims.map((a) => a.runTime));
    const nFrames = Math.max(1, Math.round(totalTime * this.fps));
    const dt = totalTime / nFrames;

    this.log("play", `play: ${anims.length} animation(s)`, {
      index: playIndex, count: anims.length, runTime: totalTime, nFrames, startFrame,
    });

    for (let f = 1; f <= nFrames; f++) {
      const elapsed = (f / nFrames) * totalTime;
      for (const a of anims) {
        const localAlpha = a.runTime === 0 ? 1 : Math.max(0, Math.min(1, elapsed / a.runTime));
        a.interpolate(localAlpha);
      }
      this.updateMobjects(dt);
      this._tickTasks(dt);
      this.time += dt;
      if (skip) this.frameCount++;
      else await this.emitFrame();
    }

    this.playRecords.push({ index: playIndex, kind: "play", hash, startFrame, endFrame: this.frameCount });

    for (const a of anims) {
      a.finish();
      // Resume updaters that were suspended for the duration of the animation.
      if (a.suspendMobjectUpdating !== false) a.mobject?.resumeUpdating?.();
      for (const m of a.getMobjectsToIntroduce()) this.add(m);
      for (const m of a.getMobjectsToRemove()) this.remove(m);
      // ReplacementTransform introduces its target explicitly.
      if (a.introduced) this.add(a.introduced);
    }
    return this;
  }

  // Hold the current frame for `duration` seconds (runs updaters each frame).
  async wait(duration = 1): Promise<this> {
    const nFrames = Math.max(1, Math.round(duration * this.fps));
    const dt = duration / nFrames;

    const playIndex = this.playCount++;
    const startFrame = this.frameCount;
    // A wait's content depends on the visible mobjects + duration. The
    // fingerprint must be FAMILY-DEEP: containers (Group/VGroup/Code/
    // MathTex) hold all drawable state in submobjects and have no own
    // points, so a top-level-only fingerprint hashed every hold over them
    // identically -- later holds replayed the first hold's cached frames
    // within a single render. Include per-leaf position + paint + opacity.
    const fp = this.mobjects.map((m: any) => {
      const fam: any[] = typeof m?.getFamily === "function" ? m.getFamily() : [m];
      let npts = 0;
      const bits: string[] = [];
      for (const f of fam) {
        npts += Array.isArray(f?.points) ? f.points.length : 0;
        const c = typeof f?.getCenter === "function" && f.points?.length ? f.getCenter() : [0, 0, 0];
        bits.push(
          `${Math.round(c[0] * 1000)},${Math.round(c[1] * 1000)},` +
          `${f?.fillColor?.toHex?.() ?? ""},${Math.round((f?.opacity ?? 1) * 1000)},` +
          `${Math.round((f?.strokeEnd ?? 1) * 1000)}`,
        );
      }
      return `${m?.constructor?.name ?? "m"}:${npts}:${fnv1a(bits.join(";"))}`;
    }).join(",");
    const hash = this.hashAnimations([{ constructor: { name: "Wait" }, runTime: duration, mobject: { points: [], submobjects: [] } }], `wait:${duration}:${fp}`);
    const directive = this.onSegment?.({ index: playIndex, kind: "wait", hash, startFrame });
    const skip = !!directive?.skip;

    this.log("wait", `wait: ${duration}s`, { index: playIndex, duration, nFrames, startFrame });

    for (let f = 0; f < nFrames; f++) {
      this.updateMobjects(dt);
      this._tickTasks(dt);
      this.time += dt;
      if (skip) this.frameCount++;
      else await this.emitFrame();
    }
    this.playRecords.push({ index: playIndex, kind: "wait", hash, startFrame, endFrame: this.frameCount });
    return this;
  }

  /**
   * Hold at a NAMED time event (Motion Canvas's `waitUntil`). The hold
   * duration is `timeEvents[name]` from SceneConfig when present, else
   * `fallbackDuration` — the config map is the editor-less equivalent of
   * MC's draggable events: retime a scene without touching construct().
   */
  async waitUntil(name: string, fallbackDuration = 1): Promise<this> {
    const duration = this.timeEvents[name] ?? fallbackDuration;
    this.timeEventRecords.push({ name, time: this.time, duration });
    this.log("waitUntil", `waitUntil: ${name} (${duration}s)`, { name, duration });
    if (duration <= 0) return this;
    return this.wait(duration);
  }

  /**
   * Start a BACKGROUND task (Motion Canvas's `spawn`): a generator yielding
   * animation steps that advance alongside the foreground play()/wait()
   * frames. Yield an Animation to run it, or a number to idle that many
   * seconds. The task only progresses while frames are being emitted (it is
   * ticked by the same clock as updaters), so it is fully deterministic.
   *
   * ```ts
   * const orbit = scene.spawn(function* () {
   *   while (true) yield new Rotate(dot, { angle: Math.PI, runTime: 2 });
   * });
   * await scene.play(...foreground...);
   * orbit.cancel();
   * ```
   */
  spawn(source: (() => Iterator<any> | Iterable<any>) | Iterator<any> | Iterable<any>): TaskHandle {
    let it: Iterator<any>;
    const resolved = typeof source === "function" ? (source as () => any)() : source;
    if (resolved && typeof (resolved as any)[Symbol.iterator] === "function") {
      it = (resolved as Iterable<any>)[Symbol.iterator]();
    } else {
      it = resolved as Iterator<any>;
    }
    const task: BackgroundTask = { iterator: it, current: null, done: false, onDone: [] };
    this._tasks.push(task);
    const finish = () => {
      if (task.done) return;
      task.done = true;
      for (const cb of task.onDone) cb();
      task.onDone.length = 0;
    };
    return {
      cancel: () => finish(),
      join: async () => {
        while (!task.done) await this.wait(1 / this.fps);
      },
      get done() { return task.done; },
    };
  }

  /** Sugar over spawn(): run `factory()`'s animation forever (MC's infinite
   *  `loop`). Cancel the returned handle to stop it. */
  loopForever(factory: () => any): TaskHandle {
    return this.spawn(function* () {
      for (;;) yield factory();
    });
  }

  // Advance every live background task by dt: pull the next step from its
  // iterator when idle, interpolate the current animation, finish and move
  // on when it completes. Runs from the play()/wait() frame loops right
  // after updateMobjects — background tasks are clocked exactly like
  // updaters and never emit frames themselves.
  private _tickTasks(dt: number): void {
    if (this._tasks.length === 0) return;
    for (const task of this._tasks) {
      if (task.done) continue;
      let budget = dt;
      let pulls = 0;
      // A step can complete mid-frame; the remainder of the frame flows into
      // the next step so long chains don't drift by a frame per step. The
      // pull cap breaks a generator that yields zero-duration steps forever
      // (`while (true) yield 0;`) instead of hanging the frame loop.
      while (budget > 1e-12 && !task.done && pulls < 1000) {
        if (!task.current) {
          pulls++;
          const next = task.iterator.next();
          if (next.done) {
            task.done = true;
            for (const cb of task.onDone) cb();
            task.onDone.length = 0;
            break;
          }
          const step = next.value;
          if (typeof step === "number") {
            task.current = { runTime: Math.max(0, step), elapsed: 0 };
          } else if (step && typeof step.begin === "function") {
            const anim = step._isAnimateBuilder ? step.build() : step;
            anim.begin();
            for (const m of anim.getMobjectsToIntroduce?.() ?? []) this.add(m);
            task.current = { anim, runTime: Math.max(anim.runTime ?? 0, 0), elapsed: 0 };
          } else if (step && step._isAnimateBuilder) {
            const anim = step.build();
            anim.begin();
            for (const m of anim.getMobjectsToIntroduce?.() ?? []) this.add(m);
            task.current = { anim, runTime: Math.max(anim.runTime ?? 0, 0), elapsed: 0 };
          } else {
            // Unknown step (null/undefined/other): skip it.
            task.current = { runTime: 0, elapsed: 0 };
          }
        }
        const cur = task.current!;
        const advance = Math.min(budget, cur.runTime - cur.elapsed);
        cur.elapsed += advance;
        budget -= advance;
        if (cur.anim) {
          const alpha = cur.runTime === 0 ? 1 : Math.min(1, cur.elapsed / cur.runTime);
          cur.anim.interpolate(alpha);
        }
        if (cur.elapsed >= cur.runTime - 1e-12) {
          if (cur.anim) {
            cur.anim.finish();
            for (const m of cur.anim.getMobjectsToIntroduce?.() ?? []) this.add(m);
            for (const m of cur.anim.getMobjectsToRemove?.() ?? []) this.remove(m);
          }
          task.current = null;
        }
      }
    }
    // Drop finished tasks so a long render doesn't accumulate dead entries.
    this._tasks = this._tasks.filter((t) => !t.done);
  }

  // Add mobjects and show them for a moment (manim's self.add + a frame).
  async pause(duration = 0.5): Promise<this> {
    return this.wait(duration);
  }

  // Full run: emit an initial frame, then the user's construct().
  async render(): Promise<this> {
    await this.construct();
    this.finalizeSections();
    return this;
  }
}

/** FNV-1a 32-bit hash, returned as an 8-char hex string. Deterministic + fast.
 *  Exported so callers outside Scene (e.g. node.ts's render-config cache-key
 *  fingerprint) can reuse the same algorithm instead of duplicating it. */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Fingerprint the render-time config that affects final pixel output but is
 * invisible to hashAnimations() above (which only looks at animation/mobject
 * content): resolution, background, fps, transparency, and (for a 3D camera)
 * orientation/zoom/rasterizer settings AT render() CALL TIME.
 *
 * Confirmed bug this fixes: node.ts/node-parallel.ts's partial-segment cache
 * used to key solely off hashAnimations()'s content hash, so re-rendering the
 * identical scene code with a different background/resolution/3D camera
 * setting (or this session's new camera.superSample anti-aliasing option)
 * silently reused a stale cached segment from a run with different config --
 * e.g. asking for a blue background produced red output, because a cached
 * red segment matched the (config-blind) content hash. Salting every partial
 * filename with this fingerprint's return value fixes that.
 *
 * Deliberately shared between node.ts and node-parallel.ts (rather than each
 * computing its own) so both cache paths stay byte-compatible, matching the
 * existing "single source of truth" convention for their partial files
 * (see node-parallel.ts's own header comment).
 *
 * Does NOT cover camera state that changes mid-scene (ambient rotation,
 * moveCamera) -- that would require per-segment camera fingerprinting inside
 * hashAnimations() itself, a separate, harder problem left alone here.
 */
export function computeRenderConfigHash(config: {
  pixelWidth: number;
  pixelHeight: number;
  background: string;
  fps: number;
  transparent?: boolean;
  camera?: any;
}): string {
  const parts: any[] = [config.pixelWidth, config.pixelHeight, config.background, config.fps, !!config.transparent];
  const c = config.camera;
  if (c && typeof c.projectionDepth === "function") {
    parts.push(
      c.phi, c.theta, c.gamma ?? 0, c.zoom ?? 1, c.superSample ?? 1,
      !!c.disableZBuffer, !!c.flatShading, c.focalDistance ?? "",
    );
  }
  return fnv1a(parts.join("|"));
}

// JSON.stringify with recursively-sorted object keys, so two params objects
// with the same contents in different insertion order hash identically.
function stableStringify(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/**
 * Fingerprint a render's scene params for the partial-segment cache key.
 * Params change what construct() builds, but hashAnimations() can miss that
 * (e.g. a param used only in a raster label) — and two personalized renders
 * writing to the same output directory MUST NOT collide on cached partials.
 * Shared by node.ts and node-parallel.ts the same way computeRenderConfigHash
 * is, so parallel and sequential partials stay interchangeable.
 */
export function computeParamsHash(params: Record<string, any>): string {
  return fnv1a(stableStringify(params));
}
