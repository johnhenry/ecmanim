# Geometry figures (`GeometryFigure`)

`GeometryFigure` (exported from the root `.` entry) draws textbook-style geometry
from a small declarative spec: triangles, quadrilaterals and their subtypes,
regular and general polygons, and polyhedra. It uses the standard marks (equal-side
ticks, equal-angle arcs, parallel-side chevrons, right-angle squares), optional
labels, diagonals, an altitude, squares on triangle sides (Pythagoras) and
circles, and it exposes named **parts** you can point at, highlight or animate.
It is also the `shape` visual of the `character-explainer` authoring format
(see `authoring-studio.md`).

```ts
import { GeometryFigure, initMathTex } from "@johnhenry/ecmanim";

await initMathTex();                       // LaTeX labels (plain text otherwise)
const fig = new GeometryFigure({ type: "rhombus", labels: { vertices: true } }, { size: 3 });
await this.play(fig.reveal());             // outline -> marks -> labels (-> squares)
await this.play(fig.highlight("ticks"));   // flash a part
const p = fig.part("AB");                  // { name, kind, mobs, anchor, center, width, height, aim }
```

## The spec

`{ type, ...params, marks?, labels?, diagonals?, altitude?, squares?, circle?, spin?, tilt? }`.
`normalizeShapeSpec(raw)` (pure, never throws) canonicalises it: synonyms
(`diamond` -> `rhombus`, `trapezium` -> `trapezoid`, `hexagon` ->
`regular-polygon` with `n: 6`, ...), bad or absurd params fall back to the type's
defaults with a note (`GeometryFigure.notes`).

| key | meaning |
|---|---|
| `marks` | `false` disables all marks; or `{ ticks, arcs, parallels, rightAngles }` booleans to turn individual defaults off |
| `labels` | `{ vertices: true \| ["P","Q",..], sides: true \| [..] \| {a,b,c}, angles: true \| [..] }` (LaTeX; `angles: true` shows degrees) |
| `diagonals` | dashed diagonals (quadrilaterals / polygons) |
| `altitude` | dashed height with its right-angle mark (triangles, parallelogram, rhombus, trapezoids) |
| `squares` | a tinted square on each side of a triangle, labelled `a^2`, `b^2`, `c^2` |
| `circle` | `"inscribed"`, `"circumscribed"` or `"both"` (regular polygons, square, equilateral triangle) |
| `spin`, `tilt` | solids: degrees per second (default 0) and the `[pitch, yaw]` view in degrees (default `[20, 30]`) |

Planar vertices are named `A, B, C...` counter-clockwise. For triangles side `a` is
opposite `A` (`BC`), `b` is `CA`, `c` is `AB`; in right triangles the right angle is at `C`.

## Gallery

| type | defaults | default marks | some parts |
|---|---|---|---|
| `right-triangle` | `a`=3, `b`=4 | right angles | A,B, c,a, right |
| `isosceles-triangle` | `base`=4, `height`=3 | ticks (1), angle arcs (1) | A,B, c,a, ticks,arcs |
| `equilateral-triangle` | `side`=4 | ticks (1), angle arcs (1) | A,B, c,a, ticks,arcs |
| `scalene-triangle` | `a`=4, `b`=5, `c`=6 | none | A,B, c,a |
| `obtuse-triangle` | `angles`=[35,30,115] | none | A,B, c,a |
| `acute-triangle` | `angles`=[60,70,50] | none | A,B, c,a |
| `triangle` | `a`=4, `b`=5, `c`=6 | none | A,B, c,a |
| `square` | `side`=3 | ticks (1), right angles | A,B, AB,BC, ticks,right |
| `rectangle` | `w`=5, `h`=3 | ticks (1/2), right angles | A,B, AB,BC, ticks,right |
| `rhombus` | `side`=3, `angle`=60 | ticks (1), parallel arrows (1/2), angle arcs (1/2) | A,B, AB,BC, ticks,arrows,arcs |
| `parallelogram` | `w`=4, `h`=2.5, `angle`=65 | ticks (1/2), parallel arrows (1/2), angle arcs (1/2) | A,B, AB,BC, ticks,arrows,arcs |
| `kite` | `width`=3, `top`=1.8, `bottom`=2.8 | ticks (1/2), angle arcs (1) | A,B, AB,BC, ticks,arcs |
| `trapezoid` | `base1`=5, `base2`=3, `height`=2.5, `offset`=0.7 | parallel arrows (1) | A,B, AB,BC, arrows |
| `isosceles-trapezoid` | `base1`=5, `base2`=3, `height`=2.5 | ticks (1), parallel arrows (1), angle arcs (1/2) | A,B, AB,BC, ticks,arrows,arcs |
| `right-trapezoid` | `base1`=5, `base2`=3, `height`=2.5 | parallel arrows (1), right angles | A,B, AB,BC, arrows,right |
| `quadrilateral` | `vertices` | none | A,B, AB,BC |
| `regular-polygon` | `n`=6 | ticks (1), angle arcs (1) | A,B, AB,BC, ticks,arcs |
| `polygon` | `vertices` | none | A,B, AB,BC |
| `tetrahedron` | - | projected 3D view, back edges dashed | face*, edge*, vertex* |
| `cube` | - | projected 3D view, back edges dashed | face*, edge*, vertex* |
| `octahedron` | - | projected 3D view, back edges dashed | face*, edge*, vertex* |
| `dodecahedron` | - | projected 3D view, back edges dashed | face*, edge*, vertex* |
| `icosahedron` | - | projected 3D view, back edges dashed | face*, edge*, vertex* |
| `prism` | `n`=3 | projected 3D view, back edges dashed | face*, edge*, vertex* |
| `pyramid` | `n`=4 | projected 3D view, back edges dashed | face*, edge*, vertex* |
| `cuboid` | `w`=2, `h`=1.4, `d`=1.2 | projected 3D view, back edges dashed | face*, edge*, vertex* |

