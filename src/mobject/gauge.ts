// GaugeChart: an axis-free standalone chart mobject (ECharts "gauge" series
// parity — see examples/echarts-parity/ref/06-gauge.js). A dial with a
// colored band track (drawn as AnnularSectors/Sectors, same primitive
// PieChart uses for pie slices — see arcs.ts), tick labels around the
// outside, a needle (an elongated Polygon) pointing at the current value,
// and a center value label below the dial's center (ECharts convention).
//
// Sibling module to charts.ts (PieChart): same VGroup + identity-preserving
// update conventions. `needle` keeps its mobject identity across
// `setValue()` calls (rotated in place via `.rotate()`, manim's Rotate
// animation convention — see animation/extra.ts's `Rotate` class) so it stays
// addressable/animatable; the value label is rebuilt each call via
// `Mobject.become()` (Mobject.ts), which is the same identity-preserving
// primitive `alwaysRedraw()` uses, so the label mobject also keeps its
// identity even though its glyph geometry is regenerated.

import { VMobject, VGroup } from "./VMobject.ts";
import { AnnularSector, Sector } from "./arcs.ts";
import { Polygon } from "./geometry.ts";
import { Text } from "./text/Text.ts";
import * as V from "../core/math/vector.ts";
import { GRAY } from "../core/color.ts";
import type { ColorLike } from "../core/types.ts";

const DEG = Math.PI / 180;

/** A color band from the previous band's `to` (or `min`, for the first
 *  band) up to this band's `to`. Mirrors ECharts' `axisLine.lineStyle.color`
 *  list-of-[fraction,color] convention, simplified to a cumulative value. */
export interface GaugeBand {
  to: number;
  color: ColorLike;
}

export interface GaugeChartConfig {
  /** Value at the start of the dial (default 0). */
  min?: number;
  /** Value at the end of the dial (default 100). */
  max?: number;
  /** Sweep start angle in radians (default 225°, ECharts' default). */
  startAngle?: number;
  /** Sweep end angle in radians (default -45° — a 270° total clockwise
   *  sweep from `startAngle`, ECharts' default). */
  endAngle?: number;
  /** Outer radius of the dial, in world units (default 2). */
  radius?: number;
  /** Color bands along the dial. Defaults to a 3-band ECharts-style ramp
   *  spanning [min, max] (20% / 60% / 20% of the range). */
  bands?: GaugeBand[];
  /** Radial thickness of the band track (default radius*0.15). A track
   *  width >= radius fills all the way to the center (drawn as `Sector`s
   *  instead of `AnnularSector`s). */
  trackWidth?: number;
  needleColor?: ColorLike;
  /** Needle base width as a fraction of the radius (default 0.04). */
  needleWidthRatio?: number;
  /** Number of evenly-spaced tick labels from min to max (default 5). */
  tickCount?: number;
  tickFontSize?: number;
  /** Tick label color (default WHITE, matching Text's own default — set this
   *  explicitly on a light/white background scene or the ticks render
   *  invisibly, same footgun as any bare `Text` mobject in this codebase). */
  tickColor?: ColorLike;
  /** Show the big value label at the center-bottom of the dial (default true). */
  showValueLabel?: boolean;
  valueFormat?: (value: number) => string;
  valueFontSize?: number;
  /** Value label color (default WHITE — see `tickColor`'s note). */
  valueColor?: ColorLike;
}

interface ResolvedGaugeConfig {
  min: number;
  max: number;
  startAngle: number;
  endAngle: number;
  radius: number;
  bands?: GaugeBand[];
  trackWidth: number;
  needleColor?: ColorLike;
  needleWidthRatio: number;
  tickCount: number;
  tickFontSize?: number;
  tickColor?: ColorLike;
  showValueLabel: boolean;
  valueFormat?: (value: number) => string;
  valueFontSize?: number;
  valueColor?: ColorLike;
}

