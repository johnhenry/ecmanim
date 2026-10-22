// Type pins for the public option/config shapes (epic #61, child #63).
//
// Compiled (never run) by `npm run type-check` via tsconfig.test-types.json.
// Each pin lists the CURRENT keys of an interface with their exact types and
// optionality, and asserts the interface still has precisely that shape for
// those keys, in BOTH directions. So:
//   * adding a new OPTIONAL field to an interface: still compiles (the pin
//     only looks at the listed keys);
//   * removing/renaming/re-typing a listed field, or making an optional field
//     required (or vice versa): compile error here, with the pin name in it.
// When a change here is deliberate and additive, ADD the new key to the pin
// (as optional); never edit or delete an existing line.
//
// Note: RenderOptions / BrowserOptions carry `[key: string]: any`; pinning via
// `Pick<T, keys>` still checks the declared keys individually.

import type { RenderOptions } from "../../src/node.ts";
import type { BrowserOptions, RecordVideoOptions } from "../../src/browser.ts";
import type { Keyframe, KeyframeTrackOptions, ParticleSystemConfig, Camera } from "../../src/index.ts";

type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
/** Compile error unless `T` is exactly `true`. */
type Expect<T extends true> = T;
/** Both-way assignability on the listed keys, incl. optionality and readonly-ness. */
type Pinned<Actual, Keys extends keyof Actual, Pin> = IsEqual<Pick<Actual, Keys>, Pin>;

// --- RenderOptions (src/node.ts) -------------------------------------------
type RenderOptionsPin = {
  output?: string;
  quality?: string;
  background?: string;
  format?: string;
  fps?: number;
  pixelWidth?: number;
  pixelHeight?: number;
  resolution?: [number, number];
  camera?: any;
  verbose?: boolean;
  vectorFont?: string;
  fonts?: Array<{ path: string; name: string }>;
  saveLastFrame?: boolean;
  transparent?: boolean;
  fromAnimationNumber?: number | null;
  uptoAnimationNumber?: number | null;
  disableCaching?: boolean;
  saveSections?: boolean;
  params?: Record<string, any>;
  onProgress?: (p: { segmentsDone: number; segmentsTotal: number }) => void;
  style?: string;
  aspectRatio?: string;
  stillFrame?: number;
  watermark?: import("../../src/core/watermark.ts").WatermarkConfig;
  encoder?: "ffmpeg" | "js"; // added by #70 (additive)
};
export type _RenderOptions = Expect<Pinned<RenderOptions, keyof RenderOptionsPin, RenderOptionsPin>>;

// --- BrowserOptions (src/browser.ts) ---------------------------------------
type BrowserOptionsPin = {
  canvas?: any;
  background?: string;
  loop?: boolean;
  quality?: string;
  pixelWidth?: number;
  pixelHeight?: number;
  fps?: number;
  camera?: any;
  mimeType?: string;
  bitrate?: number;
};
export type _BrowserOptions = Expect<Pinned<BrowserOptions, keyof BrowserOptionsPin, BrowserOptionsPin>>;

// --- RecordVideoOptions (src/browser.ts) -----------------------------------
// `format` may only ever WIDEN (e.g. add "apng" | "zip"); the existing members
// must stay assignable. Checked as: old union assignable to the current type,
// and every BrowserOptions key still present.
type RecordVideoFormat = NonNullable<RecordVideoOptions["format"]>;
export type _RecordVideoFormatKeepsOld = Expect<"webm" | "gif" | "mp4" extends RecordVideoFormat ? true : false>;
export type _RecordVideoAddsJsFormats = Expect<"apng" | "zip" extends RecordVideoFormat ? true : false>;
export type _RecordVideoIsOptional = Expect<{} extends Pick<RecordVideoOptions, "format"> ? true : false>;
export type _RecordVideoExtendsBrowserOptions = Expect<RecordVideoOptions extends BrowserOptions ? true : false>;

