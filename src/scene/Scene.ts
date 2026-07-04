// The Scene orchestrates mobjects and animations and emits frames at a fixed
// fps. It is backend-agnostic: a backend sets `frameHandler` (called with the
// list of top-level mobjects once per frame) and awaits `render()`.

import type { Mobject } from "../mobject/Mobject.ts";
import { Group } from "../mobject/Mobject.ts";
import type { Camera } from "../renderer/CanvasRenderer.ts";
import { TransformMatchingAuto } from "../animation/auto_matching.ts";
import type { AutoMatchingConfig } from "../animation/auto_matching.ts";

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
  [key: string]: any;
}

export class Scene {
  mobjects: Mobject[];
  fps: number;
  camera: Camera | null;
  frameHandler: FrameHandler;
  time: number;
  frameCount: number;
  sounds: SceneSound[];

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
    this.frameHandler = config.frameHandler ?? (async () => {});
    this.time = 0;
    this.frameCount = 0;
    this.sounds = [];
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
      parts.push(`${cls}:${npts}:${fam.length}:${geom}:${a?.runTime ?? ""}`);
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

  add(...mobs: (Mobject | Mobject[])[]): this {
    for (const m of mobs.flat()) {
      if (m && !this.mobjects.includes(m)) this.mobjects.push(m);
    }
    return this;
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
    if (animations.length && animations[animations.length - 1] && animations[animations.length - 1]._playConfig) {
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
    // A wait's content depends on the visible mobjects + duration; include a
    // point-count fingerprint so a changed scene invalidates the cached hold.
    const fp = this.mobjects.map((m: any) =>
      `${m?.constructor?.name ?? "m"}:${Array.isArray(m?.points) ? m.points.length : 0}`).join(",");
    const hash = this.hashAnimations([{ constructor: { name: "Wait" }, runTime: duration, mobject: { points: [], submobjects: [] } }], `wait:${duration}:${fp}`);
    const directive = this.onSegment?.({ index: playIndex, kind: "wait", hash, startFrame });
    const skip = !!directive?.skip;

    this.log("wait", `wait: ${duration}s`, { index: playIndex, duration, nFrames, startFrame });

    for (let f = 0; f < nFrames; f++) {
      this.updateMobjects(dt);
      this.time += dt;
      if (skip) this.frameCount++;
      else await this.emitFrame();
    }
    this.playRecords.push({ index: playIndex, kind: "wait", hash, startFrame, endFrame: this.frameCount });
    return this;
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

/** FNV-1a 32-bit hash, returned as an 8-char hex string. Deterministic + fast. */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
