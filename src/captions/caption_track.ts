// A caption overlay mobject: shows the active caption for the current scene time,
// with optional karaoke-style left-to-right reveal. Reuses RasterText's existing
// `revealFraction` (the same field drawText uses for typewriter clipping). The
// updater accumulates dt, so it stays in sync through play()/wait().

import { RasterText } from "../mobject/text/Text.ts";
import { captionAt } from "./captions.ts";
import type { Caption } from "./captions.ts";

export interface CaptionTrackConfig {
  fontSize?: number;
  color?: string;
  point?: number[];
  align?: "left" | "center" | "right";
  /** Reveal the active caption progressively (default false = show whole). */
  karaoke?: boolean;
  /** Start time offset in ms (default 0). */
  offsetMs?: number;
}

export class CaptionTrack extends RasterText {
  captions: Caption[];
  karaoke: boolean;
  private _elapsedMs: number;

  constructor(captions: Caption[], config: CaptionTrackConfig = {}) {
    super("", {
      fontSize: config.fontSize ?? 0.45,
      color: config.color ?? "#FFFFFF",
      align: config.align ?? "center",
      point: config.point ?? [0, -3, 0],
    });
    this.captions = captions;
    this.karaoke = config.karaoke ?? false;
    this._elapsedMs = config.offsetMs ?? 0;
    this.addUpdater((_m: any, dt: number) => this._tick(dt));
    this._render(); // initial frame
  }

  private _tick(dt: number): void {
    this._elapsedMs += dt * 1000;
    this._render();
  }

  private _render(): void {
    const c = captionAt(this.captions, this._elapsedMs);
    this.text = c ? c.text : "";
    if (this.karaoke && c) {
      const span = Math.max(1, c.endMs - c.startMs);
      this.revealFraction = Math.max(0, Math.min(1, (this._elapsedMs - c.startMs) / span));
    } else {
      this.revealFraction = 1;
    }
  }

  /** Jump the caption clock to `ms` (e.g. when seeking). */
  seekMs(ms: number): this {
    this._elapsedMs = ms;
    this._render();
    return this;
  }
}
