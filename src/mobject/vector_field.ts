// Vector field mobjects: VectorField (base), ArrowVectorField and StreamLines.
// Ports of ManimCommunity manim/mobject/vector_field.py.
//
// A field function `func` maps a point [x, y, z] to a vector [vx, vy, vz]. The
// arrow field samples the function on a grid, drawing one arrow per sample,
// scaled and colored by magnitude. Stream lines integrate the field from seed
// points to trace flow paths.

import { VMobject, VGroup } from "./VMobject.ts";
import * as V from "../core/math/vector.ts";
import { Arrow } from "./geometry.ts";
import { Vector } from "./vectors.ts";
import { Color, BLUE_E, GREEN, YELLOW, RED } from "../core/color.ts";
import type { ColorLike, Vec3 } from "../core/types.ts";
import { Animation, Create } from "../animation/Animation.ts";
import { AnimationGroup } from "../animation/composition.ts";
import { ShowPassingFlash } from "../animation/indication_extra.ts";
import { linear, easeOutSine } from "../animation/rate_functions.ts";

type FieldFunc = (point: any) => number[];

// Default magnitude color ramp (low -> high).
const DEFAULT_COLORS: ColorLike[] = [BLUE_E, GREEN, YELLOW, RED];

// Interpolate a color from a ramp based on a normalized value in [0, 1].
function colorFromRamp(colors: ColorLike[], alpha: number): Color {
  if (colors.length === 0) return Color.parse("#FFFFFF");
  if (colors.length === 1) return Color.parse(colors[0]);
  const a = Math.max(0, Math.min(1, alpha));
  const scaled = a * (colors.length - 1);
  const lo = Math.floor(scaled);
  const hi = Math.min(colors.length - 1, lo + 1);
  return Color.lerp(colors[lo], colors[hi], scaled - lo);
}

export interface VectorFieldConfig {
  colorScheme?: (point: number[]) => number; // maps point -> scalar to color by
  minColorScheme?: number;
  maxColorScheme?: number;
  colors?: ColorLike[];
  [key: string]: any;
}

export class VectorField extends VGroup {
  func: FieldFunc;
  colors: ColorLike[];
  minColorScheme: number;
  maxColorScheme: number;
  colorScheme: (point: number[]) => number;

  constructor(funcXY: FieldFunc, config: VectorFieldConfig = {}) {
    super();
    // Normalize the field function to always accept/return a 3-vector.
    this.func = (point: any): Vec3 => {
      const p = point as number[];
      const out = funcXY([p[0], p[1] ?? 0, p[2] ?? 0]);
      return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0];
    };
    this.colors = config.colors ?? DEFAULT_COLORS;
    // By default color by vector magnitude at a point.
    this.colorScheme = config.colorScheme ?? ((p: number[]) => V.length(this.func(p)));
    this.minColorScheme = config.minColorScheme ?? 0;
    this.maxColorScheme = config.maxColorScheme ?? 2;
  }

  // Normalize a scalar value into [0, 1] across the color scheme range.
  protected normalizeScalar(value: number): number {
    const lo = this.minColorScheme;
    const hi = this.maxColorScheme;
    if (hi === lo) return 0;
    return (value - lo) / (hi - lo);
  }

  colorForPoint(point: number[]): Color {
    return colorFromRamp(this.colors, this.normalizeScalar(this.colorScheme(point)));
  }

  // Build a single colored arrow representing the field at `point`.
  getVector(point: number[]): Vector {
    const p: Vec3 = [point[0], point[1] ?? 0, point[2] ?? 0];
    const v = this.func(p);
    const color = this.colorForPoint(p).toHex();
    const vec = new Vector(v, { color, strokeColor: color });
    vec.shift(V.sub(p, vec.getStart()));
    return vec;
  }
}

