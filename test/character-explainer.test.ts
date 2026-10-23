import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  POSE_NAMES, CUE_DOS, CAMERA_KINDS, FX_KINDS, VISUAL_KINDS,
  validateCharacterPlan, buildFallbackPlan, parseModelJSON, scheduleCues, buildPlanPrompt,
  createPresenterPoseLibrary, PRESENTER_BONES, characterExplainerGates,
  ollamaLLMProvider, characterExplainerFormat, END_LEAD, layoutVisuals, STAGE,
} from "../src/authoring/character_explainer.ts";
import { runQualityGates } from "../src/authoring/quality.ts";
import { getFormat, runFormat } from "../src/authoring/formats.ts";
import { manimRenderProvider } from "../src/authoring/showrunner.ts";
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
  assert.deepEqual([...CUE_DOS], ["point", "pose", "camera", "fx"]);
  assert.deepEqual([...CAMERA_KINDS], ["impact", "pulse", "shake"]);
  assert.deepEqual([...FX_KINDS], ["aura", "explosion", "smoke", "beam"]);
  assert.deepEqual([...VISUAL_KINDS], ["text", "math", "diagram", "chart"]);
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
  assert.deepEqual(body, { model: "qwen2.5:3b", prompt: "p", system: "s", stream: false, format: "json" });
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
      visuals: [{ id: "f", kind: "math", content: "a^2+b^2=c^2" }, { id: "t", kind: "text", content: "Hello" }],
      beats: [
        { narration: "Hi <bookmark mark='a'/> there.", show: ["t"], cues: [{ at: "start", do: "pose", pose: "wave" }, { at: "a", do: "point", target: "t" }, { at: "a", do: "camera", camera: "pulse" }] },
        { narration: "Now <bookmark mark='b'/> this.", show: ["f"], cues: [{ at: "b", do: "fx", fx: "aura", target: "f" }, { at: "end", do: "pose", pose: "celebrate" }] },
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
