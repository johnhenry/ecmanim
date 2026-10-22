// Particle presets: Aura / Explosion / Smoke / Beam. Each is a Group of
// ParticleSystems (src/mobject/particles.ts) layered into a finished look.
//
// Every layer is closed-form in (seed, index, time), so a preset is a pure
// function of ONE clock: `setTime(t)` jumps all layers (either direction),
// which makes presets scrub-safe and node-parallel-safe. By default a preset
// advances itself from scene time via an updater (`autoAdvance`, like
// ParticleSystem); pass `autoAdvance: false` and drive it with
// `setTime(scene.time - t0)` for fully explicit timing.
//
// All numeric constants below (rates, lifetimes, ramps, drag...) are authored
// for this library. Rendering is Canvas-2D only (see docs/particles.md): SVG
// and WebGL warn once per preset instead of dropping it silently.

import { Group } from "./Mobject.ts";
import type { ColorLike } from "../core/types.ts";
import { ParticleSystem } from "./particles.ts";
import type { ParticleSystemConfig } from "./particles.ts";

export interface ParticlePresetConfig {
  /** Look variant; see each preset's static `STYLES`. */
  style?: string;
  seed?: number;
  /** Uniform multiplier on emission amounts (default 1). */
  intensity?: number;
  /** Advance the clock with scene time via an updater (default true). */
  autoAdvance?: boolean;
}

type Burst = [atT: number, count: number, opts?: { speed?: [number, number]; direction?: number; spread?: number }];

/** Shared machinery: one clock, layered ParticleSystem children. */
export abstract class ParticlePreset extends Group {
  /** The preset clock (seconds); children are driven from it by setTime. */
  time = 0;
  readonly style: string;
  protected readonly _seed: number;
  protected readonly _intensity: number;
  protected readonly _autoAdvance: boolean;
  private _layerCount = 0;

  constructor(name: string, styles: readonly string[], config: ParticlePresetConfig) {
    super();
    this.style = config.style ?? styles[0];
    if (!styles.includes(this.style)) {
      throw new Error(`${name}: unknown style "${this.style}" (expected one of: ${styles.join(", ")})`);
    }
    this._seed = config.seed ?? 0;
    this._intensity = config.intensity ?? 1;
    this._autoAdvance = config.autoAdvance ?? true;
  }

  /** Add one ParticleSystem layer (never self-advancing; the preset owns the clock). */
  protected _layer(cfg: ParticleSystemConfig, bursts: Burst[] = []): ParticleSystem {
    const seed = (this._seed + 1) * 7919 + this._layerCount++ * 104729;
    const ps = new ParticleSystem({ maxParticles: 4000, maxParticlesMode: "alive", ...cfg, seed, autoAdvance: false });
    for (const [at, n, o] of bursts) ps.burst(at, Math.max(0, Math.round(n * this._intensity)), o);
    (ps as any)._presetOwner = this;
    this.add(ps);
    return ps;
  }

  /** Rate scaled by `intensity`. */
  protected _rate(r: number): number {
    return r * this._intensity;
  }

  /** Called once by the concrete constructor after its layers exist. */
  protected _finish(): void {
    if (this._autoAdvance) this._installClock();
  }

  private _installClock(): void {
    this.addUpdater((_m: any, dt: number) => { this.setTime(this.time + dt); });
  }

  /** Jump every layer to preset time `t` (seconds). Closed-form: any order. */
  setTime(t: number): this {
    this.time = t;
    for (const m of this.submobjects) if ((m as any)._isParticles) (m as ParticleSystem).setTime(t);
    return this;
  }

  copy(): this {
    const c = super.copy() as any;
    for (const m of c.submobjects) if (m._isParticles) m._presetOwner = c;
    // Mobject.copy() drops updaters; re-arm the clock on the copy.
    if (this._autoAdvance) c._installClock();
    return c;
  }
}

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Aura: a glowing halo with rising motes around a point.

export interface AuraConfig extends ParticlePresetConfig {
  style?: "flame" | "frost" | "arcane" | "radiant";
  center?: number[];
  /** Halo radius, world units (default 1). */
  radius?: number;
}

