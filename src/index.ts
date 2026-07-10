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

// Visual effects model (per-mobject blur/glow/shadow/colorAdjust/noise +
// camera-level FrameEffect grading). Fluent API lives on Mobject itself
// (mob.blur(4).glow(8)); these are the descriptors + pure helpers.
export {
  effectsToCanvasFilter, effectPad, effectsFingerprint, splitEffects,
  makeNoiseBytes, saturateMatrix, hueRotateMatrix, lerpEffects,
} from "./core/effects.ts";
export type { Effect, FrameEffect } from "./core/effects.ts";

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

export { Mobject, Group, CompositeGroup } from "./mobject/Mobject.ts";
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
export { Text, MarkupText, RasterText, CHAR_ASPECT, estimateTextSize, fontSizePt } from "./mobject/text/Text.ts";
export * from "./mobject/text/paragraph.ts";
export * from "./mobject/text/tex_extras.ts";
export * from "./mobject/text/code.ts";
export * from "./mobject/text/variable.ts";
export { ChangingDecimal, ChangeDecimalToValue } from "./animation/numbers.ts";
export { VText, setDefaultFont, setDefaultFontSync, getDefaultFont } from "./mobject/vectorized_text.ts";
export {
  setTextShapingBackend, getTextShapingBackend, isTextShapingBackendActive,
  buildGlyphRun, measureGlyphRunWidth,
} from "./mobject/text_shaping.ts";
export type { TextShapingBackend, GlyphRunEntry, GlyphRunResult, BuildGlyphRunOptions } from "./mobject/text_shaping.ts";
export { parsePathToSubpaths, subpathsToVMobject } from "./mobject/svg_path.ts";
export { MathTex, Tex, SingleStringMathTex, texToVGroup, initMathTex, texToSVG, glyphsFromDomSvg, matchTex, parseTexGroups } from "./mobject/mathtex.ts";
export type { MatchTexResult } from "./mobject/mathtex.ts";
export { CubicBezier, QuadBezier, Spline, Path, PolyLine } from "./mobject/curves.ts";
export type { CubicBezierConfig, QuadBezierConfig, SplineConfig, SplinePoint, PathConfig, PolyLineConfig } from "./mobject/curves.ts";
export { MathTexImage, mathTexImage } from "./mobject/mathtex_image.ts";
export { ImageMobject } from "./mobject/image_mobject.ts";
export { VideoMobject } from "./mobject/video_mobject.ts";
export type { VideoFrameProvider, VideoMobjectConfig } from "./mobject/video_mobject.ts";

