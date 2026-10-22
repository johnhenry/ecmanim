// Long-time + #78-option cases for the ParticleSystem byte-identity test (#93).
// Expected values (fixtures/particles-long-baseline.json) were captured from the
// code BEFORE the live-window optimisation; rate 20 crosses the default 2000 cap
// at t = 100.
import { ParticleSystem } from "../src/mobject/particles.ts";

export const LONG_TIMES = [0.5, 10, 50, 99.9, 100.05, 101, 250];

export const LONG_CASES: Array<{ name: string; make: () => ParticleSystem }> = [
  { name: "long-default", make: () => new ParticleSystem({ autoAdvance: false }) },
  { name: "long-disc-drag", make: () => new ParticleSystem({ seed: 7, rate: 20, emitterRadius: 0.5, gravity: -2, drag: 0.4, lifetime: [0.5, 3], autoAdvance: false }) },
  { name: "long-reversed-lifetime", make: () => new ParticleSystem({ seed: 3, lifetime: [2, 1], autoAdvance: false }) },
  { name: "long-lowcap", make: () => new ParticleSystem({ seed: 5, rate: 20, maxParticles: 300, autoAdvance: false }) },
  { name: "long-options", make: () => new ParticleSystem({ seed: 11, rate: 20, turbulence: { amplitude: 0.3, frequency: 0.8, octaves: 2 }, material: "soft", blendMode: "add", colorRamp: ["#ff0000", "#0000ff"], autoAdvance: false }) },
  { name: "long-bursts", make: () => new ParticleSystem({ seed: 99, rate: 20, autoAdvance: false }).burst(0.3, 40, { speed: [1, 4] }).burst(120, 25) },
];

export function snapshot(ps: ParticleSystem, t: number) {
  return ps.sampleParticles(t).map((p) => ({ x: p.x, y: p.y, size: p.size, opacity: p.opacity, color: p.color.toHex(), life: p.life }));
}
export function captureCase(ps: ParticleSystem) {
  return { samples: LONG_TIMES.map((t) => snapshot(ps, t)), composite: (ps as any).compositeOperation ?? null, shape: ps.shape, material: ps.material, box: ps.points };
}
