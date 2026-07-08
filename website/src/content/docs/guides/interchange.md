---
title: "Interchange & fidelity (OTIO · Lottie · watermark · real-TeX)"
---

Phase-5 adoption additions.

## OpenTimelineIO (.otio)

Export a scene's timeline (one clip per `play()`/`wait()` segment, frame-exact)
to OTIO JSON — round-trips to DaVinci Resolve / Premiere / FCPXML / EDL / AAF via
OTIO's adapters.

```js
import { sceneToOtioString, sceneToOtio, toOtioJSON, fromOtioJSON } from "ecmanim";
writeFileSync("out.otio", sceneToOtioString(scene, { name: "demo", mediaUrl: "out.mp4" }));
```

`RationalTime {value, rate}` keeps everything frame-exact (no float drift). The
JS/WASM OTIO bindings are immature, so the schema is reimplemented in TS.

**Limitations:** the export is a single video track of clips — no audio tracks,
no transition/effect metadata, and every clip references the same flat render
(`mediaUrl`) by frame range. It is a timeline skeleton for conforming in an NLE,
not a full project interchange.

## Lottie import/export

```js
import { vmobjectToLottieJSON, loadLottie } from "ecmanim";
const doc = vmobjectToLottieJSON(shape, { width: 512, height: 512 });  // -> a .json Lottie
const mob = loadLottie(existingLottieJson);                            // -> a VMobject
```

Maps VMobject cubic-Bézier subpaths to Lottie's shape model (`v` vertices with
relative `i`/`o` tangents + closed flag `c`). Lottie is y-down, manim y-up, so y
is negated on export/import.

**Limitations (read before relying on this):**
- **Static geometry only — no keyframes.** Export captures the mobject's
  *current* shape; nothing you animate with `play()` appears in the Lottie.
  Exporting an animated scene gives you a frozen frame, not the animation.
- No fills, strokes, gradients, trim paths, mattes, or text on either
  direction — geometry only. For high-fidelity *import* of rich Lottie files,
  use ThorVG-WASM and rasterize.
- Round-tripping is supported for what's in scope: `loadLottie(vmobjectToLottieJSON(m))`
  reproduces the geometry.

## Watermark

```js
import { render } from "ecmanim/node";
await render(MyScene, { watermark: { text: "@channel", position: "bottom-right", opacity: 0.7 } });
// or an image logo: { image: "logo.png", position: "top-left", opacity: 0.9 }
// or standalone: import { applyWatermark } from "ecmanim/node"; await applyWatermark("v.mp4", {...});
```

Positions: `top-left`, `top-right`, `bottom-left`, `bottom-right`, `center`.

## Real-TeX (dvisvgm) backend

For publication-grade LaTeX (full package/`align` support), the Node backend can
shell out to a real TeX toolchain — `latex → dvi → dvisvgm → SVG → Béziers` — with
an on-disk cache, detecting the toolchain and falling back to MathJax when TeX
isn't installed. See `texToSVGViaDvisvgm` / `mathTexDvisvgmOrFallback`
(`ecmanim/node`). MathJax remains the zero-dependency default.
