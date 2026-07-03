// layout.ts — verified layout helpers for ecmanim scene authoring.
// Every constant/function here is checked against ecmanim's actual source
// and runtime behavior, not assumed — see ../SKILL.md for the failure modes
// this exists to prevent. Copy this file into a project's scene directory
// and import from it rather than re-deriving these formulas per scene.

import { Axes, Text, DecimalNumber, estimateTextSize } from "ecmanim/node";

// Re-exported for convenience: a fast, approximate size without constructing
// a mobject — the exact formula RasterText/Text use internally to size
// themselves before real glyph layout is available (verified: this is now a
// real exported library function, not a hand-maintained duplicate of a
// private constant). Prefer textWidth()/textHeight() below (measured ground
// truth) for anything close to the safe-zone budget; reach for this when you
// need a size estimate in a hot path without paying for a real mobject.
export { estimateTextSize };

// --- Frame geometry (src/core/constants.ts) --------------------------------
// World coordinates run from -FRAME_X_RADIUS to +FRAME_X_RADIUS (x) and
// -FRAME_Y_RADIUS to +FRAME_Y_RADIUS (y); anything beyond those bounds is
// clipped or invisible, regardless of quality preset (they scale pixel
// dimensions, not the world coordinate system).
export const FRAME_WIDTH = 14.222222222222221; // 8 * (16 / 9)
export const FRAME_HEIGHT = 8.0;
export const FRAME_X_RADIUS = FRAME_WIDTH / 2; // 7.111...
export const FRAME_Y_RADIUS = FRAME_HEIGHT / 2; // 4.0

// A safe-zone gutter to keep content clear of the true frame edge — tune per
// scene, 0.3-0.4 is a reasonable default for captions/readouts near an edge.
export const GUTTER = 0.35;
export const SAFE_X_RADIUS = FRAME_X_RADIUS - GUTTER;
export const SAFE_Y_RADIUS = FRAME_Y_RADIUS - GUTTER;

// --- Measured text size (ground truth, not an estimate) --------------------
// Text/MarkupText/Paragraph all expose .getWidth()/.getHeight() on the real,
// laid-out mobject. Prefer this over hand-deriving a width from font size
// and character count whenever a caption's estimated width is close to the
// safe-zone budget — a fast approximation can be wrong right where it
// matters most, right at the boundary.
export function textWidth(text: string, opts: { fontSize?: number } = {}): number {
  return new Text(text, { fontSize: opts.fontSize ?? 1 }).getWidth();
}
export function textHeight(text: string, opts: { fontSize?: number } = {}): number {
  return new Text(text, { fontSize: opts.fontSize ?? 1 }).getHeight();
}

// Throws (rather than silently rendering a clip) if a piece of content,
// given its center point and measured width/height, would cross the safe
// zone. Call this before rendering, not after — it's a calculation, not a
// look at the output.
export function assertClear(
  label: string,
  point: [number, number, number],
  width: number,
  height: number,
): void {
  const [x, y] = point;
  const left = x - width / 2, right = x + width / 2;
  const bottom = y - height / 2, top = y + height / 2;
  const problems: string[] = [];
  if (left < -SAFE_X_RADIUS) problems.push(`left edge ${left.toFixed(2)} < -${SAFE_X_RADIUS.toFixed(2)}`);
  if (right > SAFE_X_RADIUS) problems.push(`right edge ${right.toFixed(2)} > ${SAFE_X_RADIUS.toFixed(2)}`);
  if (bottom < -SAFE_Y_RADIUS) problems.push(`bottom edge ${bottom.toFixed(2)} < -${SAFE_Y_RADIUS.toFixed(2)}`);
  if (top > SAFE_Y_RADIUS) problems.push(`top edge ${top.toFixed(2)} > ${SAFE_Y_RADIUS.toFixed(2)}`);
  if (problems.length) throw new Error(`assertClear("${label}"): ${problems.join("; ")}`);
}

// A different check from assertClear: horizontal clearance between two
// elements (e.g. a label block and a curve's right endpoint), rather than
// one element against the frame boundary. Throws instead of silently
// rendering an overlap.
export function assertGap(label: string, leftBlockEdge: number, rightObstacleEdge: number, minGap = 0.3): void {
  const gap = leftBlockEdge - rightObstacleEdge;
  if (gap < minGap) {
    throw new Error(
      `assertGap("${label}"): left edge ${leftBlockEdge.toFixed(2)} is only ${gap.toFixed(2)} clear ` +
      `of the obstacle at ${rightObstacleEdge.toFixed(2)} (need >= ${minGap}).`,
    );
  }
}

