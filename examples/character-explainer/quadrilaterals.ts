// A stick-figure presenter walks through the quadrilateral family, pointing at
// the textbook marks that define each shape (ticks = equal sides, arrows =
// parallel sides, arcs = equal angles, small squares = right angles).
//   node examples/character-explainer/quadrilaterals.ts          # hand-written plan
//   node examples/character-explainer/quadrilaterals.ts --llm [--model qwen2.5:3b] [--timeout 900]   # plan from the topic via Ollama
//   QUALITY=low node examples/character-explainer/quadrilaterals.ts
// Output: examples/character-explainer/out/quadrilaterals[-llm].mp4 (+ .plan.json); out/ is gitignored.

import { mkdirSync, writeFileSync } from "node:fs";
import { runFormat, manimRenderProvider, ollamaLLMProvider } from "../../src/authoring.ts";
import type { CharacterExplainerPlan } from "../../src/authoring.ts";

mkdirSync("examples/character-explainer/out", { recursive: true });

const plan: CharacterExplainerPlan = {
  title: "The quadrilateral family",
  tts: "system",
  visuals: [
    { id: "sq", kind: "shape", content: { type: "square", labels: { vertices: true } } },
    { id: "rect", kind: "shape", content: { type: "rectangle", labels: { vertices: true } } },
    { id: "rh", kind: "shape", content: { type: "rhombus", labels: { vertices: true } } },
    { id: "pg", kind: "shape", content: { type: "parallelogram", altitude: true, labels: { vertices: true } } },
    { id: "tz", kind: "shape", content: { type: "isosceles-trapezoid", labels: { vertices: true } } },
    { id: "kite", kind: "shape", content: { type: "kite", diagonals: true, labels: { vertices: true } } },
  ],
  beats: [
    {
      narration: "Let us meet the quadrilateral family. First, the square. <bookmark mark=\"t\"/> All four sides are equal, one tick on each, <bookmark mark=\"r\"/> and all four angles are right angles.",
      show: ["sq"],
      cues: [{ at: "start", do: "pose", pose: "wave" }, { at: "t", do: "highlight", target: "sq.ticks" }, { at: "r", do: "highlight", target: "sq.rightAngles" }],
    },
    {
      narration: "Next, the rectangle. <bookmark mark=\"r\"/> It keeps the four right angles, <bookmark mark=\"t\"/> but only opposite sides are equal. One tick and two ticks show which pairs match.",
      show: ["rect"],
      cues: [{ at: "r", do: "highlight", target: "rect.rightAngles" }, { at: "t", do: "point", target: "rect.AB" }, { at: "t", do: "highlight", target: "rect.ticks" }],
    },
    {
      narration: "A rhombus is a tilted square. <bookmark mark=\"t\"/> All four sides are equal, <bookmark mark=\"a\"/> and it has two pairs of parallel sides, marked by arrows.",
      show: ["rh"],
      cues: [{ at: "start", do: "pose", pose: "think" }, { at: "t", do: "highlight", target: "rh.ticks" }, { at: "a", do: "highlight", target: "rh.arrows" }],
    },
    {
      narration: "A parallelogram also has two pairs of parallel sides, <bookmark mark=\"a\"/> but its sides are not all equal. <bookmark mark=\"h\"/> Its height is measured straight across, at a right angle to the base.",
      show: ["pg"],
      cues: [{ at: "a", do: "highlight", target: "pg.arrows" }, { at: "h", do: "point", target: "pg.height" }, { at: "h", do: "highlight", target: "pg.height" }],
    },
    {
      narration: "A trapezoid has just one pair of parallel sides, <bookmark mark=\"a\"/> called the bases. In an isosceles trapezoid, <bookmark mark=\"l\"/> the two legs are equal, and the angles at each base match.",
      show: ["tz"],
      cues: [{ at: "a", do: "highlight", target: "tz.arrows" }, { at: "l", do: "highlight", target: "tz.ticks" }, { at: "l", do: "point", target: "tz.BC" }],
    },
    {
      narration: "Finally, the kite. <bookmark mark=\"t\"/> It has two pairs of equal neighbouring sides, <bookmark mark=\"d\"/> and its diagonals cross at right angles. That is the whole family!",
      show: ["kite"],
      cues: [{ at: "t", do: "highlight", target: "kite.ticks" }, { at: "d", do: "point", target: "kite.diagonalBD" }, { at: "end", do: "pose", pose: "celebrate" }, { at: "end", do: "fx", fx: "aura" }],
    },
  ],
};

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const useLLM = process.argv.includes("--llm");
const output = "examples/character-explainer/out/" + (useLLM ? "quadrilaterals-llm.mp4" : "quadrilaterals.mp4");
const renderOptions = { output, quality: process.env.QUALITY ?? "medium" };

let res;
if (useLLM) {
  const model = arg("--model") ?? "qwen2.5:3b";
  const timeoutSec = Number(arg("--timeout") ?? 900);
  const llm = ollamaLLMProvider({ model, timeoutMs: timeoutSec * 1000 });
  if (!(await llm.available!())) throw new Error(`Ollama is not reachable at http://localhost:11434 (start it, then \`ollama pull ${model}\`)`);
  console.log(`planning with ollama ${model}... this can take minutes on CPU (timeout ${timeoutSec}s; falls back to a built-in plan if it fails)`);
  const t0 = Date.now();
  res = await runFormat("character-explainer", { topic: "The quadrilateral family: square, rectangle, rhombus, parallelogram, trapezoid and kite", params: { tts: "system", renderOptions }, providers: { render: manimRenderProvider, llm } });
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
