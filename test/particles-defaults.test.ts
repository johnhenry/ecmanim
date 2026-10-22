// Compatibility contract: with none of the newer options (turbulence,
// blendMode, material) set, ParticleSystem output is byte-identical to the
// pre-presets behaviour. Fixture captured from unmodified particles.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BASELINE_CASES, BASELINE_TIMES } from "./_particles_baseline_cases.ts";

const baseline = JSON.parse(readFileSync(new URL("./fixtures/particles-baseline.json", import.meta.url), "utf8"));

for (const c of BASELINE_CASES) {
  test(`particles defaults byte-identical: ${c.name}`, () => {
    const ps = c.make();
    const got = BASELINE_TIMES.map((t) => ps.sampleParticles(t).map((p) => ({ x: p.x, y: p.y, size: p.size, opacity: p.opacity, color: p.color.toHex(), life: p.life })));
    assert.equal(JSON.stringify(got), JSON.stringify(baseline[c.name]));
    assert.equal(JSON.stringify(ps.points), JSON.stringify(baseline[c.name + ":box"]));
  });
}
