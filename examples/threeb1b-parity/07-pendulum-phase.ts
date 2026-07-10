// Recreation of the pendulum phase-space visual ("Differential equations,
// a tourist's guide", 3b1b, 2019): the (theta, omega) phase plane for
// theta'' = -(g/L) sin(theta) - mu*theta', with a magnitude-colored vector
// field, integrated streamlines spiraling into the attractor, and one
// highlighted trajectory whose dot drives a small synced pendulum inset.
// Recreation of the visual, not a code port.

import {
  Scene, Axes, Text, Dot, Line, Circle, Rectangle, VGroup,
  ArrowVectorField, StreamLines, TracedPath, UpdateFromAlphaFunc,
  FadeIn, Create,
  YELLOW, WHITE, GRAY,
} from "../../src/node.ts";
import { linear } from "../../src/animation/rate_functions.ts";
import { demoRender } from "./_run.ts";

const G_OVER_L = 3;
const MU = 0.3;

// Phase-space velocity: d/dt [theta, omega].
const field = (p: number[]): number[] =>
  [p[1], -G_OVER_L * Math.sin(p[0]) - MU * p[1], 0];

// RK4 integration of the highlighted trajectory from (theta0, omega0).
function integrate(theta0: number, omega0: number, T: number, dt: number): number[][] {
  const out: number[][] = [[theta0, omega0, 0]];
  let p = [theta0, omega0, 0];
  const steps = Math.round(T / dt);
  for (let s = 0; s < steps; s++) {
    const k1 = field(p);
    const k2 = field([p[0] + k1[0] * dt / 2, p[1] + k1[1] * dt / 2, 0]);
    const k3 = field([p[0] + k2[0] * dt / 2, p[1] + k2[1] * dt / 2, 0]);
    const k4 = field([p[0] + k3[0] * dt, p[1] + k3[1] * dt, 0]);
    p = [
      p[0] + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
      p[1] + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
      0,
    ];
    out.push([...p]);
  }
  return out;
}

class PendulumPhase extends Scene {
  async construct() {
    // Axes sized so world coordinates == phase coordinates (identity c2p):
    // theta on x in [-6, 6], omega on y in [-3, 3].
    const axes = new Axes({
      xRange: [-6, 6, 1], yRange: [-3, 3, 1],
      xLength: 12, yLength: 6,
      axisConfig: { color: GRAY, strokeWidth: 1.5 },
      tips: false,
    });
    const thetaLabel = new Text("θ", { fontSize: 0.42, color: WHITE });
    thetaLabel.moveTo([6.25, 0.35, 0]);
    const omegaLabel = new Text("ω", { fontSize: 0.42, color: WHITE });
    omegaLabel.moveTo([0.35, 3.25, 0]);
    await this.play(new FadeIn(axes), new FadeIn(thetaLabel), new FadeIn(omegaLabel),
      { _playConfig: true, runTime: 1 });

    // Beat 1: the vector field, colored by magnitude, fades in.
    const arrows = new ArrowVectorField(field, {
      xRange: [-6, 6], yRange: [-3, 3], step: 0.6,
      maxColorScheme: 4.5,
      strokeWidth: 2.5,
    });
    for (const a of arrows.submobjects as any[]) a.setOpacity?.(0.8);
    await this.play(new FadeIn(arrows), { _playConfig: true, runTime: 2 });
    await this.wait(0.5);

    // Beat 2: streamlines (RK4-integrated in src/mobject/vector_field.ts)
    // flow in, tracing the spiral descent into the attractor at theta = 0.
    const streams = new StreamLines(field, {
      xRange: [-6, 6, 0.75], yRange: [-3, 3, 0.75],
      maxColorScheme: 4.5,
      strokeWidth: 1.5, dt: 0.04, virtualTime: 2.5, maxAnchorsPerLine: 80,
    });
    for (const line of streams.getLines()) line.strokeOpacity = 0.55;
    await this.play(new Create(streams, { lagRatio: 0.003, runTime: 3 }));
    await this.wait(0.5);

    // Beat 3: one highlighted trajectory from (2.5, 0) + synced pendulum inset.
    const T = 10; // simulated seconds
    const traj = integrate(2.5, 0, T, 0.005);
    const at = (t: number): number[] => traj[Math.min(traj.length - 1, Math.round((t / T) * (traj.length - 1)))];

    const dot = new Dot({ point: at(0), radius: 0.09, color: YELLOW });
    const trail = new TracedPath(() => dot.getCenter(), { strokeColor: YELLOW, strokeWidth: 3.5 });

    // Corner inset: a pendulum (pivot + rod + bob) driven by the SAME theta —
    // world x of the phase dot IS theta (identity axes), so the updater reads
    // it straight off the dot every frame.
    const pivotP = [4.9, 2.7, 0];
    const RODL = 1.15;
    const bobAt = (theta: number): number[] =>
      [pivotP[0] + RODL * Math.sin(theta), pivotP[1] - RODL * Math.cos(theta), 0];
    // Dark backdrop so the inset reads against the busy field behind it.
    const backdrop = new Rectangle({
      width: 2.8, height: 2.8,
      fillColor: "#171d23", fillOpacity: 0.88,
      strokeColor: GRAY, strokeWidth: 1, strokeOpacity: 0.5,
    });
    backdrop.moveTo([pivotP[0], pivotP[1] - 0.55, 0]);
    const swingGuide = new Circle({ radius: RODL, strokeColor: GRAY, strokeWidth: 1, strokeOpacity: 0.35, fillOpacity: 0 });
    swingGuide.moveTo(pivotP);
    const pivot = new Dot({ point: pivotP, radius: 0.05, color: GRAY });
    const rod = new Line(pivotP, bobAt(2.5), { strokeColor: WHITE, strokeWidth: 2.5 });
    const bob = new Dot({ point: bobAt(2.5), radius: 0.12, color: YELLOW });
    const pendulum = new VGroup(backdrop, swingGuide, pivot, rod, bob);
    pendulum.addUpdater(() => {
      const theta = dot.getCenter()[0];
      rod.putStartAndEndOn(pivotP, bobAt(theta));
      bob.moveTo(bobAt(theta));
    });

    this.add(trail, dot);
    await this.play(new FadeIn(pendulum), { _playConfig: true, runTime: 0.8 });
    await this.play(new UpdateFromAlphaFunc(dot, (m: any, a: number) => m.moveTo(at(a * T)),
      { runTime: 7, rateFunc: linear }));
    await this.wait(1.5);
  }
}

await demoRender(PendulumPhase, import.meta.url);
