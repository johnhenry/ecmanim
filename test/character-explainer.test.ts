import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  POSE_NAMES, CUE_DOS, CAMERA_KINDS, FX_KINDS, VISUAL_KINDS,
  validateCharacterPlan, buildFallbackPlan, parseModelJSON, scheduleCues, buildPlanPrompt,
  createPresenterPoseLibrary, PRESENTER_BONES, characterExplainerGates,
  ollamaLLMProvider, characterExplainerFormat, END_LEAD, layoutVisuals, STAGE, DEFAULT_OLLAMA_TIMEOUT_MS,
} from "../src/authoring/character_explainer.ts";
import { runQualityGates } from "../src/authoring/quality.ts";
import { getFormat, runFormat } from "../src/authoring/formats.ts";
import { manimRenderProvider } from "../src/authoring/showrunner.ts";
import { readFileSync } from "node:fs";
import { SkeletonModel } from "../src/mobject/skeleton_model.ts";

const goodPlan = () => ({
  title: "T",
  visuals: [{ id: "f", kind: "math", content: "a^2+b^2=c^2" }, { id: "n", kind: "text", content: "hi" }],
  beats: [
    { narration: "Look <bookmark mark='x'/> here.", show: ["f", "n"], cues: [{ at: "x", do: "point", target: "f" }, { at: "end", do: "pose", pose: "celebrate" }] },
  ],
  tts: "silent",
});

// --- validation + repair ------------------------------------------------------
test("validate: a good plan passes untouched with no warnings", () => {
  const r = validateCharacterPlan(goodPlan());
  assert.equal(r.usable, true);
  assert.deepEqual(r.plan.warnings ?? [], []);
  assert.equal(r.plan.beats[0].cues!.length, 2);
});

test("validate: drops unknown pose / target / do / camera / fx with warnings", () => {
  const p: any = goodPlan();
  p.beats[0].cues.push(
    { at: "start", do: "pose", pose: "backflip" },
    { at: "start", do: "point", target: "ghost" },
    { at: "start", do: "dance" },
    { at: "start", do: "camera", camera: "earthquake" },
    { at: "start", do: "fx", fx: "lasersharks" },
  );
  const r = validateCharacterPlan(p);
  assert.equal(r.usable, true);
  assert.equal(r.plan.beats[0].cues!.length, 2);
  assert.equal(r.plan.warnings!.length, 5);
  assert.match(r.plan.warnings!.join("\n"), /backflip/);
  assert.match(r.plan.warnings!.join("\n"), /ghost/);
  assert.match(r.plan.warnings!.join("\n"), /dance/);
});

test("validate: cue at a bookmark that is not in the narration is dropped", () => {
  const p: any = goodPlan();
  p.beats[0].cues.push({ at: "nope", do: "pose", pose: "wave" });
  const r = validateCharacterPlan(p);
  assert.equal(r.plan.beats[0].cues!.length, 2);
  assert.match(r.plan.warnings!.join("\n"), /nope/);
});

test("validate: drops invalid visuals and show refs; auto-shows pointed-at visuals", () => {
  const p: any = {
    title: "x",
    visuals: [{ id: "a", kind: "text", content: "A" }, { id: "a", kind: "text", content: "dup" }, { id: "b", kind: "hologram", content: 1 }, { id: "c", kind: "text", content: "C" }],
    beats: [{ narration: "One <bookmark mark='m'/> two.", show: ["a", "zzz"], cues: [{ at: "m", do: "point", target: "c" }] }],
  };
  const r = validateCharacterPlan(p);
  assert.deepEqual(r.plan.visuals.map((v) => v.id), ["a", "c"]);
  assert.deepEqual(r.plan.beats[0].show, ["a", "c"]);
  assert.ok(r.plan.warnings!.length >= 3);
});

test("validate: unusable input never throws", () => {
  for (const bad of [null, undefined, 42, "str", [], {}, { beats: [] }, { beats: [{ narration: "" }] }, { beats: "x" }]) {
    const r = validateCharacterPlan(bad as any);
    assert.equal(r.usable, false);
  }
});

test("validate: normalises case/whitespace of vocab values and defaults tts", () => {
  const p: any = goodPlan();
  p.beats[0].cues[1].pose = " Celebrate ";
  delete p.tts;
  const r = validateCharacterPlan(p, { tts: "system" });
  assert.equal(r.plan.beats[0].cues![1].pose, "celebrate");
  assert.equal(r.plan.tts, "system");
});

test("vocabularies match the issue", () => {
  assert.deepEqual([...POSE_NAMES], ["neutral", "wave", "point", "think", "excited", "shrug", "celebrate"]);
  assert.deepEqual([...CUE_DOS], ["point", "pose", "camera", "fx", "show", "highlight"]);
  assert.deepEqual([...CAMERA_KINDS], ["impact", "pulse", "shake"]);
  assert.deepEqual([...FX_KINDS], ["aura", "explosion", "smoke", "beam"]);
  assert.deepEqual([...VISUAL_KINDS], ["text", "math", "diagram", "chart", "shape"]);
});

