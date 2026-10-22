// Shared case list for the ParticleSystem byte-identical-default test.
// The RNG draw order in particles.ts is a compatibility contract: these cases
// were captured from the code BEFORE turbulence/blendMode/material existed.
import { ParticleSystem } from "../src/mobject/particles.ts";

export const BASELINE_TIMES = [0, 0.37, 1.1, 2.5, 6];

export const BASELINE_CASES: Array<{ name: string; make: () => ParticleSystem }> = [
  { name: "default-seed0", make: () => new ParticleSystem({ autoAdvance: false }) },
  { name: "disc-seed7", make: () => new ParticleSystem({ seed: 7, rate: 30, emitterRadius: 0.5, gravity: -2, drag: 0.4, spread: Math.PI, autoAdvance: false }) },
  { name: "line-seed123", make: () => new ParticleSystem({ seed: 123, rate: 15, emitterLine: [[-2, 0, 0], [2, 0, 0]], colorRamp: ["#ff0000", "#00ff00", "#0000ff"], size: [0.2, 0.05], lifetime: [0.5, 3], autoAdvance: false }) },
  { name: "burst-seed99", make: () => new ParticleSystem({ seed: 99, rate: 0, emitterPoint: [1, -1, 0], emitterRadius: 0.2, gravity: [0.5, -1], autoAdvance: false }).burst(0.3, 40, { speed: [1, 4] }).burst(1.5, 25, { direction: 1, spread: 0.5 }) },
];
