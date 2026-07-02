// Analytic waves: a time-parameterized sine curve (VMobject polyline) that
// advances via an updater. Formula-based, deterministic. LinearWave (traveling)
// and StandingWave mirror manim-physics' analytic wave mobjects.

import { VMobject } from "../mobject/VMobject.ts";
import { Color } from "../core/color.ts";

export interface WaveConfig {
  xRange?: [number, number, number]; // [min, max, step]
  amplitude?: number;
  wavelength?: number;
  frequency?: number;   // angular frequency ω = 2π·frequency
  phase?: number;
  color?: string;
  strokeWidth?: number;
  point?: number[];     // baseline center
}

export abstract class WaveCurve extends VMobject {
  amplitude: number;
  wavelength: number;
  frequency: number;
  phase: number;
  xMin: number; xMax: number; xStep: number;
  time = 0;
  private _baseline: number[];

  constructor(config: WaveConfig = {}) {
    super();
    const [xMin, xMax, xStep] = config.xRange ?? [-5, 5, 0.1];
    this.xMin = xMin; this.xMax = xMax; this.xStep = xStep;
    this.amplitude = config.amplitude ?? 1;
    this.wavelength = config.wavelength ?? 2;
    this.frequency = config.frequency ?? 1;
    this.phase = config.phase ?? 0;
    this._baseline = config.point ?? [0, 0, 0];
    this.strokeColor = Color.parse(config.color ?? "#58C4DD");
    this.strokeWidth = config.strokeWidth ?? 4;
    this.fillOpacity = 0;
    this._build();
    this.addUpdater((_m: any, dt: number) => { this.time += dt; this._build(); });
  }

  /** Displacement y at position x and current time. */
  protected abstract yAt(x: number, t: number): number;

  private _build(): void {
    const pts: number[][] = [];
    for (let x = this.xMin; x <= this.xMax + 1e-9; x += this.xStep) {
      pts.push([this._baseline[0] + x, this._baseline[1] + this.yAt(x, this.time), this._baseline[2]]);
    }
    if (pts.length >= 2) this.setPointsAsCorners(pts);
    this.strokeColor = Color.parse(this.strokeColor);
  }

  setTime(t: number): this { this.time = t; this._build(); return this; }
  private get k(): number { return (2 * Math.PI) / this.wavelength; }
  protected omega(): number { return 2 * Math.PI * this.frequency; }
  protected waveNumber(): number { return this.k; }
}

/** A traveling wave: y = A·sin(kx − ωt + φ). */
export class LinearWave extends WaveCurve {
  protected yAt(x: number, t: number): number {
    return this.amplitude * Math.sin(this.waveNumber() * x - this.omega() * t + this.phase);
  }
}

/** A standing wave: y = A·sin(kx)·cos(ωt). */
export class StandingWave extends WaveCurve {
  protected yAt(x: number, t: number): number {
    return this.amplitude * Math.sin(this.waveNumber() * x + this.phase) * Math.cos(this.omega() * t);
  }
}
