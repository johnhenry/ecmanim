// p5.js parity demo 02: ref/02-particle-system.js — p5.js gallery's
// "Particle System" (Nature of Code / Daniel Shiffman, credited inline in
// the ref): a `Particle`/`ParticleSystem` pair emitting short-lived,
// gravity-accelerated particles from a fixed point, fading out as they age
// ("Light grey circles flowing out from a point like a sparkler").
//
// Proves: ParticleSystem (src/mobject/particles.ts) as a drop-in for the
// classic emit-update-fade-remove pattern — no bespoke Particle class needed,
// since ParticleSystem is already a closed-form (seed, index, time) function
// covering exactly this behavior. Config mapping from the ref's per-frame
// (~60fps) physics:
//   - emitterPoint: top-center, matching `createVector(width / 2, 50)`.
//   - direction/spread: ref's velocity is `random(-1,1), random(-1,0)` px/frame
//     (canvas y-down) — an upward cone roughly 90 degrees wide centered
//     straight up. Ported to this engine's y-up world as direction=PI/2
//     (straight up), spread=PI/2.
//   - gravity: ref's `acceleration = (0, 0.05)` px/frame^2 pulls DOWN in
//     canvas y-down space; ported as a negative y (world) acceleration.
//   - lifetime: ref's `lifespan` starts at 255, -2/frame -> dies at frame
//     127.5 -> ~2.12s at the ref's default 60fps. particleOpacity defaults
//     to [1, 0], the same linear fade as `stroke(200, this.lifespan)`.
//   - rate: ref calls `system.addParticle()` once per `draw()` (~60/s at
//     the ref's default frame rate) -- ported at a slightly lower rate for
//     a legible, non-overwhelming density on a shorter clip.
//   - no emitterRadius/emitterLine: ref spawns every particle exactly at
//     the origin point, so this omits both (config default = point spawn).
//   - no drag: the ref's Particle has no drag term.
// Determinism: ParticleSystem is closed-form over (seed, index, time) with
// its own internal mulberry32 stream per particle — no Math.random() used
// here, and a fixed `seed` is passed explicitly.

import { Scene, ParticleSystem } from "../../src/node.ts";
import { demoRender } from "./_run.ts";

class ParticleSystemDemo extends Scene {
  async construct() {
    const system = new ParticleSystem({
      emitterPoint: [0, 3, 0],
      rate: 45,
      lifetime: 2.12,
      speed: [1.6, 3.0],
      direction: Math.PI / 2,
      spread: Math.PI / 2,
      gravity: -3.2,
      drag: 0,
      size: 0.32,
      particleOpacity: [1, 0],
      colorRamp: ["#DADADA"],
      seed: 5,
      maxParticles: 500,
    });
    this.add(system);

    await this.wait(6);
  }
}

await demoRender(ParticleSystemDemo, import.meta.url);
