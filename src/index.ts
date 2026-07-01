// Isomorphic entry point: everything that works in both Node and the browser.
// Backends (video export) live in ./node.js and ./browser.js.

export * as vector from "./core/math/vector.ts";
export * as bezier from "./core/math/bezier.ts";
export {
  ORIGIN, UP, DOWN, LEFT, RIGHT, IN, OUT, UL, UR, DL, DR,
  PI, TAU, DEGREES,
} from "./core/math/vector.ts";

// Color: the Color class, the full palette (core names top-level + X11/XKCD/
// SVGNAMES/BS381/AS2700/DVIPSNAMES namespaces), and all color utilities.
export * from "./core/color.ts";
export * as colors from "./core/color.ts";

// Constants (buffers, axes, screen edges, enums, defaults). PI/TAU/DEGREES come
// from vector.ts above, so exclude them here to avoid a duplicate export.
export {
  X_AXIS, Y_AXIS, Z_AXIS, TOP, BOTTOM, LEFT_SIDE, RIGHT_SIDE,
  SMALL_BUFF, MED_SMALL_BUFF, MED_LARGE_BUFF, LARGE_BUFF,
  DEFAULT_MOBJECT_TO_EDGE_BUFFER, DEFAULT_MOBJECT_TO_MOBJECT_BUFFER,
  FRAME_HEIGHT, FRAME_WIDTH, FRAME_X_RADIUS, FRAME_Y_RADIUS, DEFAULT_FRAME_RATE,
  EPSILON, DEFAULT_STROKE_WIDTH, DEFAULT_FONT_SIZE, DEFAULT_DOT_RADIUS, DEFAULT_ARROW_TIP_LENGTH,
  RendererType, LineJointType, CapStyleType,
} from "./core/constants.ts";
export * as constants from "./core/constants.ts";

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
export { Text, MarkupText, RasterText } from "./mobject/text/Text.ts";
export * from "./mobject/text/paragraph.ts";
export * from "./mobject/text/tex_extras.ts";
export * from "./mobject/text/code.ts";
export * from "./mobject/text/variable.ts";
export { ChangingDecimal, ChangeDecimalToValue } from "./animation/numbers.ts";
export { VText, setDefaultFont, setDefaultFontSync, getDefaultFont } from "./mobject/vectorized_text.ts";
export { parsePathToSubpaths, subpathsToVMobject } from "./mobject/svg_path.ts";
export { MathTex, Tex, SingleStringMathTex, texToVGroup, initMathTex } from "./mobject/mathtex.ts";
export { ImageMobject } from "./mobject/image_mobject.ts";
export { SVGMobject, parseXML, parseTransform } from "./mobject/svg_mobject.ts";
export { ThreeDScene, ThreeDCamera, ThreeDAxes } from "./scene/three_d.ts";
export {
  Surface, ParametricSurface, Sphere, Torus, Cylinder, Cone, Box, Cube,
  Prism, Dot3D, Line3D, Arrow3D, ThreeDVMobject,
} from "./mobject/surface.ts";
export {
  Polyhedron, Tetrahedron, Octahedron, Icosahedron, Dodecahedron, ConvexHull3D,
} from "./mobject/polyhedra.ts";
export { NumberLine, Axes, NumberPlane, PolarPlane, ComplexPlane, UnitInterval } from "./mobject/coordinate_systems.ts";
export * from "./mobject/functions.ts";
export * from "./mobject/probability.ts";
export * from "./mobject/vector_field.ts";
export * from "./mobject/graphing_scale.ts";
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
export {
  DrawBorderThenFill, Unwrite, ShowIncreasingSubsets, ShowSubmobjectsOneByOne,
  AddTextLetterByLetter, RemoveTextLetterByLetter, AddTextWordByWord,
  TypeWithCursor, Untype, UntypeWithCursor, SpiralIn,
} from "./animation/creation_extra.ts";
export {
  TransformFromCopy, ClockwiseTransform, CounterclockwiseTransform, MoveToTarget,
  Restore, ApplyFunction, ApplyPointwiseFunction, ApplyPointwiseFunctionToCenter,
  ApplyMatrix, ApplyComplexFunction, ScaleInPlace, FadeTransform, FadeTransformPieces,
  CyclicReplace, Swap,
} from "./animation/transform_extra.ts";
export { TransformMatchingShapes, TransformMatchingTex } from "./animation/transform_matching.ts";
export { Homotopy, SmoothedVectorizedHomotopy, ComplexHomotopy, PhaseFlow } from "./animation/movement.ts";
export { ShowPassingFlash, ShowPassingFlashWithThinningStrokeWidth, ApplyWave, Blink } from "./animation/indication_extra.ts";
export { AnimatedBoundary, TracedPath } from "./animation/changing.ts";
export { Broadcast, ChangeSpeed } from "./animation/specialized.ts";
export { ComplexValueTracker } from "./mobject/complex_value_tracker.ts";
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
