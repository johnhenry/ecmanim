// Cross-feature smoke test for epic #61: one scene combining outgoing-easing
// pose tracks, IK with a joint limit, a rig constraint, a looping Clip, an
// "alive"-mode particle preset and camera shake, rendered headlessly to APNG
// and to GIF with the first-party JS encoders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const D = Math.PI / 180;
const OPTS = { quality: "low", fps: 8, resolution: [96, 54] as [number, number], disableCaching: true, verbose: false };

async function buildScene() {
  const { Skeleton, poseTrack, Clip, IKChain } = await import("../src/skeletal.ts");
  const { Aura } = await import("../src/mobject/particle_presets.ts");
  const { CameraShake } = await import("../src/index.ts");
  const { Dot } = await import("../src/mobject/geometry.ts");
  return async (s: any) => {
    const fig = new Skeleton(
      [
        { id: "torso", parent: null, length: 1.2, angle: 90 * D },
        { id: "armL", parent: "torso", length: 0.8, angle: 140 * D, limits: { min: 20 * D, max: 170 * D } },
        { id: "handL", parent: "armL", length: 0.6, angle: 10 * D },
        { id: "head", parent: "torso", length: 0.3 },
      ],
      { joints: true },
    );
    // Pose track with outgoing "auto" easing on the keyframes.
    fig.bindPoseTrack(poseTrack([
      { t: 0, value: { bones: { armL: { angle: 140 * D } } }, easeOut: "auto" },
      { t: 0.5, value: { bones: { armL: { angle: 60 * D } } }, easeOut: "auto" },
      { t: 1, value: { bones: { armL: { angle: 140 * D } } } },
    ] as any));
    // Rig constraint: keep the head upright regardless of the pose.
    fig.addConstraint({ type: "angleLock", bone: "head", reference: "world", multiplier: 0, offset: 90 * D });
    // IK on the arm chain (the limit on armL is honoured by IK only).
    const target = new Dot({ point: [1.2, 1.4, 0] } as any);
    const ik = new IKChain(fig, { bones: ["armL", "handL"], target, bendSide: "left" });
    ik.solve();
    const walker = new Clip(fig, { mode: "loop", duration: 1 });
    s.add(walker, new Aura({ seed: 7 }));
    s.camera.addEffect(new CameraShake({ seed: 3, amplitude: 0.05 }));
    await s.wait(0.75);
  };
}

function frameCount(b: Uint8Array, kind: "apng" | "gif"): number {
  if (kind === "apng") {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let n = 0;
    for (let o = 8; o < b.length; o += 12 + v.getUint32(o)) {
      if (String.fromCharCode(...b.subarray(o + 4, o + 8)) === "fcTL") n++;
    }
    return n;
  }
  let n = 0;
  for (let i = 0; i < b.length - 3; i++) if (b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 4) n++;
  return n;
}

test("epic #61 combined scene renders to APNG + GIF with the JS encoders, deterministically", async () => {
  const { render } = await import("../src/node.ts");
  const scene = await buildScene();
  const dir = mkdtempSync(join(tmpdir(), "epic61-"));
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...a: any[]) => { warnings.push(a.map(String).join(" ")); };
  try {
    const run = async (name: string, format: string, encoder?: string) => {
      const out = join(dir, name);
      const res = await render(scene, { ...OPTS, output: out, format, ...(encoder ? { encoder } : {}) } as any);
      return { res, bytes: new Uint8Array(readFileSync(out)) };
    };
    const a1 = await run("a1.apng", "apng", "js");
    const a2 = await run("a2.apng", "apng", "js");
    const g1 = await run("g1.gif", "gif", "js");
    const g2 = await run("g2.gif", "gif", "js");

    assert.deepEqual(Array.from(a1.bytes.subarray(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(Buffer.from(g1.bytes.subarray(0, 6)).toString("latin1"), "GIF89a");
    assert.ok(a1.res.frames >= 6, `frames=${a1.res.frames}`);
    assert.equal(frameCount(a1.bytes, "apng"), a1.res.frames);
    assert.equal(frameCount(g1.bytes, "gif"), g1.res.frames);
    assert.equal(a1.res.frames, g1.res.frames);

    assert.ok(Buffer.from(a1.bytes).equals(Buffer.from(a2.bytes)), "APNG render is deterministic");
    assert.ok(Buffer.from(g1.bytes).equals(Buffer.from(g2.bytes)), "GIF render is deterministic");
    assert.deepEqual(warnings, [], "no unexpected console.warn on the Canvas path");
  } finally {
    console.warn = origWarn;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("epic #61 combined scene: pose track, limit, constraint and clip agree", async () => {
  const { Skeleton, poseTrack, Clip } = await import("../src/skeletal.ts");
  const fig = new Skeleton([
    { id: "torso", parent: null, length: 1, angle: 90 * D },
    { id: "armL", parent: "torso", length: 1, angle: 90 * D, limits: { min: 20 * D, max: 100 * D } },
    { id: "head", parent: "torso", length: 0.3 },
  ]);
  fig.bindPoseTrack(poseTrack([
    { t: 0, value: { bones: { armL: { angle: 30 * D } } }, easeOut: "auto" },
    { t: 1, value: { bones: { armL: { angle: 90 * D } } } },
  ] as any));
  fig.addConstraint({ type: "angleLock", bone: "head", reference: "world", multiplier: 0, offset: 90 * D });
  const clip = new Clip(fig, { mode: "loop", duration: 1 });
  clip.seek(0.25);
  const a = fig.model.boneWorldAngle("armL");
  clip.seek(1.25);
  assert.ok(Math.abs(fig.model.boneWorldAngle("armL") - a) < 1e-9, "loop wraps");
  assert.ok(Math.abs(fig.model.boneWorldAngle("head") - 90 * D) < 1e-9, "constraint holds after clip seek");
});
