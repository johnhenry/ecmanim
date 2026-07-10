// A video clip placed in the scene: an ImageMobject whose displayed bitmap is
// swapped, per scene frame, to the source clip's frame for the current time.
//
// The decode is backend-specific and hidden behind VideoFrameProvider: the Node
// backend builds a provider backed by an ffmpeg frame-extraction cache; the
// browser backend builds one backed by <video> / WebCodecs. This module (and
// thus VideoMobject) is isomorphic and depends only on the provider interface.
//
// The provider's frameAt() is SYNCHRONOUS — providers do all their decoding up
// front in the async `loadVideo()` factory, so that per-frame lookup inside the
// updater is a cheap, deterministic array/index access.

import { ImageMobject } from "./image_mobject.ts";
import type { ImageMobjectConfig } from "./image_mobject.ts";
import type { Chapter } from "../metadata.ts";

/** A backend-agnostic source of decoded video frames. */
export interface VideoFrameProvider {
  /** Clip duration in seconds. */
  readonly duration: number;
  /** Intrinsic frame width in pixels. */
  readonly width: number;
  /** Intrinsic frame height in pixels. */
  readonly height: number;
  /** The fps the provider's frames are indexed at (usually the scene fps). */
  readonly fps: number;
  /**
   * Return a drawable bitmap (an @napi-rs/canvas Image in Node; an ImageBitmap /
   * HTMLCanvasElement / HTMLVideoElement in the browser) for the given SOURCE
   * time in seconds. Implementations clamp `timeSeconds` to [0, duration].
   * Must be synchronous; may return null if no frame is available yet.
   */
  frameAt(timeSeconds: number): any;
  /** Release any held resources (decoded frames, video element, …). */
  dispose?(): void;
}

export interface VideoMobjectConfig extends ImageMobjectConfig {
  /** Source in-point in seconds (default 0). */
  start?: number;
  /** Source out-point in seconds (default = provider.duration). */
  end?: number;
  /** Playback speed multiplier (default 1). */
  playbackRate?: number;
  /** Loop the [start, end) span instead of holding the last frame (default false). */
  loop?: boolean;
  /** Start paused (no auto-advance) until play() is called (default false). */
  paused?: boolean;
  /** Chapters/segments (seconds) — e.g. populated from an ingested IIIF manifest. */
  chapters?: Chapter[];
}

export class VideoMobject extends ImageMobject {
  _isVideo = true;
  provider: VideoFrameProvider;
  start: number;
  end: number;
  playbackRate: number;
  loop: boolean;
  paused: boolean;
  /** Chapters/segments (seconds), if known (e.g. from an ingested IIIF manifest). */
  chapters: Chapter[];
  // Scene seconds of playback consumed so far (advanced by the updater's dt).
  _elapsed = 0;

  constructor(provider: VideoFrameProvider, config: VideoMobjectConfig = {}) {
    const start = config.start ?? 0;
    // Seed the ImageMobject with the first frame and the clip's intrinsic size
    // (so aspect/scaling behave exactly like a still ImageMobject).
    const first = provider.frameAt(start);
    super(first, { imageWidth: provider.width, imageHeight: provider.height, ...config });
    this.provider = provider;
    this.start = start;
    this.end = config.end ?? provider.duration;
    this.playbackRate = config.playbackRate ?? 1;
    this.loop = config.loop ?? false;
    this.paused = config.paused ?? false;
    this.chapters = config.chapters ?? [];

    // Drive frames from scene time. Updaters receive dt (verified), which we
    // accumulate — deterministic because dt is fixed per fps, so this composes
    // with the partial-movie cache and parallel rendering.
    this.addUpdater((_m, dt) => { if (!this.paused) this.advance(dt); });
  }

  /** Advance playback by `dt` scene seconds and swap to the matching frame. */
  advance(dt: number): this {
    this._elapsed += dt * this.playbackRate;
    const frame = this.provider.frameAt(this.sourceTime());
    if (frame) this.setImage(frame);
    return this;
  }

  /** The source time (seconds) currently shown, honoring start/end/loop. */
  sourceTime(): number {
    const span = Math.max(1e-6, this.end - this.start);
    let t = this._elapsed;
    t = this.loop ? ((t % span) + span) % span : Math.min(Math.max(0, t), span);
    return this.start + t;
  }

  /** Jump to `sceneSeconds` of playback (0 = the in-point) and show that frame. */
  seekTo(sceneSeconds: number): this {
    this._elapsed = Math.max(0, sceneSeconds);
    const frame = this.provider.frameAt(this.sourceTime());
    if (frame) this.setImage(frame);
    return this;
  }

  play(): this { this.paused = false; return this; }
  pause(): this { this.paused = true; return this; }

  /** Jump playback to `t` seconds into the clip (clip-relative, before
   *  start/end trimming is applied) and show that frame immediately. */
  seek(t: number): this {
    this._elapsed = t;
    const frame = this.provider.frameAt(this.sourceTime());
    if (frame) this.setImage(frame);
    return this;
  }

  /** Total playing duration of the selected span at the current rate (seconds). */
  get playDuration(): number {
    return Math.max(0, (this.end - this.start)) / (this.playbackRate || 1);
  }

  dispose(): void { this.provider.dispose?.(); }

  copy(): this {
    const c = super.copy();
    (c as any).provider = this.provider; // share the (already-decoded) provider
    return c;
  }
}
