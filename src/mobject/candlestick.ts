// Candlestick chart mobject: a category-x / price-y coordinate system with
// one OHLC candle (Rectangle body + Line wick) per data point, plus optional
// moving-average overlay lines.
//
// Follows probability.ts's BarChart precedent: an Axes SUBCLASS (not an
// axis-free VGroup like PieChart/RadarChart/GaugeChart/FunnelChart) because a
// candlestick chart genuinely needs a coordinate system to plot against --
// each candle's body top/bottom and wick low/high are prices on a numeric
// y-axis, positioned above a category (date) slot on the x-axis, exactly like
// BarChart's `coordsToPoint`-driven `Rectangle` bars. Bodies additionally get
// a thin `Line` wick spanning low->high, centered under the body.
//
// setPoints() mirrors PieChart.setValues()'s identity-preserving rebuild:
// when the candle COUNT is unchanged, existing Rectangle/Line mobjects are
// mutated in place (geometry + color rewritten) so updaters/Transforms/refs
// to `chart.candles[i]` / `chart.wicks[i]` stay valid; otherwise the lists
// are replaced wholesale.

import { VMobject, VGroup } from "./VMobject.ts";
import { Rectangle, Line } from "./geometry.ts";
import { Axes } from "./coordinate_systems.ts";
import type { AxesConfig } from "./coordinate_systems.ts";
import type { ColorLike } from "../core/types.ts";

// Defaults match examples/echarts-parity/ref/08-candlestick.js's itemStyle
// (Chinese-market convention: red = rising/bullish, green = falling/bearish).
const DEFAULT_UP_COLOR: ColorLike = "#ec0000";
const DEFAULT_DOWN_COLOR: ColorLike = "#00da3c";

export interface CandlestickPoint {
  /** X-axis category label (e.g. a date string), or a numeric index. */
  label: string | number;
  open: number;
  close: number;
  low: number;
  high: number;
}

export interface CandlestickConfig extends AxesConfig {
  /** Body/wick color for close >= open. Default '#ec0000' (ref file). */
  upColor?: ColorLike;
  /** Body/wick color for close < open. Default '#00da3c' (ref file). */
  downColor?: ColorLike;
  /** Wick color override. Default: matches each candle's body color. */
  wickColor?: ColorLike;
  /** Fraction of the per-category band width the body occupies. Default 0.6. */
  bodyWidth?: number;
  /** Body outline stroke width. Default 1. */
  strokeWidth?: number;
  /** Wick line stroke width. Default 2. */
  wickStrokeWidth?: number;
  yRange?: number[];
  xLength?: number;
  yLength?: number;
  [key: string]: any;
}

export class Candlestick extends Axes {
  // Note: named `data`, not `points` -- `Mobject.points: number[][]` is a
  // reserved base-class field (the raw bezier anchor/handle geometry), so an
  // OHLC-point array can't reuse that name.
  data: CandlestickPoint[];
  upColor: ColorLike;
  downColor: ColorLike;
  wickColor?: ColorLike;
  bodyWidth: number;
  strokeWidth: number;
  wickStrokeWidth: number;

  readonly candles: VMobject[] = [];
  readonly wicks: Line[] = [];
  private readonly _candlesGroup = new VGroup();
  private readonly _wicksGroup = new VGroup();

  constructor(points: CandlestickPoint[], config: CandlestickConfig = {}) {
    const n = points.length;
    const xRange = config.xRange ?? [0, Math.max(1, n), 1];
    const xLength = config.xLength ?? Math.max(1, n);
    const yLength = config.yLength ?? 6;

    const lows = points.map((p) => p.low);
    const highs = points.map((p) => p.high);
    const minY = points.length ? Math.min(...lows) : 0;
    const maxY = points.length ? Math.max(...highs) : 1;
    const span = maxY - minY;
    const pad = span > 0 ? span * 0.05 : 1;
    const yRange = config.yRange ?? [minY - pad, maxY + pad, Math.max(1e-9, (span + 2 * pad) / 5)];

    // CE BarChart passes tips=False; keep tip-less axes unless asked.
    super({
      tips: false,
      ...config,
      xRange,
      yRange,
      xLength,
      yLength,
    });

    this.data = points.map((p) => ({ ...p }));
    this.upColor = config.upColor ?? DEFAULT_UP_COLOR;
    this.downColor = config.downColor ?? DEFAULT_DOWN_COLOR;
    this.wickColor = config.wickColor;
    this.bodyWidth = config.bodyWidth ?? 0.6;
    this.strokeWidth = config.strokeWidth ?? 1;
    this.wickStrokeWidth = config.wickStrokeWidth ?? 2;

    this.add(this._candlesGroup, this._wicksGroup);
    this._build(this.data);
  }

