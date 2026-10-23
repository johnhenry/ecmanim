// Probability / statistics mobjects: BarChart and SampleSpace.
// Ports of ManimCommunity manim/mobject/graphing/probability.py.
//
// BarChart extends Axes and draws one Rectangle bar per value, positioned on
// the axes. SampleSpace extends Rectangle and can be subdivided horizontally or
// vertically into proportioned sub-rectangles (a unit square of probability).

import { VMobject, VGroup } from "./VMobject.ts";
import * as V from "../core/math/vector.ts";
import { Rectangle, Line } from "./geometry.ts";
import { Axes } from "./coordinate_systems.ts";
import type { AxesConfig } from "./coordinate_systems.ts";
import { Text } from "./text/Text.ts";
import { Brace } from "./brace.ts";
import { Color, BLUE, GREEN, RED, YELLOW, WHITE } from "../core/color.ts";
import type { ColorLike, Vec3 } from "../core/types.ts";

const DEFAULT_BAR_COLORS: ColorLike[] = [BLUE, YELLOW, RED, GREEN];

export interface BarChartConfig extends AxesConfig {
  barNames?: string[];
  yRange?: number[];
  xLength?: number;
  yLength?: number;
  barColors?: ColorLike[];
  barWidthRatio?: number;
  barFillOpacity?: number;
  barStrokeWidth?: number;
  [key: string]: any;
}

export class BarChart extends Axes {
  values: number[];
  barNames: string[];
  barColors: ColorLike[];
  barWidthRatio: number;
  barFillOpacity: number;
  barStrokeWidth: number;
  bars!: VGroup;

  constructor(values: number[], config: BarChartConfig = {}) {
    const nBars = values.length;
    const barNames = config.barNames ?? [];
    // Default y range spans 0..max(values), with a sensible step.
    const maxVal = values.length ? Math.max(...values, 0) : 1;
    const yRange = config.yRange ?? [0, maxVal, Math.max(1, Math.ceil(maxVal / 5))];
    // The x-axis holds the bars: one unit per bar, indexed 0..nBars.
    const xRange = [0, nBars, 1];
    const xLength = config.xLength ?? Math.max(1, nBars);
    const yLength = config.yLength ?? 6;

    // CE BarChart passes tips=False; keep tip-less axes unless asked.
    super({
      tips: false,
      ...config,
      xRange,
      yRange,
      xLength,
      yLength,
    });

    this.values = [...values];
    this.barNames = barNames;
    this.barColors = config.barColors ?? DEFAULT_BAR_COLORS;
    this.barWidthRatio = config.barWidthRatio ?? 0.6;
    this.barFillOpacity = config.barFillOpacity ?? 0.7;
    this.barStrokeWidth = config.barStrokeWidth ?? 3;

    this._addBars(this.values);
  }

  // World width (per unit x) for one bar slot.
  private _unitWidth(): number {
    return this.xAxis.unit;
  }

  private _colorFor(index: number): ColorLike {
    const colors = this.barColors;
    if (!colors.length) return WHITE;
    return colors[index % colors.length];
  }

  private _addBars(values: number[]): void {
    this.bars = new VGroup();
    const slot = this._unitWidth();
    const barWidth = slot * this.barWidthRatio;

    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      // Base sits on y=0, top at y=value. Center x at the middle of slot i.
      const xCenter = i + 0.5;
      const base = this.coordsToPoint(xCenter, 0);
      const top = this.coordsToPoint(xCenter, value);
      const height = Math.abs(top[1] - base[1]);
      const color = this._colorFor(i);

      const bar = new Rectangle({
        width: barWidth,
        height: height <= 0 ? 1e-6 : height,
        fillColor: color,
        fillOpacity: this.barFillOpacity,
        strokeColor: color,
        strokeWidth: this.barStrokeWidth,
      });
      // Position: horizontally centered on the slot, resting on the axis.
      const cy = (base[1] + top[1]) / 2;
      bar.moveTo([base[0], cy, 0]);
      (bar as any).barValue = value;
      this.bars.add(bar);
    }
    this.add(this.bars);
  }

  getBars(): VGroup {
    return this.bars;
  }

  // Labels drawn under each bar (using barNames, if given).
  getBarLabels(config: { fontSize?: number; color?: ColorLike; buff?: number } = {}): VGroup {
    const fontSize = config.fontSize ?? 0.3;
    const color = config.color ?? WHITE;
    const buff = config.buff ?? 0.25;
    const labels = new VGroup();
    for (let i = 0; i < this.bars.submobjects.length; i++) {
      const name = this.barNames[i] ?? String(i);
      const bar = this.bars.submobjects[i];
      const label = new Text(name, { fontSize, color });
      // Place below the bar's base (on the x-axis).
      const base = this.coordsToPoint(i + 0.5, 0);
      label.moveTo([base[0], base[1] - buff, 0]);
      labels.add(label);
    }
    return labels;
  }

  // Rebuild the bars in-place from a new set of values, preserving the axes.
  changeBarValues(values: number[]): this {
    this.values = [...values];
    // Remove old bars from submobjects.
    const idx = this.submobjects.indexOf(this.bars);
    if (idx !== -1) this.submobjects.splice(idx, 1);
    this._addBars(this.values);
    return this;
  }
}