// --- lenient normalisation (real qwen2.5:3b output) ----------------------------------
const QWEN = {"title":"The Pythagorean Theorem","visuals":[{"id":"triangle","kind":"diagram","content":"A[Start] --> B[Base=3] --> C[Top=4] --> D[Side=5] --> C[Top=4] <-- B[Base=3] <-- A[Start]","at":"right"},{"id":"eq","kind":"math","content":"a^2 + b^2 = c^2","at":"bottom"}],"beats":[{"narration":"Let's explore the Pythagorean Theorem! <bookmark mark='triangle' />","show":["triangle"],"cues":[{"at":"triangle","do":"camera","impact":true}]},{"narration":"Imagine a right-angled triangle. <bookmark mark='eq' />","show":["eq"],"cues":[{"at":"eq","do":"point","target":"eq"}]}]};

test("normalise: real qwen output keeps its camera cue (impact:true) with a warning", () => {
  const r = validateCharacterPlan(structuredClone(QWEN));
  assert.equal(r.usable, true);
  assert.deepEqual(r.plan.beats[0].cues![0], { at: "triangle", do: "camera", camera: "impact" });
  assert.equal(r.plan.beats[1].cues![0].target, "eq");
  assert.ok(r.plan.warnings.some((w) => /normali[sz]ed/i.test(w) && /impact/.test(w)));
});

test("normalise: common cue shapes map onto the schema", () => {
  const mk = (cue: any) => validateCharacterPlan({ beats: [{ narration: "hi", cues: [{ at: "start", ...cue }] }] }).plan.beats[0].cues?.[0];
  assert.equal(mk({ do: "camera", type: "impact" })!.camera, "impact");
  assert.equal(mk({ do: "fx", explosion: true })!.fx, "explosion");
  assert.equal(mk({ do: "pose", celebrate: true })!.pose, "celebrate");
  assert.deepEqual(mk({ do: "celebrate" }), { at: "start", do: "pose", pose: "celebrate" });
  assert.deepEqual(mk({ do: "zoom" }), { at: "start", do: "camera", camera: "pulse" });
  assert.deepEqual(mk({ do: "shake" }), { at: "start", do: "camera", camera: "shake" });
  const noCam = (cue: any) => validateCharacterPlan({ beats: [{ narration: "hi", cues: [{ at: "start", ...cue }] }] }).plan.beats[0].cues!.every((c) => c.do !== "camera");
  assert.ok(noCam({ do: "camera", impact: false }));
  assert.ok(noCam({ do: "camera" }));
});

// --- visual content repair -------------------------------------------------------------
const vis = (v: any) => validateCharacterPlan({ visuals: [v], beats: [{ narration: "hi", show: [v.id] }] });

test("math: Unicode super/subscripts become LaTeX, runs merge, delimiters stripped", () => {
  let r = vis({ id: "m", kind: "math", content: "a² + b² = c²" });
  assert.equal(r.plan.visuals[0].content, "a^{2} + b^{2} = c^{2}");
  assert.ok(r.plan.warnings.some((w) => /LaTeX|delimiters/.test(w)));
  assert.equal(vis({ id: "m", kind: "math", content: "x²³ + y₁₀ⁿ" }).plan.visuals[0].content, "x^{23} + y_{10}^{n}");
  assert.equal(vis({ id: "m", kind: "math", content: "$$a^2$$" }).plan.visuals[0].content, "a^2");
  assert.equal(vis({ id: "m", kind: "math", content: "\\(a^2+b^2\\)" }).plan.visuals[0].content, "a^2+b^2");
  assert.equal(vis({ id: "m", kind: "math", content: "$e^{x}$" }).plan.visuals[0].content, "e^{x}");
  const clean = vis({ id: "m", kind: "math", content: "a^2 + b^2 = c^2" });
  assert.ok(!clean.plan.warnings.some((w) => /LaTeX|delimiters/.test(w)));
});

test("text: long text truncates at a word boundary with an ellipsis + warning", () => {
  const long = "word ".repeat(60).trim();
  const r = vis({ id: "t", kind: "text", content: long });
  const c: string = r.plan.visuals[0].content;
  assert.ok(c.length <= 141 && c.endsWith("…") && !c.endsWith(" …"));
  assert.ok(c.slice(0, -1).split(" ").every((w) => w === "word"));
  assert.ok(r.plan.warnings.some((w) => /truncated/.test(w)));
  assert.equal(vis({ id: "t", kind: "text", content: "short" }).plan.visuals[0].content, "short");
});