interface AuraStyle {
  glow: ColorLike[]; mote: ColorLike[]; lift: number; wobble: number; moteMaterial: "circle" | "star";
}
const AURA: Record<string, AuraStyle> = {
  flame:   { glow: ["#ffd45a", "#ff7a1a", "#a3200a"], mote: ["#fff2b0", "#ff9a2e", "#c4310f"], lift: 1.1, wobble: 0.18, moteMaterial: "circle" },
  frost:   { glow: ["#e8fbff", "#6fd0ff", "#2a5fd0"], mote: ["#ffffff", "#b6ecff", "#4a8cff"], lift: -0.35, wobble: 0.1, moteMaterial: "star" },
  arcane:  { glow: ["#f0d0ff", "#a24dff", "#3a1a8c"], mote: ["#ffffff", "#d28bff", "#7a2cff"], lift: 0.25, wobble: 0.3, moteMaterial: "star" },
  radiant: { glow: ["#fffbe0", "#ffe27a", "#e29a1c"], mote: ["#ffffff", "#fff0a0", "#ffc94d"], lift: 0.6, wobble: 0.08, moteMaterial: "star" },
};

export class Aura extends ParticlePreset {
  static readonly STYLES = ["flame", "frost", "arcane", "radiant"] as const;

  constructor(config: AuraConfig = {}) {
    super("Aura", Aura.STYLES, config);
    const s = AURA[this.style];
    const R = config.radius ?? 1;
    const c = config.center ?? [0, 0, 0];
    // Big soft additive halo.
    this._layer({
      emitterPoint: c, emitterRadius: R * 0.7, rate: this._rate(10), lifetime: [1.2, 2.2],
      speed: [0.05, 0.25], spread: TAU, direction: Math.PI / 2,
      gravity: s.lift * 0.25, size: [R * 0.9, R * 1.5], particleOpacity: [0.28, 0],
      colorRamp: s.glow, material: "soft", blendMode: "add",
      turbulence: { amplitude: R * 0.12, frequency: 0.9 },
    });
    // Rising wisps.
    this._layer({
      emitterPoint: c, emitterRadius: R, rate: this._rate(60), lifetime: [0.7, 1.5],
      speed: [0.1, 0.5], spread: TAU, gravity: s.lift, drag: 0.5,
      size: [R * 0.4, R * 0.08], particleOpacity: [0.9, 0],
      colorRamp: s.glow, material: "soft", blendMode: "add",
      turbulence: { amplitude: R * s.wobble, frequency: 1.6 },
    });
    // Bright motes.
    this._layer({
      emitterPoint: c, emitterRadius: R * 1.1, rate: this._rate(9), lifetime: [1.2, 2.6],
      speed: [0.05, 0.3], spread: TAU, gravity: s.lift * 0.6,
      size: [R * 0.14, R * 0.04], particleOpacity: [1, 0],
      colorRamp: s.mote, material: s.moteMaterial, blendMode: "add",
      turbulence: { amplitude: R * 0.2, frequency: 1.1 },
    });
    this._finish();
  }
}

// ---------------------------------------------------------------------------
// Explosion: a one-shot burst at `startTime`.

export interface ExplosionConfig extends ParticlePresetConfig {
  style?: "fire" | "plasma" | "confetti";
  center?: number[];
  /** Overall scale of the blast, world units (default 1). */
  size?: number;
  /** When the blast goes off, in preset time (default 0). */
  startTime?: number;
}

interface ExplosionStyle {
  flash: ColorLike[]; fire: ColorLike[]; spark: ColorLike[]; smoke: ColorLike[];
  sparkMaterial: "circle" | "star" | "square"; sparkGravity: number; smokeAlpha: number;
}
const EXPLOSION: Record<string, ExplosionStyle> = {
  fire:     { flash: ["#ffffff", "#ffe9a8"], fire: ["#fff4c2", "#ff9a2a", "#b3270c", "#3a0d06"], spark: ["#fff6d0", "#ffb347", "#ff4d1a"], smoke: ["#5a504a", "#2c2926"], sparkMaterial: "circle", sparkGravity: -3.5, smokeAlpha: 0.4 },
  plasma:   { flash: ["#ffffff", "#c8f4ff"], fire: ["#e9fdff", "#4fd8ff", "#7a3cff", "#1a0a4d"], spark: ["#ffffff", "#8fe9ff", "#b078ff"], smoke: ["#2d3a66", "#12172e"], sparkMaterial: "star", sparkGravity: -0.6, smokeAlpha: 0.25 },
  confetti: { flash: ["#ffffff", "#fff3b8"], fire: ["#ffe66d", "#ff6b9d", "#4ecdc4", "#a06cd5"], spark: ["#ff595e", "#ffca3a", "#8ac926", "#1982c4", "#6a4c93"], smoke: ["#ffffff", "#e8e8e8"], sparkMaterial: "square", sparkGravity: -5, smokeAlpha: 0.0 },
};