const DEFAULT_BANDS: GaugeBand[] = [
  { to: 20, color: "#67e0e3" },
  { to: 80, color: "#37a2da" },
  { to: 100, color: "#fd666d" },
];

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function formatTick(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * A gauge/dial chart: a colored band track sweeping `startAngle` ->
 * `endAngle`, tick labels around the outside, a needle pointing at the
 * current value, and (by default) a big center value label. `needle` keeps
 * its mobject identity across `setValue()` (rotated in place, cheap enough
 * to call every frame from a `ValueTracker` updater); `bandSectors` and
 * `tickLabels` are addressable per-segment like PieChart's `slices`/`labels`.
 */
export class GaugeChart extends VGroup {
  value: number;
  readonly needle: VMobject;
  readonly bandSectors: VMobject[] = [];
  readonly tickLabels: Text[] = [];
  readonly valueLabel: Text | null;

  private readonly _config: ResolvedGaugeConfig;
  private _currentAngle = 0;
  private readonly _trackGroup = new VGroup();
  private readonly _tickGroup = new VGroup();

  constructor(value: number, config: GaugeChartConfig = {}) {
    super();
    const min = config.min ?? 0;
    const max = config.max ?? 100;
    const radius = config.radius ?? 2;
    this._config = {
      min,
      max,
      startAngle: config.startAngle ?? 225 * DEG,
      endAngle: config.endAngle ?? -45 * DEG,
      radius,
      bands: config.bands,
      trackWidth: config.trackWidth ?? radius * 0.15,
      needleColor: config.needleColor,
      needleWidthRatio: config.needleWidthRatio ?? 0.04,
      tickCount: config.tickCount ?? 5,
      tickFontSize: config.tickFontSize,
      tickColor: config.tickColor,
      showValueLabel: config.showValueLabel ?? true,
      valueFormat: config.valueFormat,
      valueFontSize: config.valueFontSize,
      valueColor: config.valueColor,
    };
    this.value = clamp(value, min, max);

    this._buildTrack();
    this._buildTicks();
    this.needle = this._buildNeedle();
    this.valueLabel = this._config.showValueLabel ? this._buildValueLabel(this.value) : null;

    this.add(this._trackGroup, this._tickGroup, this.needle);
    if (this.valueLabel) this.add(this.valueLabel);
  }

  /** Map a value in [min, max] to its dial angle (radians), clamping first. */
  angleForValue(value: number): number {
    const { min, max, startAngle, endAngle } = this._config;
    const v = clamp(value, min, max);
    const t = max === min ? 0 : (v - min) / (max - min);
    return startAngle + t * (endAngle - startAngle);
  }

  /** The needle's current dial angle (radians), for tests/introspection. */
  get needleAngle(): number {
    return this._currentAngle;
  }

  private _buildTrack(): void {
    const { min, radius, trackWidth } = this._config;
    const bands = this._config.bands?.length ? this._config.bands : DEFAULT_BANDS;
    this.bandSectors.length = 0;
    this._trackGroup.submobjects.length = 0;
    const innerRadius = Math.max(0, radius - trackWidth);
    let from = min;
    for (const band of bands) {
      const a1 = this.angleForValue(from);
      const a2 = this.angleForValue(band.to);
      const startAngle = Math.min(a1, a2);
      const angle = Math.abs(a2 - a1);
      const common = { startAngle, angle, color: band.color, fillOpacity: 1, strokeWidth: 0 };
      const sector = trackWidth >= radius
        ? new Sector({ ...common, radius })
        : new AnnularSector({ ...common, innerRadius, outerRadius: radius });
      this.bandSectors.push(sector);
      from = band.to;
    }
    this._trackGroup.add(...this.bandSectors);
  }

  private _buildTicks(): void {
    const { min, max, radius, tickCount, tickFontSize, tickColor } = this._config;
    this.tickLabels.length = 0;
    this._tickGroup.submobjects.length = 0;
    const n = Math.max(2, tickCount);
    const fontSize = tickFontSize ?? 0.3;
    const tickRadius = radius + Math.max(0.3, fontSize);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const value = min + t * (max - min);
      const angle = this.angleForValue(value);
      const label = new Text(formatTick(value), {
        fontSize,
        ...(tickColor !== undefined ? { color: tickColor } : {}),
      });
      label.moveTo([tickRadius * Math.cos(angle), tickRadius * Math.sin(angle), 0]);
      this.tickLabels.push(label);
    }
    this._tickGroup.add(...this.tickLabels);
  }

  private _buildNeedle(): VMobject {
    const { radius, needleColor, needleWidthRatio } = this._config;
    const length = radius * 0.7;
    const halfWidth = (needleWidthRatio * radius) / 2;
    // Built pointing along +X (angle 0): tip far from center, base straddling
    // the gauge center — an elongated Polygon rather than the equilateral
    // Triangle class, since Triangle's vertices sit symmetrically around its
    // centroid (not a center-to-tip pointer shape).
    const needle = new Polygon(
      [
        [length, 0, 0],
        [0, halfWidth, 0],
        [0, -halfWidth, 0],
      ],
      { color: needleColor ?? GRAY, fillOpacity: 1, strokeWidth: 0 },
    );
    this._currentAngle = this.angleForValue(this.value);
    needle.rotate(this._currentAngle, { aboutPoint: V.ORIGIN });
    return needle;
  }

  private _buildValueLabel(value: number): Text {
    const { radius, valueFormat, valueFontSize, valueColor } = this._config;
    const text = valueFormat ? valueFormat(value) : value.toFixed(0);
    const label = new Text(text, {
      fontSize: valueFontSize ?? radius * 0.3,
      ...(valueColor !== undefined ? { color: valueColor } : {}),
    });
    // ECharts convention: the detail label sits below the dial's center.
    label.moveTo([0, -radius * 0.35, 0]);
    return label;
  }

  /**
   * Update the gauge to a new value, rebuilding the needle rotation and
   * value label IN PLACE. The needle mobject is rotated (not rebuilt), and
   * the value label is regenerated then merged in via `become()` (the same
   * identity-preserving primitive `alwaysRedraw()` uses) — both mobjects
   * keep their identity, so this is cheap enough to call every frame from a
   * ValueTracker updater.
   */
  setValue(value: number): this {
    const { min, max } = this._config;
    this.value = clamp(value, min, max);
    const newAngle = this.angleForValue(this.value);
    const delta = newAngle - this._currentAngle;
    if (delta !== 0) this.needle.rotate(delta, { aboutPoint: V.ORIGIN });
    this._currentAngle = newAngle;
    if (this.valueLabel) {
      this.valueLabel.become(this._buildValueLabel(this.value));
    }
    return this;
  }
}