test("diagram: invalid DSL converts to text, chains split into edges, valid untouched", () => {
  const bad = validateCharacterPlan(structuredClone(QWEN));
  const tri = bad.plan.visuals.find((v) => v.id === "triangle")!;
  assert.equal(tri.kind, "text");
  assert.ok(bad.plan.warnings.some((w) => /diagram/.test(w)));
  assert.equal(vis({ id: "d", kind: "diagram", content: "just a sentence about triangles" }).plan.visuals[0].kind, "text");
  const chain = vis({ id: "d", kind: "diagram", content: "A[Start] --> B[Mid] --> C[End]" });
  assert.equal(chain.plan.visuals[0].kind, "diagram");
  assert.equal(chain.plan.visuals[0].content, "A[Start] --> B[Mid]\nB[Mid] --> C[End]");
  const ok = vis({ id: "d", kind: "diagram", content: "A[Leg a] --> C[Hyp]\nB[Leg b] --> C" });
  assert.equal(ok.plan.visuals[0].content, "A[Leg a] --> C[Hyp]\nB[Leg b] --> C");
  assert.deepEqual(ok.plan.warnings.filter((w) => /diagram/.test(w)), []);
});

test("prompt states the math/text/diagram conventions", () => {
  const { prompt } = buildPlanPrompt("x");
  assert.match(prompt, /never Unicode superscripts/);
  assert.match(prompt, /12 words/);
  assert.match(prompt, /"show"/);
  assert.match(prompt, /"kind":"math"/);
  assert.match(prompt, /A\[Label\] --> B\[Label\]/);
});

// --- show cues, never-shown visuals, default cues ----------------------------------------
const qwenSaved = () => JSON.parse(readFileSync(new URL("./fixtures/character-explainer-qwen-plan.json", import.meta.url), "utf8"));

test("show cue: reveals a visual at a bookmark; reveal/display normalise to show", () => {
  const base = (cue: any) => validateCharacterPlan({
    visuals: [{ id: "a", kind: "text", content: "A" }, { id: "b", kind: "text", content: "B" }],
    beats: [{ narration: "One <bookmark mark='m'/> two.", show: ["a"], cues: [{ at: "m", ...cue }] }],
  });
  const r = base({ do: "show", target: "b" });
  assert.deepEqual(r.plan.beats[0].cues![0], { at: "m", do: "show", target: "b" });
  assert.deepEqual(r.plan.beats[0].cues![1], { at: "m", do: "point", target: "b" }); // default gesture
  assert.ok(!r.plan.warnings.some((w) => /never shown/.test(w)));
  assert.equal(base({ do: "reveal", target: "b" }).plan.beats[0].cues![0].do, "show");
  assert.equal(base({ do: "display", target: "b" }).plan.beats[0].cues![0].do, "show");
  assert.ok(base({ do: "show", target: "zzz" }).plan.beats[0].cues!.every((c) => c.do !== "show"));
});

test("saved qwen plan + its show cues: diagram is revealed, every beat has a cue", () => {
  const raw = qwenSaved();
  raw.beats[2].cues = [{ at: "start", do: "show", target: "diagram" }];
  raw.beats[3].cues.push({ at: "start", do: "show", target: "diagram" });
  const r = validateCharacterPlan(raw);
  assert.equal(r.usable, true);
  assert.equal(r.plan.beats[2].cues![0].do, "show");
  assert.ok(r.plan.beats.every((b) => (b.cues?.length ?? 0) > 0));
  assert.ok(!r.plan.warnings.some((w) => /never shown/.test(w)));
});

test("never-shown visual attaches to the beat that mentions it, else the next reveal-less beat", () => {
  const r = validateCharacterPlan(qwenSaved());
  const idx = r.plan.beats.findIndex((b) => b.show?.includes("diagram"));
  assert.equal(idx, 2);
  assert.ok(r.plan.warnings.some((w) => /diagram/.test(w) && /attached/.test(w)));
  const r2 = validateCharacterPlan({
    visuals: [{ id: "a", kind: "text", content: "Alpha" }, { id: "z", kind: "chart", content: [{ label: "p", value: 1 }] }],
    beats: [{ narration: "First.", show: ["a"] }, { narration: "Second beat." }, { narration: "Third beat." }],
  });
  assert.deepEqual(r2.plan.beats.map((b) => b.show ?? []), [["a"], ["z"], []]);
  const r3 = validateCharacterPlan({
    visuals: [{ id: "v", kind: "text", content: "Gravity pulls things down" }],
    beats: [{ narration: "Hello." }, { narration: "Everything feels gravity daily." }],
  });
  assert.deepEqual(r3.plan.beats.map((b) => b.show ?? []), [[], ["v"]]);
});

