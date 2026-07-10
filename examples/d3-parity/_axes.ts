// Shared D3-style axis rendering for the parity ports: thin wrappers that
// draw d3-axis-shaped ticks/labels/domain lines from a scale + an SvgFrame.
// Kept scene-side (not library) deliberately — axis LOOK is a per-chart
// decision in d3, and ports read closer to the refs with these helpers
// mirroring axisLeft/axisBottom.

import { Group, Line, Text } from "../../src/node.ts";
import type { SvgFrame } from "./_run.ts";

const AXIS_COLOR = "#000000";
const TICK_LEN = 6;

export interface AxisOptions {
  /** d3 tickFormat-style formatter. Return "" to draw the tick mark but
   *  skip its label (d3's sparse log-axis labeling). */
  format?: (v: any) => string;
  tickCount?: number;
  /** Extend gridlines across the plot area (x1 to x2 SVG px). */
  gridX?: [number, number];
  /** axisBottom: extend vertical gridlines across the plot (y1 to y2 SVG px). */
  gridY?: [number, number];
  label?: string;
  fontSize?: number;
  color?: string;
  /** axisBottom: hide the domain line (d3's `.select(".domain").remove()`). */
  noDomain?: boolean;
}

/** axisLeft(scale) at SVG x position `x0`. Works with any scale exposing
 *  ticks()/(). Returns a Group of tick lines, labels, and optional grid. */
export function axisLeft(scale: any, x0: number, f: SvgFrame, opts: AxisOptions = {}): Group {
  const g = new Group();
  const color = opts.color ?? AXIS_COLOR;
  const fontSize = f.len(opts.fontSize ?? 11);
  const ticks: any[] = scale.ticks ? scale.ticks(opts.tickCount ?? 10) : scale.domain();
  const fmt = opts.format ?? ((v: any) => String(v));
  for (const t of ticks) {
    const y = scale(t);
    g.add(new Line({ start: f.pt(x0 - TICK_LEN, y), end: f.pt(x0, y), strokeColor: color, strokeWidth: f.sw(1) }));
    if (opts.gridX) {
      g.add(new Line({
        start: f.pt(opts.gridX[0], y), end: f.pt(opts.gridX[1], y),
        strokeColor: color, strokeWidth: f.sw(0.5), strokeOpacity: 0.12,
      }));
    }
    const text = fmt(t);
    if (text !== "") {
      const label = new Text(text, { fontSize, color });
      label.moveTo(f.pt(x0 - TICK_LEN - 4, y));
      label.shift([-label.getWidth() / 2, 0, 0]);
      g.add(label);
    }
  }
  if (opts.label) {
    // Top-left corner, clear of the plot area (d3 convention).
    const lab = new Text(opts.label, { fontSize, color });
    const top = Math.min(...ticks.map((t: any) => scale(t)));
    lab.moveTo(f.pt(x0 - TICK_LEN - 24, top - 22));
    lab.shift([lab.getWidth() / 2, 0, 0]);
    g.add(lab);
  }
  return g;
}

/** axisBottom(scale) at SVG y position `y0`. Band scales label at band
 *  centers; continuous scales at tick values. */
export function axisBottom(scale: any, y0: number, f: SvgFrame, opts: AxisOptions = {}): Group {
  const g = new Group();
  const color = opts.color ?? AXIS_COLOR;
  const fontSize = f.len(opts.fontSize ?? 11);
  const fmt = opts.format ?? ((v: any) => String(v));
  const isBand = typeof scale.bandwidth === "function";
  const ticks: any[] = scale.ticks ? scale.ticks(opts.tickCount ?? 10) : scale.domain();
  const [r0, r1] = typeof scale.range === "function" ? scale.range() : [0, 0];
  if (!opts.noDomain) {
    g.add(new Line({ start: f.pt(r0, y0), end: f.pt(r1, y0), strokeColor: color, strokeWidth: f.sw(1) }));
  }
  for (const t of ticks) {
    const x = scale(t) + (isBand ? scale.bandwidth() / 2 : 0);
    if (Number.isNaN(x)) continue;
    g.add(new Line({ start: f.pt(x, y0), end: f.pt(x, y0 + TICK_LEN), strokeColor: color, strokeWidth: f.sw(1) }));
    if (opts.gridY) {
      g.add(new Line({
        start: f.pt(x, opts.gridY[0]), end: f.pt(x, opts.gridY[1]),
        strokeColor: color, strokeWidth: f.sw(0.5), strokeOpacity: 0.12,
      }));
    }
    const text = fmt(t);
    if (text !== "") {
      const label = new Text(text, { fontSize, color });
      label.moveTo(f.pt(x, y0 + TICK_LEN + 10));
      g.add(label);
    }
  }
  if (opts.label) {
    // Right-aligned under the axis' right end (d3 convention for x labels).
    const lab = new Text(opts.label, { fontSize, color });
    lab.moveTo(f.pt(Math.max(r0, r1), y0 + TICK_LEN + 22));
    lab.shift([-lab.getWidth() / 2, 0, 0]);
    g.add(lab);
  }
  return g;
}