// Video metadata: schema.org VideoObject + IIIF Presentation manifest export (with
// chapters from nextSection()) + a provenance sliver, and IIIF ingest. See
// docs/metadata.md.
export {
  toVideoObject, toVideoObjectScript, toIIIFManifest, resolveIIIFVideo, isIIIFManifest,
  chaptersFrom, metaDuration, toISODuration, MANIM_JS_VERSION, IPTC_ALGORITHMIC_MEDIA,
} from "./metadata.ts";
export type {
  VideoMetaInput, MetaSection, Chapter, ProvenanceInput, ResolvedIIIFVideo,
} from "./metadata.ts";
export { SVGMobject, parseXML, parseTransform } from "./mobject/svg_mobject.ts";
export { ThreeDScene, ThreeDCamera, ThreeDAxes } from "./scene/three_d.ts";
export { MovingCameraScene, ScreenRectangle, FullScreenRectangle } from "./scene/moving_camera_scene.ts";
export type { CameraStop } from "./scene/moving_camera_scene.ts";
export { ZoomedScene, ZoomedDisplay } from "./scene/zoomed_scene.ts";
export { VectorScene, LinearTransformationScene } from "./scene/vector_space_scene.ts";
export { MultiCamera } from "./camera/multi_camera.ts";
export { MappingCamera } from "./camera/mapping_camera.ts";
export {
  Surface, ParametricSurface, Sphere, Torus, Cylinder, Cone, Box, Cube,
  Prism, Dot3D, Line3D, Arrow3D, ThreeDVMobject,
} from "./mobject/surface.ts";
export {
  Polyhedron, Tetrahedron, Octahedron, Icosahedron, Dodecahedron, ConvexHull3D,
} from "./mobject/polyhedra.ts";
export {
  loadMeshOBJ, extractMeshData, extractMeshDataFromGeometry, isMeshLoaderAvailable,
} from "./loaders/mesh_obj.ts";
export type { MeshOBJImportOptions } from "./loaders/mesh_obj.ts";
export { loadMeshSTL } from "./loaders/mesh_stl.ts";
export type { MeshSTLImportOptions } from "./loaders/mesh_stl.ts";
export { Mesh3D } from "./mobject/mesh3d.ts";
export { loadMesh3D } from "./loaders/mesh3d_loader.ts";
export type { Mesh3DImportOptions } from "./loaders/mesh3d_loader.ts";
export { normalizePixelArray } from "./core/pixel_array.ts";
export type { NormalizedPixels } from "./core/pixel_array.ts";
export { loadGeoJSON, GeoMap } from "./loaders/geojson_loader.ts";
export type { GeoJSONOptions } from "./loaders/geojson_loader.ts";
export { mercator, equirectangular } from "./loaders/geo_projection.ts";
export type { GeoProjection } from "./loaders/geo_projection.ts";
export { NumberLine, Axes, NumberPlane, PolarPlane, ComplexPlane, UnitInterval } from "./mobject/coordinate_systems.ts";
export { reprojectCurve } from "./mobject/coordinate_reprojection.ts";
export type { CoordSystemLike, ReprojectOptions } from "./mobject/coordinate_reprojection.ts";
export * from "./mobject/functions.ts";
export * from "./mobject/probability.ts";
export { PieChart } from "./mobject/charts.ts";
export type { PieChartConfig } from "./mobject/charts.ts";
export { ParticleSystem } from "./mobject/particles.ts";
export type { ParticleSystemConfig, ParticleState } from "./mobject/particles.ts";
export * from "./mobject/vector_field.ts";
export * from "./mobject/graphing_scale.ts";
export { ValueTracker, DecimalNumber, Integer, alwaysRedraw } from "./mobject/value_tracker.ts";
// Opt-in Yoga-backed Flexbox layout (async init -- see docs/flex-group.md).
export { FlexGroup, isYogaLoaded } from "./mobject/flex_group.ts";
export type { FlexGroupConfig, FlexChildConfig, FlexDirection, JustifyContent, AlignItems } from "./mobject/flex_group.ts";

export { CanvasRenderer, Camera } from "./renderer/CanvasRenderer.ts";
export { SVGRenderer, mobjectsToSVG } from "./renderer/SVGRenderer.ts";
export type { SVGRenderOptions } from "./renderer/SVGRenderer.ts";
export { Scene } from "./scene/Scene.ts";
export type { TaskHandle } from "./scene/Scene.ts";
export { Direction, slideTransition, fadeTransition, zoomInTransition, finishScene } from "./scene/scene_transitions.ts";
export { CameraFrameTween } from "./scene/moving_camera_scene.ts";
export type { IncomingContent, ZoomArea } from "./scene/scene_transitions.ts";
export { isSceneLike, makeScene, runConstruct, sampleSceneAt } from "./scene/orchestrate.ts";

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
export { TransformMatchingShapes, TransformMatchingTex, matchingParts } from "./animation/transform_matching.ts";
// Automatic shared-element matching (auto-Transform by matchId/text/shape).
export { TransformMatchingAuto, autoMatchKeys } from "./animation/auto_matching.ts";
// Diagram-as-code with animated board transitions (parse -> layout -> board).
export { parseDiagram, layoutDiagram, buildBoard, diagram } from "./diagram/diagram.ts";
export type { DiagramGraph, DiagramNode, DiagramEdge, BoardOptions } from "./diagram/diagram.ts";

// Learnings from prior-art (py2ts converter, signals reactivity, frame Player).
export { convert as py2ts } from "./tools/py2ts.ts";
export * from "./reactive/signal.ts";
export { Player } from "./player.ts";
export { Homotopy, SmoothedVectorizedHomotopy, ComplexHomotopy, PhaseFlow } from "./animation/movement.ts";
export { ShowPassingFlash, ShowPassingFlashWithThinningStrokeWidth, ApplyWave, Blink } from "./animation/indication_extra.ts";
export { AnimatedBoundary, TracedPath } from "./animation/changing.ts";
export { Broadcast, ChangeSpeed, UpdateFromFunc, UpdateFromAlphaFunc } from "./animation/specialized.ts";
export { ComplexValueTracker } from "./mobject/complex_value_tracker.ts";
export * as rate_functions from "./animation/rate_functions.ts";

