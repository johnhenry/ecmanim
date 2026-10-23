// character-explainer: an authoring Format where an animated stick-figure
// presenter narrates a topic, with gestures, pointing, camera beats and effects
// synced to its own speech (voiceover bookmarks). An LLM (or a human) writes a
// small JSON plan made only of CHOICES from fixed vocabularies -- never code --
// so output stays safe and deterministic.
//
// Layout of this file:
//   1. vocabularies + plan types                      (pure)
//   2. parse / validate / repair / fallback / prompt  (pure)
//   3. scheduleCues + visual layout                   (pure)
//   4. presenter rig spec + named poses               (pure data)
//   5. quality gates                                  (pure)
//   6. ollamaLLMProvider                              (global fetch only)
//   7. the Format itself (compose renders; heavy modules are imported lazily)

import { registerFormat } from "./formats.ts";
import type { Format, FormatContext, Provider } from "./formats.ts";
import type { QualityGate, QualityContext } from "./quality.ts";
import { PoseLibrary } from "../animation/pose.ts";
import type { BoneSpec, PartialPose } from "../mobject/skeleton_model.ts";

// --- 1. vocabularies + types -------------------------------------------------------

export const POSE_NAMES = ["neutral", "wave", "point", "think", "excited", "shrug", "celebrate"] as const;
export const CUE_DOS = ["point", "pose", "camera", "fx"] as const;
export const CAMERA_KINDS = ["impact", "pulse", "shake"] as const;
export const FX_KINDS = ["aura", "explosion", "smoke", "beam"] as const;
export const VISUAL_KINDS = ["text", "math", "diagram", "chart"] as const;
export const VISUAL_REGIONS = ["right", "top", "bottom"] as const;

export type PoseName = (typeof POSE_NAMES)[number];
export type CueDo = (typeof CUE_DOS)[number];
export type CameraKind = (typeof CAMERA_KINDS)[number];
export type FxKind = (typeof FX_KINDS)[number];
export type VisualKind = (typeof VISUAL_KINDS)[number];
export type VisualRegion = (typeof VISUAL_REGIONS)[number];

/** Seconds before the end of the narration at which an `at: "end"` cue fires. */
export const END_LEAD = 0.5;
const MAX_BEATS = 12;
const MAX_VISUALS = 8;

export interface CharacterVisual {
  id: string;
  kind: VisualKind;
  /** text/math/diagram: a string. chart: `[{ label, value }, ...]`. */
  content: any;
  at?: VisualRegion;
}

export interface CharacterCue {
  /** A bookmark name from the beat's narration, or "start" | "end". */
  at: string;
  do: CueDo;
  /** point / fx: a visual id. */
  target?: string;
  pose?: PoseName;
  camera?: CameraKind;
  fx?: FxKind;
}

export interface CharacterBeat {
  /** May contain `<bookmark mark="x"/>` tags. */
  narration: string;
  /** Visual ids revealed in this beat. */
  show?: string[];
  cues?: CharacterCue[];
}

export interface CharacterExplainerPlan {
  title: string;
  visuals: CharacterVisual[];
  beats: CharacterBeat[];
  /** Voiceover provider: silent | system | openai | elevenlabs. */
  tts: string;
  style?: string;
  /** Repairs / fallbacks applied while building this plan (never thrown). */
  warnings?: string[];
}

const isIn = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => typeof v === "string" && (list as readonly string[]).includes(v);
const norm = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");

// --- 2. parse / validate / repair --------------------------------------------------

const BOOKMARK_RE = /<bookmark\s+mark\s*=\s*["']([^"']+)["']\s*\/?>/g;

/** Strip bookmark tags: clean text + each tag's character offset in the clean text. */
function splitBookmarks(text: string): { clean: string; marks: Array<{ name: string; charIndex: number }> } {
  const marks: Array<{ name: string; charIndex: number }> = [];
  let clean = "";
  let last = 0;
  BOOKMARK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BOOKMARK_RE.exec(text))) {
    clean += text.slice(last, m.index);
    marks.push({ name: m[1], charIndex: clean.length });
    last = m.index + m[0].length;
  }
  clean += text.slice(last);
  return { clean: clean.trim(), marks };
}

