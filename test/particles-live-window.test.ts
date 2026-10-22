// #93: continuous-stream sampling only visits indices that can be alive, and
// the opt-in maxParticlesMode "alive" lifts the total-births cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ParticleSystem } from "../src/mobject/particles.ts";
import { LONG_CASES, captureCase } from "./_particles_long_cases.ts";

const baseline = JSON.parse(readFileSync(new URL("./fixtures/particles-long-baseline.json", import.meta.url), "utf8"));

for (const c of LONG_CASES) {
  test(`long-time output byte-identical to pre-window code: ${c.name}`, () => {
    assert.equal(JSON.stringify(captureCase(c.make())), JSON.stringify(baseline[c.name]));
  });
}

function countEmits(ps: ParticleSystem, t: number): number {
  let n = 0;
  const orig = (ps as any)._emit.bind(ps);
  (ps as any)._emit = (...a: any[]) => { n++; return orig(...a); };
  ps.sampleParticles(t);
  return n;
}

test("perf shape: _emit calls are O(alive window), not O(total births)", () => {
  const ps = new ParticleSystem({ rate: 20, lifetime: [1, 2], maxParticles: 1e9, autoAdvance: false });
  const small = countEmits(ps, 10);
  const huge = countEmits(ps, 100000);
  // window ~ rate * lifetimeMax = 40 (+ small slack), independent of t
  assert.ok(huge <= 50, `huge t visited ${huge}`);
  assert.ok(Math.abs(huge - small) <= 5);
  // bursts that are not yet born / long dead cost nothing
  const b = new ParticleSystem({ rate: 0, autoAdvance: false }).burst(5, 1000).burst(0, 1000);
  assert.equal(countEmits(b, 1), 1000); // only the t=0 burst can be alive
  assert.equal(countEmits(b, 1000), 0);
});

test("default mode 'total' still stops after maxParticles births", () => {
  const ps = new ParticleSystem({ rate: 20, maxParticles: 100, lifetime: [1, 2], autoAdvance: false });
  assert.equal(ps.sampleParticles(1000).length, 0);
  assert.ok(ps.sampleParticles(4).length > 0);
});

test("alive mode: runs indefinitely, matches total mode below the cap", () => {
  const mk = (mode?: "total" | "alive") =>
    new ParticleSystem({ seed: 4, rate: 20, maxParticles: 2000, maxParticlesMode: mode, autoAdvance: false });
  const a = mk("alive"), d = mk();
  for (const t of [0, 0.4, 7, 50, 99.9]) {
    assert.equal(JSON.stringify(a.sampleParticles(t)), JSON.stringify(d.sampleParticles(t)));
  }
  assert.equal(d.sampleParticles(1000).length, 0);
  assert.ok(a.sampleParticles(1000).length > 20);
  assert.ok(a.sampleParticles(100000).length > 20);
});

test("alive mode: at most maxParticles alive, most recent kept, seek-safe", () => {
  const mk = () => new ParticleSystem({ seed: 2, rate: 100, lifetime: [1, 2], maxParticles: 30, maxParticlesMode: "alive", autoAdvance: false });
  const ps = mk();
  const uncapped = new ParticleSystem({ seed: 2, rate: 100, lifetime: [1, 2], maxParticles: 1e9, maxParticlesMode: "alive", autoAdvance: false });
  const t = 77.7;
  const got = ps.sampleParticles(t);
  const all = uncapped.sampleParticles(t);
  assert.ok(all.length > 30);
  assert.equal(got.length, 30);
  // the most recent 30 alive (they are the tail of the index-ordered list)
  assert.equal(JSON.stringify(got), JSON.stringify(all.slice(-30)));
  // seek-safe: order of queries / fresh instance doesn't matter
  ps.sampleParticles(500); ps.sampleParticles(1);
  assert.equal(JSON.stringify(ps.sampleParticles(t)), JSON.stringify(got));
  assert.equal(JSON.stringify(mk().sampleParticles(t)), JSON.stringify(got));
  // perf shape stays bounded in alive mode too
  assert.ok(countEmits(ps, 1e6) <= 250);
});

test("presets run past the old 4000-birth cap", async () => {
  const { Smoke, Aura, Beam, Explosion } = await import("../src/mobject/particle_presets.ts");
  const layers = (p: any) => p.submobjects.filter((m: any) => m._isParticles);
  for (const p of [new Smoke({ autoAdvance: false }), new Aura({ autoAdvance: false }), new Beam({ from: [-1, 0, 0], to: [1, 0, 0], autoAdvance: false })]) {
    p.setTime(5000);
    assert.ok(layers(p).some((l: any) => l.sampleParticles().length > 0), p.constructor.name);
  }
  const e = new Explosion({ autoAdvance: false });
  e.setTime(5000);
  assert.ok(layers(e).length > 0);
});
