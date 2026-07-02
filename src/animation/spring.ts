// Remotion-style physics-based spring easing.
//
// The spring is ANALYTIC: value(frame) is a pure, closed-form function of the
// frame number with no hidden step-by-step integration state. This preserves
// manim-js's deterministic content-hash render cache — the same frame always
// yields the same value.
//
// We use the closed-form solution of a damped harmonic oscillator with the
// standard Remotion / react-spring initial conditions:
//   - at t = 0: position = `from`, velocity = 0
//   - the position offset from the target `to` decays from (from - to) to 0.
//
// Let x(t) be the position and define the offset y(t) = x(t) - to, so that
// y(0) = from - to and y'(0) = 0, and y -> 0 as t -> infinity.
//
// The ODE is  m*y'' + c*y' + k*y = 0  with
//   w0   = sqrt(k/m)                 (undamped angular frequency)
//   zeta = c / (2*sqrt(k*m))         (damping ratio)
//
// Note: `import { clamp } from "../core/math/vector.ts"` was requested, but no
// such export exists there (only a private clamp01 in color.ts). To avoid
// editing files we don't own, we define a local clamp with the requested
// signature clamp(x, min, max).

import type { RateFunc } from "../core/types.ts";

/** Clamp x into [min, max]. */
function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x;
}

export interface SpringConfig {
  mass?: number;        // default 1
  damping?: number;     // default 10
  stiffness?: number;   // default 100
  overshootClamping?: boolean; // default false
}

export interface SpringParams {
  frame: number;        // current frame (>=0)
  fps: number;          // frames per second
  from?: number;        // default 0
  to?: number;          // default 1
  config?: SpringConfig;
  durationInFrames?: number; // optional: rescale so spring settles by this frame
}

const DEFAULTS: Required<Omit<SpringConfig, "overshootClamping">> & {
  overshootClamping: boolean;
} = {
  mass: 1,
  damping: 10,
  stiffness: 100,
  overshootClamping: false,
};

function resolveConfig(config?: SpringConfig) {
  const mass = config?.mass ?? DEFAULTS.mass;
  const damping = config?.damping ?? DEFAULTS.damping;
  const stiffness = config?.stiffness ?? DEFAULTS.stiffness;
  const overshootClamping = config?.overshootClamping ?? DEFAULTS.overshootClamping;
  return { mass, damping, stiffness, overshootClamping };
}

/**
 * Closed-form damped harmonic oscillator, evaluated at time `t` seconds.
 *
 * Returns both position and velocity for a system whose offset from the target
 * starts at `offset0` (= from - to) with zero initial velocity, decaying to 0.
 * `position` is offset + to.
 */
function analytic(
  t: number,
  offset0: number,
  to: number,
  mass: number,
  damping: number,
  stiffness: number,
): { position: number; velocity: number } {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  let y: number; // offset y(t)
  let dy: number; // velocity y'(t)

  if (zeta < 1) {
    // Underdamped: oscillatory decay.
    const wd = w0 * Math.sqrt(1 - zeta * zeta); // damped angular frequency
    const envelope = Math.exp(-zeta * w0 * t);
    // y(0)=offset0, y'(0)=0 =>
    //   y(t) = e^{-zeta w0 t} [ offset0 cos(wd t) + (zeta w0 offset0 / wd) sin(wd t) ]
    const cos = Math.cos(wd * t);
    const sin = Math.sin(wd * t);
    const B = (zeta * w0 * offset0) / wd;
    y = envelope * (offset0 * cos + B * sin);
    // y'(t): derivative of the product.
    dy =
      envelope *
      ((-zeta * w0) * (offset0 * cos + B * sin) +
        (-offset0 * wd * sin + B * wd * cos));
  } else if (zeta === 1) {
    // Critically damped: y(t) = (A + B t) e^{-w0 t}, A = offset0, B = w0*offset0.
    const A = offset0;
    const B = w0 * offset0; // from y'(0)=0 => B - w0*A = 0
    const e = Math.exp(-w0 * t);
    y = (A + B * t) * e;
    dy = (B) * e + (A + B * t) * (-w0) * e; // = e*(B - w0*(A + B t))
  } else {
    // Overdamped: two real roots r1, r2.
    const disc = w0 * Math.sqrt(zeta * zeta - 1);
    const r1 = -zeta * w0 + disc;
    const r2 = -zeta * w0 - disc;
    // y = C1 e^{r1 t} + C2 e^{r2 t}, with y(0)=offset0, y'(0)=0.
    // C1 + C2 = offset0 ; r1 C1 + r2 C2 = 0  =>  C1 = -r2 offset0/(r1-r2), C2 = r1 offset0/(r1-r2)
    const denom = r1 - r2;
    const C1 = (-r2 * offset0) / denom;
    const C2 = (r1 * offset0) / denom;
    const e1 = Math.exp(r1 * t);
    const e2 = Math.exp(r2 * t);
    y = C1 * e1 + C2 * e2;
    dy = C1 * r1 * e1 + C2 * r2 * e2;
  }

  return { position: y + to, velocity: dy };
}