/**
 * Lenient cue normalisation for common model shapes. Returns the canonical
 * `do` and (when recoverable) the value for its slot, plus a note per change.
 */
function normalizeCue(c: any): { doo: string; value?: string; notes: string[] } {
  const notes: string[] = [];
  let doo = norm(c?.do);
  let value: string | undefined;
  if (!isIn(CUE_DOS, doo)) {
    if (isIn(POSE_NAMES, doo)) { value = doo; doo = "pose"; }
    else if (isIn(CAMERA_KINDS, doo)) { value = doo; doo = "camera"; }
    else if (isIn(FX_KINDS, doo)) { value = doo; doo = "fx"; }
    else if (doo === "zoom") { value = "pulse"; doo = "camera"; }
    if (isIn(CUE_DOS, doo)) notes.push(`do "${c?.do}" normalized to ${doo}${value ? ` "${value}"` : ""}`);
    return { doo, value, notes };
  }
  const list = doo === "pose" ? POSE_NAMES : doo === "camera" ? CAMERA_KINDS : doo === "fx" ? FX_KINDS : undefined;
  if (list && !isIn(list, norm(c?.[doo]))) {
    for (const k of ["type", "kind", "effect", "name", "value", "style"]) {
      if (isIn(list, norm(c?.[k]))) { value = norm(c[k]); break; }
    }
    if (!value) value = (list as readonly string[]).find((n) => c?.[n] === true || norm(c?.[n]) === "true");
    if (value) notes.push(`${doo} cue shape normalized to ${doo} "${value}"`);
  }
  return { doo, value, notes };
}

/**
 * Defensively extract a JSON value from model output: objects pass through;
 * strings may be wrapped in code fences or followed by chatter. Returns
 * undefined (never throws) when nothing parses.
 */
export function parseModelJSON(raw: unknown): unknown {
  if (raw !== null && typeof raw === "object") return raw;
  if (typeof raw !== "string") return undefined;
  let s = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* fall through to brace scan */ }
  const start = s.search(/[{[]/);
  if (start < 0) return undefined;
  // Scan to the matching close bracket, honouring strings.
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return undefined; } }
    }
  }
  return undefined;
}

export interface ValidationResult {
  /** True when at least one valid beat survived. */
  usable: boolean;
  plan: CharacterExplainerPlan & { warnings: string[] };
}

function normChart(content: unknown): Array<{ label: string; value: number }> | null {
  const arr = Array.isArray(content) ? content : (content as any)?.data;
  if (!Array.isArray(arr)) return null;
  const out = arr
    .filter((d: any) => d && typeof d === "object" && Number.isFinite(Number(d.value)) && Number(d.value) >= 0)
    .map((d: any) => ({ label: String(d.label ?? ""), value: Number(d.value) }));
  return out.length ? out.slice(0, 8) : null;
}

/**
 * Validate + repair a raw plan (from params or a model). Invalid cues, visuals
 * and references are dropped with a message in `plan.warnings`; this never
 * throws. `usable` is false when no beat survives (caller should fall back).
 */