export interface ArrowVectorFieldConfig extends VectorFieldConfig {
  xRange?: number[];
  yRange?: number[];
  step?: number;
  lengthFunc?: (norm: number) => number;
  minColor?: ColorLike;
  maxColor?: ColorLike;
  strokeWidth?: number;
  vectorConfig?: Record<string, any>;
  [key: string]: any;
}

// Saturating length function: long vectors are compressed so the field stays
// readable. Mirrors manim's default (arctan-based scaling).
function defaultLengthFunc(norm: number): number {
  return 0.45 * Math.sqrt(2) * (2 / Math.PI) * Math.atan(norm);
}

export class ArrowVectorField extends VectorField {
  xRange: number[];
  yRange: number[];
  step: number;
  lengthFunc: (norm: number) => number;

  constructor(func: FieldFunc, config: ArrowVectorFieldConfig = {}) {
    // Merge minColor/maxColor into a color ramp if provided.
    let colors = config.colors;
    if (!colors && (config.minColor || config.maxColor)) {
      colors = [config.minColor ?? BLUE_E, config.maxColor ?? RED];
    }
    super(func, { ...config, colors });

    this.step = config.step ?? 0.5;
    this.xRange = config.xRange ?? [-3, 3, this.step];
    this.yRange = config.yRange ?? [-3, 3, this.step];
    // Ensure a step component in each range.
    if (this.xRange[2] == null) this.xRange = [this.xRange[0], this.xRange[1], this.step];
    if (this.yRange[2] == null) this.yRange = [this.yRange[0], this.yRange[1], this.step];
    this.lengthFunc = config.lengthFunc ?? defaultLengthFunc;

    this._buildArrows(config);
  }

  private _buildArrows(config: ArrowVectorFieldConfig): void {
    const [x0, x1, dx] = this.xRange;
    const [y0, y1, dy] = this.yRange;
    const eps = 1e-9;
    for (let x = x0; x <= x1 + eps; x += dx) {
      for (let y = y0; y <= y1 + eps; y += dy) {
        const point: Vec3 = [x, y, 0];
        const v = this.func(point);
        const norm = V.length(v);
        const color = this.colorForPoint(point).toHex();

        // Scale the drawn vector length via the saturating length function.
        let drawn: Vec3;
        if (norm < eps) {
          drawn = [0, 0, 0];
        } else {
          const targetLen = this.lengthFunc(norm);
          drawn = V.scale(V.normalize(v), targetLen);
        }
        const end: Vec3 = [x + drawn[0], y + drawn[1], drawn[2]];

        const arrow = new Arrow(point, end, {
          color,
          strokeColor: color,
          buff: 0,
          strokeWidth: config.strokeWidth ?? 2,
          tipLength: Math.min(0.2, this.step * 0.4),
          ...(config.vectorConfig ?? {}),
        });
        (arrow as any).fieldPoint = point;
        (arrow as any).fieldVector = v;
        this.add(arrow);
      }
    }
  }
}

export interface StreamLinesConfig extends VectorFieldConfig {
  xRange?: number[];
  yRange?: number[];
  step?: number;
  strokeWidth?: number;
  maxAnchorsPerLine?: number;
  dt?: number;
  virtualTime?: number;
  nRepeats?: number;
  noisePad?: number;
  [key: string]: any;
}

export class StreamLines extends VectorField {
  xRange: number[];
  yRange: number[];
  step: number;
  declare strokeWidth: number;
  maxAnchorsPerLine: number;
  dt: number;
  virtualTime: number;
  nRepeats: number;
  streamLines: VMobject[];

  constructor(func: FieldFunc, config: StreamLinesConfig = {}) {
    super(func, config);

    this.step = config.step ?? 0.5;
    this.xRange = config.xRange ?? [-3, 3, this.step];
    this.yRange = config.yRange ?? [-3, 3, this.step];
    if (this.xRange[2] == null) this.xRange = [this.xRange[0], this.xRange[1], this.step];
    if (this.yRange[2] == null) this.yRange = [this.yRange[0], this.yRange[1], this.step];
    this.strokeWidth = config.strokeWidth ?? 1;
    this.maxAnchorsPerLine = config.maxAnchorsPerLine ?? 100;
    this.dt = config.dt ?? 0.05;
    this.virtualTime = config.virtualTime ?? 3;
    this.nRepeats = config.nRepeats ?? 1;
    this.streamLines = [];

    this._buildLines();
  }

