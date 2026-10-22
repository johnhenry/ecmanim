// Particle presets (#71): Aura / Explosion / Smoke / Beam.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Aura, Explosion, Smoke, Beam } from "../src/mobject/particle_presets.ts";
import { ParticleSystem } from "../src/mobject/particles.ts";
import { Group } from "../src/mobject/Mobject.ts";
import { SVGRenderer } from "../src/renderer/SVGRenderer.ts";
import { Camera } from "../src/renderer/CanvasRenderer.ts";

const makers: Array<[string, (o?: any) => any]> = [
  ["Aura", (o) => new Aura(o)],
  ["Explosion", (o) => new Explosion(o)],
  ["Smoke", (o) => new Smoke(o)],
  ["Beam", (o) => new Beam({ from: [-2, 0, 0], to: [2, 1, 0], ...o })],
];
const systems = (g: Group): ParticleSystem[] => g.submobjects.filter((m: any) => m._isParticles) as any;
const all = (g: any, t: number) => JSON.stringify(systems(g).map((s) => s.sampleParticles(t).map((p) => [p.x, p.y, p.size, p.opacity, p.life, p.color.toHex()])));

for (const [name, mk] of makers) {
  test(`${name}: is a Group of ParticleSystems with autoAdvance off`, () => {
    const g = mk();
    assert.ok(g instanceof Group);
    const s = systems(g);
    assert.ok(s.length >= 2);
    for (const c of s) assert.equal(c.updaters.length, 0, "children never self-advance");
  });

  test(`${name}: setTime(t) is closed-form and order independent`, () => {
    const a = mk({ seed: 3 }), b = mk({ seed: 3 });
    const ts = [0.8, 0.2, 1.6, 0.8];
    const fwd = ts.map((t) => { a.setTime(t); return all(a, a.time); });
    const back = [...ts].reverse().map((t) => { b.setTime(t); return all(b, b.time); }).reverse();
    assert.deepEqual(fwd, back);
    assert.ok(fwd[0].length > 20, "produces particles");
  });

  test(`${name}: different seeds differ; styles are selectable`, () => {
    const a = mk({ seed: 1 }), b = mk({ seed: 2 });
    a.setTime(1); b.setTime(1);
    assert.notEqual(all(a, 1), all(b, 1));
    const styles = (mk().constructor as any).STYLES as string[];
    assert.ok(Array.isArray(styles) && styles.length >= 2);
    const out = styles.map((s) => { const g = mk({ style: s, seed: 1 }); g.setTime(1); return all(g, 1); });
    assert.equal(new Set(out).size, styles.length, "each style looks different");
  });

  test(`${name}: autoAdvance (default) advances time via updater; false does not`, () => {
    const g = mk();
    g.update(0.5);
    assert.ok(Math.abs(g.time - 0.5) < 1e-9);
    const h = mk({ autoAdvance: false });
    h.update(0.5);
    assert.equal(h.time, 0);
  });

  test(`${name}: copy() is independent and equivalent`, () => {
    const g = mk({ seed: 4 });
    g.setTime(1.1);
    const c = g.copy();
    assert.equal(all(c, 1.1), all(g, 1.1));
    c.setTime(2);
    assert.equal(g.time, 1.1);
  });

  test(`${name}: unknown style throws`, () => {
    assert.throws(() => mk({ style: "nope" }), /style/i);
  });
}

test("Explosion: nothing before startTime, particles after", () => {
  const e = new Explosion({ startTime: 1 });
  assert.equal(systems(e).reduce((n, s) => n + s.sampleParticles(0.5).length, 0), 0);
  assert.ok(systems(e).reduce((n, s) => n + s.sampleParticles(1.3).length, 0) > 0);
});

test("Beam requires from/to and emits along the segment", () => {
  const b = new Beam({ from: [-3, 0, 0], to: [3, 0, 0], seed: 2 });
  b.setTime(1);
  const xs = systems(b).flatMap((s) => s.sampleParticles(1).map((p) => p.x));
  assert.ok(Math.min(...xs) < -2 && Math.max(...xs) > 2);
});

test("SVGRenderer warns once per particle mobject (not per frame)", () => {
  const r = new SVGRenderer(new Camera({ pixelWidth: 100, pixelHeight: 100 }));
  const ps = new ParticleSystem({ autoAdvance: false });
  const warnings: string[] = [];
  const orig = console.warn;
  console.warn = (...a: any[]) => { warnings.push(String(a[0])); };
  try { r.renderToString([ps]); r.renderToString([ps]); } finally { console.warn = orig; }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /SVG/);
  assert.match(warnings[0], /ParticleSystem/);
});

test("SVGRenderer warns once per preset, not per child", () => {
  const r = new SVGRenderer(new Camera({ pixelWidth: 100, pixelHeight: 100 }));
  const a = new Aura();
  const warnings: string[] = [];
  const orig = console.warn;
  console.warn = (...x: any[]) => { warnings.push(String(x[0])); };
  try { r.renderToString([a]); r.renderToString([a]); } finally { console.warn = orig; }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Aura/);
});
