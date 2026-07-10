# D3 → ecmanim porting conventions

Every port is a faithful translation of a D3 Observable gallery notebook
(compiled cell JS in `ref/`, data in `data/`). Follow `01-bar-chart.ts` as
the exemplar. The library ships d3-named equivalents, so ports read almost
1:1.

## Structure
- The notebook's `_chart` cell is the scene; ignore md/howto/altplot cells.
- `FileAttachment("x.csv").csv({typed: true})` → `loadCsv("x.csv")` (autoType
  included); `.json()` → `loadJson("x.json")`. Sanitized names: `^DJI@2.csv`
  → `DJI-2.csv` (see data/ listing).
- Scene = `class X extends Scene { async construct() {...} }` +
  `await demoRender(X, import.meta.url)`. Charts that zoom/pan use
  `MovingCameraScene`.

## Coordinates
D3 draws in SVG pixel space (y-DOWN, top-left origin). Build
`const f = svgFrame(width, height)` with the ref's dimensions, then:
- positions: `f.pt(x, y)` (handles y-flip + centering + fit)
- lengths: `f.len(n)`; stroke widths: `f.sw(n)`
- d3-shape ANGLES (pie/arc/chord/radial/partition-sunburst) are radians
  clockwise-from-12. `radialPoint(angle, radius)` (from the barrel) maps
  them into world directly — scale the RADIUS with `f.len()` and position
  the result relative to the chart center, or work in SVG px and wrap with
  `f.pt`.

## The library surface (all from ../../src/node.ts, d3 names)
scaleLinear/Log/Sqrt/Radial/Utc/Time/Band/Point/Ordinal/Sequential/
Diverging/Quantize · ticks/extent/max/min/sum/group/groups/rollup/rollups/
groupSort/quantile/pairs/rangeOf · format/utcFormat + utcDay/utcSunday/
utcMonday/utcMonth/utcYear · schemeTableau10/Observable10/Category10/
schemeBlues + interpolateBlues/BuPu/PiYG/BrBG/Spectral/Viridis/Turbo/
Rainbow/Terrain + interpolateHcl/interpolateHsvLong/hsv/makeInterpolator ·
stack/lineGen/areaGen/pieGen/arcShape/radialPoint/linkHorizontalPoints/
linkVerticalPoints/linkRadialPoints/basisBeziers/bundleBeziers/
bezierChainMobject · hierarchy/stratify/treemap/partition/pack/tree/
cluster (+tile fns) · forceSimulation/forceLink/forceManyBody/forceCenter/
forceCollide/forceX/forceY · sankey/sankeyLinkHorizontalPoints ·
chord/ribbonPoints/chordAngleToPoint · contours/contourThresholds ·
hexbin/hexagonPoints · feature/mesh (TopoJSON) · dataJoin/
interpolateFrames/rankFrame.

Axes: use `axisLeft`/`axisBottom` from `./_axes.ts` (extend them if a ref
needs more — they're scene-side helpers, editable).

## Animation (the "surpass" column — every port is a VIDEO)
The static refs get a designed intro (staggered growth, draw-on via
`tweenTo(mob, {end: 1})`, LaggedStart) and the animated refs match their
original motion. Camera: `MovingCameraScene.centerOn/goToCameraStop`;
deep zooms use `new CameraFrameTween(frame, {center, width}, {path: "zoom"})`
(van Wijk — use it for zoomable circle packing). Keyed updates:
`dataJoin(oldMobs, data, keyFn, {make, update, enterFrom, exitTo})` →
play `.animation`, keep `.mobs`. Force layouts: run deterministically
(`forceSimulation(nodes, {seed: 1})...run()`) then animate positions, or
tick-by-tick with updaters for a "settling" intro.

## Rendering + receipts (MANDATORY per port)
```bash
ECMANIM_DEMO_QUALITY=low npx tsx examples/d3-parity/NN-name.ts
ffmpeg -y -loglevel error -i examples/d3-parity/out/NN-name.mp4 \
  -vf "select='eq(n\,10)+eq(n\,40)+eq(n\,80)'" -vsync 0 /tmp/d3-NN-%d.png
```
READ the frames. The picture must match what the D3 original draws (same
data → same shapes/positions/colors within the documented divergences).
White background; black axis text. A blank/garbled frame is a bug — fix
before shipping. After editing library or scene code:
`rm -rf examples/d3-parity/out/partial`.

## Footguns
- Text is a single leaf; `fontSize` is WORLD units — use `f.len(px)`.
- `Color.parse` knows CSS names ("steelblue").
- Animation constructors need `_animConfig`-marked config or set
  `anim.runTime = d` after construction; tweenTo's duration arg is real.
- Node runner: `npx tsx` for examples; `node --test` for tests.
- Keep ports ≤ ~140 lines; header comment: ref name, dataset, one-line
  description, any divergence.
