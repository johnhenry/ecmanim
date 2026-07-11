// Radar (polar multi-axis / "spider") chart: an axis-free standalone chart
// mobject alongside PieChart in this directory. Each indicator defines one
// polygon axis (its own independent max/min); each series is drawn as one
// filled Polygon whose vertices sit at value/(max-min) fraction of `radius`
// along that axis's spoke direction.

import { VMobject, VGroup } from "./VMobject.ts";
import { Polygon } from "./geometry.ts";
import { Circle, Line } from "./geometry.ts";
import { Text } from "./text/Text.ts";
import { TAU, regularVertices } from "../core/math/vector.ts";
import { BLUE, YELLOW, RED, GREEN, PURPLE, ORANGE, TEAL, PINK, GRAY } from "../core/color.ts";
import type { ColorLike } from "../core/types.ts";

const DEFAULT_SERIES_COLORS: ColorLike[] = [BLUE, YELLOW, RED, GREEN, PURPLE, ORANGE, TEAL, PINK];

export interface RadarIndicator {
  name: string;
  max: number;
  min?: number;
}

export interface RadarSeriesInput {
  name?: string;
  values: number[];
}

export interface RadarChartConfig {
  indicators: RadarIndicator[];
  /** Outer radius in world units (default 2). */
  radius?: number;
  /** Angle of the FIRST axis (default TAU/4 — 12 o'clock). */
  startAngle?: number;
  /** Shape of the concentric grid rings (default 'polygon'). */
  shape?: "polygon" | "circle";
  /** Number of concentric grid rings (default 5). */
  rings?: number;
  /** Series fill/stroke colors, cycled when there are more series than colors. */
  colors?: ColorLike[];
  strokeWidth?: number;
  fillOpacity?: number;
  labelFontSize?: number;
  /** Indicator-name label color (default WHITE, matching Text's own default —
   *  set this explicitly on a light/white background scene or the labels
   *  render invisibly). */
  labelColor?: ColorLike;
  /** Show indicator name labels at spoke tips (default true). */
  showLabels?: boolean;
}

interface AxisGeo {
  dir: number[]; // unit direction (magnitude 1) for this axis
  min: number;
  max: number;
}

/**
 * A radar / spider chart: N indicator axes radiating from the center, one
 * filled `Polygon` per series. `grid` (spokes + concentric rings) and
 * `seriesPolygons` are addressable for per-element animation; `setValues()`
 * rebuilds series geometry IN PLACE — the polygon mobjects keep their
 * identity when the series count is unchanged, so updaters, Transforms, and
 * references to `chart.seriesPolygons[i]` stay valid.
 */
export class RadarChart extends VGroup {
  series: RadarSeriesInput[];
  readonly indicators: RadarIndicator[];
  readonly grid = new VGroup();
  readonly seriesPolygons: Polygon[] = [];
  readonly labels: Text[] = [];
  private readonly _config: RadarChartConfig;
  private readonly _labelsGroup = new VGroup();
  private readonly _seriesGroup = new VGroup();
  private readonly _axes: AxisGeo[];

  constructor(series: RadarSeriesInput[], config: RadarChartConfig) {
    super();
    const { indicators } = config;
    if (!indicators || indicators.length === 0) {
      throw new Error("RadarChart: config.indicators must be a non-empty array.");
    }
    series.forEach((s, i) => {
      if (s.values.length !== indicators.length) {
        throw new Error(
          `RadarChart: series[${i}]${s.name ? ` ("${s.name}")` : ""} has ${s.values.length} ` +
          `value(s) but there are ${indicators.length} indicator(s) — values.length must match indicators.length.`,
        );
      }
    });

    this._config = config;
    this.indicators = indicators;
    this.series = series.map((s) => ({ name: s.name, values: [...s.values] }));
    this._axes = this._buildAxes();

    this.add(this.grid, this._seriesGroup, this._labelsGroup);
    this._buildGrid();
    this._buildLabels();
    this._buildSeries();
  }

  private _buildAxes(): AxisGeo[] {
    const { startAngle = TAU / 4 } = this._config;
    const n = this.indicators.length;
    const [dirs] = regularVertices(n, 1, startAngle);
    return this.indicators.map((ind, i) => ({
      dir: dirs[i],
      min: ind.min ?? 0,
      max: ind.max,
    }));
  }

  private _radius(): number {
    return this._config.radius ?? 2;
  }