// After-Effects-style expression/driver helpers (pure, deterministic).
export { wiggle, remap, ramp, valueAtTime, compose, mulberry32 } from "./animation/expressions.ts";
export type { Driver } from "./animation/expressions.ts";
// Seeded deterministic noise fields (value/simplex/fbm).
export { valueNoise1D, simplex2D, simplex3D, fbm, fbm3 } from "./core/noise.ts";

// --- D3-parity campaign (v0.4.0): scales, shapes, layouts, joins ------------
export {
  scaleLinear, scaleLog, scalePow, scaleSqrt, scaleRadial, scaleUtc, scaleTime,
  scaleBand, scalePoint, scaleOrdinal, scaleSequential, scaleDiverging, scaleQuantize,
} from "./core/scales.ts";
export type { ScaleLinear, ScaleTime, ScaleBand, ScaleOrdinal, ScaleSequential, ScaleQuantize } from "./core/scales.ts";
export {
  ascending, descending, extent, max, min, sum, mean, rangeOf, quantile,
  group, groups, rollup, rollups, groupSort, pairs, ticks, tickStep, tickIncrement, niceExtent,
} from "./core/array_utils.ts";
export { format, formatSpecifierAuto, utcFormat, utcDay, utcSunday, utcMonday, utcMonth, utcYear } from "./core/format.ts";
export type { UtcInterval } from "./core/format.ts";
export {
  schemeCategory10, schemeTableau10, schemeObservable10, schemeBlues,
  makeInterpolator, interpolateBlues, interpolateBuPu, interpolatePiYG, interpolateBrBG,
  interpolateSpectral, interpolateViridis, interpolateTurbo, interpolateRainbow,
  interpolateTerrain, interpolateHsvLong, interpolateHcl, hsv,
} from "./core/color_schemes.ts";
export {
  stack, lineGen, areaGen, pieGen, arcShape, radialPoint,
  linkHorizontalPoints, linkVerticalPoints, linkRadialPoints,
  basisBeziers, bundleBeziers, bezierChainMobject,
} from "./mobject/shape_gen.ts";
export type { StackSeries, StackConfig, PieSlice, ArcGenConfig, CurveKind } from "./mobject/shape_gen.ts";
export {
  hierarchy, stratify, treemap, partition, pack, tree, cluster,
  treemapSquarify, treemapBinary, treemapSlice, treemapDice, treemapSliceDice,
  packSiblings, packEnclose, HierarchyNode,
} from "./layout/hierarchy.ts";
export type { HierarchyLink, TreemapLayout, PartitionLayout, PackLayout, TreeLayout, ClusterLayout } from "./layout/hierarchy.ts";
export {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY,
} from "./layout/force.ts";
export type { ForceSimulation, SimulationNode, SimulationLink, Force } from "./layout/force.ts";
export { sankey, sankeyLinkHorizontalPoints } from "./layout/sankey.ts";
export { chord, ribbonPoints, chordAngleToPoint } from "./layout/chord.ts";
export { contours, contourThresholds } from "./layout/contours.ts";
export { hexbin, hexagonPoints } from "./layout/hexbin.ts";
export { feature, mesh, decodeArc } from "./loaders/topojson.ts";
export type { Topology } from "./loaders/topojson.ts";
export { dataJoin, interpolateFrames, rankFrame } from "./animation/data_join.ts";

// --- 3b1b campaign (v0.5.0) ---------------------------------------------------
export { sieve, primesUpTo, isPrime, eigen2x2 } from "./core/math/primes.ts";
export { hilbertCurve, lsystem } from "./layout/hilbert.ts";
export { FourierPath, dftOfPath, samplePath } from "./mobject/fourier_path.ts";
export type { FourierCoefficient, FourierPathConfig } from "./mobject/fourier_path.ts";
export { NeuralNetworkMobject } from "./mobject/neural_network.ts";

