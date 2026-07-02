import { test } from "node:test";
import assert from "node:assert/strict";
import { toPlanIR } from "../src/authoring/plan.ts";
import { slideshowRisk, checkDeliveryPromise, runQualityGates } from "../src/authoring/quality.ts";
import { registerFormat, registerProvider, runFormat, getFormat, listProviders } from "../src/authoring/formats.ts";
import { titleCardFormat, manimRenderProvider } from "../src/authoring/showrunner.ts";
import { Scene, Circle, FadeIn } from "../src/index.ts";

test("toPlanIR dry-runs a scene into segments + chapters + quality (no render)", async () => {
  const build = async (scene: any) => {
    scene.nextSection("intro");
    await scene.play(new FadeIn(new Circle()), { _playConfig: true, runTime: 1 });
    scene.nextSection("hold");
    await scene.wait(1);
  };
  const plan = await toPlanIR(build, { fps: 30, width: 1920, height: 1080, promise: "motion-led" });
  assert.equal(plan.version, "1");
  assert.equal(plan.config.fps, 30);
  assert.equal(plan.segments.length, 2);
  assert.equal(plan.segments[0].kind, "play");
  assert.equal(plan.segments[1].kind, "wait");
  assert.equal(plan.chapters.length, 2);
  assert.ok(plan.estimatedFrames >= 60);
  assert.ok(plan.durationSeconds >= 2 - 1e-6);
  assert.ok(plan.quality.results.length > 0);
  assert.ok(plan.quality.slideshowRisk >= 0 && plan.quality.slideshowRisk <= 1);
});

test("slideshowRisk + delivery-promise", () => {
  const allWait = { fps: 30, width: 100, height: 100, durationSeconds: 2, segments: [{ kind: "wait", startFrame: 0, endFrame: 60 }] };
  assert.ok(slideshowRisk(allWait) > 0.8);
  const p = checkDeliveryPromise({ ...allWait, promise: "motion-led" });
  assert.equal(p.ok, false);
  const lively = { fps: 30, width: 100, height: 100, durationSeconds: 2, segments: [{ kind: "play", startFrame: 0, endFrame: 60 }] };
  assert.ok(slideshowRisk(lively) < 0.2);
});

test("runQualityGates fails odd dimensions (error severity)", () => {
  const rep = runQualityGates({ fps: 30, width: 101, height: 100, durationSeconds: 1, segments: [{ kind: "play", startFrame: 0, endFrame: 30 }] });
  const dim = rep.results.find((r) => r.gate === "even_dimensions");
  assert.equal(dim!.ok, false);
  assert.equal(rep.ok, false);
});

test("Format lifecycle: plan → generateAssets → compose, requiredProviders enforced", async () => {
  const calls: string[] = [];
  registerFormat({
    name: "fake",
    requiredProviders: ["render"],
    plan: (ctx) => { calls.push("plan"); return { topic: ctx.topic }; },
    generateAssets: (p) => { calls.push("assets"); return { p }; },
    compose: (p, a, ctx) => { calls.push("compose"); return ctx.providers!.render!.invoke({ scene: null }); },
  });
  const fakeRender = { kind: "render" as const, name: "fake-render", invoke: async () => "OUT" };
  const res = await runFormat("fake", { topic: "hi", providers: { render: fakeRender } });
  assert.deepEqual(calls, ["plan", "assets", "compose"]);
  assert.equal(res.output, "OUT");
  // Missing provider throws.
  await assert.rejects(() => runFormat("fake", {}), /requires a render provider/);
});

test("showrunner: titleCardFormat + manim render provider registered", async () => {
  assert.ok(getFormat("title-card"));
  assert.ok(listProviders("render").some((p) => p.name === "ecmanim"));
  // Run the format with a FAKE render provider (no real render) to check plan/compose.
  let composed: any = null;
  const fakeRender = { kind: "render" as const, name: "fake", invoke: async (input: any) => { composed = input; return "video.mp4"; } };
  const res = await runFormat(titleCardFormat, { topic: "Fourier", params: { bullets: ["a", "b"] }, providers: { render: fakeRender } });
  assert.equal(res.plan.title, "Fourier");
  assert.deepEqual(res.plan.bullets, ["a", "b"]);
  assert.equal(res.output, "video.mp4");
  assert.equal(typeof composed.scene, "function"); // a build/construct fn was passed to render
  void manimRenderProvider;
});