export function validateCharacterPlan(raw: unknown, defaults: { title?: string; tts?: string; style?: string } = {}): ValidationResult {
  const warnings: string[] = [];
  const empty = (): ValidationResult => ({
    usable: false,
    plan: { title: defaults.title ?? "Untitled", visuals: [], beats: [], tts: defaults.tts ?? "silent", style: defaults.style, warnings },
  });
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) { warnings.push("plan is not an object"); return empty(); }
  const r = raw as Record<string, any>;
  if (!Array.isArray(r.beats)) { warnings.push("plan has no beats array"); return empty(); }

  // visuals
  const visuals: CharacterVisual[] = [];
  const seen = new Set<string>();
  for (const [i, v] of (Array.isArray(r.visuals) ? r.visuals : []).entries()) {
    const id = typeof v?.id === "string" ? v.id.trim() : "";
    const kind = norm(v?.kind);
    if (!id) { warnings.push(`visual #${i}: missing id, dropped`); continue; }
    if (seen.has(id)) { warnings.push(`visual "${id}": duplicate id, dropped`); continue; }
    if (!isIn(VISUAL_KINDS, kind)) { warnings.push(`visual "${id}": unknown kind "${v?.kind}", dropped`); continue; }
    if (visuals.length >= MAX_VISUALS) { warnings.push(`visual "${id}": more than ${MAX_VISUALS} visuals, dropped`); continue; }
    let content: any = v.content;
    if (kind === "chart") {
      content = normChart(content);
      if (!content) { warnings.push(`visual "${id}": chart needs [{label, value>=0}], dropped`); continue; }
    } else if (typeof content !== "string" || !content.trim()) {
      warnings.push(`visual "${id}": ${kind} content must be a non-empty string, dropped`); continue;
    }
    const out: CharacterVisual = { id, kind, content };
    if (v.at !== undefined) {
      const at = norm(v.at);
      if (isIn(VISUAL_REGIONS, at)) out.at = at; else warnings.push(`visual "${id}": unknown region "${v.at}", using default`);
    }
    seen.add(id);
    visuals.push(out);
  }

  // beats
  const beats: CharacterBeat[] = [];
  const shownSoFar = new Set<string>();
  for (const [bi, b] of r.beats.entries()) {
    if (beats.length >= MAX_BEATS) { warnings.push(`beat #${bi}: more than ${MAX_BEATS} beats, dropped`); continue; }
    if (typeof b?.narration !== "string" || !b.narration.trim()) { warnings.push(`beat #${bi}: missing narration, dropped`); continue; }
    const narration: string = b.narration.trim();
    const marks = new Set(splitBookmarks(narration).marks.map((m) => m.name));
    const show: string[] = [];
    for (const id of Array.isArray(b.show) ? b.show : []) {
      if (typeof id === "string" && seen.has(id.trim())) { if (!show.includes(id.trim())) show.push(id.trim()); }
      else warnings.push(`beat #${bi}: show references unknown visual "${id}", dropped`);
    }
    const cues: CharacterCue[] = [];
    for (const [ci, c] of (Array.isArray(b.cues) ? b.cues : []).entries()) {
      const tag = `beat #${bi} cue #${ci}`;
      const at = typeof c?.at === "string" ? c.at.trim() : "";
      const nc = normalizeCue(c);
      const doo = nc.doo;
      for (const n of nc.notes) warnings.push(`${tag}: ${n}`);
      if (!isIn(CUE_DOS, doo)) { warnings.push(`${tag}: unknown do "${c?.do}", dropped`); continue; }
      const atKey = at.toLowerCase();
      const atOk = atKey === "start" || atKey === "end" || marks.has(at);
      if (!atOk) { warnings.push(`${tag}: at "${c?.at}" is not start/end or a bookmark in the narration, dropped`); continue; }
      const cue: CharacterCue = { at: atKey === "start" || atKey === "end" ? atKey : at, do: doo };
      const target = typeof c.target === "string" ? c.target.trim() : undefined;
      if (doo === "point") {
        if (!target || !seen.has(target)) { warnings.push(`${tag}: point target "${c?.target}" is not a visual, dropped`); continue; }
        cue.target = target;
      } else if (doo === "pose") {
        const p = nc.value ?? norm(c.pose);
        if (!isIn(POSE_NAMES, p)) { warnings.push(`${tag}: unknown pose "${c?.pose}", dropped`); continue; }
        cue.pose = p;
      } else if (doo === "camera") {
        const k = nc.value ?? norm(c.camera);
        if (!isIn(CAMERA_KINDS, k)) { warnings.push(`${tag}: unknown camera "${c?.camera}", dropped`); continue; }
        cue.camera = k;
      } else {
        const k = nc.value ?? norm(c.fx);
        if (!isIn(FX_KINDS, k)) { warnings.push(`${tag}: unknown fx "${c?.fx}", dropped`); continue; }
        cue.fx = k;
        if (target !== undefined) {
          if (seen.has(target)) cue.target = target; else warnings.push(`${tag}: fx target "${target}" is not a visual, using the presenter`);
        }
      }
      cues.push(cue);
    }
    // Pointing / fx at a visual that has not been revealed yet: reveal it here.
    for (const c of cues) {
      if (c.target && !shownSoFar.has(c.target) && !show.includes(c.target)) {
        show.push(c.target);
        warnings.push(`beat #${bi}: "${c.target}" was targeted before being shown, added to show`);
      }
    }
    for (const id of show) shownSoFar.add(id);
    beats.push({ narration, ...(show.length ? { show } : {}), ...(cues.length ? { cues } : {}) });
  }
  if (!beats.length) { warnings.push("no valid beats"); return empty(); }
  for (const v of visuals) if (!shownSoFar.has(v.id)) warnings.push(`visual "${v.id}" is never shown`);

  const plan: CharacterExplainerPlan & { warnings: string[] } = {
    title: typeof r.title === "string" && r.title.trim() ? r.title.trim() : defaults.title ?? "Untitled",
    visuals,
    beats,
    tts: typeof r.tts === "string" && r.tts.trim() ? r.tts.trim() : defaults.tts ?? "silent",
    warnings,
  };
  const style = typeof r.style === "string" && r.style.trim() ? r.style.trim() : defaults.style;
  if (style) plan.style = style;
  return { usable: true, plan };
}