  /** World point on axis `i` at fraction `frac` (0 = center, 1 = radius). */
  private _axisPoint(i: number, frac: number): number[] {
    const r = this._radius();
    const dir = this._axes[i].dir;
    return [dir[0] * r * frac, dir[1] * r * frac, dir[2] * r * frac];
  }

  private _valueFraction(i: number, value: number): number {
    const { min, max } = this._axes[i];
    const span = max - min;
    const frac = span !== 0 ? (value - min) / span : 0;
    return Math.max(0, frac);
  }

  private _buildGrid(): void {
    const { shape = "polygon", rings = 5, strokeWidth = 1 } = this._config;
    this.grid.submobjects.length = 0;
    const n = this.indicators.length;
    const r = this._radius();

    // Spokes: one Line per axis, from center to the outer radius.
    const spokes: Line[] = [];
    for (let i = 0; i < n; i++) {
      spokes.push(new Line([0, 0, 0], this._axisPoint(i, 1), { color: GRAY, strokeWidth, strokeOpacity: 0.5 }));
    }

    // Concentric rings.
    const ringMobs: VMobject[] = [];
    for (let k = 1; k <= rings; k++) {
      const frac = k / rings;
      if (shape === "circle") {
        ringMobs.push(new Circle({ radius: r * frac, color: GRAY, strokeWidth, strokeOpacity: 0.5, fillOpacity: 0 }));
      } else {
        const verts: number[][] = [];
        for (let i = 0; i < n; i++) verts.push(this._axisPoint(i, frac));
        ringMobs.push(new Polygon(verts, { color: GRAY, strokeWidth, strokeOpacity: 0.5, fillOpacity: 0 }));
      }
    }

    this.grid.add(...ringMobs, ...spokes);
  }

  private _buildLabels(): void {
    const { showLabels = true, labelFontSize = 0.4, labelColor } = this._config;
    this._labelsGroup.submobjects.length = 0;
    this.labels.length = 0;
    if (!showLabels) return;
    const n = this.indicators.length;
    for (let i = 0; i < n; i++) {
      const point = this._axisPoint(i, 1.15); // just past the spoke tip
      const label = new Text(this.indicators[i].name, {
        fontSize: labelFontSize,
        ...(labelColor !== undefined ? { color: labelColor } : {}),
      });
      label.moveTo(point);
      this.labels.push(label);
    }
    this._labelsGroup.add(...this.labels);
  }

  private _seriesVertices(values: number[]): number[][] {
    return values.map((v, i) => this._axisPoint(i, this._valueFraction(i, v)));
  }

  private _makeSeriesPolygon(values: number[], i: number): Polygon {
    const { colors = DEFAULT_SERIES_COLORS, strokeWidth = 2, fillOpacity = 0.2 } = this._config;
    const color = colors[i % colors.length];
    return new Polygon(this._seriesVertices(values), { color, strokeWidth, fillOpacity });
  }

  private _buildSeries(): void {
    this._seriesGroup.submobjects.length = 0;
    this.seriesPolygons.length = 0;
    this.series.forEach((s, i) => {
      this.seriesPolygons.push(this._makeSeriesPolygon(s.values, i));
    });
    this._seriesGroup.add(...this.seriesPolygons);
  }

  /**
   * Update the chart to new series data, rebuilding series geometry in
   * place. With the same number of series, each existing polygon mobject's
   * points are rewritten (identity preserved — Transform-friendly); a
   * changed series count replaces the polygon list. Grid and labels are
   * unaffected (they depend only on `indicators`).
   */
  setValues(series: RadarSeriesInput[]): this {
    const { indicators } = this._config;
    series.forEach((s, i) => {
      if (s.values.length !== indicators.length) {
        throw new Error(
          `RadarChart.setValues: series[${i}]${s.name ? ` ("${s.name}")` : ""} has ${s.values.length} ` +
          `value(s) but there are ${indicators.length} indicator(s) — values.length must match indicators.length.`,
        );
      }
    });

    this.series = series.map((s) => ({ name: s.name, values: [...s.values] }));

    if (this.series.length === this.seriesPolygons.length) {
      this.series.forEach((s, i) => {
        const fresh = this._makeSeriesPolygon(s.values, i);
        const poly = this.seriesPolygons[i];
        poly.points = fresh.points;
        poly.subpathStarts = fresh.subpathStarts;
        (poly as any)._straightPath = (fresh as any)._straightPath;
        poly.vertices = fresh.vertices;
      });
    } else {
      this._buildSeries();
    }
    return this;
  }
}