// --- Keyframe (src/animation/keyframe_track.ts) ----------------------------
type KeyframePin = { t: number; value: string; ease?: import("../../src/core/types.ts").RateFunc | string };
export type _Keyframe = Expect<Pinned<Keyframe<string>, keyof KeyframePin, KeyframePin>>;
// Additive fields (#65): optional, so existing Keyframe literals stay valid.
type KeyframeOutgoingPin = { easeOut?: import("../../src/core/types.ts").RateFunc | string };
export type _KeyframeOutgoing = Expect<Pinned<Keyframe<string>, keyof KeyframeOutgoingPin, KeyframeOutgoingPin>>;

// --- KeyframeTrackOptions ---------------------------------------------------
type KeyframeTrackOptionsPin = { duration?: number; interpolate?: (a: string, b: string, alpha: number) => string };
export type _KeyframeTrackOptions = Expect<
  Pinned<KeyframeTrackOptions<string>, keyof KeyframeTrackOptionsPin, KeyframeTrackOptionsPin>
>;
// Additive field (#65).
type KeyframeTrackEaseModePin = { easeMode?: "incoming" | "outgoing" };
export type _KeyframeTrackEaseMode = Expect<
  Pinned<KeyframeTrackOptions<string>, keyof KeyframeTrackEaseModePin, KeyframeTrackEaseModePin>
>;

// --- ParticleSystemConfig (src/mobject/particles.ts) -----------------------
type Range = number | [number, number];
type ParticleSystemConfigPin = {
  emitterPoint?: number[];
  emitterRadius?: number;
  emitterLine?: [number[], number[]];
  rate?: number;
  lifetime?: Range;
  speed?: Range;
  direction?: number;
  spread?: number;
  gravity?: number | [number, number];
  drag?: number;
  size?: Range;
  particleOpacity?: Range;
  colorRamp?: import("../../src/core/types.ts").ColorLike[];
  seed?: number;
  maxParticles?: number;
  maxParticlesMode?: "total" | "alive";
  shape?: "circle" | "square";
  autoAdvance?: boolean;
};
export type _ParticleSystemConfig = Expect<
  Pinned<ParticleSystemConfig, keyof ParticleSystemConfigPin, ParticleSystemConfigPin>
>;

// --- Camera public fields (src/renderer/CanvasRenderer.ts) -----------------
type CameraPin = {
  pixelWidth: number;
  pixelHeight: number;
  frameHeight: number;
  frameWidth: number;
  frameCenter: number[];
  background: import("../../src/core/types.ts").ColorLike;
  disableZBuffer?: boolean;
  flatShading?: boolean;
  focalDistance?: number;
  superSample?: number;
  frame?: any;
  zoom?: number;
  rotation?: number;
  frameEffects?: import("../../src/core/effects.ts").FrameEffect[];
};
export type _Camera = Expect<Pinned<Camera, keyof CameraPin, CameraPin>>;
export type _CameraMethods = Expect<
  Camera extends { toPixel(p: number[]): [number, number] } ? true : false
>;

// --- Self-test: prove the pins actually bite -------------------------------
// Each line below MUST be an error if the pin machinery works; if one stops
// erroring, `@ts-expect-error` itself fails the build.
type _P1 = { a?: number; b: string };
// @ts-expect-error removed key is detected
export type _NegRemoved = Expect<Pinned<{ a?: number }, "a", _P1>>;
// @ts-expect-error optional -> required is detected
export type _NegRequired = Expect<Pinned<{ a: number }, "a", { a?: number }>>;
// @ts-expect-error re-typed (narrowed) key is detected
export type _NegNarrowed = Expect<Pinned<{ a?: "x" }, "a", { a?: string }>>;
// @ts-expect-error re-typed (widened) key is detected
export type _NegWidened = Expect<Pinned<{ a?: string | number }, "a", { a?: string }>>;
// An added optional field does NOT trip the pin:
export type _PosAdded = Expect<Pinned<{ a?: number; extra?: string }, "a", { a?: number }>>;
