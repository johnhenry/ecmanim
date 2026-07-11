// p5.js parity demo 08: ref/08-wave-interference.js — substitutes "Wavemaker"
// (p5.js gallery, LGPL; see ref/README.md's substitution note: no example
// literally titled "wave interference" exists, but Wavemaker's own
// description states it shows waves emerging from particles oscillating in
// place, combining two oscillation-source terms per particle). The ref
// combines a mouse-driven x-wave and y-wave term per particle and moves each
// particle in a circle; this port instead implements genuine two-source
// interference math directly (per the campaign brief): a grid of Dots at
// FIXED positions whose per-frame opacity is driven by the classic 2-source
// interference field
//   amplitude(x, y, t) = sin(k*r1 - w*t) + sin(k*r2 - w*t)
// where r1/r2 are each grid point's distance from two fixed wave sources, k
// is the wavenumber (2*PI/wavelength), and w is the angular frequency
// (2*PI*frequency). This is a pure function of scene TIME (accumulated via
// an updater's dt, never wall-clock) and the fixed source positions, so it
// is fully deterministic -- no seeded randomness needed since there is none.
//
// src/physics/waves.ts's LinearWave/StandingWave were checked first: both
// are 1D waveform curves (a single sine curve along an x-axis), not a 2D
// interference FIELD across a grid of points, so they don't directly cover
// this case -- hence composing the interference math directly, as the task
// brief anticipated.
//
// Visualization choice: nodal (destructive-interference) points have
// amplitude pinned at 0 for ALL time (sum-to-product identity: amplitude =
// 2*sin(k*(r1+r2)/2 - w*t)*cos(k*(r1-r2)/2), and the cos term is time-
// independent) -- so mapping opacity to |amplitude|/2 makes those points
// stay invisible against the black background forever, while antinode
// points pulse between invisible and fully opaque as the traveling sin term
// cycles. The result is a static grid of dark fringe LINES (destructive
// bands) separating regions that visibly pulse (constructive regions) --
// legible as a genuine interference pattern in any single frame, not just
// across a sequence.

import { Scene, VGroup, Dot } from "../../src/node.ts";
import { demoRender } from "./_run.ts";

class WaveInterference extends Scene {
  async construct() {
    const cols = 30;
    const rows = 17;
    const spacing = 0.42;
    const startX = -((cols - 1) * spacing) / 2;
    const startY = -((rows - 1) * spacing) / 2;

    // Two fixed wave sources, symmetric about the origin.
    const source1: [number, number] = [-2.5, 0];
    const source2: [number, number] = [2.5, 0];
    const wavelength = 1.4;
    const k = (2 * Math.PI) / wavelength;
    const frequency = 0.3; // Hz
    const omega = 2 * Math.PI * frequency;
    const color = "#38bdf8";

    const dots: Dot[] = [];
    const gridPositions: [number, number][] = [];
    for (let row = 0; row < rows; row++) {
      const y = startY + row * spacing;
      for (let col = 0; col < cols; col++) {
        const x = startX + col * spacing;
        gridPositions.push([x, y]);
        dots.push(new Dot({ point: [x, y, 0], radius: 0.09, color }));
      }
    }

    const field = new VGroup(...dots);

    const applyField = (t: number) => {
      for (let i = 0; i < dots.length; i++) {
        const [x, y] = gridPositions[i];
        const r1 = Math.hypot(x - source1[0], y - source1[1]);
        const r2 = Math.hypot(x - source2[0], y - source2[1]);
        const amplitude = Math.sin(k * r1 - omega * t) + Math.sin(k * r2 - omega * t);
        const opacity = Math.abs(amplitude) / 2; // amplitude in [-2, 2] -> opacity in [0, 1]
        dots[i].setFill(color, opacity);
      }
    };

    applyField(0); // color the very first rendered frame, before any updater tick
    this.add(field);

    let time = 0;
    field.addUpdater((_m: any, dt: number) => {
      time += dt;
      applyField(time);
    });

    await this.wait(6);
  }
}

await demoRender(WaveInterference, import.meta.url);