// --- Mermaid campaign (v0.6.0) -------------------------------------------------
export { loadMermaid, renderMermaidSvg, DiagramMobject } from "./loaders/mermaid_loader.ts";
export type { MermaidLoadConfig, MermaidRenderConfig, MermaidDiagramType } from "./loaders/mermaid_loader.ts";
export { revealDiagram, DiagramReveal, parseEdgeEndpoints } from "./animation/diagram_reveal.ts";
export type { DiagramRevealConfig } from "./animation/diagram_reveal.ts";
export { diffDiagrams, DiagramDiff } from "./animation/diagram_diff.ts";
export type { DiagramDiffConfig } from "./animation/diagram_diff.ts";

// --- Lottie campaign (v0.7.0) ---------------------------------------------------
export { loadLottie, LottieMobject } from "./mobject/lottie_mobject.ts";
export { parseLottie, cubicBezierEase, evalProperty } from "./loaders/lottie_loader.ts";
export type { NeuralNetworkConfig, ForwardPassConfig } from "./mobject/neural_network.ts";
export type { DataJoinConfig, DataJoinResult } from "./animation/data_join.ts";
export type { FbmOptions } from "./core/noise.ts";
// Scene templates + themes (pure factories; compose with Timeline/transitions).
export { resolveTheme } from "./templates/theme.ts";
export type { Theme, ThemeInput } from "./templates/theme.ts";
export { titleCard, lowerThird, statCounter, socialShort, chartReveal, outroCard } from "./templates/templates.ts";
export type { TemplatePiece } from "./templates/templates.ts";
// GSAP-style Timeline builder (relative/absolute placement -> one AnimationGroup).
export { Timeline, timeline } from "./animation/timeline.ts";
export type { TimelineOptions } from "./animation/timeline.ts";
// count/yoyo/repeatDelay wrapper for any leaf Animation/AnimationGroup/Timeline.
export { Repeat } from "./animation/repeat.ts";
export type { RepeatConfig } from "./animation/repeat.ts";
// Composable stagger value-transform helpers (cycle()/staggerRange()).
export { cycle, staggerRange } from "./animation/stagger.ts";
// Motion-Canvas-style tween ergonomics (chainable tweens, spring presets, seeded RNG).
export {
  tweenTo, tweenSignal, tween, map, TweenChain, springTween, useRandom,
  PlopSpring, SmoothSpring, BounceSpring, SwingSpring, JumpSpring, StrikeSpring,
} from "./animation/tween_chain.ts";
export type { SeededRandom, Ease } from "./animation/tween_chain.ts";
// Unified keyframe-track primitive (structured/mutable, unlike opaque RateFuncs).
export { KeyframeTrack, PlayKeyframeTrack, animateSignal } from "./animation/keyframe_track.ts";
export type { Keyframe, KeyframeTrackOptions } from "./animation/keyframe_track.ts";
// Studio-facing property-keyframe track: absolute-time tick(dt)/seek(t) over
// KeyframeTrack, plus bindTrack() wiring a track onto a mobject property.
export { PlayableKeyframeTrack, bindTrack } from "./reactive/keyframes.ts";
// Vector (glyph-outline) DecimalNumber — crisp/SVG-friendly live numbers.
export { VectorDecimalNumber, vectorDecimalNumber } from "./mobject/vector_value_tracker.ts";
export type { VectorDecimalNumberConfig } from "./mobject/vector_value_tracker.ts";
// Composition registry (renderable scenes with metadata) + style/aspect presets.
export {
  registerComposition, getComposition, listCompositions, compositionsToJSON, unregisterComposition,
} from "./scene/compositions.ts";
export type { CompositionDescriptor } from "./scene/compositions.ts";
export {
  STYLE_PRESETS, ASPECT_RATIO_PRESETS, resolveStyle, resolveAspectRatio, registerStylePreset,
} from "./core/presets.ts";
export type { StylePreset, AspectRatioPreset } from "./core/presets.ts";

// Captions: data model + SRT + TikTok-style karaoke pages + an overlay mobject.
export {
  parseSrt, serializeSrt, createTikTokStyleCaptions, captionAt,
} from "./captions/captions.ts";
export type { Caption, CaptionToken, CaptionPage } from "./captions/captions.ts";
export { CaptionTrack, WordCaptionTrack } from "./captions/caption_track.ts";
export type { CaptionTrackConfig, WordCaptionTrackConfig, WordHighlightConfig } from "./captions/caption_track.ts";
// Audio analysis for audio-reactive animation (decode + per-frame FFT).
export { getAudioData, visualizeAudio, getWaveformPortion, createSmoothSvgPath } from "./audio/analyze.ts";
export type { AudioData } from "./audio/analyze.ts";
export { fftInPlace, magnitudeSpectrum, nextPow2 } from "./audio/fft.ts";

