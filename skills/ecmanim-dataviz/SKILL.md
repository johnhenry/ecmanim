---
name: ecmanim-dataviz
description: Author data-visualization and math-visualization scenes in ecmanim — the D3-parity foundation (scales, shape generators, hierarchy layouts, force simulation, sankey/chord, contours/hexbin/topojson, dataJoin for enter/update/exit), chart mobjects (PieChart roseType, RadarChart, GaugeChart, FunnelChart, Candlestick, Legend/ColorBar), 3Blue1Brown-style math mobjects (FourierPath epicycles, NeuralNetworkMobject, hilbertCurve/lsystem, prime/eigenvector helpers, Surface.setFunc), CellularAutomaton, and the Code mobject's source-editing API. Use this skill when a task mentions D3, a chart/graph/dashboard, a force-directed or hierarchy layout, a bar-chart-race, Fourier epicycles, a neural-network diagram, Conway's Game of Life, or animating a diff between two versions of source code.
metadata:
  tags: ecmanim, d3, dataviz, charts, scales, force-simulation, hierarchy, fourier, neural-network, cellular-automaton, code-diff
---

# ecmanim-dataviz

Domain skill covering everything the D3-parity (Campaign 2), 3Blue1Brown-parity
(Campaign 3), and ECharts-parity (Campaign 6) galleries added, plus two
smaller mobjects (`CellularAutomaton`, `Code`'s editing API) that never fit
another skill's scope. Read `skills/ecmanim/SKILL.md` first for the shared
Plan→Code→Render→Verify→Iterate loop — this skill assumes it.

There is no dedicated `docs/*.md` page for this material yet; the source
files cited under each heading are the authoritative reference — check them
before asserting an API shape not covered here. Everything below is exported
from the top-level `ecmanim` package (no separate subpath):

```ts
import { scaleLinear, forceSimulation, hierarchy, dataJoin, RadarChart, FourierPath } from "ecmanim";
```

## Scales (`src/core/scales.ts`)

Deliberately **chainable D3-style getters/setters**, not ecmanim's usual
config-object convention — so ported D3 gallery code reads line-for-line.
Every scale is directly callable as a function.

```ts
const x = scaleBand(groupSort(data, ([d]) => -d.value, (d) => d.name), [marginLeft, width - marginRight]).padding(0.1);
const y = scaleLinear([0, max(data, (d) => d.value)], [height - marginBottom, marginTop]);
x(d.name); x.bandwidth(); y(d.value); y.invert(pixelY); y.ticks(5); y.nice();
```

`scaleLinear/scaleLog/scalePow/scaleSqrt/scaleRadial/scaleUtc` (alias
`scaleTime`, UTC only, no local-tz variant) share the continuous interface:
`(v)`, `.invert(px)`, `.domain()/.range()`, `.clamp()`, `.ticks(n?)`,
`.tickFormat(n?, specifier?)`, `.nice(n?)`, `.copy()`. `scaleBand`/`scalePoint`
add `.bandwidth()/.step()/.padding/.paddingInner/.paddingOuter/.align/.round`.
`scaleOrdinal` grows its domain implicitly like real d3. `scaleSequential`/
`scaleDiverging`/`scaleQuantize`/`scaleThreshold` round out the value→color/
bucket mappings; `visualMapContinuous(config)` is ECharts' `visualMap`-style
`{ size(v), color(v) }` pair, not a d3 scale at all.

Also live here and commonly ported alongside scales: `ticks`, array reducers
(`extent`, `max`, `min`, `sum`, `mean`, `quantile`, `group`, `groups`,
`rollup`, `groupSort`, `movingAverage`, `pairs` — `src/core/array_utils.ts`),
`format`/`utcFormat` (`src/core/format.ts`), and color schemes
(`schemeCategory10`, `schemeTableau10`, `interpolateViridis`/`Turbo`/
`Spectral`/etc. — `src/core/color_schemes.ts`).

**Gotcha:** `scaleBand().padding()` called with no argument is a GETTER —
don't pass `undefined` through it expecting a default; an earlier bug did
exactly that and poisoned every subsequent `scale(v)` call to `NaN`.

## Shape generators, hierarchy, force (`src/mobject/shape_gen.ts`, `src/layout/{hierarchy,force,sankey,chord}.ts`)

```ts
const arc = arcShape({ innerRadius: 1, outerRadius: 2, startAngle: 0, endAngle: Math.PI / 2 }); // -> VMobject
const slices = pieGen()(data);           // d3 angle convention: radians, clockwise from 12
const stacked = stack({ keys: ["a", "b"] })(data);
```
`lineGen`/`areaGen` return raw point arrays (segments split at `defined:
false`), not mobjects — feed them to `VMobject.addCubicBezier` or a `Polygon`
yourself. `arcShape`'s `padAngle` is a constant-angle approximation of d3's
padRadius scaling — visually equivalent, not bit-identical.

```ts
const root = hierarchy(flareJson).sum((d) => d.value ?? 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
treemap().tile(treemapSquarify).size([width, height]).padding(1).round(true)(root);
for (const leaf of root.leaves()) { /* leaf.x0/y0/x1/y1 */ }
```
`hierarchy`/`stratify`/`treemap`/`partition`/`pack`/`tree`/`cluster`
(`src/layout/hierarchy.ts`) are a faithful, deterministic d3-hierarchy port
(pack's internal circle-placement LCG is d3's own, not `Math.random`, so
results are byte-identical to real d3). `node.copy()` is the one d3 method
NOT provided.

```ts
const sim = forceSimulation(nodes, { seed: 1 })
  .force("link", forceLink(links, { id: (d) => d.id }))
  .force("charge", forceManyBody())
  .force("center", forceCenter());
sim.tick(stepsThisFrame);   // or sim.run() for a fixed 300-tick settle
```
`forceSimulation`/`forceLink`/`forceManyBody`/`forceCenter`/`forceCollide`/
`forceX`/`forceY` (`src/layout/force.ts`) are **fully deterministic** — a
seeded `mulberry32` PRNG (default seed `1`) drives initial phyllotaxis
placement, so the same seed reproduces byte-identical runs across processes.
`forceManyBody`/`forceCollide` are exact O(n²), **not** Barnes-Hut
quadtree-approximated like real d3-force — fine to a few hundred nodes,
per-pair math otherwise matches. `.run()` does a fixed deterministic tick
count, not a float-comparison loop, avoiding boundary sensitivity.

`sankey()` (`src/layout/sankey.ts`) mutates a `{nodes, links}` graph in place
(assigns `x0/x1/y0/y1` etc.) — **stroke** the ribbon centerline from
`sankeyLinkHorizontalPoints(link)` at `link.width`, don't fill it. `chord()`
(`src/layout/chord.ts`) returns `{groups, chords}` as a plain object (real d3
bolts `.groups` onto the chords array instead) — adjust destructuring if
porting d3 code literally.

## Contours, hexbin, topojson (`src/layout/{contours,hexbin}.ts`, `src/loaders/topojson.ts`)

- `contours({size, smooth?})` (`.contour(values, threshold)`) returns rings in
  **y-DOWN** grid space, matching d3-contour exactly — flip y before placing
  into ecmanim's y-up world.
- `hexbin({x, y, radius, extent?})` reproduces d3-hexbin's row/column-
  normalized overlap disambiguation bit-for-bit (not Euclidean nearest-center
  — a documented, intentional divergence-from-intuition). `hexagonPoints(r)`
  returns absolute corners starting at the top, not d3's relative offsets.
- `feature()`/`mesh()`/`decodeArc()` (topojson loader) — `mesh()` does not
  stitch contiguous filtered arcs into longer LineStrings the way
  topojson-client does; geometric union is identical, just more/shorter
  lines in the result.

## `dataJoin` — enter/update/exit (`src/animation/data_join.ts`)

The bar-chart-race primitive: tracks mobject identity across successive data
frames via a key function (stamped as `__joinKey`), so you don't hand-roll
your own enter/update/exit bookkeeping.

```ts
let join = dataJoin([], frame0, (d) => d.name, { make, update });
scene.add(...join.mobs);
for (const frame of frames) {
  join = dataJoin(join.mobs, frame, (d) => d.name, { make, update });
  await scene.play(join.animation);   // AnimationGroup of enter/update/exit animations
}
```
`DataJoinConfig`: `make(d,i)` builds a new mobject for an entering datum,
`update(mob,d,i)` returns an `Animation` (or mutates in place and returns
void) for a persisting one, `enterFrom`/`exitTo` customize the fade/slide,
`runTime`/`lagRatio` tune pacing. Companions `interpolateFrames`/`rankFrame`
expand sparse keyframes and compute per-frame ranks for the classic
bar-chart-race look.

## Chart mobjects (`src/mobject/{charts,radar,gauge,funnel,candlestick,legend}.ts`)

All are `VGroup`s (except `Candlestick`, see below) following the same
**identity-preserving update convention** as the rest of ecmanim: call
`setValues`/`setStages`/`setPoints`/`setValue`/`setDomain`/`setItems` to
mutate existing children in place (safe from inside an updater or across a
`Transform`), rather than reconstructing the chart every frame.

```ts
const pie = new PieChart(values, { roseType: "area" });          // 'radius': linear radius; 'area': radius ∝ sqrt(value)
const radar = new RadarChart([{ name: "A", values: [...] }], { indicators: [{ name, max, min? }, ...] });
const gauge = new GaugeChart(72, { min: 0, max: 100 });
gauge.setValue(v);                                                 // needle re-angles in place, cheap per-frame from a ValueTracker
const funnel = new FunnelChart([{ name: "Visits", value: 10000 }, ...]);
const cs = new Candlestick(ohlcPoints);                            // the ONE chart mobject that's an Axes subclass
cs.addMovingAverageLine(movingAverage(closes, 5));
const legend = new Legend([{ label: "A", color: "#4ade80" }]);
const bar = new ColorBar({ domain: [0, 100], interpolator: interpolateViridis });
```

- `RadarChart`'s constructor **throws** if any series' `values.length` !=
  `indicators.length`.
- `Candlestick` stores its OHLC rows on `chart.data`, not `chart.points` —
  `Mobject.points` is a reserved base-class field. Default colors follow the
  Chinese-market convention (red=up, green=down); don't assume US colors.
- `GaugeChart.needle` is rotated in place rather than rebuilt — safe to call
  `setValue()` every frame from a `ValueTracker` updater.
- **Every one of these** (`RadarChart`, `GaugeChart`, `FunnelChart`,
  `Legend`, `ColorBar`, `PieChart` labels) defaults its text labels to
  **white**, matching `Text`'s own default — set `labelColor`/`textColor`
  explicitly on a light-background scene or labels render invisibly.

## 3Blue1Brown math-visualization mobjects

```ts
const pts = samplePath(glyph, 256);
const coeffs = dftOfPath(pts);                       // all coefficients, DESCENDING amplitude
const fp = new FourierPath({ coefficients: coeffs.slice(0, n), speed: 1 / period, showCircles: true });
fp.attachTo(this);                                    // adds a clock updater
const trail = new TracedPath(() => fp.tip, { strokeColor: YELLOW, dissipatingTime: 2 });
scene.add(trail);
```
`FourierPath` (`src/mobject/fourier_path.ts`) needs **either**
`coefficients` **or** `path` in its config — the constructor throws
otherwise. `setTime(t)` is pure/scrub-safe; `fp.tip` returns a fresh array
each call, feed it straight into `TracedPath`.

```ts
const nn = new NeuralNetworkMobject({ layerSizes: [4, 8, 8, 3], maxNeuronsShown: 16 });
scene.add(nn);
await scene.play(nn.forwardPass(input, { stepTime: 0.85, pulseTimeWidth: 0.4 }));
await scene.play(nn.highlightOutput(argmax));
```
`NeuralNetworkMobject` (`src/mobject/neural_network.ts`) abbreviates layers
past `maxNeuronsShown` with a 3-dot ellipsis; weights are seeded-deterministic
unless you pass `weights` explicitly. `forwardPass` pulses throwaway COPIES
of edges (not the live scene edges) — flashing real edges would drop them
from the scene, since the pulse animation is a `ShowPassingFlash` remover.

`hilbertCurve(order)` and `lsystem(axiom, rules, iterations, angle,
drawSymbols?)` (`src/layout/hilbert.ts`) return raw polylines — wire them
into a `VMobject`/`Polygon` yourself. `hilbertCurve`'s points are cell-centered,
so it only spans `(n-1)/n` of the unit square at order `n = 2^order`; stretch
by `n/(n-1)` if you need every order to fill the same visible region.

`sieve`/`primesUpTo`/`isPrime`/`eigen2x2` (`src/core/math/primes.ts`) are
plain math helpers — `eigen2x2` returns real eigenpairs only (`[]` for a
complex pair), each vector unit-length with a stable sign convention
(largest-magnitude component positive). Pair with
`src/scene/vector_space_scene.ts`'s `LinearTransformationScene` for a 3b1b-style
"here are the eigenvectors of this matrix" beat.

`Surface.setFunc(func, ranges?)` (`src/mobject/surface.ts`) re-parameterizes
an existing `Surface` **in place**, rebuilding its face mesh (shading and
checkerboard reapply exactly as at construction) — the mechanism behind 3b1b
"unroll a sphere into a plane" morphs. Safe to call every frame from an
updater: `surf.addUpdater(() => surf.setFunc((u, v) => unroll(u, v, t.value)))`.

## `CellularAutomaton` (`src/mobject/cellular_automaton.ts`)

```ts
const ca = new CellularAutomaton({ cols: 30, rows: 18, seed: 7, initialDensity: 0.35, aliveColor: GREEN });
scene.add(ca);
ca.addUpdater((_m, dt) => { acc += dt; while (acc >= 0.1) { ca.step(); acc -= 0.1; } });  // fixed-step-sim pattern
```
Deterministic via seeded `mulberry32` (never `Math.random()`) — same seed
reproduces the same initial grid and, by extension, the same sequence after N
`step()` calls. Default `rule: "conway"` (B3/S23); pass a custom `(neighbors,
alive) => boolean` for other rules, including a 1D elementary/Wolfram
automaton via `rows: 1`. Rendering packs same-color cells as disjoint
subpaths into one or two `VMobject.fill()` calls per generation — not one
Rectangle per cell — so large grids stay cheap.

## `Code` mobject: source-editing (`src/mobject/text/code.ts`)

Beyond static syntax-highlighted display, `Code` supports animated
find/replace/select — the primitive behind "diff two versions of this
function" beats:

```ts
const { animation, target } = code.edit(0.8)`const x = ${edit("1", "2")};`;
await scene.play(animation);
scene.remove(code);
scene.remove(...target.codeTokens.submobjects);   // see gotcha below
scene.add(target);
code = target;
await scene.play(code.selection(lines(2, 4), 0.6));   // dims everything else to 0.25 opacity
```
`edit()`/`selection()`/`findFirstRange()`/`setCode()`/`replace()` (source-edit
overload, dispatched from a `CodeRange`-shaped argument)/`prepend()`/
`append()`/`diffTo()`; range helpers `lines(from, to?)`/`word(line, col,
length?)`; edit markers `insert(text)`/`remove(text)`/`edit(from, to)`.

**Gotcha (confirmed by an actual render, not just unit tests):** `edit()`'s
underlying token-matching keys by `text:line:col`, so inserting/removing a
line shifts every later token's key — content below the change fades out/in
rather than morphing (same trade-off as manim's `TransformMatchingTex`, not a
bug). Worse: tokens present only in `target` are individually `FadeIn`-ed by
the matcher and get auto-added to the scene by `play()` even though `target`
itself was never `scene.add()`-ed — skipping the `scene.remove(...target.
codeTokens.submobjects)` cleanup above leaks loose token mobjects into the
scene permanently. `examples/motion-canvas-parity/21-code.ts` has the full
correct swap pattern.

## Gotchas

- **Identity-preserving updates are the norm, not the exception.** Every
  mobject in this skill (`RadarChart`, `GaugeChart`, `FunnelChart`,
  `Candlestick`, `Legend`, `ColorBar`, `NeuralNetworkMobject`,
  `CellularAutomaton`, `Code`) exposes a `setXxx()`/`step()` that mutates
  existing children in place — prefer it over reconstructing the mobject,
  both for performance and so `Transform`/direct references/updaters keep
  working across an update.
- **Determinism is seeded, not incidental.** `forceSimulation`, `pack()`,
  `CellularAutomaton`, `NeuralNetworkMobject`'s random weights all use
  `mulberry32` with an explicit `seed` — never `Math.random()`. Set the seed
  explicitly rather than relying on a default if a render needs to be
  reproduced later.
- **White-on-white labels** are the single most common visual bug across the
  chart mobjects — see the callout under "Chart mobjects" above.
- **`dataJoin`'s cache-safety** follows the same rule as any updater-driven
  loop: if a frame's content depends on something outside what
  `make`/`update` read from the datum itself (e.g. a shared color scale you
  mutate between frames), that's invisible to the partial-movie cache — see
  `ecmanim-render-cli`'s Caching section and `addUpdater`'s `hashExtra` escape
  hatch if you hit stale-cache symptoms.
