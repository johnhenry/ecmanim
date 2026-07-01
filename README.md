# manim-js

A JavaScript port of [manim](https://github.com/ManimCommunity/manim) — the
Mathematical Animation Engine popularized by 3Blue1Brown.

**It runs everywhere manim runs** (Node.js → renders to `.mp4`/`.webm`/`.gif`
via ffmpeg) **plus the browser** (live playback on a `<canvas>` and `.webm`
export via `MediaRecorder`) — using the *exact same* `Scene`, mobject, and
animation code on both targets.

```js
import { render, Scene, Circle, Square, Transform, Create, BLUE, GREEN } from "manim-js/node";

class Demo extends Scene {
  async construct() {
    const c = new Circle({ radius: 1.5, color: BLUE, fillColor: BLUE, fillOpacity: 0.5 });
    await this.play(new Create(c));
    await this.play(new Transform(c, new Square({ sideLength: 3, color: GREEN })));
    await this.play(c.animate.shift([3, 0, 0]).rotate(Math.PI / 4));
  }
}

await render(Demo, { output: "demo.mp4", quality: "high" });
```

## Why a canvas-based port?

manim's core object is the **`VMobject`** — a shape made of cubic Bézier
curves. The browser's Canvas-2D API (`bezierCurveTo`) maps onto this almost
perfectly, and Node gets the identical API from
[`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas) (prebuilt binaries —
**no system Cairo required**, so it works on NixOS out of the box). One renderer
drives both. Video muxing on Node is done by piping PNG frames to `ffmpeg`.

## Architecture

```
src/
  core/
    math/vector.js     [x,y,z] point/vector math + direction constants (UP, RIGHT, …)
    math/bezier.js     cubic bezier eval, arc approximation, partial-curve splitting
    color.js           Color class + manim palette (BLUE, RED, YELLOW, …)
  mobject/
    Mobject.js         base: submobject tree, transforms, bounds, .animate, updaters
    VMobject.js        bezier shapes, fill/stroke, subpaths, point-count alignment
    geometry.js        Arc Circle Dot Ellipse Annulus Line Arrow Polygon Rectangle Square …
    text/Text.js       Canvas-text mobject with typewriter reveal
    vectorized_text.js VText — real glyph outlines as Béziers (opentype.js)
    mathtex.js         MathTex / Tex — LaTeX via MathJax → Bézier glyphs
    svg_path.js        SVG path `d` → cubic-Bézier subpaths (powers MathTex/VText)
    coordinate_systems.js  NumberLine, Axes (+ plot), NumberPlane
    value_tracker.js   ValueTracker, DecimalNumber, Integer, alwaysRedraw
  scene/
    Scene.js           play()/wait(), fixed-fps frame emission (backend-agnostic)
    three_d.js         ThreeDScene, ThreeDCamera (projection), ThreeDAxes
  animation/
    Animation.js       Animation base, Transform, Create, Write, Fade*, ApplyMethod
    composition.js     AnimationGroup, LaggedStart, Succession, the .animate builder
    extra.js           GrowFromCenter, SpinInFromNothing, Indicate, Flash, MoveAlongPath, …
    rate_functions.js  smooth, linear, thereAndBack, easeInOut*, …
  renderer/
    CanvasRenderer.js  isomorphic: draws mobjects to any 2D context
    fonts-node.js      auto-registers system fonts (@napi-rs/canvas + opentype)
  node.js              Node backend: @napi-rs/canvas → ffmpeg
  browser.js           Browser backend: live play() + record() → WebM Blob
```

## Install

```bash
npm install            # installs @napi-rs/canvas (optional dep) for Node rendering
# ffmpeg must be on PATH for video output
```

## Node usage

```js
import { render, Scene, /* mobjects, animations, colors */ } from "manim-js/node";

await render(MySceneClass, {
  output: "out.mp4",
  quality: "medium",       // low | medium | high | fourk
  format: "mp4",           // mp4 | webm | gif | png-sequence
  background: "#0d1117",
  fps: 30,                 // optional, overrides the quality preset
});

// Or render a bare construct function:
await render(async (scene) => {
  await scene.play(new Create(new Circle()));
}, { output: "out.mp4" });
```

### CLI

```bash
npx manim-js render myscene.js -q high -o out.mp4
npx manim-js render myscene.js --scene IntroScene --format webm
```

## Browser usage

```html
<canvas id="stage" width="1280" height="720"></canvas>
<script type="module">
  import { play, record, Scene, Circle, Create } from "./node_modules/manim-js/src/browser.js";

  class Demo extends Scene {
    async construct() { await this.play(new Create(new Circle({ radius: 2 }))); }
  }

  const canvas = document.getElementById("stage");
  await play(Demo, { canvas, quality: "medium" });      // live, real-time playback

  const blob = await record(Demo, { quality: "high" }); // -> WebM Blob for download
</script>
```

See `examples/browser/index.html` for a complete page.

## Examples

```bash
node examples/basic.js     # shapes, Create, Transform, FadeOut, Text
node examples/graph.js     # Axes, plot(), ValueTracker, alwaysRedraw, LaggedStart, Indicate
node examples/morph.js     # VText — glyph outlines traced by Write, morphed by Transform
node examples/mathtex.js   # MathTex — LaTeX (Euler's identity, sums, integrals) as Béziers
node examples/threed.js    # ThreeDScene — projection camera orbiting a 3D scene
node bin/manim-js.js render examples/hello-scene.js -q low -o examples/out/hello.mp4
```

## API parity with manim

| Area | manim | manim-js | Notes |
|------|-------|----------|-------|
| Scene | `class S(Scene): def construct` | `class S extends Scene { async construct() }` | `await this.play(...)`, `await this.wait(t)` |
| Play | `self.play(a, b, run_time=2)` | `await this.play(a, b, { _playConfig: true, runTime: 2 })` | parallel by default |
| `.animate` | `mob.animate.shift(RIGHT)` | `mob.animate.shift([1,0,0])` | chainable proxy |
| Geometry | Circle, Square, Line, Polygon, … | ✅ same | Arc Circle Dot Ellipse Annulus Line Arrow DashedLine Polygon RegularPolygon Triangle Rectangle Square |
| Text (raster) | Text | ✅ `Text` | fast Canvas text, typewriter reveal for Write/Create |
| Text (vector) | Text (Pango glyph paths) | ✅ `VText` | **real glyph outlines as Béziers** (via opentype.js) — Write traces them, Transform morphs letters into shapes |
| LaTeX | `MathTex`, `Tex` (shells out to LaTeX) | ✅ `MathTex`, `Tex` | **MathJax → SVG → Béziers, no LaTeX install**; genuine glyph VMobjects that Write/Transform |
| 3D | ThreeDScene, ThreeDAxes, move_camera | ✅ `ThreeDScene`, `ThreeDCamera`, `ThreeDAxes` | projection camera (φ/θ + perspective), `moveCamera`, ambient rotation, depth sort — **no WebGL, renders headlessly** |
| Coordinates | Axes, NumberPlane, NumberLine, `plot` | ✅ same | `axes.c2p(x,y)`, `axes.plot(fn)` |
| Creation | Create, Write, Uncreate, DrawBorderThenFill | ✅ Create, Write, Uncreate | |
| Transform | Transform, ReplacementTransform | ✅ same | automatic Bézier point-count alignment |
| Fading | FadeIn, FadeOut (+shift/scale) | ✅ same | |
| Growth | GrowFromCenter/Point/Edge, SpinInFromNothing, ShrinkToCenter | ✅ same | |
| Motion | MoveAlongPath, Rotate, Rotating, ApplyMethod | ✅ same | |
| Emphasis | Indicate, Flash, Wiggle, Circumscribe, FocusOn | ✅ same | |
| Groups | AnimationGroup, LaggedStart, Succession | ✅ same | `lagRatio` timing matches manim |
| Trackers | ValueTracker, DecimalNumber, Integer, always_redraw | ✅ ValueTracker, DecimalNumber, Integer, `alwaysRedraw` | |
| Updaters | `mob.add_updater(fn)` | `mob.addUpdater((mob, dt) => …)` | run each frame during play/wait |
| Rate funcs | smooth, rush_into, there_and_back, … | ✅ camelCase: `smooth`, `rushInto`, `thereAndBack`, … | |
| Colors | WHITE, BLUE, RED, … | ✅ same names | plus `Color.lerp`, hex parsing |
| Render targets | `-ql/-qm/-qh`, mp4/gif/png | ✅ quality presets, mp4/webm/gif/png-sequence | **+ browser (live + WebM)** |

### Not yet ported

- `Surface` / parametric-surface mobjects and lighting (the 3D **camera** and
  `ThreeDAxes` exist; smooth-shaded surfaces do not).
- A GPU/WebGL renderer. 3D uses a CPU projection camera (like manim's Cairo
  renderer) so it works headlessly in Node. Three.js could be layered on as an
  optional browser-only accelerated backend.
- `ImageMobject`, SVG-file import (the SVG **path** parser exists and powers
  `MathTex`/`VText`; a full `SVGMobject` file loader is not wrapped up), sound.
- `MathTex` browser support currently expects MathJax to be initialized; the
  Node path auto-initializes it.

## Testing

```bash
npm test    # node --test — 32 tests across math, mobjects, animations, integration + a headless render
```

## License

MIT