test("cue-less beats get a default: point at what they reveal, else alternating think/excited", () => {
  const r = validateCharacterPlan({
    visuals: [{ id: "a", kind: "text", content: "A" }],
    beats: [{ narration: "Look <bookmark mark='m'/> here.", show: ["a"] }, { narration: "Plain." }, { narration: "Plain two." }, { narration: "Plain three." }],
  });
  assert.deepEqual(r.plan.beats[0].cues, [{ at: "m", do: "point", target: "a" }]);
  assert.deepEqual(r.plan.beats[1].cues, [{ at: "start", do: "pose", pose: "think" }]);
  assert.deepEqual(r.plan.beats[2].cues, [{ at: "start", do: "pose", pose: "excited" }]);
  assert.deepEqual(r.plan.beats[3].cues, [{ at: "start", do: "pose", pose: "think" }]);
  assert.equal(r.plan.warnings.filter((w) => /default cue/.test(w)).length, 4);
});

test("narration-only formulas are left alone", () => {
  const r = validateCharacterPlan({ beats: [{ narration: "A squared plus B squared equals C squared.", cues: [{ at: "start", do: "pose", pose: "wave" }] }] });
  assert.deepEqual(r.plan.visuals, []);
});

// --- fallback -------------------------------------------------------------------
test("fallback plan is deterministic, valid, and cue-bearing", () => {
  const a = buildFallbackPlan("Photosynthesis");
  const b = buildFallbackPlan("Photosynthesis");
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, buildFallbackPlan("Gravity"));
  const r = validateCharacterPlan(a);
  assert.equal(r.usable, true);
  assert.deepEqual(r.plan.warnings ?? [], []);
  assert.ok(a.beats.length >= 3);
  assert.ok(a.beats.every((bt) => (bt.cues?.length ?? 0) > 0));
});

// --- model output parsing -----------------------------------------------------
test("parseModelJSON strips fences, tolerates trailing text, rejects junk", () => {
  assert.deepEqual(parseModelJSON('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJSON('Sure! {"a":{"b":"}"}} hope that helps'), { a: { b: "}" } });
  assert.deepEqual(parseModelJSON({ a: 1 }), { a: 1 });
  assert.equal(parseModelJSON("no json here"), undefined);
  assert.equal(parseModelJSON('{"a":'), undefined);
});

test("buildPlanPrompt carries topic, schema and every vocabulary value", () => {
  const { prompt, system } = buildPlanPrompt("Tides");
  const all = prompt + system;
  assert.match(all, /Tides/);
  for (const v of [...POSE_NAMES, ...CAMERA_KINDS, ...FX_KINDS, ...VISUAL_KINDS]) assert.ok(all.includes(v), v);
  assert.match(all, /JSON/);
});

// --- scheduleCues ----------------------------------------------------------------
test("scheduleCues: exact bookmark times, time-ordered, stable on ties", () => {
  const beat: any = {
    narration: "A <bookmark mark='a'/> b <bookmark mark='b'/> c",
    cues: [
      { at: "b", do: "pose", pose: "wave" },
      { at: "a", do: "point", target: "f" },
      { at: "start", do: "camera", camera: "pulse" },
      { at: "b", do: "fx", fx: "aura" },
      { at: "end", do: "pose", pose: "celebrate" },
    ],
  };
  const ev = scheduleCues(beat, { a: 1.5, b: 3 }, 6);
  assert.deepEqual(ev.map((e) => e.time), [0, 1.5, 3, 3, 6 - END_LEAD]);
  assert.deepEqual(ev.map((e) => e.index), [2, 1, 0, 3, 4]);
});

test("scheduleCues: proportional to char position when no times are given", () => {
  const beat: any = { narration: "aaaa<bookmark mark='m'/>bbbb", cues: [{ at: "m", do: "pose", pose: "think" }] };
  const [e] = scheduleCues(beat, undefined, 8);
  assert.ok(Math.abs(e.time - 4) < 1e-9);
});

test("scheduleCues: clamps into [0, duration] and skips unresolvable bookmarks", () => {
  const beat: any = { narration: "x <bookmark mark='m'/> y", cues: [{ at: "m", do: "pose", pose: "wave" }, { at: "ghost", do: "pose", pose: "wave" }] };
  const ev = scheduleCues(beat, { m: 99 }, 5);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].time, 5);
  assert.deepEqual(scheduleCues({ narration: "hi" } as any, {}, 3), []);
  assert.equal(scheduleCues({ narration: "hi", cues: [{ at: "end", do: "pose", pose: "wave" }] } as any, {}, 0.2)[0].time, 0);
});

