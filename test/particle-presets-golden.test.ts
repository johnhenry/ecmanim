// Golden frames for the particle presets and ParticleSystem materials (#71).
// NEW fixtures only (test/golden/particles-*.png); existing goldens are untouched.
// Regenerate deliberately with UPDATE_SNAPSHOTS=1 after an intended visual change.
import { test } from "node:test";
import assert from "node:assert";
import { Scene } from "../src/scene/Scene.ts";
import { Aura, Explosion, Smoke, Beam } from "../src/mobject/particle_presets.ts";
import { ParticleSystem } from "../src/mobject/particles.ts";
import { captureFrames, matchSnapshot, loadNapiCanvas } from "./_snapshot_util.ts";

const canvasAvailable = await loadNapiCanvas().then((m) => !!m);

const sceneOf = (build: () => any[]) => class extends Scene {
  async construct() {
    this.add(...build());
    await this.wait(0.2);
  }
};

const CASES: Array<{ name: string; scene: any }> = [
  { name: "particles-aura", scene: sceneOf(() => [new Aura({ style: "arcane", seed: 3, autoAdvance: false, radius: 1.3 }).setTime(1.8)]) },
  { name: "particles-explosion", scene: sceneOf(() => [new Explosion({ style: "fire", seed: 5, autoAdvance: false, size: 1.2 }).setTime(0.55)]) },
  { name: "particles-smoke", scene: sceneOf(() => [new Smoke({ style: "billow", seed: 2, autoAdvance: false, center: [0, -3, 0], width: 0.8 }).setTime(3.5)]) },
  { name: "particles-beam", scene: sceneOf(() => [new Beam({ style: "plasma", seed: 4, autoAdvance: false, from: [-4, -1, 0], to: [4, 1, 0], width: 0.4 }).setTime(1.2)]) },
  {
    name: "particles-materials",
    scene: sceneOf(() => (["circle", "square", "soft", "star"] as const).map((m, i) =>
      new ParticleSystem({
        material: m, emitterPoint: [-3.3 + i * 2.2, 0, 0], emitterRadius: 0.5, rate: 40, lifetime: 100,
        speed: 0, size: 0.5, particleOpacity: [0.8, 0.8], colorRamp: ["#58C4DD", "#FFFF00"], seed: i + 1,
        maxParticles: 12, autoAdvance: false,
      }).setTime(1))),
  },
];

for (const c of CASES) {
  test(`snapshot: ${c.name}`, { skip: !canvasAvailable && "@napi-rs/canvas not available" }, async () => {
    const caps = await captureFrames(c.scene, [1]);
    const cap = caps.get(1)!;
    let lit = 0;
    for (let i = 0; i < cap.data.length; i += 4) if (cap.data[i] + cap.data[i + 1] + cap.data[i + 2] > 30) lit++;
    assert.ok(lit > 200, `${c.name}: frame is not blank (lit=${lit})`);
    const failure = await matchSnapshot(`${c.name}.static`, cap);
    assert.equal(failure, null, failure ?? undefined);
  });
}