  // World width (per unit x) for one category slot -- mirrors BarChart's
  // `_unitWidth`.
  private _unitWidth(): number {
    return this.xAxis.unit;
  }

  private _colorFor(p: CandlestickPoint): ColorLike {
    return p.close >= p.open ? this.upColor : this.downColor;
  }

  private _build(points: CandlestickPoint[]): void {
    const slot = this._unitWidth();
    const width = slot * this.bodyWidth;

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const xCenter = i + 0.5;
      const color = this._colorFor(p);

      const bodyTopVal = Math.max(p.open, p.close);
      const bodyBotVal = Math.min(p.open, p.close);
      const top = this.coordsToPoint(xCenter, bodyTopVal);
      const bottom = this.coordsToPoint(xCenter, bodyBotVal);
      const height = Math.abs(top[1] - bottom[1]);

      const body = new Rectangle({
        width,
        height: height <= 0 ? 1e-6 : height,
        point: [top[0], (top[1] + bottom[1]) / 2, 0],
        fillColor: color,
        fillOpacity: 1,
        strokeColor: color,
        strokeWidth: this.strokeWidth,
      });
      (body as any).candleData = p;
      this.candles.push(body);
      this._candlesGroup.add(body);

      const lowPt = this.coordsToPoint(xCenter, p.low);
      const highPt = this.coordsToPoint(xCenter, p.high);
      const wick = new Line(lowPt, highPt, {
        strokeColor: this.wickColor ?? color,
        strokeWidth: this.wickStrokeWidth,
      });
      (wick as any).candleData = p;
      this.wicks.push(wick);
      this._wicksGroup.add(wick);
    }
  }

  // Rebuild candles+wicks in place when point count is unchanged (identity
  // preserving, mirrors PieChart.setValues); otherwise replace the lists.
  setPoints(points: CandlestickPoint[]): this {
    const sameCount = points.length === this.data.length;
    this.data = points.map((p) => ({ ...p }));

    if (!sameCount) {
      this._candlesGroup.submobjects.length = 0;
      this._wicksGroup.submobjects.length = 0;
      this.candles.length = 0;
      this.wicks.length = 0;
      this._build(this.data);
      return this;
    }

    const slot = this._unitWidth();
    const width = slot * this.bodyWidth;

    for (let i = 0; i < this.data.length; i++) {
      const p = this.data[i];
      const xCenter = i + 0.5;
      const color = this._colorFor(p);

      const bodyTopVal = Math.max(p.open, p.close);
      const bodyBotVal = Math.min(p.open, p.close);
      const top = this.coordsToPoint(xCenter, bodyTopVal);
      const bottom = this.coordsToPoint(xCenter, bodyBotVal);
      const height = Math.abs(top[1] - bottom[1]);

      const fresh = new Rectangle({
        width,
        height: height <= 0 ? 1e-6 : height,
        point: [top[0], (top[1] + bottom[1]) / 2, 0],
      });
      const body = this.candles[i];
      body.points = fresh.points;
      body.subpathStarts = fresh.subpathStarts;
      (body as any)._straightPath = (fresh as any)._straightPath;
      body.setFill(color, 1);
      body.setStroke(color, this.strokeWidth);
      (body as any).candleData = p;

      const lowPt = this.coordsToPoint(xCenter, p.low);
      const highPt = this.coordsToPoint(xCenter, p.high);
      const wick = this.wicks[i];
      wick.putStartAndEndOn(lowPt, highPt);
      wick.setStroke(this.wickColor ?? color, this.wickStrokeWidth);
      (wick as any).candleData = p;
    }
    return this;
  }

  // Overlay a pre-computed moving-average series (the mobject itself stays
  // statistics-agnostic: callers compute MA5/MA10/... and pass the values
  // in). Plots via `plotLineGraph` with `addVertexDots: false`, then --
  // since `plotLineGraph` has no built-in `smooth` option in this codebase
  // yet -- falls back to `VMobject.setPointsSmoothly` directly when
  // `config.smooth` is requested. Adds the resulting line group to the chart
  // and returns it.
  addMovingAverageLine(values: number[], config: { color?: ColorLike; smooth?: boolean } = {}): VGroup {
    const color = config.color ?? "#FFA500";
    const xValues: number[] = [];
    const yValues: number[] = [];
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v == null || typeof v !== "number" || Number.isNaN(v)) continue;
      xValues.push(i + 0.5);
      yValues.push(v);
    }

    const group = this.plotLineGraph(xValues, yValues, { addVertexDots: false, lineColor: color });

    if (config.smooth && xValues.length > 0) {
      const line = group.submobjects[0] as VMobject;
      const anchors = xValues.map((x, i) => this.coordsToPoint(x, yValues[i]));
      line.setPointsSmoothly(anchors);
    }

    this.add(group);
    return group;
  }
}
