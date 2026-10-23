// A stick-figure presenter explains the Pythagorean theorem, synced to its own
// speech (espeak-ng via tts: "system"; falls back to estimated timing if absent).
//   node examples/character-explainer/pythagoras.ts          # hand-written plan
//   node examples/character-explainer/pythagoras.ts --llm    # plan from just the topic via local Ollama (qwen2.5:3b)
//   node examples/character-explainer/pythagoras.ts --llm --model qwen2.5:3b --timeout 900   (seconds)
//   QUALITY=low node examples/character-explainer/pythagoras.ts
// Output: examples/character-explainer/out/pythagoras.mp4 (out/ is gitignored)

import { mkdirSync, writeFileSync } from "node:fs";
import { runFormat, manimRenderProvider, ollamaLLMProvider } from "../../src/authoring.ts";
import type { CharacterExplainerPlan } from "../../src/authoring.ts";

mkdirSync("examples/character-explainer/out", { recursive: true });

const plan: CharacterExplainerPlan = {
  title: "The Pythagorean Theorem",
  tts: "system",
  visuals: [
    { id: "formula", kind: "math", content: "a^2 + b^2 = c^2" },
    { id: "tri", kind: "diagram", content: "A[Leg a] --> C[Hypotenuse c]\nB[Leg b] --> C" },
    { id: "squares", kind: "chart", content: [{ label: "a squared", value: 9 }, { label: "b squared", value: 16 }, { label: "c squared", value: 25 }] },
  ],
  beats: [
    {
      narration: "Hi there! Today we are looking at one of the most famous ideas in geometry, the Pythagorean theorem. <bookmark mark=\"f\"/> It says that a squared plus b squared equals c squared.",
      show: ["formula"],
      cues: [
        { at: "start", do: "pose", pose: "wave" },
        { at: "f", do: "point", target: "formula" },
      ],
    },
    {
      narration: "It is about right triangles, the ones with a square corner. <bookmark mark=\"legs\"/> The two shorter sides are called the legs, <bookmark mark=\"hyp\"/> and the longest side, opposite the corner, is the hypotenuse.",
      show: ["tri"],
      cues: [
        { at: "start", do: "pose", pose: "think" },
        { at: "legs", do: "point", target: "tri" },
        { at: "hyp", do: "camera", camera: "pulse" },
      ],
    },
    {
      narration: "Let us test it with legs of three and four. <bookmark mark=\"sq\"/> Three squared is nine, four squared is sixteen, and nine plus sixteen is twenty five. <bookmark mark=\"ok\"/> So the hypotenuse is exactly five. It works!",
      show: ["squares"],
      cues: [
        { at: "sq", do: "point", target: "squares" },
        { at: "ok", do: "camera", camera: "impact" },
        { at: "ok", do: "pose", pose: "excited" },
        { at: "ok", do: "fx", fx: "explosion", target: "squares" },
      ],
    },
    {
      narration: "Builders, map makers and game designers use this every day to find distances. <bookmark mark=\"bye\"/> Now go and find a right triangle of your own!",
      cues: [
        { at: "start", do: "pose", pose: "shrug" },
        { at: "bye", do: "pose", pose: "celebrate" },
        { at: "end", do: "fx", fx: "aura" },
      ],
    },
  ],
};

const useLLM = process.argv.includes("--llm");
const quality = process.env.QUALITY ?? "medium";
const output = "examples/character-explainer/out/" + (useLLM ? "pythagoras-llm.mp4" : "pythagoras.mp4");
const renderOptions = { output, quality };

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

let res;
if (useLLM) {
  const model = arg("--model") ?? "qwen2.5:3b";
  const timeoutSec = Number(arg("--timeout") ?? 900);
  const llm = ollamaLLMProvider({ model, timeoutMs: timeoutSec * 1000 });
  if (!(await llm.available!())) throw new Error(`Ollama is not reachable at http://localhost:11434 (start it, then \`ollama pull ${model}\`)`);
  console.log(`planning with ollama ${model}... this can take minutes on CPU (timeout ${timeoutSec}s; falls back to a built-in plan if it fails)`);
  const t0 = Date.now();
  res = await runFormat("character-explainer", {
    topic: "The Pythagorean theorem",
    params: { tts: "system", renderOptions },
    providers: { render: manimRenderProvider, llm },
  });
  console.log(`plan + render finished in ${((Date.now() - t0) / 1000).toFixed(0)}s; plan has ${res.plan.beats.length} beats`);
} else {
  res = await runFormat("character-explainer", { topic: plan.title, params: { ...plan, renderOptions }, providers: { render: manimRenderProvider } });
}
const planPath = output.replace(/\.mp4$/, ".plan.json");
writeFileSync(planPath, JSON.stringify(res.plan, null, 2));
console.log("plan saved to", planPath);
for (const w of res.plan.warnings ?? []) console.warn("plan warning:", w);
console.log(`wrote ${res.output.output} (${res.output.frames} frames, ${(res.output.frames / res.output.fps).toFixed(1)}s)`);
console.log("quality:", res.output.quality.ok ? "ok" : "FAILED", res.output.quality.results.filter((r: any) => !r.ok).map((r: any) => `${r.gate}: ${r.message}`));
