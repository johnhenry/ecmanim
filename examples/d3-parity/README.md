# D3 parity suite

Ports of 26 scenes from the official [D3 gallery](https://observablehq.com/@d3/gallery)
— the animation-forward canon — rendered as VIDEO on ecmanim's data-viz
layer (scales, shapes, hierarchy/force/sankey/chord layouts, contours,
hexbin, TopoJSON, keyed data joins: all shipped for this campaign, d3
names throughout). Original notebook cell JS in [`ref/`](./ref/) (ISC,
© Observable/Mike Bostock), canonical fixture datasets in
[`data/`](./data/) — provenance in [ref/README.md](./ref/README.md).

```bash
ECMANIM_DEMO_QUALITY=low npx tsx examples/d3-parity/06-bar-chart-race.ts
for f in examples/d3-parity/[0-9]*.ts; do npx tsx "$f"; done   # everything
```

Conventions (SVG-pixel bridge, CSV autoType, d3-named library surface,
receipts discipline) in [PORTING.md](./PORTING.md).

## Scorecard

| # | Port | Ref | Proves |
|---|------|-----|--------|
| 01 | bar-chart | bar-chart | scaleBand + groupSort, % axis, staggered growth |
| 02 | bar-chart-transitions | bar-chart-transitions | keyed re-sorting with per-index stagger |
| 03 | stacked-to-grouped-bars | stacked-to-grouped-bars | stack(), two-phase grouped↔stacked morph, seeded bumps |
| 04 | radial-stacked-bar | radial-stacked-bar-chart | scaleRadial (area-true) + angular scaleBand + arcShape |
| 05 | pie-chart-update | pie-chart-update | pieGen + true angle interpolation (arcTween) |
| 06 | bar-chart-race | bar-chart-race | **dataJoin** enter/update/exit per keyframe, interpolateFrames/rankFrame, 20 years of brands |
| 07 | connected-scatterplot | connected-scatterplot | Catmull-Rom draw-on + path-length label stagger |
| 08 | streamgraph | streamgraph | stack insideOut + **wiggle offset**, scaleUtc axis |
| 09 | parallel-coordinates | parallel-coordinates | per-dimension scales, BrBG-encoded polylines |
| 10 | calendar-view | calendar-view | UTC interval math, quantile-bounded diverging PiYG |
| 11 | treemap | treemap | hierarchy + **squarify** tiling, ancestor colors |
| 12 | sunburst | sunburst | partition in polar, nested arcShape rings |
| 13 | tree | tree + cluster | Buchheim tidy tree **morphing into** the dendrogram |
| 14 | radial-tree | radial-tree | tree().size([2π, r]), radial bump links |
| 15 | circle-packing | zoomable-circle-packing | pack() + **van Wijk camera zoom** (interpolateZoom), HCL depth ramp |
| 16 | force-directed-graph | force-directed-graph | deterministic forceSimulation settling LIVE on screen |
| 17 | disjoint-force-graph | disjoint-force-directed-graph | forceX/forceY containment of disconnected components |
| 18 | arc-diagram | arc-diagram | scalePoint ordering + semicircular arcs |
| 19 | chord-diagram | chord-diagram | chord layout + ribbonPoints ribbons |
| 20 | sankey | sankey | full sankey relaxation + bump links w/ flow widths |
| 21 | edge-bundling | hierarchical-edge-bundling | cluster + **curveBundle** B-splines through node.path() |
| 22 | choropleth | choropleth | **TopoJSON** feature/mesh, all 3,142 counties, quantize Blues, state-border mesh |
| 23 | volcano-contours | volcano-contours | grid **contours** (filled isobands + crater hole), terrain ramp |
| 24 | hexbin | hexbin | hexbin binning, log-log axes, BuPu density |
| 25 | brushable-scatterplot | brushable-scatterplot | brush → camera reframe (dim + zoom + reset) |

(01–26 refs: `bar-chart` and `tree`+`cluster` pages merge into single ports.)

## Honest divergences

- **Interaction → direction**: brushes, dropdowns, radio inputs, hover
  effects, and zoom gestures become authored camera moves / timed
  sequences (each header documents its reframe).
- **Force layouts are seeded + fixed-step** (byte-reproducible; d3's are
  unseeded with Barnes-Hut approximation — settled shapes differ
  slightly).
- **Color ramps** interpolate RGB between d3's actual scheme stops (d3
  splines through Lab) — visually close, not bit-identical; `interpolateHcl`
  and `interpolateHsvLong` are exact color-space implementations.
- **arcShape padAngle** is a constant-angle inset (d3 scales by padRadius).
- `format()`/`utcFormat()` implement the gallery's specifier subset, not
  the full grammar.
- Labels use raster text metrics (no white halos, no per-label rotation on
  the radial tree).

## Bugs the receipts workflow caught this campaign (fixed + tested)

GeoJSON polygons rendered as "petals" (raw ring vertices fed to the cubic
bezier renderer as handles); `format(".0s")` threw and SI output could go
exponent-notation; `scaleBand.padding()` getter form corrupted the scale
to NaN; AnimationGroup and geometry-less `tween(cb)` segments collided in
the partial-movie cache (across scenes!); FadeOut left family opacities at
0 so a later FadeIn animated to invisible; `CameraFrameTween` missing from
the barrel; plus Graph's `Math.random` determinism leaks (fixed during
gap-fill). See CHANGELOG.
