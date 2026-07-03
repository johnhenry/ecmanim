---
name: ecmanim
description: Author, render, and iterate on ecmanim animations (a TypeScript port of manim that renders the same Scene code in Node and the browser). This skill should be used when the user wants to create or edit a Manim-style programmatic animation with ecmanim, render it to video/GIF/still, debug a render failure, or pick which specialized ecmanim-* skill covers a specific need (captions, voiceover, physics, interchange, presentation, the prompt-to-video authoring pipeline, Studio live-preview, or CLI/render mechanics).
metadata:
  tags: ecmanim, manim, animation, video, typescript
---

# ecmanim — root skill

`ecmanim` is a TypeScript port of [manim](https://github.com/ManimCommunity/manim)
that runs the *same* `Scene` code in Node (renders to MP4/WebM/GIF/MOV/PNG via
ffmpeg) and in the browser (live canvas + WebM, optional WebGL/Three.js). This
skill is the entry point; it teaches the core authoring loop and routes to
narrower skills for specific domains.

This is a portable skill package (not auto-loaded). If not already active in
this session, copy or symlink this `skills/` directory into `~/.claude/skills/`
or the target project's `.claude/skills/`.

## When to hand off to a child skill

| Need | Skill |
|---|---|
| Sequencing/timing grammar, expression-driven properties (wiggle/remap), a vector-glyph number counter, style/aspect-ratio presets, rendering a single still frame | `ecmanim-timeline` |
| Burned-in or overlay captions (SRT, karaoke, TikTok-style), audio-reactive visuals (FFT/waveform) | `ecmanim-captions-audio` |
| Narration: `voiceover()`, bookmarks, TTS providers | `ecmanim-voiceover` |
| Auto shared-element transforms between states, slide/section presenter controls, diagram-as-code (Mermaid/D2-lite → animated graph) | `ecmanim-presentation` |
| Importing/exporting Lottie, exporting OTIO timelines, real-TeX (LaTeX) math, watermarking | `ecmanim-interchange` |
| Physics: analytic E&M/wave/optics fields, rigid-body simulation | `ecmanim-physics` |
| Turning a topic/brief into a finished video without hand-writing a Scene (Format lifecycle, plan-IR/dry-run, quality gates) | `ecmanim-authoring-pipeline` |
| Live-reloading local preview server, schema-driven prop controls | `ecmanim-studio` |
| CLI flags, quality/output presets, caching, renderer backends (canvas/WebGL/z-buffer 3D) | `ecmanim-render-cli` |
| Content clipping/off-center near a frame edge, `Axes`/`NumberPlane` layout with a range not centered on zero, animating more than one mobject at once, a render that looks subtly wrong instead of erroring | `ecmanim-practical-authoring` |

Everything below applies regardless of which child skill is also in play.

## Quickstart

```ts
import { render, Scene, Circle, Square, Transform, Create, BLUE, GREEN } from "ecmanim/node";

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

A Scene is a class with `async construct()`; build mobjects (`Circle`, `Square`,
`Text`, ...), animate them with `this.play(new SomeAnimation(...))` or the
`.animate` proxy, and `this.wait(seconds)` between beats. `render()` (Node) or
`play()`/`record()` (browser, from `ecmanim/browser`) drives the Scene. ~120
mobjects, ~67 animations, all manim rate functions, and the full manim color
palette are available — same names as Python manim where they overlap. See
[docs/primitives.md](../../docs/primitives.md) and the top-level
[README.md](../../README.md) for the full quickstart and parity table (adjust
the relative path if this skill was copied elsewhere — search the target repo
for `docs/primitives.md`).

Before anything else, sanity-check the environment once per session:

```bash
npx ecmanim checkhealth
```

This reports Node/ffmpeg/ffprobe/canvas/fonts (required) plus system TTS, TeX,
and headless-Chrome CDP (optional — each degrades gracefully when absent; see
`docs/external-tools.md`). Don't assume ffmpeg exists — check first, since
render failures caused by a missing binary look identical to a code bug.

## The authoring loop: Plan → Code → Render → Verify → Iterate

This loop is the shared convention every ecmanim-* skill assumes. It's
synthesized from patterns used by existing Manim-agent tooling (render-in-the-
loop self-correction, code-writer/code-reviewer splits, vision-in-the-loop
escalation) and from ecmanim's own `ecmanim/authoring` package, which
implements the same shape as a real API (see `ecmanim-authoring-pipeline`).

1. **Plan** — before writing mobject code, sketch the beats in prose or as a
   short list (what appears, in what order, what transforms into what, roughly
   how long each beat holds). For anything non-trivial, prefer
   `ecmanim/authoring`'s `toPlanIR()` (dry-run — harvests scene structure
   *without* rendering) over skipping straight to code; see
   `ecmanim-authoring-pipeline`.
2. **Code** — write the `Scene` subclass. Keep `construct()` linear and
   readable: one visual idea per `play()` call. Reach for `Timeline` (see
   `ecmanim-timeline`) once you need more than simple sequential/`wait()`
   pacing.
3. **Render** — start cheap:
   - `ecmanim render file.ts Scene -s` — a single PNG of the final frame
     (`--save_last_frame`), fastest way to check layout/composition.
   - `renderStill(Scene, { time })` from `ecmanim/node` — a still at an
     arbitrary time, useful for checking a specific beat mid-animation.
   - Only render full video (`ecmanim render file.ts Scene -q low`) once stills
     look right — full renders are the slowest feedback loop, so don't reach
     for them first.
4. **Verify** — a render that exits 0 is necessary, not sufficient:
   - Read stderr/exceptions fully before retrying — ecmanim's errors (missing
     font, `ffmpeg ENOENT`, unresolved mobject) are usually precise about the
     cause; don't guess-and-check.
   - For layout/visual correctness, actually look at the PNG/frame output
     (Read tool on the still, or a video frame extracted with `-s`/
     `renderStill`) rather than assuming code that type-checks looks correct —
     this is the step most agent-driven Manim tooling skips, and it's the one
     that catches wrong positions, overlapping text, and off-screen mobjects.
   - Escalate cost gradually: fix from the error text first; only pull in a
     rendered-frame visual check when the error is unclear or the bug is
     purely visual (positioning/timing/composition), not a fixable exception.
5. **Iterate** — apply one focused fix per cycle and re-render the cheapest
   artifact that would reveal whether it worked (usually a still, not a full
   video). Cap retries on the same error at a handful of attempts — if it's
   not converging, re-read the relevant docs page instead of guessing.

## Conventions to carry into every child skill

- **Ground claims in the docs, not memory.** ecmanim tracks manim closely but
  is not identical; check `docs/*.md` (or the exported TypeScript types) before
  asserting an API shape, especially for less-common mobjects/animations.
- **Everything is isomorphic unless noted.** Core mobjects/animations run in
  both Node and browser from the same code. Node-only or browser-only
  capabilities are explicitly called out in each child skill and in
  `docs/renderers.md` — don't assume parity where it isn't documented.
- **Optional dependencies degrade gracefully, don't error opaquely.**
  `@napi-rs/canvas`, `three`, system `ffmpeg`/TeX/TTS binaries, and headless
  Chrome are all optional; `checkhealth` is the fast way to know what's
  available before debugging a mysterious failure.
