// Isomorphic entry point: everything that works in both Node and the browser.
// Backends (video export) live in ./node.js and ./browser.js.

export * as vector from "./core/math/vector.js";
export * as bezier from "./core/math/bezier.js";
export {
  ORIGIN, UP, DOWN, LEFT, RIGHT, IN, OUT, UL, UR, DL, DR,
  PI, TAU, DEGREES,
} from "./core/math/vector.js";

export { Color } from "./core/color.js";
export * as colors from "./core/color.js";
export {
  WHITE, BLACK, GRAY, GREY, RED, GREEN, BLUE, YELLOW, GOLD, ORANGE,
  PURPLE, PINK, MAROON, TEAL, LIGHT_GRAY, DARK_GRAY, DARK_BLUE,
  BLUE_A, BLUE_B, BLUE_C, BLUE_D, BLUE_E, GREEN_A, GREEN_C, GREEN_E, RED_C, RED_E,
} from "./core/color.js";

export { Mobject } from "./mobject/Mobject.js";
export { VMobject, VGroup } from "./mobject/VMobject.js";
export {
  Arc, Circle, Dot, Ellipse, Annulus, Line, DashedLine, Arrow,
  Polygon, RegularPolygon, Triangle, Rectangle, Square,
} from "./mobject/geometry.js";
export { Text, MarkupText } from "./mobject/text/Text.js";
export { VText, setDefaultFont, setDefaultFontSync, getDefaultFont } from "./mobject/vectorized_text.js";
export { parsePathToSubpaths, subpathsToVMobject } from "./mobject/svg_path.js";
export { MathTex, Tex, texToVGroup, initMathTex } from "./mobject/mathtex.js";
export { ImageMobject } from "./mobject/image_mobject.js";
export { SVGMobject, parseXML, parseTransform } from "./mobject/svg_mobject.js";
export { ThreeDScene, ThreeDCamera, ThreeDAxes } from "./scene/three_d.js";
export {
  Surface, ParametricSurface, Sphere, Torus, Cylinder, Cone, Box, Cube,
} from "./mobject/surface.js";
export { NumberLine, Axes, NumberPlane } from "./mobject/coordinate_systems.js";
export { ValueTracker, DecimalNumber, Integer, alwaysRedraw } from "./mobject/value_tracker.js";

export { CanvasRenderer, Camera } from "./renderer/CanvasRenderer.js";
export { Scene } from "./scene/Scene.js";

export {
  Animation, Transform, ReplacementTransform,
  Create, Write, Uncreate, FadeIn, FadeOut,
  ApplyMethod, Shift, MoveTo, ScaleAnim, FadeToColor,
} from "./animation/Animation.js";
export {
  AnimationGroup, LaggedStart, LaggedStartMap, Succession, makeAnimateBuilder,
} from "./animation/composition.js";
export {
  GrowFromPoint, GrowFromCenter, GrowFromEdge, SpinInFromNothing, ShrinkToCenter,
  Rotating, Rotate, MoveAlongPath, Indicate, Flash, Wiggle, Circumscribe, FocusOn,
} from "./animation/extra.js";
export * as rate_functions from "./animation/rate_functions.js";

// Quality presets mirroring manim's -ql / -qm / -qh flags.
export const QUALITIES = {
  low: { pixelWidth: 854, pixelHeight: 480, fps: 15 },
  medium: { pixelWidth: 1280, pixelHeight: 720, fps: 30 },
  high: { pixelWidth: 1920, pixelHeight: 1080, fps: 60 },
  fourk: { pixelWidth: 3840, pixelHeight: 2160, fps: 60 },
};
