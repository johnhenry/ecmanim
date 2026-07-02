---
name: ecmanim-interchange
description: Interchange and fidelity workflows for ecmanim — exporting/importing Lottie shape JSON, exporting OpenTimelineIO (OTIO) `.otio` timelines for NLE conforming (Resolve/Premiere/FCPXML/EDL), rendering math with a real LaTeX+dvisvgm toolchain instead of the default MathJax backend, and burning in text/image video watermarks. Use this skill when a task mentions Lottie, After Effects/Bodymovin, OTIO, OpenTimelineIO, editing-timeline export, publication-grade LaTeX, dvisvgm, or watermarking rendered video.
metadata:
  tags: ecmanim, lottie, otio, opentimelineio, latex, dvisvgm, mathjax, watermark, interchange
---

# ecmanim-interchange

Child skill of `ecmanim` (read `../ecmanim/SKILL.md` first for the shared
Plan→Code→Render→Verify→Iterate loop and `checkhealth`-first convention — not
repeated here). This skill covers four independent, unrelated features that
share one theme: getting data *into or out of* ecmanim, or trading fidelity
for cost. All four are documented in full at
[../../docs/interchange.md](../../docs/interchange.md) — this file is a
grounded summary with accurate import paths and gotchas, not a replacement.

Every claim below was verified against `docs/interchange.md` and the source
(`src/interchange/lottie.ts`, `src/interchange/otio.ts`,
`src/mobject/mathtex.ts`, `src/mobject/mathtex_dvisvgm.ts`,
`src/core/watermark.ts`) — re-check those files if behavior seems to have
drifted, don't trust this summary from memory in a later session.

## OpenTimelineIO (`.otio`) export

Exports a scene's `play()`/`wait()` segments as a frame-exact OTIO timeline
(one video track of clips) that round-trips into Resolve, Premiere, FCPXML,
EDL, or AAF via OTIO's own adapters, for conforming a rendered cut in an NLE.

```ts
import { sceneToOtioString } from "ecmanim";
import { writeFileSync } from "node:fs";

// scene is a Scene instance that has already been render()ed (playRecords
// populated); mediaUrl should point at the rendered video.
writeFileSync("out.otio", sceneToOtioString(scene, { name: "demo", mediaUrl: "out.mp4" }));
```

Lower-level pieces (`sceneToOtio`, `toOtioJSON`, `fromOtioJSON`,
`rationalTime`, `timeRange`) are also exported from `"ecmanim"` if you need to
inspect or hand-edit the timeline model before serializing. `sceneToOtio`
reads `scene.playRecords` (falling back to `scene.sections`) and uses
`scene.fps` for the frame rate — the timeline is only meaningful after the
scene has actually been driven through a render, not before.

**Scope: a timeline skeleton, not a project file.** One video track, no audio
tracks, no transition/effect metadata; every clip points at the *same* flat
`mediaUrl` by frame range (ecmanim has no per-segment source media). Use it to
get frame-accurate cut points into an NLE, not to hand off a multi-track
project. The JS/WASM OTIO bindings are immature enough that the schema is
reimplemented directly in TS rather than wrapping the real library — so
`fromOtioJSON` only parses the subset of the schema ecmanim itself writes
(clips + time ranges + metadata), not arbitrary third-party `.otio` files.

## Lottie import/export

Round-trips a `VMobject`'s cubic-Bézier geometry through Lottie's shape model
(`v`/`i`/`o`/`c`), for handing shapes to a web/iOS/Android Lottie player or
pulling simple Lottie shape data into an animatable VMobject.

```ts
import { vmobjectToLottieJSON, loadLottie } from "ecmanim";

const doc = vmobjectToLottieJSON(shape, { width: 512, height: 512, fps: 30 });
// doc is a full Lottie animation document (write it out as .json)

const mob = loadLottie(existingLottieJson);  // -> VMobject | VGroup
```

`vmobjectToLottieShapes`, `lottieShapeToPoints`, and `lottieShapesToVMobject`
are also exported from `"ecmanim"` for working at the single-shape level
(e.g. embedding shapes inside a hand-built Lottie layer). Lottie is y-down and
manim is y-up, so every conversion negates y — this is handled internally,
not something to redo at the call site.

**This is a static-geometry bridge, not an animation exporter — read this
before reaching for it:**
- **No keyframes.** `vmobjectToLottieJSON` captures the mobject's shape *at
  call time*. Anything driven by `play()` is invisible to the export; you get
  one frozen frame packaged as a (technically valid, technically
  one-frame-long) Lottie document, never a Lottie animation of the ecmanim
  animation.
- **Geometry only, both directions.** No fills, strokes, gradients, trim
  paths, mattes, or text — importing a rich production Lottie file (the kind
  after-effects/Bodymovin actually produces) will silently drop everything
  outside `"sh"` shape layers. For faithful *import/playback* of a rich Lottie
  file, this isn't the tool — use ThorVG-WASM and rasterize instead.
- **Round-tripping works within that scope**: `loadLottie(vmobjectToLottieJSON(m))`
  reproduces the source geometry. Don't expect it to work on Lottie files from
  other tools beyond their shape geometry.

## Video watermark