// --- Axes centering ----------------------------------------------------
// Axes always maps data value 0 to world [0,0,0] on each axis, regardless of
// xRange/yRange (verified across [0,70], [10,20], [-4,4], [-70,0]-style
// ranges) — so an axes box whose range doesn't straddle zero renders
// off-center in the frame unless explicitly re-centered. With no `targets`,
// solves the shift that puts the axes box's own midpoint at the world
// origin:
//
//   const ax = new Axes({ xRange: [0, 70, 10], yRange: [0, 8, 1], ... });
//   ax.shift(solveAxesShift(ax));
//
// Pass `targets` to place a specific edge at an exact world-space margin
// instead (e.g. pin the left edge so a caption has guaranteed room to its
// left) — only the sides given are constrained; the other axis is
// untouched. `left`/`right` are mutually exclusive (same for `bottom`/`top`);
// if both are given for an axis, `left`/`bottom` wins.
//
//   ax.shift(solveAxesShift(ax, { left: -6, bottom: -3 }));
//
// Derives from the axes instance's own `c2p()` (ground truth) rather than
// recomputing the unit/scale math independently, so it can't drift out of
// sync if that math ever changes.
export interface AxesMarginTargets {
  left?: number;
  right?: number;
  bottom?: number;
  top?: number;
}
export function solveAxesShift(axes: Axes, targets?: AxesMarginTargets): [number, number, number] {
  const c1 = axes.c2p(axes.xRange[0], axes.yRange[0]);
  const c2 = axes.c2p(axes.xRange[1], axes.yRange[1]);
  if (!targets) return [-(c1[0] + c2[0]) / 2, -(c1[1] + c2[1]) / 2, 0];
  const left = Math.min(c1[0], c2[0]), right = Math.max(c1[0], c2[0]);
  const bottom = Math.min(c1[1], c2[1]), top = Math.max(c1[1], c2[1]);
  let shiftX = 0, shiftY = 0;
  if (targets.left !== undefined) shiftX = targets.left - left;
  else if (targets.right !== undefined) shiftX = targets.right - right;
  if (targets.bottom !== undefined) shiftY = targets.bottom - bottom;
  else if (targets.top !== undefined) shiftY = targets.top - top;
  return [shiftX, shiftY, 0];
}

// --- A right-anchored multi-row readout (a common "stat block" layout) -----
// N right-aligned rows of text stacked vertically below `topRight`, each
// row's width measured (not estimated) so nothing overhangs the anchor edge.
export function buildReadout(
  rows: string[],
  opts: { topRight: [number, number, number]; fontSize?: number; color?: string; lineGap?: number },
): Text[] {
  const fontSize = opts.fontSize ?? 0.4;
  const lineGap = opts.lineGap ?? fontSize * 1.4;
  return rows.map((row, i) => {
    const y = opts.topRight[1] - i * lineGap;
    const t = new Text(row, { fontSize, color: opts.color, point: [0, y, 0] });
    t.moveTo([opts.topRight[0] - t.getWidth() / 2, y, 0]);
    return t;
  });
}

// --- A live-updating label + value "stat block" (e.g. "people: 5", where 5
// changes every frame) -----------------------------------------------------
// A DecimalNumber's own width changes as its digit count changes ("5" vs
// "500000"), so without something to anchor it, its position drifts on every
// setValue() -- which can visibly jitter a readout or, worse, change how
// close it sits to a frame edge over time. DecimalNumber's built-in
// `edgeToFix` option (verified against src/mobject/value_tracker.ts) solves
// this directly: it re-anchors the *given* edge to its current position on
// every update, so pin the right edge once at construction and the value
// column's right edge never moves again, however many digits it grows to.
// Each row's label is positioned to the left of its (own-width, edgeToFix-
// pinned) value, with a gap, so it can never collide with the value even as
// the value's width changes.
export interface StatRow {
  label: string;
  initialValue: number;
  decimalPlaces: number;
  color?: string;
}
export function buildStatBlock(
  rows: StatRow[],
  opts: { topRight: [number, number, number]; fontSize?: number; color?: string; lineGap?: number; gap?: number },
): Array<{ label: Text; value: InstanceType<typeof DecimalNumber> }> {
  const fontSize = opts.fontSize ?? 0.4;
  const lineGap = opts.lineGap ?? fontSize * 1.4;
  const gap = opts.gap ?? 0.3;
  return rows.map((row, i) => {
    const y = opts.topRight[1] - i * lineGap;
    const color = row.color ?? opts.color;
    const value = new DecimalNumber(row.initialValue, {
      numDecimalPlaces: row.decimalPlaces, color, fontSize,
      point: [opts.topRight[0], y, 0], edgeToFix: [1, 0, 0],
    });
    value.moveTo([opts.topRight[0] - value.getWidth() / 2, y, 0]);
    const label = new Text(row.label, { fontSize, color, point: [0, y, 0] });
    label.moveTo([opts.topRight[0] - value.getWidth() - gap - label.getWidth() / 2, y, 0]);
    return { label, value };
  });
}