/** A deterministic plan built only from the topic (the zero-network, zero-LLM path). */
export function buildFallbackPlan(topic: string, opts: { tts?: string; style?: string } = {}): CharacterExplainerPlan {
  const t = (topic || "this topic").trim();
  return {
    title: t,
    visuals: [
      { id: "topic", kind: "text", content: t },
      { id: "idea", kind: "text", content: "The key idea" },
      { id: "recap", kind: "text", content: `${t}: in short` },
    ],
    beats: [
      {
        narration: `Hi there! <bookmark mark="hello"/> Today we are talking about ${t}.`,
        show: ["topic"],
        cues: [{ at: "start", do: "pose", pose: "wave" }, { at: "hello", do: "point", target: "topic" }],
      },
      {
        narration: `Let us think about it. <bookmark mark="key"/> Here is the key idea to remember.`,
        show: ["idea"],
        cues: [{ at: "start", do: "pose", pose: "think" }, { at: "key", do: "point", target: "idea" }, { at: "key", do: "camera", camera: "pulse" }],
      },
      {
        narration: `<bookmark mark="sum"/> And that is ${t} in a nutshell. Thanks for watching!`,
        show: ["recap"],
        cues: [{ at: "sum", do: "point", target: "recap" }, { at: "end", do: "pose", pose: "celebrate" }, { at: "end", do: "fx", fx: "explosion" }],
      },
    ],
    tts: opts.tts ?? "silent",
    ...(opts.style ? { style: opts.style } : {}),
  };
}

const EXAMPLE_PLAN = {
  title: "Why the sky is blue",
  visuals: [{ id: "q", kind: "text", content: "Why is the sky blue?" }],
  beats: [
    { narration: "Hello! <bookmark mark=\"q\"/> Why is the sky blue?", show: ["q"], cues: [{ at: "start", do: "pose", pose: "wave" }, { at: "q", do: "point", target: "q" }] },
    { narration: "Air scatters blue light most.", cues: [{ at: "end", do: "pose", pose: "celebrate" }] },
  ],
};

/** The system + user prompt for a model: schema, allowed vocabularies, one short example. */
export function buildPlanPrompt(topic: string): { system: string; prompt: string } {
  const system = "You write scripts for an animated stick-figure presenter. Reply with ONE JSON object only.";
  const prompt = [
    `Plan a 30-45 second explainer about: ${topic}`,
    `Schema: {"title":str,"visuals":[{"id":str,"kind":${q(VISUAL_KINDS)},"content":...,"at"?:${q(VISUAL_REGIONS)}}],"beats":[{"narration":str,"show"?:[visual ids],"cues"?:[{"at":bookmark|"start"|"end","do":${q(CUE_DOS)},"target"?:visual id,"pose"?:${q(POSE_NAMES)},"camera"?:${q(CAMERA_KINDS)},"fx"?:${q(FX_KINDS)}}]}]}`,
    `content: text=short string; math=LaTeX; diagram=lines like "A[Start] --> B[End]"; chart=[{"label","value"}].`,
    `Rules: 3-5 beats of 1-2 short sentences; put <bookmark mark="name"/> in narration and cue at those names; "point" needs a target shown by then; max 3 visuals; every beat gets a cue.`,
    `Example: ${JSON.stringify(EXAMPLE_PLAN)}`,
    `Output JSON for: ${topic}`,
  ].join("\n");
  return { system, prompt };
}

