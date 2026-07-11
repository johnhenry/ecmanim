// p5.js parity demo 01: ref/01-noise-field-flow.js — p5.js gallery's "Noise"
// example (substitution: no example titled "flow field" exists in the
// official corpus; this is the closest official analog — a 2D field of
// Perlin-noise values sampled per grid cell, driving each cell's dot
// diameter: `diameter = noise(x, y) * gap`, per the ref's `dotGrid()`).
//
// DESIGN CHOICE — animated over time, not static-per-frame: the ref only
// redraws when a slider changes (mouse-driven offset/gap), so a literal port
// would be one still frame for the whole clip. Since this campaign's target
// is a *video*, and the brief explicitly permits substituting "flowing" for
// static-per-frame if it better captures the "flow field" spirit, this port
// samples simplex3D(seed) with time as the third dimension — noise(x, y, t)
// — so every cell's size continuously pulses/drifts, giving the field an
// actual flow rather than a frozen snapshot. This is the more honest visual
// proof of a "noise field" primitive on a medium (video) where motion is the
// point.
//
// Proves: simplex3D (src/core/noise.ts) sampled per grid cell to drive a Dot
// grid's radius (and, as a legibility aid the 1-bit ref didn't need since it
// only modulates size, opacity too). Fully deterministic: fixed seed, no
// Math.random(). Dots are scaled in place each frame via Mobject.scale()
// about their own center (Circle/Dot has no direct radius setter — rebuilding
// bezier points every frame would be wasteful, so relative scaling from a
// tracked "current radius" is the idiomatic way to resize a Circle in place).

import { Scene, Dot, simplex3D, FRAME_WIDTH, FRAME_HEIGHT } from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const SEED = 4;
const COLS = 18;
const ROWS = 10;
const MARGIN_X = 1.0;
const MARGIN_Y = 0.9;
const X_SCALE = 0.32; // noise-space frequency across x (world units)
const Y_SCALE = 0.42; // noise-space frequency across y
const T_SCALE = 0.35; // noise-space drift speed over time
const MIN_RADIUS = 0.015;

class NoiseFieldFlow extends Scene {
  async construct() {
    const noise3 = simplex3D(SEED);

    const usableW = FRAME_WIDTH - MARGIN_X * 2;
    const usableH = FRAME_HEIGHT - MARGIN_Y * 2;
    const gapX = usableW / (COLS - 1);
    const gapY = usableH / (ROWS - 1);
    const gap = Math.min(gapX, gapY);

    // Map a raw noise value to a [0, 1] fraction, same as the ref's
    // `noise()` (p5's Perlin noise returns [0, 1] directly); simplex3D
    // returns roughly [-1, 1], so remap.
    const to01 = (n: number): number => Math.min(1, Math.max(0, (n + 1) / 2));

    const dots: Dot[] = [];
    const centers: number[][] = [];
    const radii: number[] = [];

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = -usableW / 2 + c * gapX;
        const y = usableH / 2 - r * gapY;
        const n01 = to01(noise3(x * X_SCALE, y * Y_SCALE, 0));
        // Ref: diameter = noiseValue * gap.
        const radius = Math.max(MIN_RADIUS, (n01 * gap) / 2);
        const dot = new Dot({ point: [x, y, 0], radius, color: "#58C4DD" });
        dot.setOpacity(0.3 + 0.7 * n01);
        this.add(dot);
        dots.push(dot);
        centers.push([x, y, 0]);
        radii.push(radius);
      }
    }

    dots[0].addUpdater((_m: any, _dt: number) => {
      const t = this.time;
      for (let i = 0; i < dots.length; i++) {
        const [x, y] = centers[i];
        const n01 = to01(noise3(x * X_SCALE, y * Y_SCALE, t * T_SCALE));
        const targetRadius = Math.max(MIN_RADIUS, (n01 * gap) / 2);
        const factor = targetRadius / radii[i];
        dots[i].scale(factor, { aboutPoint: centers[i] });
        radii[i] = targetRadius;
        dots[i].setOpacity(0.3 + 0.7 * n01);
      }
    });

    await this.wait(6);
  }
}

await demoRender(NoiseFieldFlow, import.meta.url);