// --- layout -----------------------------------------------------------------------
test("layoutVisuals: boxes stay on stage, never overlap, and strips shrink the main area", () => {
  const boxes = layoutVisuals([{ id: "a" }, { id: "b" }, { id: "t", at: "top" }]);
  for (const b of Object.values(boxes)) {
    assert.ok(b.cx - b.maxW / 2 >= STAGE.left - 1e-9 && b.cx + b.maxW / 2 <= STAGE.right + 1e-9);
    assert.ok(b.cy - b.maxH / 2 >= STAGE.bottom - 1e-9 && b.cy + b.maxH / 2 <= STAGE.top + 1e-9);
  }
  const overlap = (p: any, q: any) => Math.abs(p.cy - q.cy) < (p.maxH + q.maxH) / 2 - 1e-9 && Math.abs(p.cx - q.cx) < (p.maxW + q.maxW) / 2 - 1e-9;
  assert.equal(overlap(boxes.a, boxes.b), false);
  assert.equal(overlap(boxes.a, boxes.t), false);
  assert.equal(overlap(boxes.b, boxes.t), false);
  assert.ok(boxes.a.cy < boxes.t.cy);
  assert.ok(layoutVisuals([{ id: "a" }]).a.maxH > boxes.a.maxH);
  assert.deepEqual(layoutVisuals([]), {});
});

// --- presenter spec ---------------------------------------------------------------
test("presenter rig is a valid SkeletonModel and every pose names real bones", () => {
  const m = new SkeletonModel(PRESENTER_BONES);
  const lib = createPresenterPoseLibrary();
  assert.deepEqual(lib.names().sort(), [...POSE_NAMES].sort());
  for (const n of lib.names()) {
    const pose = lib.get(n)!;
    for (const id of Object.keys(pose.bones ?? {})) assert.ok(m.ids.includes(id), `${n}: ${id}`);
  }
  for (const id of ["armR", "foreR", "spine", "head"]) assert.ok(m.ids.includes(id), id);
});

// --- quality gates -----------------------------------------------------------------
const qctx = (promise?: string) => ({
  fps: 30, width: 640, height: 360, durationSeconds: 4,
  segments: [{ kind: "play", startFrame: 0, endFrame: 120 }], promise,
});

test("gates: targets_exist is an error, beat_has_cue a warning, motion-led promise", () => {
  const plan: any = goodPlan();
  const ok = runQualityGates(qctx("motion-led"), characterExplainerGates(plan));
  assert.equal(ok.ok, true);
  assert.ok(ok.results.find((r) => r.gate === "targets_exist")!.ok);
  assert.ok(ok.results.find((r) => r.gate === "beat_has_cue")!.ok);

  const bad: any = goodPlan();
  bad.beats[0].cues[0].target = "ghost";
  bad.beats.push({ narration: "no cues" });
  const rep = runQualityGates(qctx("motion-led"), characterExplainerGates(bad));
  const te = rep.results.find((r) => r.gate === "targets_exist")!;
  const bc = rep.results.find((r) => r.gate === "beat_has_cue")!;
  assert.equal(te.ok, false); assert.equal(te.severity, "error");
  assert.equal(bc.ok, false); assert.equal(bc.severity, "warn");
  assert.equal(rep.ok, false);
  // static output breaks the motion-led promise
  const still = runQualityGates({ ...qctx("motion-led"), segments: [{ kind: "wait", startFrame: 0, endFrame: 120 }] }, characterExplainerGates(plan));
  assert.equal(still.results.find((r) => r.gate === "delivery_promise")!.ok, false);
});

// --- shape visuals, part targets, highlight -----------------------------------------------
const shp = (content: any, extra: any = {}) => validateCharacterPlan({
  visuals: [{ id: "s", kind: "shape", content, ...extra }],
  beats: [{ narration: "Look <bookmark mark='m'/> here.", show: ["s"] }],
});
const spec = (content: any, extra?: any) => shp(content, extra).plan.visuals[0].content as any;

test("shape: content normalises (types, synonyms, defaults) with warnings only when repaired", () => {
  assert.equal(spec({ type: "rhombus" }).type, "rhombus");
  assert.equal(spec("kite").type, "kite");
  assert.equal(spec({ type: "Diamond" }).type, "rhombus");
  assert.equal(spec({ type: "trapezium" }).type, "trapezoid");
  assert.deepEqual([spec({ type: "hexagon" }).type, spec({ type: "hexagon" }).n], ["regular-polygon", 6]);
  assert.equal(spec({ type: "banana" }).type, "right-triangle");
  assert.ok(shp({ type: "banana" }).plan.warnings.some((w) => /banana/.test(w)));
  assert.ok(!shp({ type: "rhombus" }).plan.warnings.some((w) => /shape|type/.test(w)));
  assert.equal(spec({ type: "cube" }).type, "cube");
});

