// ecmanim/authoring — the higher-level authoring/orchestration layer: a plan IR
// (dry-run), quality gates, a pluggable Format lifecycle + provider abstraction
// (llm/tts/render), and a ecmanim render provider so it can back prompt→video
// pipelines. Kept out of the lean core entry; import from "ecmanim/authoring".

export {
  toPlanIR, toPlanString,
} from "./authoring/plan.ts";
export type { PlanIR, PlanSegment, PlanChapter, PlanConfig, PlanOptions } from "./authoring/plan.ts";

export {
  slideshowRisk, checkDeliveryPromise, runQualityGates, DEFAULT_QUALITY_GATES,
} from "./authoring/quality.ts";
export type { QualityContext, QualityGate, QualityReport } from "./authoring/quality.ts";

export {
  registerProvider, getProvider, listProviders,
  registerFormat, getFormat, listFormats, runFormat,
} from "./authoring/formats.ts";
export type { Provider, ProviderKind, ProviderSet, Format, FormatContext, FormatResult } from "./authoring/formats.ts";

export { manimRenderProvider, titleCardFormat } from "./authoring/showrunner.ts";
export type { TitleCardPlan } from "./authoring/showrunner.ts";

export {
  characterExplainerFormat, ollamaLLMProvider, validateCharacterPlan, buildFallbackPlan, buildPlanPrompt, parseModelJSON,
  scheduleCues, layoutVisuals, characterExplainerGates, createPresenterPoseLibrary,
  PRESENTER_BONES, PRESENTER_POSES, POSE_NAMES, CUE_DOS, CAMERA_KINDS, FX_KINDS, VISUAL_KINDS, VISUAL_REGIONS, END_LEAD, STAGE,
} from "./authoring/character_explainer.ts";
export type {
  CharacterExplainerPlan, CharacterVisual, CharacterBeat, CharacterCue, PoseName, CueDo, CameraKind, FxKind, VisualKind,
  VisualRegion, CueEvent, Box, ValidationResult, OllamaOptions,
} from "./authoring/character_explainer.ts";

export { explainerFormat, chartRevealFormat, quoteCardFormat } from "./authoring/formats_builtin.ts";
export type {
  ExplainerPlan, ExplainerSection, ChartRevealPlan, ChartDatum, QuoteCardPlan,
} from "./authoring/formats_builtin.ts";