Named aliases (`pentagon` ... `dodecagon`, `diamond`, `trapezium`, `square pyramid`, ...) resolve
through `canonicalShapeType`. `prism` / `pyramid` take `n` (3 to 12); `regular-polygon` takes `n`
(3 to 24); `polygon` / `quadrilateral` take `vertices` (`[[x, y], ...]`).

Each subtype's marks make it recognisable: a rhombus has four equal ticks and two pairs of
parallel arrows (single and double); a kite has two tick classes (1 and 2) and equal angle arcs;
an isosceles trapezoid has arrows on the bases, ticks on the legs and equal base-angle arcs
(single at the long base, double at the short one).

## Parts

`fig.part(name)` (aliases resolve: `a`, `AC` = `CA`, `squarec`, `altitude`) returns
`{ name, kind, mobs, anchor, center, width, height, aim }` or `undefined`. `fig.partNames()` lists them.

| part | what |
|---|---|
| `A`, `B`, ... | vertices |
| `AB`, `BC`, ... (triangles: `a`, `b`, `c`) | sides |
| `angleA`, ... | angles (the arc, even when none is drawn by default) |
| `ticks`, `arrows`, `arcs`, `rightAngles` (`right` = the first one) | all marks of that kind |
| `diagonalAC`, ... | diagonals (when `diagonals: true`) |
| `height` | the altitude (when `altitude: true`) |
| `squareA`, `squareB`, `squareC` | squares on the sides opposite `A`, `B`, `C` (when `squares: true`) |
| `circle` | the circle(s) |
| `face0..`, `edge0..`, `vertex0..` | polyhedra |

`aim` is `"point"` for sides, vertices, lines and edges (aim at `anchor`) and `"box"` for the rest
(aim at the nearest point of the box).

## Animations

- `fig.reveal()` returns a `GeometryReveal` (a `Succession`): the fill and outline first, then
  the marks, then the labels, then (triangles with squares) each square `GrowFromCenter` followed by its
  label. Solids fade in. The reveal introduces the figure itself; do not add its children separately.
- `fig.highlight(part, { color?, runTime? })` flashes a part (restyled in place and restored, so it
  also works for parts that are not drawn by default, e.g. `angleA`). It does not pause the figure's updaters.

## Solids

Solids are a projected 3D view: faces are semi-transparent and depth-sorted (their `zIndex` is
recomputed on every update), front edges are solid and hidden edges dashed. `fig.setTime(t)` is
**pure** in `t` (the same `t` always gives the same picture, so seeking and parallel segment
rendering agree); drive the spin with an updater such as
`fig.addUpdater(() => fig.setTime(scene.time - t0))`. The figure keeps its own affine frame, so
`shift` / `scale` / `moveTo` keep working. Prefer those over `.animate` for solids (a copied figure does
not carry the frame).

## Honest limitations

- Planar marks are plain strokes: at small sizes ticks and arcs get faint. Size the figure up or use a larger `size`.
- `polygon` / `quadrilateral` with custom vertices get no marks (the figure cannot know which sides are equal) and are assumed simple (non-self-intersecting).
- Solids use a painter's algorithm (depth sort per face), which is exact for convex solids and not for
  intersecting geometry. There are no vertex/edge labels on solids.
- Triangle squares make the figure about three times larger than its triangle; scale it to the space you have.
- Labels need `initMathTex()`; without it they fall back to plain text (no real LaTeX).
- Goldens: `test/golden/geometry.*.png` cover a right triangle with squares, rhombus, kite, isosceles trapezoid,
  hexagon, cube and icosahedron.