test("shape: legacy triangle kind/content variants map onto right-triangle", () => {
  for (const kind of ["triangle", "right-triangle", "Triangle"]) {
    const r = shp({ a: 3, b: 4 }, { kind });
    assert.equal(r.plan.visuals[0].kind, "shape", kind);
    assert.equal((r.plan.visuals[0].content as any).type, "right-triangle");
    assert.deepEqual((r.plan.visuals[0].content as any).labels, { sides: true }); // old default a, b, c
  }
  assert.equal(spec({ legs: [5, 12] }, { kind: "triangle" }).b, 12);
  assert.equal(spec({ sides: [3, 4, 5] }, { kind: "geometry" }).a, 3);
  assert.equal(spec({ sides: [3, 4, 5] }, { kind: "geometry" }).type, "right-triangle");
  assert.equal(spec({}, { kind: "solid" }).type, "cube");
  assert.equal(spec({}, { kind: "polygon" }).type, "regular-polygon");
  assert.equal(spec({ n: 5 }, { kind: "polygon" }).n, 5);
  assert.equal(spec({}, { kind: "rhombus" }).type, "rhombus"); // kind is a type name
  assert.equal(spec({}, { kind: "quadrilateral" }).type, "quadrilateral");
  assert.ok(shp({ a: 3, b: 4 }, { kind: "geometry" }).plan.warnings.some((w) => /normalized to shape/.test(w)));
});

test("shape: inconsistent sides / absurd sizes warn and fall back", () => {
  const bad = shp({ type: "right-triangle", sides: [3, 4, 6] });
  assert.equal((bad.plan.visuals[0].content as any).a, 3);
  assert.ok(bad.plan.warnings.some((w) => /a\^2/.test(w)));
  const absurd = shp({ type: "right-triangle", a: -1, b: 4 });
  assert.deepEqual([(absurd.plan.visuals[0].content as any).a, (absurd.plan.visuals[0].content as any).b], [3, 4]);
});

test("part targets: canonical names kept, aliases resolved, unknown -> whole visual with a warning", () => {
  const mk = (cue: any, content: any = { type: "right-triangle", squares: true }) => validateCharacterPlan({
    visuals: [{ id: "tri", kind: "shape", content }, { id: "t", kind: "text", content: "hello" }],
    beats: [{ narration: "x <bookmark mark='m'/> y", show: ["tri", "t"], cues: [{ at: "m", ...cue }] }],
  });
  const tgt = (r: any) => r.plan.beats[0].cues![0].target;
  for (const part of ["a", "b", "c", "right", "squareA", "squareB", "squareC", "angleC", "A"]) assert.equal(tgt(mk({ do: "point", target: `tri.${part}` })), `tri.${part}`, part);
  assert.equal(tgt(mk({ do: "point", target: "tri.SQUAREc" })), "tri.squareC");
  assert.equal(tgt(mk({ do: "point", target: "tri.BC" })), "tri.a"); // vertex pair -> side alias
  const unk = mk({ do: "point", target: "tri.zzz" });
  assert.equal(tgt(unk), "tri");
  assert.ok(unk.plan.warnings.some((w) => /part "zzz"/.test(w)));
  assert.equal(tgt(mk({ do: "point", target: "t.a" })), "t"); // text has no parts
  assert.equal(tgt(mk({ do: "fx", fx: "aura", target: "tri.c" })), "tri.c");
  assert.equal(tgt(mk({ do: "point", target: "tri.squareA" }, { type: "right-triangle" })), "tri"); // no squares drawn
  assert.equal(mk({ do: "point", target: "ghost.a" }).plan.beats[0].cues!.some((c: any) => c.target === "ghost.a"), false);
  // quadrilateral marks and solids
  const q = (target: string, type: string, extra: any = {}) => validateCharacterPlan({
    visuals: [{ id: "q", kind: "shape", content: { type, ...extra } }],
    beats: [{ narration: "x", show: ["q"], cues: [{ at: "start", do: "highlight", target }] }],
  }).plan.beats[0].cues![0].target;
  assert.equal(q("q.ticks", "rhombus"), "q.ticks");
  assert.equal(q("q.arrows", "rhombus"), "q.arrows");
  assert.equal(q("q.ab", "rhombus"), "q.AB");
  assert.equal(q("q.ticks", "scalene-triangle"), "q"); // scalene has no ticks
  assert.equal(q("q.face3", "cube"), "q.face3");
  assert.equal(q("q.face9", "cube"), "q");
  assert.equal(q("q.diagonalAC", "kite", { diagonals: true }), "q.diagonalAC");
});

test("highlight cue: whole visual or part; needs a target; flash/indicate alias", () => {
  const mk = (cue: any) => validateCharacterPlan({
    visuals: [{ id: "tri", kind: "shape", content: { type: "right-triangle" } }],
    beats: [{ narration: "hi", show: ["tri"], cues: [{ at: "start", ...cue }] }],
  }).plan.beats[0].cues![0];
  assert.deepEqual(mk({ do: "highlight", target: "tri.c" }), { at: "start", do: "highlight", target: "tri.c" });
  assert.deepEqual(mk({ do: "highlight", target: "tri" }), { at: "start", do: "highlight", target: "tri" });
  assert.equal(mk({ do: "flash", target: "tri.a" }).do, "highlight");
  assert.equal(mk({ do: "indicate", target: "tri.a" }).do, "highlight");
  assert.notEqual(mk({ do: "highlight" }).do, "highlight");
});