const q = (list: readonly string[]) => list.map((v) => `"${v}"`).join("|");

// --- 3. scheduleCues + layout ------------------------------------------------------

export interface CueEvent {
  /** Seconds from the start of the beat's narration. */
  time: number;
  /** Index into `beat.cues`. */
  index: number;
  cue: CharacterCue;
}

/**
 * Turn a beat's cues into time-ordered events. `bookmarkTimes` are the
 * tracker's bookmark times in seconds from the start of the narration (exact
 * when the TTS provider has word boundaries). Bookmarks missing from it fall
 * back to a proportional estimate from their character position. "start" = 0,
 * "end" = duration - END_LEAD (so the gesture lands as the line ends).
 * Unresolvable cues are skipped. Ties keep authoring order.
 */
export function scheduleCues(beat: CharacterBeat, bookmarkTimes: Record<string, number> | undefined, duration: number): CueEvent[] {
  const { clean, marks } = splitBookmarks(beat.narration ?? "");
  const clamp = (t: number) => Math.min(Math.max(t, 0), Math.max(duration, 0));
  const out: CueEvent[] = [];
  for (const [index, cue] of (beat.cues ?? []).entries()) {
    let time: number | undefined;
    if (cue.at === "start") time = 0;
    else if (cue.at === "end") time = Math.max(0, duration - END_LEAD);
    else if (bookmarkTimes && Number.isFinite(bookmarkTimes[cue.at])) time = clamp(bookmarkTimes[cue.at]);
    else {
      const m = marks.find((x) => x.name === cue.at);
      if (m && clean.length) time = clamp((m.charIndex / clean.length) * duration);
    }
    if (time !== undefined) out.push({ time, index, cue });
  }
  return out.sort((a, b) => a.time - b.time || a.index - b.index);
}

export interface Box { cx: number; cy: number; maxW: number; maxH: number }
/** The stage (right of the presenter) in world units; the frame is 14.22 x 8. */
export const STAGE = { left: -0.5, right: 6.5, top: 2.7, bottom: -3.55 };
const GAP = 0.3;

/**
 * Place visible visuals in boxes. "top" / "bottom" visuals take a strip; the
 * "right" (default) visuals share what is left, stacked vertically in order.
 */
export function layoutVisuals(items: Array<{ id: string; at?: VisualRegion }>): Record<string, Box> {
  const out: Record<string, Box> = {};
  const w = STAGE.right - STAGE.left;
  const cx = (STAGE.left + STAGE.right) / 2;
  const tops = items.filter((i) => i.at === "top");
  const bottoms = items.filter((i) => i.at === "bottom");
  const mains = items.filter((i) => i.at !== "top" && i.at !== "bottom");
  const stripH = 1.25;
  let top = STAGE.top, bottom = STAGE.bottom;
  const place = (arr: typeof items, y0: number, y1: number, horizontal: boolean) => {
    const n = arr.length;
    if (!n) return;
    if (horizontal) {
      const bw = (w - GAP * (n - 1)) / n;
      arr.forEach((it, i) => { out[it.id] = { cx: STAGE.left + bw / 2 + i * (bw + GAP), cy: (y0 + y1) / 2, maxW: bw, maxH: y1 - y0 }; });
    } else {
      const bh = (y1 - y0 - GAP * (n - 1)) / n;
      arr.forEach((it, i) => { out[it.id] = { cx, cy: y1 - bh / 2 - i * (bh + GAP), maxW: w, maxH: bh }; });
    }
  };
  if (tops.length) { place(tops, top - stripH, top, true); top -= stripH + GAP; }
  if (bottoms.length) { place(bottoms, bottom, bottom + stripH, true); bottom += stripH + GAP; }
  place(mains, bottom, top, false);
  return out;
}

