// Shared time/frame<->pixel mapping, plus independent render functions per
// data source (renderSectionOverview now; renderWaveform/
// renderKeyframeTimeline land in later phases). These share only the layout
// math, NOT a data model -- a section, a waveform sample, and a keyframe are
// different shapes. Each render function has a DOM-free "compute layout"
// half that's independently unit-testable without a canvas.

export interface FrameAxisOptions {
  totalFrames: number;
  pixelWidth: number;
}

export function frameToPixel(frame: number, opts: FrameAxisOptions): number {
  if (opts.totalFrames <= 0) return 0;
  return (frame / opts.totalFrames) * opts.pixelWidth;
}

export function pixelToFrame(px: number, opts: FrameAxisOptions): number {
  if (opts.pixelWidth <= 0) return 0;
  return (px / opts.pixelWidth) * opts.totalFrames;
}

export interface TimeAxisOptions {
  duration: number; // seconds
  pixelWidth: number;
}

export function timeToPixel(t: number, opts: TimeAxisOptions): number {
  if (opts.duration <= 0) return 0;
  return (t / opts.duration) * opts.pixelWidth;
}

export function pixelToTime(px: number, opts: TimeAxisOptions): number {
  if (opts.pixelWidth <= 0) return 0;
  return (px / opts.pixelWidth) * opts.duration;
}

// --- section overview (item 4) ---------------------------------------------

export interface SectionThumbnailLayout {
  section: any;
  x: number;
  width: number;
}

/**
 * Pure layout: one thumbnail slot per section, sized proportionally to the
 * section's own share of the timeline, clamped to `minWidth` so short
 * sections stay clickable/visible. An open section (endFrame < 0, i.e. the
 * live/last one before finalizeSections() runs) extends to totalFrames.
 */
export function computeSectionThumbnails(
  sections: any[],
  opts: FrameAxisOptions & { minWidth?: number },
): SectionThumbnailLayout[] {
  const minWidth = opts.minWidth ?? 24;
  return sections.map((section) => {
    const endFrame = section.endFrame < 0 ? opts.totalFrames : section.endFrame;
    const x = frameToPixel(section.startFrame, opts);
    const rawWidth = Math.max(0, frameToPixel(endFrame, opts) - x);
    return { section, x, width: Math.max(minWidth, rawWidth) };
  });
}

/**
 * Draws one thumbnail per section along a strip, each showing that
 * section's first frame (via Player.drawFrameTo(), already "nearly free"
 * since frames are rasterized bitmaps) at its computed layout position.
 */
export function renderSectionOverview(
  ctx: any,
  player: { sections(): any[]; frameCount: number; drawFrameTo: (ctx: any, frameIndex: number, opts?: any) => void },
  opts: { pixelWidth: number; height: number; minWidth?: number },
): SectionThumbnailLayout[] {
  const layout = computeSectionThumbnails(player.sections(), {
    totalFrames: player.frameCount,
    pixelWidth: opts.pixelWidth,
    minWidth: opts.minWidth,
  });
  for (const { section, x, width } of layout) {
    player.drawFrameTo(ctx, section.startFrame, { x, y: 0, width, height: opts.height });
  }
  return layout;
}

// --- step markers (item 2 UI) -----------------------------------------------

export interface StepMarkerLayout {
  step: any;
  x: number;
}

/** Pure layout: one tick mark per playRecord (step), at its start frame. */
export function computeStepMarkers(steps: any[], opts: FrameAxisOptions): StepMarkerLayout[] {
  return steps.map((step) => ({ step, x: frameToPixel(step.startFrame, opts) }));
}

// --- waveform (item 6) -------------------------------------------------------
// Audio decoding/downsampling is NOT reimplemented here -- getAudioData()/
// getWaveformPortion() (src/audio/analyze.ts) already do that (both Node
// ffmpeg and browser AudioContext backends). This is purely the bar-layout
// half: turn downsampled peak-amplitude samples into screen-space bars.

export interface WaveformBar {
  x: number;
  height: number;
}

/** Pure layout: one bar per sample, evenly spaced, height proportional to
 *  the sample's peak amplitude (expected in [-1, 1], e.g. from
 *  getWaveformPortion()). */
export function computeWaveformBars(
  samples: number[],
  opts: { pixelWidth: number; maxHeight: number },
): WaveformBar[] {
  const n = samples.length;
  if (n === 0) return [];
  const barWidth = opts.pixelWidth / n;
  return samples.map((amp, i) => ({
    x: i * barWidth,
    height: Math.min(opts.maxHeight, Math.abs(amp) * opts.maxHeight),
  }));
}

/** Draws vertically-centered bars for one sound's waveform onto `ctx`,
 *  positioned at `opts.x`/`opts.y` (e.g. timeToPixel(sound.time, ...) for a
 *  sound scheduled partway through the scene). */
export function renderWaveform(
  ctx: any,
  samples: number[],
  opts: { pixelWidth: number; height: number; x?: number; y?: number; color?: string },
): WaveformBar[] {
  const bars = computeWaveformBars(samples, { pixelWidth: opts.pixelWidth, maxHeight: opts.height });
  const barWidth = bars.length ? opts.pixelWidth / bars.length : 0;
  const originX = opts.x ?? 0;
  const centerY = (opts.y ?? 0) + opts.height / 2;
  if (ctx) {
    ctx.fillStyle = opts.color ?? "#4fd1c5";
    for (const bar of bars) {
      ctx.fillRect(originX + bar.x, centerY - bar.height / 2, Math.max(1, barWidth - 1), Math.max(1, bar.height));
    }
  }
  return bars;
}
