// Global constants, mirroring ManimCommunity manim/constants.py. Screen/frame
// dimensions, buffers, axis/edge vectors, and rendering enums. Vectors are
// plain number[] triples like the rest of the codebase.

import type { Vec3 } from "./types.ts";
import {
  PI,
  TAU,
  DEGREES,
  UP,
  DOWN,
  LEFT,
  RIGHT,
} from "./math/vector.ts";

// Re-export the angle constants and direction vectors that already live in
// math/vector.ts so consumers can import them from one place.
export { PI, TAU, DEGREES } from "./math/vector.ts";

// --- Coordinate axes ---
export const X_AXIS: Vec3 = [1, 0, 0];
export const Y_AXIS: Vec3 = [0, 1, 0];
export const Z_AXIS: Vec3 = [0, 0, 1];

// --- Frame dimensions (manim's default 16:9-ish config) ---
export const FRAME_HEIGHT = 8.0;
export const FRAME_WIDTH = 14.222222222222221; // 8 * (16/9)
export const FRAME_Y_RADIUS = FRAME_HEIGHT / 2;
export const FRAME_X_RADIUS = FRAME_WIDTH / 2;
export const DEFAULT_FRAME_RATE = 60;

// --- Screen edge vectors (center of each edge) ---
export const TOP: Vec3 = [UP[0] * FRAME_Y_RADIUS, UP[1] * FRAME_Y_RADIUS, UP[2] * FRAME_Y_RADIUS];
export const BOTTOM: Vec3 = [DOWN[0] * FRAME_Y_RADIUS, DOWN[1] * FRAME_Y_RADIUS, DOWN[2] * FRAME_Y_RADIUS];
export const LEFT_SIDE: Vec3 = [LEFT[0] * FRAME_X_RADIUS, LEFT[1] * FRAME_X_RADIUS, LEFT[2] * FRAME_X_RADIUS];
export const RIGHT_SIDE: Vec3 = [RIGHT[0] * FRAME_X_RADIUS, RIGHT[1] * FRAME_X_RADIUS, RIGHT[2] * FRAME_X_RADIUS];

// --- Buffers (spacing constants, in scene units) ---
export const SMALL_BUFF = 0.1;
export const MED_SMALL_BUFF = 0.25;
export const MED_LARGE_BUFF = 0.5;
export const LARGE_BUFF = 1.0;
export const DEFAULT_MOBJECT_TO_EDGE_BUFFER = MED_LARGE_BUFF;
export const DEFAULT_MOBJECT_TO_MOBJECT_BUFFER = MED_SMALL_BUFF;

// --- Miscellaneous defaults ---
export const EPSILON = 1e-8;
export const DEFAULT_STROKE_WIDTH = 4;
export const DEFAULT_FONT_SIZE = 48;
export const DEFAULT_DOT_RADIUS = 0.08;
export const DEFAULT_ARROW_TIP_LENGTH = 0.35;

// --- Rendering enums (as const objects + derived string-literal types) ---

/** Which renderer backend to use (this port targets Canvas / WebGL). */
export const RendererType = {
  CANVAS: "canvas",
  WEBGL: "webgl",
} as const;
export type RendererType = (typeof RendererType)[keyof typeof RendererType];

/** How consecutive line segments are joined at their meeting points. */
export const LineJointType = {
  AUTO: "auto",
  ROUND: "round",
  BEVEL: "bevel",
  MITER: "miter",
} as const;
export type LineJointType = (typeof LineJointType)[keyof typeof LineJointType];

/** How the ends of open strokes are capped. */
export const CapStyleType = {
  AUTO: "auto",
  ROUND: "round",
  BUTT: "butt",
  SQUARE: "square",
} as const;
export type CapStyleType = (typeof CapStyleType)[keyof typeof CapStyleType];

// --- Render quality presets (pixel dimensions + frame rate) ---

/** A single render-quality preset. */
export interface Quality {
  pixelWidth: number;
  pixelHeight: number;
  fps: number;
}

export const QUALITIES: Record<string, Quality> = {
  low: { pixelWidth: 854, pixelHeight: 480, fps: 15 },
  medium: { pixelWidth: 1280, pixelHeight: 720, fps: 30 },
  high: { pixelWidth: 1920, pixelHeight: 1080, fps: 60 },
  fourk: { pixelWidth: 3840, pixelHeight: 2160, fps: 60 },
  production: { pixelWidth: 2560, pixelHeight: 1440, fps: 60 },
};