  // Integrate the field with 4th-order Runge-Kutta to advance a point.
  private _rk4Step(p: Vec3, dt: number): Vec3 {
    const f = (q: Vec3): Vec3 => this.func(q) as Vec3;
    const k1 = f(p);
    const k2 = f(V.add(p, V.scale(k1, dt / 2)) as Vec3);
    const k3 = f(V.add(p, V.scale(k2, dt / 2)) as Vec3);
    const k4 = f(V.add(p, V.scale(k3, dt)) as Vec3);
    const incr = V.scale(
      [
        k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0],
        k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1],
        k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2],
      ],
      dt / 6,
    );
    return V.add(p, incr) as Vec3;
  }

  private _buildLines(): void {
    const [x0, x1, dx] = this.xRange;
    const [y0, y1, dy] = this.yRange;
    const eps = 1e-9;
    const nSteps = Math.max(1, Math.floor(this.virtualTime / this.dt));

    for (let rep = 0; rep < this.nRepeats; rep++) {
      for (let x = x0; x <= x1 + eps; x += dx) {
        for (let y = y0; y <= y1 + eps; y += dy) {
          const anchors: Vec3[] = [];
          let p: Vec3 = [x, y, 0];
          anchors.push(V.clone(p));

          for (let s = 0; s < nSteps && anchors.length < this.maxAnchorsPerLine; s++) {
            const next = this._rk4Step(p, this.dt);
            if (!Number.isFinite(next[0]) || !Number.isFinite(next[1]) || !Number.isFinite(next[2])) {
              break;
            }
            // Stop if the point escapes far past the domain.
            if (next[0] < x0 - 5 || next[0] > x1 + 5 || next[1] < y0 - 5 || next[1] > y1 + 5) {
              anchors.push(V.clone(next));
              break;
            }
            p = next;
            anchors.push(V.clone(p));
          }

          if (anchors.length < 2) continue;

          const line = new VMobject({ strokeWidth: this.strokeWidth });
          line.setPointsAsCorners(anchors);
          line.fillOpacity = 0;
          this._colorLineByLength(line, anchors);
          (line as any).seedPoint = [x, y, 0];
          // CE: line.duration = max_steps * dt, max_steps = ceil(virtual_time / dt) + 1.
          (line as any).duration = (Math.ceil(this.virtualTime / this.dt) + 1) * this.dt;
          this.streamLines.push(line);
          this.add(line);
        }
      }
    }
  }

  // Color the polyline: use the average field magnitude along its anchors so
  // each line reads as a single magnitude-mapped hue (finite, stable).
  private _colorLineByLength(line: VMobject, anchors: Vec3[]): void {
    let total = 0;
    for (const a of anchors) total += V.length(this.func(a));
    const avg = anchors.length ? total / anchors.length : 0;
    const color = colorFromRamp(this.colors, this.normalizeScalar(avg));
    line.strokeColor = color;
    (line as any).color = color;
  }

  getLines(): VMobject[] {
    return this.streamLines;
  }

  // --- animations (CE vector_field.py StreamLines.create/start_animation/end_animation) ---

  /** True while startAnimation()'s flow updater is installed. */
  private _flow: {
    updater: (m: any, dt: number) => void;
    speed: number;
    timeWidth: number;
    elapsed: number;
    t0: Map<VMobject, number>;
  } | null = null;
  /** Public CE attribute names (`flow_animation`, `flow_speed`, `time_width`). */
  flowSpeed = 1;
  timeWidth = 0.3;

  /**
   * CE `StreamLines.create(lag_ratio, run_time)`: an AnimationGroup of one
   * Create per line, in a (seeded, hence deterministic) random order.
   * `runTime` defaults to `virtualTime` and may be a function of it;
   * `lagRatio` defaults to runTime / 2 / number-of-lines.
   */
  create(config: { lagRatio?: number; runTime?: number | ((virtualTime: number) => number); [k: string]: any } = {}): AnimationGroup {
    const { lagRatio: lagIn, runTime: rtIn, ...rest } = config;
    const rt = rtIn ?? this.virtualTime;
    const runTime = Number(typeof rt === "function" ? rt(this.virtualTime) : rt);
    const lagRatio = lagIn ?? runTime / 2 / Math.max(1, this.submobjects.length);
    const anims = this.streamLines.map((line) => new Create(line, { ...rest, runTime }));
    const rand = mulberry32(0);
    for (let i = anims.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [anims[i], anims[j]] = [anims[j], anims[i]];
    }
    return new AnimationGroup(anims, { lagRatio });
  }

  /** Line flow clock: CE `line.time`, in closed form of the elapsed flow time. */
  private _lineTime(t0: number, elapsed: number, speed: number): number {
    const t = t0 + elapsed * speed;
    return t >= this.virtualTime ? ((t % this.virtualTime) + this.virtualTime) % this.virtualTime : t;
  }

  /**
   * CE `StreamLines.start_animation(warm_up, flow_speed, time_width, rate_func,
   * line_animation_class)`: installs an updater that makes the lines flow
   * continuously (each line runs a ShowPassingFlash-style window along itself,
   * wrapping every `virtualTime`). Start offsets come from a seeded generator
   * and each line's phase is a closed-form function of the accumulated
   * updater time, so playback is deterministic and identical however it is
   * stepped or re-played.
   */
  startAnimation(config: {
    warmUp?: boolean; warm_up?: boolean;
    flowSpeed?: number; flow_speed?: number;
    timeWidth?: number; time_width?: number;
    rateFunc?: (t: number) => number; rate_func?: (t: number) => number;
    lineAnimationClass?: new (m: any, c?: any) => any; line_animation_class?: new (m: any, c?: any) => any;
    [k: string]: any;
  } = {}): this {
    const {
      warmUp: w1, warm_up: w2, flowSpeed: f1, flow_speed: f2, timeWidth: t1, time_width: t2,
      rateFunc: r1, rate_func: r2, lineAnimationClass: c1, line_animation_class: c2, ...kwargs
    } = config;
    const warmUp = w1 ?? w2 ?? true;
    const flowSpeed = f1 ?? f2 ?? 1;
    const timeWidth = t1 ?? t2 ?? 0.3;
    const rateFunc = r1 ?? r2 ?? linear;
    const LineAnim = c1 ?? c2 ?? ShowPassingFlash;
    if (this._flow) this.removeUpdater(this._flow.updater);

    const rand = mulberry32(0);
    const t0 = new Map<VMobject, number>();
    for (const line of this.streamLines as any[]) {
      const runTime = line.duration / flowSpeed;
      const anim = new LineAnim(line, { ...kwargs, runTime, rateFunc, timeWidth });
      line.anim = anim;
      anim.begin();
      const start = rand() * this.virtualTime * (warmUp ? -1 : 1);
      t0.set(line, start);
      line.time = start;
      this._applyFlow(line);
    }
    const flow = {
      speed: flowSpeed, timeWidth, elapsed: 0, t0,
      updater: (_m: any, dt: number) => {
        flow.elapsed += dt;
        for (const line of this.streamLines as any[]) {
          line.time = this._lineTime(flow.t0.get(line)!, flow.elapsed, flow.speed);
          this._applyFlow(line);
        }
      },
    };
    this._flow = flow;
    this.addUpdater(flow.updater, { hashExtra: () => `${flow.elapsed}:${flow.speed}` });
    this.flowSpeed = flowSpeed;
    this.timeWidth = timeWidth;
    return this;
  }

  /** CE: `line.anim.interpolate(clip(line.time / line.anim.run_time, 0, 1))`. */
  private _applyFlow(line: any): void {
    line.anim.interpolate(Math.min(1, Math.max(0, line.time / line.anim.runTime)));
  }

  /**
   * CE `StreamLines.end_animation()`: stops the flow updater and returns an
   * animation that finishes each line's current flash cycle (or waits out its
   * warm-up) and then draws the whole line with an ease-out-sine Create, so
   * the stream lines end up fully displayed without a visible cut. Throws if
   * startAnimation() has not been called. The settle is a closed-form function
   * of the animation's progress (CE accumulates a fixed 1/frame_rate per
   * frame; at constant frame rate the two agree).
   */
  endAnimation(): AnimationGroup {
    const flow = this._flow;
    if (!flow) throw new Error("You have to start the animation before fading it out.");
    const speed = flow.speed;
    const maxRunTime = this.virtualTime / speed;
    // creation_run_time makes the Create start at the speed of the flash.
    const creationStartingSpeed = easeOutSine(0.001) * 1000;
    const creationRunTime = (maxRunTime / (1 + flow.timeWidth)) * creationStartingSpeed;
    this.removeUpdater(flow.updater);
    this._flow = null;
    const anims = (this.streamLines as any[]).map((line) => {
      const pre = line.time <= 0 ? -line.time / speed : maxRunTime - line.time / speed;
      return new StreamLineSettle(line, { time0: line.time, speed, pre, creationRunTime });
    });
    return new AnimationGroup(anims);
  }
}

