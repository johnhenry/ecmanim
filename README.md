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
    coordinate_systems.js  NumberLine, Axes (+ plot), NumberPlane
    value_tracker.js   ValueTracker, DecimalNumber, Integer, alwaysRedraw
  animation/
    Animation.js       Animation base, Transform, Create, Write, Fade*, ApplyMethod
    composition.js     AnimationGroup, LaggedStart, Succession, the .animate builder
    extra.js           GrowFromCenter, SpinInFromNothing, Indicate, Flash, MoveAlongPath, …
    rate_functions.js  smooth, linear, thereAndBack, easeInOut*, …
  renderer/
    CanvasRenderer.js  isomorphic: draws mobjects to any 2D context
    fonts-node.js      auto-registers a system font for @napi-rs/canvas
  scene/Scene.js       play()/wait(), fixed-fps frame emission (backend-agnostic)
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
node bin/manim-js.js render examples/hello-scene.js -q low -o examples/out/hello.mp4
```

## API parity with manim

| Area | manim | manim-js | Notes |
|------|-------|----------|-------|
| Scene | `class S(Scene): def construct` | `class S extends Scene { async construct() }` | `await this.play(...)`, `await this.wait(t)` |
| Play | `self.play(a, b, run_time=2)` | `await this.play(a, b, { _playConfig: true, runTime: 2 })` | parallel by default |
| `.animate` | `mob.animate.shift(RIGHT)` | `mob.animate.shift([1,0,0])` | chainable proxy |
| Geometry | Circle, Square, Line, Polygon, … | ✅ same | Arc Circle Dot Ellipse Annulus Line Arrow DashedLine Polygon RegularPolygon Triangle Rectangle Square |
| Text | Text (Pango glyph paths) | ✅ Canvas text | typewriter reveal for Write/Create; not true glyph-vector morphing |
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

- LaTeX / `MathTex` (manim shells out to LaTeX). `Text` covers plain strings;
  `MathTex` is not implemented.
- True glyph-path text (so `Transform`-ing text into shapes morphs the box, not
  the letterforms).
- 3D scenes (`ThreeDScene`, `Surface`) — the math is 3D-ready (points are
  `[x,y,z]`, rotation takes an axis) but there is no 3D camera projection yet.
- SVG import, `ImageMobject`, sound.

## Testing

```bash
npm test    # node --test — 32 tests across math, mobjects, animations, integration + a headless render
```

## License

MIT