// Interchange: OTIO timeline model (+ .otio export) and Lottie import/export.
export {
  rationalTime, rtSeconds, timeRange, toOtioJSON, fromOtioJSON, sceneToOtio, sceneToOtioString,
} from "./interchange/otio.ts";
export type { RationalTime, TimeRange, OtioClip, OtioTrack, OtioTimeline } from "./interchange/otio.ts";
export {
  vmobjectToLottieShapes, lottieShapeToPoints, lottieShapesToVMobject, vmobjectToLottieJSON, loadLottieShapes,
} from "./interchange/lottie.ts";
export type { LottieShape, LottieExportOptions } from "./interchange/lottie.ts";

// Physics: analytic EM/wave/optics fields + a pluggable rigid-body engine.
export {
  electricFieldFunc, magneticFieldFunc, ElectricField, MagneticField, thinLensRefract,
} from "./physics/fields.ts";
export type { PointCharge, PointCurrent } from "./physics/fields.ts";
export { WaveCurve, LinearWave, StandingWave } from "./physics/waves.ts";
export type { WaveConfig } from "./physics/waves.ts";
export { SimpleEngine, physics, Pendulum } from "./physics/rigid.ts";
export type { PhysicsBody, PhysicsEngineOptions, PhysicsEngineLike, PendulumConfig } from "./physics/rigid.ts";

// Remotion-inspired primitives: range-mapping interpolate, physics springs, and
// composable easing combinators. `interpolate` claims the bare top-level name
// (the 2-arg lerp stays namespaced as `bezier.interpolate`).
export { interpolate } from "./animation/interpolate.ts";
export type { Extrapolation, InterpolateOptions } from "./animation/interpolate.ts";
export { spring, measureSpring, springRate } from "./animation/spring.ts";
export type { SpringConfig, SpringParams } from "./animation/spring.ts";
export { Easing } from "./animation/easing.ts";
export type { EaseFn } from "./animation/easing.ts";

// Sequence time-shift + mobject-level transitions (timing orthogonal to presentation).
export { Sequence, SequenceAnimation } from "./animation/sequence.ts";
export type { SequenceConfig } from "./animation/sequence.ts";
export { crossFade, slide, wipe, Slide, Wipe, linearTiming, springTiming } from "./animation/transitions.ts";
export type { TransitionConfig, TimingPreset, TimingPresetResult } from "./animation/transitions.ts";

// Async-asset gate (Remotion-style delayRender/continueRender).
export {
  delayRender, continueRender, delayRenderUntil, waitForRender, getPendingRenders,
} from "./core/async_gate.ts";
export type { DelayHandle } from "./core/async_gate.ts";

// Typed scene params + calculateMetadata hook.
export { defineSchema } from "./core/schema.ts";
export type { Schema, SchemaSpec, FieldSpec, FieldType } from "./core/schema.ts";
export { resolveSceneMetadata } from "./scene/scene_params.ts";
export type { SceneMetadata, CalculateMetadata } from "./scene/scene_params.ts";

// Plugin system: register the built-ins, then expose use()/registry.
import { registerBuiltins } from "./plugins/builtins.ts";
registerBuiltins();
export { loadWasm, isWasmLoaded, bezierEvalWasm, earclipWasm, mat3VecWasm } from "./wasm.ts";
export { loadManifest, loadManifestFromFile } from "./plugins/manifest.ts";
export { compileExpr, evalExpr } from "./plugins/expr.ts";
export { use, registry, Registry } from "./plugins/registry.ts";
export type { Plugin, PluginLike, RegistryKind } from "./plugins/registry.ts";

// Quality presets mirroring manim's -ql / -qm / -qh flags.
export const QUALITIES: Record<string, { pixelWidth: number; pixelHeight: number; fps: number }> = {
  low: { pixelWidth: 854, pixelHeight: 480, fps: 15 },
  medium: { pixelWidth: 1280, pixelHeight: 720, fps: 30 },
  high: { pixelWidth: 1920, pixelHeight: 1080, fps: 60 },
  fourk: { pixelWidth: 3840, pixelHeight: 2160, fps: 60 },
};