// --- 4. presenter rig + poses -----------------------------------------------------

const D = Math.PI / 180;
/** Presenter bones (y-up; angles relative to the parent, radians). Right = toward the visuals. */
export const PRESENTER_BONES: BoneSpec[] = [
  { id: "spine", parent: null, length: 1.35, angle: 90 * D, width: 10 },
  { id: "neck", parent: "spine", length: 0.2, width: 7 },
  { id: "head", parent: "neck", length: 0.44, width: 2 },
  { id: "eyeA", parent: "head", length: 0.17, angle: -35 * D, width: 1 },
  { id: "eyeB", parent: "head", length: 0.32, angle: -72 * D, width: 1 },
  { id: "shoulderL", parent: "spine", length: 0.4, angle: 90 * D, width: 9 },
  { id: "shoulderR", parent: "spine", length: 0.4, angle: -90 * D, width: 9 },
  { id: "armL", parent: "shoulderL", length: 1.0, angle: 80 * D, width: 8 },
  { id: "foreL", parent: "armL", length: 0.95, angle: 10 * D, width: 7 },
  { id: "handL", parent: "foreL", length: 0.1, width: 6 },
  { id: "armR", parent: "shoulderR", length: 1.0, angle: -80 * D, width: 8, limits: { min: -200 * D, max: 175 * D } },
  { id: "foreR", parent: "armR", length: 0.95, angle: -10 * D, width: 7 },
  { id: "handR", parent: "foreR", length: 0.1, width: 6 },
  { id: "hipL", parent: null, length: 0.2, angle: 180 * D, width: 9 },
  { id: "hipR", parent: null, length: 0.2, angle: 0, width: 9 },
  { id: "legUL", parent: "hipL", length: 1.0, angle: 87 * D, width: 9 },
  { id: "legLL", parent: "legUL", length: 1.0, angle: 5 * D, width: 8 },
  { id: "footL", parent: "legLL", length: 0.28, angle: -92 * D, width: 8 },
  { id: "legUR", parent: "hipR", length: 1.0, angle: -87 * D, width: 9 },
  { id: "legLR", parent: "legUR", length: 1.0, angle: -5 * D, width: 8 },
  { id: "footR", parent: "legLR", length: 0.28, angle: 92 * D, width: 8 },
];

const arms = (aR: number, fR: number, aL: number, fL: number): PartialPose["bones"] => ({
  armR: { angle: aR * D }, foreR: { angle: fR * D }, armL: { angle: aL * D }, foreL: { angle: fL * D },
});

/** The named poses of the vocabulary, as partial poses over PRESENTER_BONES. */
export const PRESENTER_POSES: Record<PoseName, PartialPose> = {
  neutral: { bones: { ...arms(-80, -10, 80, 10), spine: { angle: 90 * D }, neck: { angle: 0 } } },
  wave: { bones: { ...arms(55, 38, 80, 10), neck: { angle: -6 * D } } },
  point: { bones: { ...arms(8, 0, 80, 10), neck: { angle: 0 } } },
  think: { bones: { ...arms(-22, 158, 80, 10), neck: { angle: 10 * D } } },
  excited: { bones: { ...arms(62, 14, -62, -14), neck: { angle: -4 * D } } },
  shrug: { bones: { ...arms(-48, 105, 48, -105), neck: { angle: 5 * D } } },
  celebrate: { bones: { ...arms(72, 8, -72, -8), spine: { angle: 94 * D }, neck: { angle: -8 * D } } },
};

/** A PoseLibrary with the vocabulary's poses. */
export function createPresenterPoseLibrary(): PoseLibrary {
  return new PoseLibrary(PRESENTER_POSES as Record<string, PartialPose>);
}

// --- 5. quality gates --------------------------------------------------------------