/** Seeded PRNG (mulberry32): CE uses Python's `random`; ecmanim must be deterministic. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One line's end_animation: phase 1 (`pre` seconds) hides a warming-up line
 * (time <= 0, CE hide_and_wait) or finishes the running flash cycle (CE
 * finish_updater_cycle); phase 2 is `Create(line, ease_out_sine)`.
 */
class StreamLineSettle extends Animation {
  private time0: number;
  private speed: number;
  private pre: number;
  private create: Create;
  private origOpacity: number;

  constructor(line: any, cfg: { time0: number; speed: number; pre: number; creationRunTime: number }) {
    super(line, { runTime: cfg.pre + cfg.creationRunTime, rateFunc: linear });
    this.time0 = cfg.time0;
    this.speed = cfg.speed;
    this.pre = cfg.pre;
    this.create = new Create(line, { runTime: cfg.creationRunTime, rateFunc: easeOutSine });
    this.origOpacity = line.strokeOpacity ?? 1;
  }

  begin(): this {
    this.started = true;
    this.create.setup();
    this.interpolate(0);
    return this;
  }

  interpolateMobject(alpha: number): void {
    const line = this.mobject;
    const t = alpha * this.runTime; // seconds into the settle
    if (t < this.pre || (this.pre === 0 && alpha === 0)) {
      if (this.time0 <= 0) {
        line.strokeOpacity = 0; // hide_and_wait(alpha == 0)
        line.strokeStart = 0; line.strokeEnd = 0;
      } else {
        line.strokeOpacity = this.origOpacity;
        line.time = this.time0 + t * this.speed;
        line.anim.interpolate(Math.min(1, line.time / line.anim.runTime));
      }
      return;
    }
    // Phase 2.
    line.strokeOpacity = this.origOpacity; // hide_and_wait(alpha == 1)
    line.strokeStart = 0;
    const span = this.runTime - this.pre;
    this.create.interpolate(span > 0 ? (t - this.pre) / span : 1);
  }

  finish(): this {
    this.mobject.strokeOpacity = this.origOpacity;
    this.mobject.strokeStart = 0;
    this.create.finish();
    this.finished = true;
    return this;
  }
}
