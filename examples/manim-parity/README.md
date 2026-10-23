# Manim gallery parity: all 27 examples, ported 1:1

Every example on
[docs.manim.community/en/stable/examples.html](https://docs.manim.community/en/stable/examples.html),
ported line-for-line to ecmanim. The Python originals are committed in
[`ref/`](./ref/) — read any port side-by-side with its source. The initial
assessment scored ecmanim **13 reproducible / 13 needing gaps / 1 structurally
blocked**; every gap was then closed (clusters M1–M5) and the ports below are
the receipts: **27 / 27**.

## Running

```bash
npm run demos:manim                    # all 27 -> examples/manim-parity/out/*.mp4
node --experimental-strip-types examples/manim-parity/26-OpeningManim.ts   # just one
```

`ECMANIM_DEMO_QUALITY=low|medium|high` (default medium). Iterating on a port?
Delete `out/partial/` — pre-play static mutations aren't captured by the
segment content hash.

## Porting conventions (Python → ecmanim)

| Python | ecmanim |
|---|---|
| `snake_case(kwarg=...)` | `camelCase({ kwarg })` config objects |
| `Dot(LEFT)` positional point | `new Dot({ point: LEFT })` |
| `2.25*LEFT + 1.5*UP` | `V.add(V.scale(LEFT, 2.25), V.scale(UP, 1.5))` |
| `mob[i]` | `mob.get(i)` |
| `mob.height` / `.width` | `mob.getHeight()` / `getWidth()` |
| `font_size=48` (points) | `fontSize: fontSizePt(48)` (world units) |
| `ImageMobject(np.uint8([[...]]))` | `new ImageMobject(await imageFromArray([[...]]))` |
| LaTeX binary | MathJax (`initMathTex()`; demoRender calls it) |

## Scorecard — 27/27 ported

| # | Example | Assessment → Now | Gaps closed for it |
|---|---|---|---|
| 01 | ManimCELogo | ✅ ready | — (Tex text-node crash fixed en route) |
| 02 | BraceAnnotation | gap → ✅ | `Line.getUnitVector`; Brace rebuilt (real curly geometry + rotate-frame placement) |
| 03 | VectorArrow | ✅ ready | arrow head now CE's 0.35 default (was 0.25, #119) |
| 04 | GradientImageFromArray | gap → ✅ | `imageFromArray` (pixel arrays → bitmap), pixelated upscaling |
| 05 | BooleanOperations | gap → ✅ | boolean-op trailing style config; `fontSizePt` |
| 06 | PointMovingOnShapes | ✅ ready | — |
| 07 | MovingAround | ✅ ready | — |
| 08 | MovingAngle | gap → ✅ | `ValueTracker.incrementValue` |
| 09 | MovingDots | ✅ ready | — |
| 10 | MovingGroupToDestination | ✅ ready | — |
| 11 | MovingFrameBox | ✅ ready | — |
| 12 | RotationUpdater | gap → ✅ | `Mobject.rotateAboutOrigin` |
| 13 | PointWithTrace | gap → ✅ | `VMobject.addPointsAsCorners`; `Rotating` `angle` alias |
| 14 | SinAndCosFunctionPlot | gap → ✅ | `numbersToInclude` + elongated ticks; dense `plot()` sampling; point-form `getVerticalLine` + `lineFunc`; `getGraphLabel` `xVal`; Axes `tips` |
| 15 | ArgMinExample | ✅ ready | (Axes now self-centers like manim) |
| 16 | GraphAreaPlot | gap → ✅ | `numbersToInclude`; point-form `getVerticalLine`; Axes centering + live label anchors |
| 17 | PolygonOnAxes | ✅ ready | — |
| 18 | HeatDiagramPlot | gap → ✅ | `numbersToInclude` on both axes |
| 19 | FollowingGraphCamera | gap → ✅ | `plot()` records `tMin`/`tMax` |
| 20 | MovingZoomedSceneAround | **blocked** → ✅ | ZoomedScene rebuilt: real render-to-region zoom window, pop-out animation, `UpdateFromFunc`, `addForegroundMobject`, vector `scale([x,y,z])`, `Mobject.replace` |
| 21 | FixedInFrameMObjectTest | ✅ ready | — |
| 22 | ThreeDLightSourcePosition | gap → ✅ | `ThreeDScene.lightSource.moveTo` proxy |
| 23 | ThreeDCameraRotation | ✅ ready | — |
| 24 | ThreeDCameraIllusionRotation | ✅ ready (approx. motion) | — |
| 25 | ThreeDSurfacePlot | gap → ✅ | `Surface.setStyle` + `setFillByCheckerboard` |
| 26 | OpeningManim | gap → ✅ | `prepareForNonlinearTransform` (the warped grid); Tex `\LaTeX` crash fix |
| 27 | SineCurveUnitCircle | ✅ ready | — |

Honest notes: 24's "illusion rotation" is a qualitatively-similar oscillation,
not frame-identical to manim's updater; 3D shading is ecmanim's own
Lambert/Gouraud approximation, so 22/25 match in structure and light
direction, not per-pixel; text metrics come from system fonts + MathJax, so
glyph spacing differs slightly from a LaTeX toolchain's.

## CI

`manim-smoke` in `.github/workflows/ci.yml` renders 02 (MathTex + Brace),
16 (axes depth), and 25 (3D surface) end-to-end at low quality on every push.