/** Extra gates for runQualityGates(ctx, extra): targets_exist (error), beat_has_cue (warn). */
export function characterExplainerGates(plan: CharacterExplainerPlan): QualityGate[] {
  const ids = new Set(plan.visuals.map((v) => v.id));
  return [
    {
      name: "targets_exist",
      check: (_c: QualityContext) => {
        const missing: string[] = [];
        for (const b of plan.beats) for (const c of b.cues ?? []) if (c.target !== undefined && !ids.has(c.target)) missing.push(c.target);
        for (const b of plan.beats) for (const s of b.show ?? []) if (!ids.has(s)) missing.push(s);
        return missing.length
          ? { ok: false, message: `unknown visual id(s): ${[...new Set(missing)].join(", ")}`, severity: "error" as const }
          : { ok: true, message: "every cue target and show ref exists in visuals", severity: "error" as const };
      },
    },
    {
      name: "beat_has_cue",
      check: (_c: QualityContext) => {
        const bare = plan.beats.map((b, i) => ((b.cues?.length ?? 0) === 0 ? i : -1)).filter((i) => i >= 0);
        return bare.length
          ? { ok: false, message: `beat(s) without a cue: ${bare.join(", ")}`, severity: "warn" as const }
          : { ok: true, message: "every beat has at least one cue", severity: "warn" as const };
      },
    },
  ];
}

// --- 6. ollama provider ------------------------------------------------------------

/** Default per-request timeout of ollamaLLMProvider (15 minutes). */
export const DEFAULT_OLLAMA_TIMEOUT_MS = 15 * 60_000;

export interface OllamaOptions {
  model?: string;
  baseUrl?: string;
  /** Abort a request after this many ms. Default 15 minutes: a 3B model on a loaded CPU-only host runs at ~1-2 tok/s. */
  timeoutMs?: number;
  /** How long Ollama keeps the model loaded after a call (default "15m"). */
  keepAlive?: string;
  /** Ollama `options` (num_predict, num_ctx, temperature, ...). Defaults: `{ num_predict: 1024 }`. Yours are merged over the defaults. */
  options?: Record<string, unknown>;
  /** Inject a fetch (tests). Default: the global fetch. */
  fetch?: typeof fetch;
}

/**
 * An `llm` Provider backed by a local Ollama server (`/api/generate`). Runs
 * fully offline. `invoke({ prompt, system?, json? })` returns parsed JSON when
 * `json` is true (rejects if the model's output is not JSON), else the text.
 */