Burns a text or image watermark into a rendered video via an ffmpeg filter,
either as a `render()` option or as a standalone post-process step. Node-only.

```ts
import { render } from "ecmanim/node";

await render(MyScene, {
  watermark: { text: "@channel", position: "bottom-right", opacity: 0.7 },
});
// image logo instead of text:
// watermark: { image: "logo.png", position: "top-left", opacity: 0.9 }
```

```ts
// or apply to an already-rendered file, in place:
import { applyWatermark } from "ecmanim/node";
await applyWatermark("v.mp4", { text: "DRAFT", position: "center", opacity: 0.5 });
```

`WatermarkConfig`: `text` or `image` (image wins if both are set),
`position` (`top-left` | `top-right` | `bottom-left` | `bottom-right` |
`center`, default `bottom-right`), `opacity` (default `0.6`), `fontSize`
(default `36`), `color` (default `white`), `margin` (default `24`).

**Gotcha: text watermarks need an ffmpeg build with `drawtext` (libfreetype
compiled in).** Homebrew's default macOS `ffmpeg` formula omits it (use
`ffmpeg-full` instead); most Linux distro packages — including this
NixOS host — include it by default. `applyWatermark` checks via
`ffmpeg -filters` (cached as `ffmpegHasDrawtext()`) and, if missing, **warns
and no-ops** rather than throwing — the video is left unchanged, so a silent
success in logs doesn't mean the watermark was actually burned in. Verify by
inspecting the output frame, not just the exit code. Image watermarks
(`overlay` + `colorchannelmixer`) have no such gate; they always work.

## Real-TeX (dvisvgm) math backend

ecmanim's default math backend (`MathTex`/`Tex`, `import { MathTex, Tex,
initMathTex } from "ecmanim"`) renders LaTeX via **MathJax** (`mathjax-full`
in Node's lite-DOM) — pure JS, zero system dependencies, and this remains the
default for a reason: it works everywhere. For publication-grade output
(full package support, `align` environments, exotic macros, or kerning that
must match real LaTeX exactly), an **opt-in** Node-only backend shells out to
an actual TeX toolchain instead:

```ts
import { mathTexDvisvgmOrFallback } from "ecmanim/node";

// Tries latex/pdflatex -> dvi/pdf -> dvisvgm --no-fonts -> SVG -> VMobjects.
// Falls back to MathTex (MathJax) automatically if the toolchain is missing
// or the render throws for any reason — always resolves, never rejects.
const eq = await mathTexDvisvgmOrFallback("\\int_0^\\infty e^{-x^2}\\,dx", {
  fontSize: 0.8,
});
await this.play(new Write(eq));
```

Lower-level pieces, also from `"ecmanim/node"`:
- `detectDvisvgmToolchain()` — probes PATH for `latex`/`pdflatex` and
  `dvisvgm`, returns `{ latex, pdflatex, dvisvgm, available }`. Check this
  (or run `npx ecmanim checkhealth`, which reports the same) before assuming
  the real backend will actually be used.
- `texToSVGViaDvisvgm(tex, config)` — the raw string-to-SVG step; **throws** a
  descriptive "TeX toolchain not found" error if unavailable (does not
  degrade on its own — that's `mathTexDvisvgmOrFallback`'s job).
  `mathTexDvisvgm(tex, config)` wraps that into an animatable
  `MathTexDvisvgm` (a `VGroup`) but also throws on failure.
- Results are cached on disk (keyed by a hash of the wrapped TeX source), so
  repeated renders of the same equation skip the expensive `latex`/`dvisvgm`
  round trip after the first hit.

**Gotchas:**
- **Requires a real TeX distribution on PATH** (`latex` or `pdflatex`, plus
  `dvisvgm` — e.g. TeX Live). Nothing installs this automatically; it is not
  present in every environment ecmanim runs in (`checkhealth` reports it as
  optional, same category as system TTS and headless Chrome).
  `texToSVGViaDvisvgm`/`mathTexDvisvgm` throw outright when it's missing —
  only `mathTexDvisvgmOrFallback` degrades gracefully to MathJax. Prefer the
  `OrFallback` factory unless you specifically want a hard failure when TeX
  isn't installed.
- **`Tex`/`MathTex` (MathJax) require `await initMathTex()` to resolve once**
  before construction — the constructors themselves are synchronous and throw
  if MathJax hasn't initialized yet. `mathTexDvisvgmOrFallback`'s fallback
  path constructs a `MathTex` internally, so callers relying on the fallback
  should still `await initMathTex()` up front (once per process) so the
  fallback path doesn't throw on top of the toolchain already being missing.
- The dvisvgm backend is Node-only; calling it in a browser bundle throws
  immediately with a message pointing back at MathJax, which is the only
  backend available there.
- Because both backends ultimately produce a `VGroup` of Bézier-outline
  glyphs, `Write`/`Transform`/part-addressing (`getPartByTex`,
  `setColorByTexToColorMap`, etc. on `MathTex`) work the same either way —
  switching backends is a rendering-quality decision, not an API change,
  except that `MathTexDvisvgm` doesn't expose the part-addressing API that
  `MathTex` does (it's a flat glyph `VGroup`, not broken into addressable
  parts by isolated substrings).