test("gates: targets_exist understands parts", () => {
  const plan: any = { title: "t", tts: "silent", visuals: [{ id: "tri", kind: "shape", content: { type: "right-triangle", a: 3, b: 4, squares: true } }, { id: "txt", kind: "text", content: "x" }],
    beats: [{ narration: "x", cues: [{ at: "start", do: "point", target: "tri.squareC" }, { at: "start", do: "highlight", target: "tri.a" }] }] };
  const run = (p: any) => runQualityGates(qctx(), characterExplainerGates(p)).results.find((r) => r.gate === "targets_exist")!;
  assert.equal(run(plan).ok, true);
  plan.beats[0].cues[0].target = "tri.nope"; assert.equal(run(plan).ok, false);
  plan.beats[0].cues[0].target = "ghost.a"; assert.equal(run(plan).ok, false);
  plan.beats[0].cues[0].target = "txt.a"; assert.equal(run(plan).ok, false);
});

test("prompt lists the shape kind, type names, part syntax and highlight", () => {
  const { prompt } = buildPlanPrompt("x");
  for (const w of ["shape", "highlight", "rhombus", "isosceles-trapezoid", "icosahedron", "squareA", "diagonalAC", "ticks", "face0"]) assert.ok(prompt.includes(w), w);
});

// --- ollama provider ---------------------------------------------------------------
const resp = (body: string, init: { ok?: boolean; status?: number } = {}) => ({
  ok: init.ok ?? true, status: init.status ?? 200,
  json: async () => JSON.parse(body), text: async () => body,
});

test("ollama: json mode posts the right request and returns parsed JSON", async () => {
  const calls: any[] = [];
  const p = ollamaLLMProvider({ fetch: (async (url: string, init: any) => { calls.push({ url, init }); return resp(JSON.stringify({ response: '{"x":1}' })); }) as any });
  assert.equal(p.kind, "llm"); assert.equal(p.name, "ollama");
  const out = await p.invoke({ prompt: "p", system: "s", json: true });
  assert.deepEqual(out, { x: 1 });
  assert.equal(calls[0].url, "http://localhost:11434/api/generate");
  assert.equal(calls[0].init.method, "POST");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "qwen2.5:3b"); assert.equal(body.prompt, "p"); assert.equal(body.system, "s");
  assert.equal(body.stream, true); assert.equal(body.format, "json");
  assert.equal(body.keep_alive, "15m");
  assert.ok(body.options.num_predict > 0 && body.options.num_predict <= 2048);
});

test("ollama: NDJSON streamed responses are concatenated", async () => {
  const nd = ['{"response":"{\\"x\\":"}', '{"response":"1}"}', '{"done":true}'].join("\n");
  const p = ollamaLLMProvider({ fetch: (async () => ({ ok: true, status: 200, text: async () => nd })) as any });
  assert.deepEqual(await p.invoke({ prompt: "p", json: true }), { x: 1 });
});

test("ollama: text mode returns the string and omits format", async () => {
  const calls: any[] = [];
  const p = ollamaLLMProvider({ model: "m", baseUrl: "http://h:1/", fetch: (async (url: string, init: any) => { calls.push({ url, init }); return resp(JSON.stringify({ response: "hello" })); }) as any });
  assert.equal(await p.invoke({ prompt: "p" }), "hello");
  assert.equal(calls[0].url, "http://h:1/api/generate");
  assert.ok(!("format" in JSON.parse(calls[0].init.body)));
});

test("ollama: non-JSON model output in json mode rejects; HTTP error rejects", async () => {
  const notJson = ollamaLLMProvider({ fetch: (async () => resp(JSON.stringify({ response: "I cannot do that" }))) as any });
  await assert.rejects(() => notJson.invoke({ prompt: "p", json: true }), /not valid JSON/);
  const http = ollamaLLMProvider({ fetch: (async () => resp("boom", { ok: false, status: 500 })) as any });
  await assert.rejects(() => http.invoke({ prompt: "p" }), /HTTP 500/);
});

test("ollama: timeout aborts the request", async () => {
  const hang = ((_u: string, init: any) => new Promise((_res, rej) => {
    init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
  })) as any;
  const p = ollamaLLMProvider({ timeoutMs: 30, fetch: hang });
  await assert.rejects(() => p.invoke({ prompt: "p" }), /timed out/);
});

