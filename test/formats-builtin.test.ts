// Built-in formats (explainer / chart-reveal / quote-card): behavioral tests.
// A fake render provider executes each format's build function against a real
// headless Scene (no canvas), so these verify actual scene construction —
// sections, animation counts, timing — not just that plan() returns an object.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runFormat, getFormat } from "../src/authoring/formats.ts";
import { explainerFormat, chartRevealFormat, quoteCardFormat } from "../src/authoring/formats_builtin.ts";
import type { Provider } from "../src/authoring/formats.ts";
import { Scene } from "../src/scene/Scene.ts";

/** Render provider that dry-runs the scene and returns it for inspection. */
const inspectRender: Provider = {
  kind: "render",
  name: "inspect",
  async invoke(input: { scene: any; options?: any }) {
    const scene = new Scene({ fps: 15 });
    scene.frameHandler = async () => {};
    await input.scene(scene);
    return { scene, options: input.options };
  },
};

test("formats are registered", () => {
  assert.ok(getFormat("explainer"));
  assert.ok(getFormat("chart-reveal"));
  assert.ok(getFormat("quote-card"));
});

test("explainer: builds title + sections + outro with real animations and sections", async () => {
  const res = await runFormat(explainerFormat, {
    params: {
      title: "How caching works",
      subtitle: "in 90 seconds",
      sections: [
        { heading: "The problem", bullets: ["recomputing is slow", "results rarely change"] },
        { heading: "The idea", bullets: ["hash the inputs"], diagram: "A[Input] --> B[Hash]\nB --> C[Store]" },
      ],
      outro: "Cache it.",
    },
    providers: { render: inspectRender },
  });
  const scene: Scene = res.output.scene;
  const secNames = scene.sections.map((s: any) => s.name);
  assert.deepEqual(secNames, ["title", "The problem", "The idea", "outro"]);
  const plays = scene.playRecords.filter((r: any) => r.kind === "play");
  // title Write + subtitle FadeIn + title FadeOut + per-section (Write + bullets + [Create board] + FadeOut) + outro FadeIn
  assert.ok(plays.length >= 9, `expected >=9 plays, got ${plays.length}`);
  assert.ok(scene.time > 8, `explainer should run several seconds, got ${scene.time}`);
  assert.equal(res.plan.tts, "silent");
});

test("explainer: plan falls back deterministically without sections or llm", async () => {
  const plan = await explainerFormat.plan({ topic: "Topic X" });
  assert.equal(plan.title, "Topic X");
  assert.equal(plan.sections.length, 1);
});

test("explainer: optional llm provider expands sections", async () => {
  const fakeLlm: Provider = {
    kind: "llm", name: "fake",
    async invoke() { return [{ heading: "H1", bullets: ["b"], narration: "n" }]; },
  };
  const plan = await explainerFormat.plan({ topic: "T", providers: { llm: fakeLlm } });
  assert.equal(plan.sections.length, 1);
  assert.equal(plan.sections[0].heading, "H1");
});

test("chart-reveal: one GrowFromEdge per bar, values scale to the max", async () => {
  const res = await runFormat(chartRevealFormat, {
    params: {
      title: "Renders per day",
      data: [{ label: "Mon", value: 4 }, { label: "Tue", value: 9 }, { label: "Wed", value: 6 }],
    },
    providers: { render: inspectRender },
  });
  const scene: Scene = res.output.scene;
  const plays = scene.playRecords.filter((r: any) => r.kind === "play");
  // title Write + baseline Create + 3 * (grow + value FadeIn) = 8
  assert.equal(plays.length, 8);
  assert.equal(res.plan.data.length, 3);
});

test("chart-reveal: rejects missing or bad data", async () => {
  await assert.rejects(() => Promise.resolve(chartRevealFormat.plan({ params: {} })), /data.*required/);
  await assert.rejects(
    () => Promise.resolve(chartRevealFormat.plan({ params: { data: [{ label: "x", value: NaN }] } })),
    /bad value/,
  );
});

test("quote-card: renders quote + attribution, passes the aspect preset through", async () => {
  const res = await runFormat(quoteCardFormat, {
    params: { quote: "Make it work, make it right, make it fast.", attribution: "Kent Beck", aspectRatio: "9:16" },
    providers: { render: inspectRender },
  });
  const scene: Scene = res.output.scene;
  assert.ok(scene.playRecords.some((r: any) => r.kind === "play"));
  assert.equal(res.output.options.aspectRatio, "9:16");
  assert.ok(scene.time > 2.5, "holds after the write");
});

test("quote-card: requires a quote", async () => {
  await assert.rejects(() => Promise.resolve(quoteCardFormat.plan({ params: {} })), /quote.*required/);
});