export class Explosion extends ParticlePreset {
  static readonly STYLES = ["fire", "plasma", "confetti"] as const;

  constructor(config: ExplosionConfig = {}) {
    super("Explosion", Explosion.STYLES, config);
    const s = EXPLOSION[this.style];
    const k = config.size ?? 1;
    const c = config.center ?? [0, 0, 0];
    const t0 = config.startTime ?? 0;
    // Flash: a few huge short-lived soft blobs.
    this._layer({
      emitterPoint: c, rate: 0, lifetime: [0.18, 0.3], speed: 0, size: [k * 2.4, k * 3.2],
      particleOpacity: [0.9, 0], colorRamp: s.flash, material: "soft", blendMode: "add",
    }, [[t0, 4]]);
    // Fireball.
    this._layer({
      emitterPoint: c, emitterRadius: k * 0.15, rate: 0, lifetime: [0.45, 1.0], drag: 2.4,
      size: [k * 1.4, k * 0.5], particleOpacity: [1, 0], colorRamp: s.fire,
      material: "soft", blendMode: "add",
      turbulence: { amplitude: k * 0.2, frequency: 1.4 },
    }, [[t0, 70, { speed: [k * 0.6, k * 2.8] }]]);
    // Sparks / debris.
    this._layer({
      emitterPoint: c, rate: 0, lifetime: [0.6, 1.6], gravity: s.sparkGravity * k, drag: 0.9,
      size: [k * 0.14, k * 0.04], particleOpacity: [1, 0], colorRamp: s.spark,
      material: s.sparkMaterial, blendMode: "add",
    }, [[t0, 70, { speed: [k * 2, k * 6.5] }]]);
    // Smoke (normal blending; skipped when its opacity is zero, e.g. confetti).
    if (s.smokeAlpha > 0) {
      this._layer({
        emitterPoint: c, emitterRadius: k * 0.3, rate: 0, lifetime: [1.4, 2.6], gravity: 0.4 * k, drag: 1.2,
        size: [k * 0.5, k * 1.5], particleOpacity: [s.smokeAlpha, 0], colorRamp: s.smoke,
        material: "soft", turbulence: { amplitude: k * 0.3, frequency: 0.8 },
      }, [[t0 + 0.08, 26, { speed: [k * 0.4, k * 1.4] }]]);
    }
    this._finish();
  }
}

// ---------------------------------------------------------------------------
// Smoke: a continuous rising column.

export interface SmokeConfig extends ParticlePresetConfig {
  style?: "wisp" | "billow" | "steam";
  /** Base of the column (default origin). */
  center?: number[];
  /** Source width, world units (default 0.5). */
  width?: number;
}

interface SmokeStyle {
  ramp: ColorLike[]; rate: number; size: [number, number]; opacity: [number, number];
  rise: number; life: [number, number]; sway: number; blend: "normal" | "screen";
}
const SMOKE: Record<string, SmokeStyle> = {
  wisp:   { ramp: ["#d8d8d8", "#8c8c8c"], rate: 40, size: [0.45, 1.4], opacity: [0.4, 0], rise: 0.7, life: [2.2, 3.6], sway: 0.35, blend: "normal" },
  billow: { ramp: ["#4a4642", "#26231f", "#12100e"], rate: 28, size: [0.8, 2.4], opacity: [0.6, 0], rise: 0.5, life: [2.6, 4.4], sway: 0.45, blend: "normal" },
  steam:  { ramp: ["#ffffff", "#dfeaf2"], rate: 55, size: [0.35, 1.2], opacity: [0.4, 0], rise: 1.1, life: [1.2, 2.2], sway: 0.25, blend: "screen" },
};

export class Smoke extends ParticlePreset {
  static readonly STYLES = ["wisp", "billow", "steam"] as const;

