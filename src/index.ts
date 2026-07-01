// Isomorphic entry point: everything that works in both Node and the browser.
// Backends (video export) live in ./node.js and ./browser.js.

export * as vector from "./core/math/vector.ts";
export * as bezier from "./core/math/bezier.ts";
export {
  ORIGIN, UP, DOWN, LEFT, RIGHT, IN, OUT, UL, UR, DL, DR,
  PI, TAU, DEGREES,
} from "./core/math/vector.ts";

export { Color } from "./core/color.ts";
export * as colors from "./core/color.ts";
export {
  WHITE, BLACK, GRAY, GREY, RED, GREEN, BLUE, YELLOW, GOLD, ORANGE,
  PURPLE, PINK, MAROON, TEAL, LIGHT_GRAY, DARK_GRAY, DARK_BLUE,
  BLUE_A, BLUE_B, BLUE_C, BLUE_D, BLUE_E, GREEN_A, GREEN_C, GREEN_E, RED_C, RED_E,
} from "./core/color.ts";

export { Mobject, Group } from "./mobject/Mobject.ts";
export { VMobject, VGroup } from "./mobject/VMobject.ts";
export {
  Arc, Circle, Dot, Ellipse, Annulus, Line, DashedLine, Arrow,
  Polygon, RegularPolygon, Triangle, Rectangle, Square,
} from "./mobject/geometry.ts";
export * from "./mobject/tips.ts";
export * from "./mobject/arcs.ts";
export * from "./mobject/polygram.ts";
export * from "./mobject/shape_matchers.ts";
export * from "./mobject/vectors.ts";
export * from "./mobject/labeled.ts";
export * from "./mobject/boolean_ops.ts";
export * from "./mobject/matrix.ts";
export * from "./mobject/table.ts";
export * from "./mobject/brace.ts";
export * from "./mobject/graph.ts";
export { Text, MarkupText } from "./mobject/text/Text.ts";
export { VText, setDefaultFont, setDefaultFontSync, getDefaultFont } from "./mobject/vectorized_text.ts";
export { parsePathToSubpaths, subpathsToVMobject } from "./mobject/svg_path.ts";
export { MathTex, Tex, texToVGroup, initMathTex } from "./mobject/mathtex.ts";
export { ImageMobject } from "./mobject/image_mobject.ts";
export { SVGMobject, parseXML, parseTransform } from "./mobject/svg_mobject.ts";
export { ThreeDScene, ThreeDCamera, ThreeDAxes } from "./scene/three_d.ts";
export {
  Surface, ParametricSurface, Sphere, Torus, Cylinder, Cone, Box, Cube,
} from "./mobject/surface.ts";
export { NumberLine, Axes, NumberPlane } from "./mobject/coordinate_systems.ts";
export { ValueTracker, DecimalNumber, Integer, alwaysRedraw } from "./mobject/value_tracker.ts";

export { CanvasRenderer, Camera } from "./renderer/CanvasRenderer.ts";
export { Scene } from "./scene/Scene.ts";

export {
  Animation, Transform, ReplacementTransform,
  Create, Write, Uncreate, FadeIn, FadeOut,
  ApplyMethod, Shift, MoveTo, ScaleAnim, FadeToColor,
} from "./animation/Animation.ts";
export {
  AnimationGroup, LaggedStart, LaggedStartMap, Succession, makeAnimateBuilder,
} from "./animation/composition.ts";
export {
  GrowFromPoint, GrowFromCenter, GrowFromEdge, SpinInFromNothing, ShrinkToCenter,
  Rotating, Rotate, MoveAlongPath, Indicate, Flash, Wiggle, Circumscribe, FocusOn,
} from "./animation/extra.ts";
export * as rate_functions from "./animation/rate_functions.ts";

// Plugin system: register the built-ins, then expose use()/registry.
import { registerBuiltins } from "./plugins/builtins.ts";
registerBuiltins();
export { use, registry, Registry } from "./plugins/registry.ts";
export type { Plugin, PluginLike, RegistryKind } from "./plugins/registry.ts";

// Quality presets mirroring manim's -ql / -qm / -qh flags.
export const QUALITIES = {
  low: { pixelWidth: 854, pixelHeight: 480, fps: 15 },
  medium: { pixelWidth: 1280, pixelHeight: 720, fps: 30 },
  high: { pixelWidth: 1920, pixelHeight: 1080, fps: 60 },
  fourk: { pixelWidth: 3840, pixelHeight: 2160, fps: 60 },
};
