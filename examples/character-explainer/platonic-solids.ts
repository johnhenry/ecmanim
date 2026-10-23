// A stick-figure presenter tours the five Platonic solids, each one spinning
// (a pure function of scene time), pointing at a face or a vertex.
//   node examples/character-explainer/platonic-solids.ts
//   QUALITY=low node examples/character-explainer/platonic-solids.ts
// Output: examples/character-explainer/out/platonic-solids.mp4 (+ .plan.json); out/ is gitignored.

import { mkdirSync, writeFileSync } from "node:fs";
import { runFormat, manimRenderProvider } from "../../src/authoring.ts";
import type { CharacterExplainerPlan } from "../../src/authoring.ts";

mkdirSync("examples/character-explainer/out", { recursive: true });

const spin = 28;
const plan: CharacterExplainerPlan = {
  title: "The five Platonic solids",
  tts: "system",
  visuals: [
    { id: "tet", kind: "shape", content: { type: "tetrahedron", spin } },
    { id: "cube", kind: "shape", content: { type: "cube", spin } },
    { id: "oct", kind: "shape", content: { type: "octahedron", spin } },
    { id: "dod", kind: "shape", content: { type: "dodecahedron", spin } },
    { id: "ico", kind: "shape", content: { type: "icosahedron", spin } },
    { id: "t4", kind: "text", content: "Tetrahedron: 4 faces" },
    { id: "t6", kind: "text", content: "Cube: 6 faces" },
    { id: "t8", kind: "text", content: "Octahedron: 8 faces" },
    { id: "t12", kind: "text", content: "Dodecahedron: 12 faces" },
    { id: "t20", kind: "text", content: "Icosahedron: 20 faces" },
  ],
  beats: [
    {
      narration: "Welcome to the five Platonic solids. Every face is the same regular polygon, and the same number of faces meet at every corner. We start with the tetrahedron. <bookmark mark=\"f\"/> It has four triangular faces, <bookmark mark=\"v\"/> and three of them meet at each vertex.",
      show: ["tet", "t4"],
      cues: [{ at: "start", do: "pose", pose: "wave" }, { at: "f", do: "point", target: "tet.face0" }, { at: "f", do: "highlight", target: "tet.face0" }, { at: "v", do: "highlight", target: "tet.vertex0" }],
    },
    {
      narration: "Next, the cube. <bookmark mark=\"f\"/> Six square faces, <bookmark mark=\"e\"/> twelve edges, <bookmark mark=\"v\"/> and eight vertices.",
      show: ["cube", "t6"],
      cues: [{ at: "f", do: "point", target: "cube.face2" }, { at: "f", do: "highlight", target: "cube.face2" }, { at: "e", do: "highlight", target: "cube.edge0" }, { at: "v", do: "highlight", target: "cube.vertex1" }],
    },
    {
      narration: "The octahedron <bookmark mark=\"f\"/> has eight triangular faces, like two square pyramids glued base to base.",
      show: ["oct", "t8"],
      cues: [{ at: "start", do: "pose", pose: "think" }, { at: "f", do: "point", target: "oct.face1" }, { at: "f", do: "highlight", target: "oct.face1" }],
    },
    {
      narration: "The dodecahedron <bookmark mark=\"f\"/> is built from twelve regular pentagons.",
      show: ["dod", "t12"],
      cues: [{ at: "f", do: "point", target: "dod.face0" }, { at: "f", do: "highlight", target: "dod.face0" }, { at: "f", do: "camera", camera: "pulse" }],
    },
    {
      narration: "And last, the icosahedron, <bookmark mark=\"f\"/> with twenty triangular faces. <bookmark mark=\"v\"/> Five of them meet at every vertex. That is all five!",
      show: ["ico", "t20"],
      cues: [{ at: "f", do: "point", target: "ico.face3" }, { at: "v", do: "highlight", target: "ico.vertex0" }, { at: "end", do: "pose", pose: "celebrate" }, { at: "end", do: "fx", fx: "aura" }],
    },
  ],
};

const output = "examples/character-explainer/out/platonic-solids.mp4";
const res = await runFormat("character-explainer", { topic: plan.title, params: { ...plan, renderOptions: { output, quality: process.env.QUALITY ?? "medium" } }, providers: { render: manimRenderProvider } });
const planPath = output.replace(/\.mp4$/, ".plan.json");
writeFileSync(planPath, JSON.stringify(res.plan, null, 2));
for (const w of res.plan.warnings ?? []) console.warn("plan warning:", w);
console.log(`wrote ${res.output.output} (${res.output.frames} frames, ${(res.output.frames / res.output.fps).toFixed(1)}s)`);
console.log("quality:", res.output.quality.ok ? "ok" : "FAILED", res.output.quality.results.filter((r: any) => !r.ok).map((r: any) => `${r.gate}: ${r.message}`));