export interface SampleSpaceConfig {
  height?: number;
  width?: number;
  fillColor?: ColorLike;
  fillOpacity?: number;
  strokeWidth?: number;
  strokeColor?: ColorLike;
  [key: string]: any;
}

export interface SampleSpaceDivideConfig {
  colors?: ColorLike[];
  vect?: number[];
  strokeWidth?: number;
  [key: string]: any;
}

export class SampleSpace extends Rectangle {
  horizontalParts?: VGroup;
  verticalParts?: VGroup;
  title?: Text;
  labels?: VGroup;

  constructor(config: SampleSpaceConfig = {}) {
    super({
      height: config.height ?? 3,
      width: config.width ?? 3,
      fillColor: config.fillColor ?? (BLUE as ColorLike),
      fillOpacity: config.fillOpacity ?? 1,
      strokeWidth: config.strokeWidth ?? 0.5,
      strokeColor: config.strokeColor ?? WHITE,
    });
  }

  private _defaultColors(n: number): ColorLike[] {
    const stops: ColorLike[] = [GREEN, BLUE, YELLOW, RED];
    const out: ColorLike[] = [];
    for (let i = 0; i < n; i++) {
      const t = n <= 1 ? 0 : i / (n - 1);
      const scaled = t * (stops.length - 1);
      const lo = Math.floor(scaled);
      const hi = Math.min(stops.length - 1, lo + 1);
      out.push(Color.lerp(stops[lo], stops[hi], scaled - lo).toHex());
    }
    return out;
  }

  // Build proportioned sub-rectangles along a given axis. `vect` points along
  // the direction the parts stack (default DOWN for horizontal divisions,
  // meaning the parts stack vertically producing horizontal cut lines).
  private _getSubdivision(pList: number[], vect: number[], colors?: ColorLike[]): VGroup {
    const parts = new VGroup();
    const total = pList.reduce((a, b) => a + b, 0) || 1;
    const cols = colors ?? this._defaultColors(pList.length);

    const fullWidth = this.getWidth();
    const fullHeight = this.getHeight();
    // Determine which dimension is being split by the vect direction.
    const splitVertical = Math.abs(vect[1]) >= Math.abs(vect[0]);

    // Start at the appropriate corner (top for downward stacking, left for
    // rightward stacking).
    let cursor: Vec3;
    if (splitVertical) {
      cursor = V.clone(this.getTop());
    } else {
      cursor = V.clone(this.getLeft());
    }
    const sign = splitVertical ? -1 : 1; // downward or rightward
    let offset = 0;

    for (let i = 0; i < pList.length; i++) {
      const frac = pList[i] / total;
      const color = cols[i % cols.length];
      let w: number, h: number;
      if (splitVertical) {
        w = fullWidth;
        h = fullHeight * frac;
      } else {
        w = fullWidth * frac;
        h = fullHeight;
      }
      const part = new Rectangle({
        width: w <= 0 ? 1e-6 : w,
        height: h <= 0 ? 1e-6 : h,
        fillColor: color,
        fillOpacity: this.fillOpacity,
        strokeColor: this.strokeColor.toHex(),
        strokeWidth: this.strokeWidth,
      });
      if (splitVertical) {
        const cy = cursor[1] + sign * (offset + h / 2);
        part.moveTo([this.getCenter()[0], cy, 0]);
        offset += h;
      } else {
        const cx = cursor[0] + sign * (offset + w / 2);
        part.moveTo([cx, this.getCenter()[1], 0]);
        offset += w;
      }
      parts.add(part);
    }
    return parts;
  }

  divideHorizontally(pList: number[], config: SampleSpaceDivideConfig = {}): VGroup {
    // Horizontal division = horizontal cut lines = parts stacked vertically.
    const parts = this._getSubdivision(pList, config.vect ?? V.DOWN, config.colors);
    this.horizontalParts = parts;
    this.add(parts);
    return parts;
  }

  divideVertically(pList: number[], config: SampleSpaceDivideConfig = {}): VGroup {
    // Vertical division = vertical cut lines = parts stacked horizontally.
    const parts = this._getSubdivision(pList, config.vect ?? V.RIGHT, config.colors);
    this.verticalParts = parts;
    this.add(parts);
    return parts;
  }

  // Braces spanning each subdivision along the given direction.
  getSubdivisionBraces(
    parts: VGroup,
    direction: number[] = V.LEFT,
    config: { buff?: number } = {},
  ): VGroup {
    const braces = new VGroup();
    for (const part of parts.submobjects) {
      const brace = new Brace(part as any, { direction, buff: config.buff ?? 0.1 });
      braces.add(brace);
    }
    return braces;
  }

  addTitle(title: string, scaleFactor = 1): Text {
    const t = new Text(title, { fontSize: 0.4 * scaleFactor });
    t.moveTo([this.getCenter()[0], this.getTop()[1] + 0.3, 0]);
    this.title = t;
    this.add(t);
    return t;
  }

  addLabel(label: Text | string, position: number[] = V.LEFT, buff = 0.25): Text {
    const t = typeof label === "string" ? new Text(label, { fontSize: 0.35 }) : label;
    const anchor = this.getBoundaryPoint(position);
    t.moveTo(V.add(anchor, V.scale(V.normalize(position), buff)));
    if (!this.labels) this.labels = new VGroup();
    this.labels.add(t);
    this.add(t);
    return t;
  }
}