/**
 * Evaluate the analytic spring at `frame`.
 *
 * durationInFrames: if provided, the natural settle time is rescaled so the
 * spring settles at exactly `durationInFrames`. This warps the time axis:
 * effectiveT = t * (naturalSettleFrames / durationInFrames).
 */
export function spring(params: SpringParams): number {
  const { frame, fps } = params;
  const from = params.from ?? 0;
  const to = params.to ?? 1;
  const { mass, damping, stiffness, overshootClamping } = resolveConfig(params.config);

  const offset0 = from - to;

  let t = frame / fps;

  if (params.durationInFrames != null && params.durationInFrames > 0) {
    const natural = measureSpring({ fps, config: params.config });
    // Map frame axis: at frame == durationInFrames we want the same phase the
    // natural spring reaches at `natural` frames.
    const scale = natural / params.durationInFrames;
    t = (frame / fps) * scale;
  }

  if (t < 0) t = 0;

  const { position } = analytic(t, offset0, to, mass, damping, stiffness);

  if (overshootClamping) {
    // Prevent the value from passing `to`.
    if (to >= from) return clamp(position, from, to);
    return clamp(position, to, from);
  }

  return position;
}

/**
 * Number of frames until the spring settles (rest) for a given config + fps.
 * Steps frames until |value - to| < threshold AND velocity is small, capped at
 * fps*10 frames. This is a measurement helper only — the spring itself remains
 * analytic (each sampled frame is an independent closed-form evaluation).
 */
export function measureSpring(params: {
  fps: number;
  config?: SpringConfig;
  threshold?: number;
}): number {
  const { fps } = params;
  const threshold = params.threshold ?? 0.005;
  const { mass, damping, stiffness } = resolveConfig(params.config);

  const from = 0;
  const to = 1;
  const offset0 = from - to;
  const maxFrames = Math.ceil(fps * 10);

  // Velocity is small relative to the spring's natural scale.
  const velThreshold = threshold; // units per second, in [from,to]=[0,1] scale

  for (let frame = 0; frame <= maxFrames; frame++) {
    const t = frame / fps;
    const { position, velocity } = analytic(t, offset0, to, mass, damping, stiffness);
    if (Math.abs(position - to) < threshold && Math.abs(velocity) < velThreshold + 1e-9) {
      // Ensure a positive frame count (a spring that starts at rest still needs
      // at least 1 frame to be considered "an animation").
      return Math.max(1, frame);
    }
  }
  return maxFrames;
}

/**
 * Adapt the spring to a manim RateFunc: t in [0,1] -> eased value in [0,1].
 *
 * Samples the analytic spring over its natural settle duration (or
 * durationInFrames if provided) and normalizes so rate(0) == from == 0 and the
 * final settled value == 1.
 */
export function springRate(
  config?: SpringConfig,
  fps = 60,
  durationInFrames?: number,
): RateFunc {
  const settle = durationInFrames ?? measureSpring({ fps, config });
  return (t: number): number => {
    const tt = clamp(t, 0, 1);
    // Map the unit interval onto the settle window (in frames).
    const frame = tt * settle;
    // For t==1 we force the exact settled value (1) to avoid tiny residuals.
    if (tt >= 1) return 1;
    return spring({
      frame,
      fps,
      from: 0,
      to: 1,
      config,
      durationInFrames: settle,
    });
  };
}