  constructor(config: SmokeConfig = {}) {
    super("Smoke", Smoke.STYLES, config);
    const s = SMOKE[this.style];
    const w = config.width ?? 0.5;
    const c = config.center ?? [0, 0, 0];
    const [x, y] = c;
    // Main puffs.
    this._layer({
      emitterLine: [[x - w / 2, y, 0], [x + w / 2, y, 0]], rate: this._rate(s.rate), lifetime: s.life,
      speed: [s.rise * 0.6, s.rise], direction: Math.PI / 2, spread: 0.5, drag: 0.35,
      size: s.size, particleOpacity: s.opacity, colorRamp: s.ramp, material: "soft", blendMode: s.blend,
      turbulence: { amplitude: s.sway, frequency: 0.7, octaves: 2 },
    });
    // Fine fast wisps riding on top.
    this._layer({
      emitterLine: [[x - w / 2, y, 0], [x + w / 2, y, 0]], rate: this._rate(s.rate * 0.6),
      lifetime: [s.life[0] * 0.6, s.life[1] * 0.6], speed: [s.rise, s.rise * 1.6],
      direction: Math.PI / 2, spread: 0.7, drag: 0.3,
      size: [s.size[0] * 0.4, s.size[1] * 0.5], particleOpacity: [s.opacity[0] * 0.8, 0],
      colorRamp: s.ramp, material: "soft", blendMode: s.blend,
      turbulence: { amplitude: s.sway * 1.3, frequency: 1.3 },
    });
    this._finish();
  }
}

// ---------------------------------------------------------------------------
// Beam: a glowing line between two points with sparks thrown off it.

export interface BeamConfig extends ParticlePresetConfig {
  style?: "laser" | "plasma" | "holy";
  from: number[];
  to: number[];
  /** Beam thickness, world units (default 0.25). */
  width?: number;
}

interface BeamStyle { core: ColorLike[]; spark: ColorLike[]; flicker: number; sparkMaterial: "circle" | "star" }
const BEAM: Record<string, BeamStyle> = {
  laser:  { core: ["#ffffff", "#ff6b6b", "#c1121f"], spark: ["#ffffff", "#ff9d9d"], flicker: 0.02, sparkMaterial: "circle" },
  plasma: { core: ["#f5ffff", "#59e0ff", "#7b3cff"], spark: ["#ffffff", "#9be9ff", "#c49bff"], flicker: 0.12, sparkMaterial: "star" },
  holy:   { core: ["#ffffff", "#ffeaa0", "#f0a823"], spark: ["#ffffff", "#fff0b8"], flicker: 0.05, sparkMaterial: "star" },
};

export class Beam extends ParticlePreset {
  static readonly STYLES = ["laser", "plasma", "holy"] as const;

  constructor(config: BeamConfig) {
    super("Beam", Beam.STYLES, config ?? ({} as BeamConfig));
    if (!config || !config.from || !config.to) throw new Error("Beam: `from` and `to` points are required");
    const s = BEAM[this.style];
    const w = config.width ?? 0.25;
    const line: [number[], number[]] = [config.from, config.to];
    const ang = Math.atan2(config.to[1] - config.from[1], config.to[0] - config.from[0]);
    // Core glow: dense, very short-lived blobs laid along the line.
    this._layer({
      emitterLine: line, rate: this._rate(320), lifetime: [0.12, 0.28], speed: 0,
      size: [w * 1.6, w * 0.9], particleOpacity: [0.5, 0], colorRamp: s.core, material: "soft", blendMode: "add",
      turbulence: s.flicker > 0.06 ? { amplitude: w * s.flicker * 3, frequency: 2.2 } : undefined,
    });
    // Bright inner streaks travelling along the beam.
    this._layer({
      emitterLine: line, rate: this._rate(160), lifetime: [0.2, 0.45], speed: [1.5, 4],
      direction: ang, spread: 0.06, size: [w * 0.5, w * 0.2], particleOpacity: [1, 0],
      colorRamp: [s.core[0], s.core[1]], material: "soft", blendMode: "add",
    });
    // Sparks thrown off both sides.
    this._layer({
      emitterLine: line, rate: this._rate(70), lifetime: [0.35, 0.9], speed: [0.3, 1.4],
      direction: ang + Math.PI / 2, spread: Math.PI, drag: 1.1, size: [w * 0.22, w * 0.05],
      particleOpacity: [1, 0], colorRamp: s.spark, material: s.sparkMaterial, blendMode: "add",
      turbulence: { amplitude: w * 0.8, frequency: 1.5 },
    });
    this._finish();
  }
}