export function ollamaLLMProvider(opts: OllamaOptions = {}): Provider {
  const model = opts.model ?? "qwen2.5:3b";
  const baseUrl = (opts.baseUrl ?? "http://localhost:11434").replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS;
  const keepAlive = opts.keepAlive ?? "15m";
  const doFetch = (): typeof fetch => opts.fetch ?? globalThis.fetch;

  const request = async (path: string, init: RequestInit, ms: number): Promise<any> => {
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, ms);
    try {
      const res = await doFetch()(`${baseUrl}${path}`, { ...init, signal: ctl.signal });
      if (!res.ok) {
        let detail = "";
        try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
        throw new Error(`ollama: HTTP ${res.status}${detail ? ` - ${detail}` : ""}`);
      }
      return res;
    } catch (e: any) {
      if (timedOut) throw new Error(`ollama: request timed out after ${ms} ms`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    kind: "llm",
    name: "ollama",
    async available() {
      try { await request("/api/tags", { method: "GET" }, Math.min(timeoutMs, 3000)); return true; } catch { return false; }
    },
    async invoke(input: { prompt: string; system?: string; json?: boolean }) {
      const body: Record<string, unknown> = { model, prompt: input.prompt, system: input.system, stream: true, format: input.json ? "json" : undefined, keep_alive: keepAlive, options: { num_predict: 1024, ...opts.options } };
      const res = await request("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, timeoutMs);
      // Streamed (NDJSON): Node's fetch aborts a request whose response headers take
      // >300 s, which a slow CPU model exceeds with stream:false. Streaming sends
      // headers with the first token. A single JSON object (stream:false style) also parses.
      const raw = await res.text();
      let text = "";
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try { const o = JSON.parse(line); if (typeof o?.response === "string") text += o.response; if (o?.error) throw new Error(`ollama: ${o.error}`); } catch (e: any) { if (/^ollama:/.test(e?.message)) throw e; }
      }
      if (!input.json) return text;
      const parsed = parseModelJSON(text);
      if (parsed === undefined) throw new Error("ollama: response was not valid JSON");
      return parsed;
    },
  };
}

// --- 7. the Format -----------------------------------------------------------------

const NEUTRAL_FALLBACK_WARNING = "LLM plan unusable; used the deterministic fallback plan";

export const characterExplainerFormat: Format = {
  name: "character-explainer",
  description: "A stick-figure presenter narrates a topic: gestures, IK pointing at visuals, camera beats and effects synced to speech bookmarks.",
  requiredProviders: ["render"],

  async plan(ctx: FormatContext): Promise<CharacterExplainerPlan> {
    const p = ctx.params ?? {};
    const defaults = { title: p.title ?? ctx.topic, tts: p.tts, style: p.style };
    const topic = ctx.topic ?? p.title ?? "this topic";

    if (Array.isArray(p.beats)) {
      const v = validateCharacterPlan(p, defaults);
      if (v.usable) return v.plan;
      const fb = buildFallbackPlan(topic, { tts: p.tts, style: p.style });
      fb.warnings = [...v.plan.warnings, NEUTRAL_FALLBACK_WARNING];
      return fb;
    }

    const warnings: string[] = [];
    if (ctx.providers?.llm) {
      try {
        const { system, prompt } = buildPlanPrompt(topic);
        const out = await ctx.providers.llm.invoke({ system, prompt, json: true });
        const v = validateCharacterPlan(parseModelJSON(out), { ...defaults, title: defaults.title ?? topic });
        if (v.usable) return { ...v.plan, warnings: v.plan.warnings };
        warnings.push(...v.plan.warnings);
      } catch (e: any) {
        warnings.push(`LLM call failed: ${e?.message ?? e}`);
      }
      warnings.push(NEUTRAL_FALLBACK_WARNING);
    }
    const fb = buildFallbackPlan(topic, { tts: p.tts, style: p.style });
    fb.warnings = warnings;
    return fb;
  },

  async compose(plan: CharacterExplainerPlan, _assets: any, ctx: FormatContext): Promise<any> {
    const renderP = ctx.providers!.render!;
    let segments: QualityContext["segments"] = [];
    const build = async (scene: any) => {
      const { runPresenterScene } = await import("./character_explainer_scene.ts");
      await runPresenterScene(scene, plan);
      segments = (scene.playRecords ?? []).map((r: any) => ({ kind: r.kind, startFrame: r.startFrame, endFrame: r.endFrame }));
    };
    const res = await renderP.invoke({
      scene: build,
      options: { ...(ctx.params?.renderOptions ?? {}), style: plan.style ?? "3b1b-dark" },
    });
    // Quality gates over what was actually rendered.
    const { runQualityGates } = await import("./quality.ts");
    const fps = res?.fps ?? 30;
    const total = segments.reduce((s, x) => s + (x.endFrame - x.startFrame), 0) || 1;
    const playFrames = segments.filter((s) => s.kind === "play").reduce((s, x) => s + (x.endFrame - x.startFrame), 0);
    // The presenter breathes/sways every frame, so waits are not fully static;
    // this is a heuristic, not a measured frame diff (see docs).
    const motionFraction = 0.5 + 0.5 * (playFrames / total);
    const quality = runQualityGates({
      fps, width: res?.pixelWidth ?? 0, height: res?.pixelHeight ?? 0,
      durationSeconds: (res?.frames ?? 0) / fps, segments, motionFraction, promise: "motion-led",
    }, characterExplainerGates(plan));
    return { ...res, quality };
  },

  async revise(plan: CharacterExplainerPlan, feedback: Partial<CharacterExplainerPlan>): Promise<CharacterExplainerPlan> {
    const v = validateCharacterPlan({ ...plan, ...feedback }, { title: plan.title, tts: plan.tts, style: plan.style });
    return v.usable ? v.plan : plan;
  },
};
registerFormat(characterExplainerFormat);