test("ollama: available() pings /api/tags and never throws", async () => {
  const urls: string[] = [];
  const up = ollamaLLMProvider({ fetch: (async (u: string) => { urls.push(u); return resp("{}"); }) as any });
  assert.equal(await up.available!(), true);
  assert.equal(urls[0], "http://localhost:11434/api/tags");
  const down = ollamaLLMProvider({ fetch: (async () => { throw new Error("ECONNREFUSED"); }) as any });
  assert.equal(await down.available!(), false);
});

test("ollama: options passthrough overrides defaults; default timeout is generous", async () => {
  const calls: any[] = [];
  const p = ollamaLLMProvider({ keepAlive: "1h", options: { num_ctx: 2048, temperature: 0.2, num_predict: 99 }, fetch: (async (_u: string, init: any) => { calls.push(JSON.parse(init.body)); return resp(JSON.stringify({ response: "x" })); }) as any });
  await p.invoke({ prompt: "p" });
  assert.equal(calls[0].keep_alive, "1h");
  assert.deepEqual(calls[0].options, { num_predict: 99, num_ctx: 2048, temperature: 0.2 });
  assert.equal(DEFAULT_OLLAMA_TIMEOUT_MS, 15 * 60_000);
});

test("odd diagram DSL from a model never throws at build time", async () => {
  const { diagram } = await import("../src/diagram/diagram.ts");
  const g = diagram(QWEN.visuals[0].content as string);
  assert.ok(g.getWidth() > 0);
});

// --- format plan() ----------------------------------------------------------------
test("format is registered; plan uses params, then LLM (repaired), then fallback", async () => {
  assert.equal(getFormat("character-explainer"), characterExplainerFormat);
  const fromParams = await characterExplainerFormat.plan({ topic: "x", params: goodPlan() });
  assert.equal(fromParams.title, "T");

  const llm = { kind: "llm" as const, name: "fake", invoke: async () => '```json\n' + JSON.stringify({ title: "L", visuals: [{ id: "a", kind: "text", content: "A" }], beats: [{ narration: "hi", cues: [{ at: "start", do: "pose", pose: "wave" }, { at: "start", do: "pose", pose: "moonwalk" }] }] }) + '\n```' };
  const fromLLM = await characterExplainerFormat.plan({ topic: "x", providers: { llm } });
  assert.equal(fromLLM.title, "L");
  assert.equal(fromLLM.beats[0].cues.length, 1);
  assert.ok(fromLLM.warnings.some((w: string) => /moonwalk/.test(w)));

  for (const out of ["garbage", { beats: [] }]) {
    const bad = { kind: "llm" as const, name: "bad", invoke: async () => out };
    const fb = await characterExplainerFormat.plan({ topic: "Tides", providers: { llm: bad } });
    assert.equal(fb.title, buildFallbackPlan("Tides").title);
    assert.ok(fb.warnings.some((w: string) => /fallback/i.test(w)));
  }
  const throwing = { kind: "llm" as const, name: "t", invoke: async () => { throw new Error("down"); } };
  const fb2 = await characterExplainerFormat.plan({ topic: "Tides", providers: { llm: throwing } });
  assert.ok(fb2.beats.length >= 3);
  const none = await characterExplainerFormat.plan({ topic: "Tides" });
  assert.ok(none.beats.length >= 3);
});

// --- render smoke ------------------------------------------------------------------
test("render smoke: low quality, silent TTS", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ce-"));
  const out = join(dir, "ce.mp4");
  const res = await runFormat("character-explainer", {
    params: {
      title: "Smoke", tts: "silent",
      visuals: [{ id: "f", kind: "math", content: "a^2+b^2=c^2" }, { id: "t", kind: "text", content: "Hello" }, { id: "tri", kind: "shape", content: { type: "right-triangle", a: 3, b: 4, squares: true, labels: { sides: true } } }],
      beats: [
        { narration: "Hi <bookmark mark='a'/> there.", show: ["t"], cues: [{ at: "start", do: "pose", pose: "wave" }, { at: "a", do: "point", target: "t" }, { at: "a", do: "camera", camera: "pulse" }] },
        { narration: "Now <bookmark mark='b'/> this.", show: ["f"], cues: [{ at: "b", do: "fx", fx: "aura", target: "f" }, { at: "end", do: "pose", pose: "celebrate" }] },
        { narration: "A triangle <bookmark mark='t'/> with squares.", show: ["tri"], cues: [{ at: "t", do: "point", target: "tri.a" }, { at: "t", do: "highlight", target: "tri.squareC" }, { at: "end", do: "point", target: "tri.c" }] },
      ],
      renderOptions: { output: out, quality: "low", fps: 12, verbose: false, disableCaching: true },
    },
    providers: { render: manimRenderProvider },
  });
  assert.ok(existsSync(out));
  assert.ok(statSync(out).size > 0);
  assert.ok(res.output.frames > 0);
  assert.ok(res.output.quality.results.length > 0);
  assert.equal(res.output.quality.ok, true);
});
