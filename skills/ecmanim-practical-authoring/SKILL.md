---
name: ecmanim-practical-authoring
description: Practical field guide for authoring ecmanim scenes — layout math that prevents clipped/off-center output, a verification discipline that catches problems before they reach the user, working layout helpers (frame geometry, measured text width, Axes centering), and confirmed library gotchas with workarounds. This skill should be used alongside `ecmanim` (the root skill) whenever a scene places content near a frame edge, uses `Axes`/`NumberPlane` with a range that doesn't straddle zero, animates more than one mobject at a time, or a render's output looks subtly wrong (clipped, off-center, or a silently corrupted animation) rather than throwing a clear error.
metadata:
  tags: ecmanim, manim, animation, layout, verification, debugging, gotchas
---

# ecmanim — practical authoring guide

This skill captures what actually mattered across real scene-authoring work
with `ecmanim` (a TypeScript port of manim: the same `Scene` code renders in
Node and the browser) — the layout math that prevents clipped output, the
verification discipline that catches problems before they reach the user, and
confirmed library gotchas with working workarounds. It **complements, not
replaces**, `ecmanim` (the root skill, which owns the core Plan → Code →
Render → Verify → Iterate loop) and the domain skills (`ecmanim-timeline`,
`ecmanim-render-cli`, etc., which cover API surface) — read this one for the
specific failure modes those don't spell out. Every numeric constant and code
sample below is checked against ecmanim's actual source and runtime behavior,
not assumed.

## Environment setup (in a sandboxed/restricted execution environment)

If you're authoring scenes from inside a sandboxed agent environment rather
than a normal local checkout, a few things commonly go wrong before you ever
get to writing a scene:

- `git clone` can be blocked ("Operation not permitted") in some sandboxes —
  download the repo as a zip/tarball via `curl` and extract instead of
  assuming `git` network access works.
- The default global npm cache path is often read-only in a sandbox.
  `npm install` fails opaquely in that case; point it at a writable
  directory first: `export NPM_CONFIG_CACHE=/tmp/npm-cache && npm install`.
- Clone into a scratch directory you know is writable (e.g. `/tmp/ecmanim_<id>/`)
  rather than assuming the working directory is.
- Once installed, **sanity-check before writing any scene code**:
  ```bash
  npx ecmanim checkhealth
  ```
  This is also step zero in the root skill's loop — repeating it here because
  skipping it is the single most common false start: a missing `ffmpeg`/font
  produces a render failure that looks identical to a code bug, and ruling
  that out first saves a full debugging cycle.
- Within a cloned repo, `examples/*.ts` import from the relative
  `../src/node.ts` (not the package name) — that's fine for `node scene.ts`
  (which calls `render()` itself, module-level), but see "CLI Scene identity
  mismatch" below before invoking such a scene through the `ecmanim` CLI
  binary specifically.

## Frame geometry — the layout math that prevents clipped output

Verified against `src/core/constants.ts`:

| Constant | Value |
|---|---|
| `FRAME_WIDTH` | `14.222222222222221` (`= 8 * 16/9`) |
| `FRAME_HEIGHT` | `8.0` |
| `FRAME_X_RADIUS` | `7.111...` (half-width) |
| `FRAME_Y_RADIUS` | `4.0` (half-height) |

World coordinates run from `-FRAME_X_RADIUS` to `+FRAME_X_RADIUS` (x) and
`-FRAME_Y_RADIUS` to `+FRAME_Y_RADIUS` (y), **regardless of the render's pixel
resolution/quality preset** — quality presets scale output pixels, not the
world coordinate system. Anything placed beyond those bounds is clipped or
invisible.

**Do the margin arithmetic before rendering, not after.** For every
text/shape that lands near a frame edge, compute its extent against
`FRAME_X_RADIUS`/`FRAME_Y_RADIUS` (with a small gutter, e.g. `0.3`-`0.4`) and
adjust position/`fontSize` until it clears — treat "does this fit" as a
calculation you do while writing the scene, not something you find out by
rendering and eyeballing the result. Every genuine layout bug worth writing
up (clipped captions, overlapping labels, off-frame axis edges) was caught
this way, not by inspection after the fact.

`Text`'s approximate width is `longest_line_length * fontSize * 0.55`
(matches the `CHAR_ASPECT = 0.55` constant in `src/mobject/text/Text.ts` — no
runtime accessor exposes it, so treat this as a maintained duplicate, not a
guarantee). It's a good first-pass estimate but **not exact** — for long
captions or anything close to the frame boundary, get the actual measured
width instead of trusting the formula:

```ts
const t = new Text(myString, { fontSize, color, point: [0, y, 0] });
const width = t.getWidth();  // ground truth — the real, laid-out bounding box
```

`assets/layout.ts` (below) wraps this as `textWidth()`/`textHeight()`. For
anything that survived to a render and you're still unsure, pixel-scan the
frame at the content's row for non-background columns touching column 0 or
the frame's right edge — this is the only fully reliable clipping check, and
should gate any caption approaching its width budget.

**`Axes` does not pre-center at world origin.** Data value `0` on each axis
always maps to world `[0,0,0]`, regardless of `xRange`/`yRange` — verified
directly via `axes.c2p(0, 0)` across `[0,70]`, `[10,20]`, `[-4,4]`, `[-70,0]`
-style ranges (all return `[0,0,0]`). So an axes box whose range doesn't
straddle zero will **not** be centered in the frame the way a naive
`-length/2` assumption predicts — solve the needed `.shift()` from this fact
(`solveAxesShift()` in `assets/layout.ts`) rather than guessing an offset.

## Reusable layout helpers: `assets/layout.ts`

A working helper module — frame/safe-zone constants, `solveAxesShift()`,
measured `textWidth()`/`textHeight()`, a right-anchored multi-row readout
builder (`buildReadout()`), and `assertClear()` (throws instead of silently
rendering a clip). Every constant and function was verified end-to-end
against the actual library (not derived from docs alone) — copy it into a
new project's scene directory and import from it rather than re-deriving
these formulas per scene:

```ts
import { FRAME_X_RADIUS, solveAxesShift, textWidth, assertClear, buildReadout } from "./layout.ts";
```

## The authoring loop, in practice

This builds on the root skill's Plan → Code → Render → Verify → Iterate loop
— read that first for the overall shape. What follows are the specific
techniques that make each step actually catch problems, learned from
real scene-authoring work:

1. **Plan — compute real data first, never hardcode a plausible number.** If
   the animation needs to display a genuine result (a simulation output, a
   closed-form value, an exhaustive search result), compute it in a separate
   script first and save it as a small JSON file the scene reads at
   construct-time:
   ```ts
   const data = JSON.parse(readFileSync(new URL("./data.json", import.meta.url), "utf-8"));
   ```
   A number typed directly into scene code because it "looks about right" is
   a silent correctness bug waiting to be discovered by a viewer, not by you.
2. **Code — compute layout margins as you write the render call**, per
   "Frame geometry" above, not after seeing a clipped result.
3. **Render cheap first.** A single still frame (`-s`/`--save_last_frame`,
   or `renderStill()`) is enough to validate composition before spending
   time on a full video render — this is already the root skill's advice;
   it matters enough to repeat.
4. **Verify by measurement, not just by looking.** Visual inspection catches
   gross problems; pixel-level column/row scans (a non-background pixel
   touching column 0 or frame-width-1) catch subtle clipping that's easy to
   miss by eye, especially in a small preview. Extract 3-4 frames spanning
   the animation (early/mid/late), not just the final one — a bug is easy to
   miss if only the last frame gets checked and the problem is transient.
5. **Iterate on one thing at a time.** When a render is visually wrong,
   isolate the cause with a minimal reproduction — strip the scene to the
   smallest snippet that still shows the bug — before guessing at a fix.
   This is also what makes a bug report (see `assets/bug_report_template.md`)
   actionable instead of a symptom description: "here's 5 lines that
   reproduce it" gets fixed; "my scene looks wrong" doesn't.
6. **Build GIFs with two-pass palette generation**, not a single-pass
   conversion — quality is materially better for a small size increase:
   ```bash
   ffmpeg -y -i scene.mp4 -vf "fps=15,scale=640:-1:flags=lanczos,palettegen" /tmp/palette.png
   ffmpeg -y -i scene.mp4 -i /tmp/palette.png \
     -filter_complex "fps=15,scale=640:-1:flags=lanczos[x];[x][1:v]paletteuse" \
     -loop 0 out.gif
   ```

## Confirmed library gotchas

Each of these was confirmed via a minimal, isolated reproduction (not
inferred from reading source alone) and independently re-verified against
the current `main` branch while writing this skill — status reflects that
verification, which may be newer than when each was first found.

### 1. CLI `Scene` identity mismatch across `src`/`dist` — fixed (0.0.6, [#3](https://github.com/johnhenry/ecmanim/issues/3))

Running a scene through the `ecmanim render`/`plan` CLI while the scene
imported `Scene` from `../src/node.ts` (source) rather than the built
`dist/` crashed with `TypeError: Class constructor ... cannot be invoked
without 'new'`. Root cause: the compiled CLI and the dynamically-imported
scene file ended up with two referentially-distinct copies of `Scene`, so
`instanceof Scene` failed even for a legitimate subclass. **Fixed** by
replacing every `instanceof Scene` check with a duck-typed `isSceneLike()`.
If you're on an older version: import from the package's built entry point
(`"ecmanim/node"`, not a relative `../src/...` path) in any scene file meant
to run through the CLI, or invoke it directly with `node scene.ts` (which
calls `render()` itself) instead.

### 2. Direct `mobject.color = X` assignment desyncs `strokeColor`/`fillColor` — fixed

Assigning `mobject.color = X` directly used to leave the `strokeColor`/
`fillColor` fields the renderer actually reads for a `VMobject` stale —
the three were independent fields that only happened to agree at
construction time (or after a real `.setColor()` call). Confirmed directly
before the fix landed:

```ts
const c = new Circle({ color: "#0000ff" });
c.color = "#ff0000";
c.color;        // "#ff0000"
c.strokeColor;   // "#0000ff" -- stale (pre-fix)
c.fillColor;     // "#0000ff" -- stale (pre-fix)
```

A naive getter/setter fix is riskier than it looks: this project's
TypeScript target uses `[[Define]]` class-field semantics, so a subclass
accessor of the same *name* as a base-class field gets shadowed by the base
class's own-property field, silently not intercepting assignment. **Fixed**
correctly by renaming the backing field (`protected _color: Color`) and
making `color` a real `get`/`set` pair whose setter delegates to
`setColor()`, so raw assignment and `.setColor()` now agree — `c.color =
"#ff0000"` correctly updates `strokeColor`/`fillColor` too, on current
`main`. On an older version without this fix: always use `.setColor(color)`
(or set `color`/`strokeColor`/`fillColor` in the constructor config) instead
of a raw `.color = ...` assignment.

### 3. `FadeIn(a, b, c)` (extra positional mobjects) — fixed

`new FadeIn(a, b, c)` used to silently corrupt `a`'s geometry to `NaN`, with
**zero error output**, `b`/`c` silently dropped. Root cause: single-mobject
`Animation` subclasses take `(mobject, config)`; the extra positional
argument `b` landed in `config`, and since `Mobject` has a `.shift()`
*method*, `config.shift ?? [0,0,0]` read that method reference as a truthy
value instead of falling through to the default — corrupting the fade's
computed shift vector into `NaN` arithmetic. **Fixed**: the `Animation` base
constructor now throws a clear `TypeError` instead ("Animation constructors
take a single Mobject; to animate multiple mobjects together, wrap them in a
Group..."). The correct pattern, unaffected by this bug on any version and
still the right idiom: wrap multiple mobjects in `Group` first —
`new FadeIn(new Group(a, b, c))`, never `new FadeIn(a, b, c)`. The
`mobjects.map(m => new FadeIn(m))` pattern (passed as multiple animations to
a single `play(...)` call) was never affected.

When a new bug surfaces, write it up with `assets/bug_report_template.md` —
the difference between a report that gets fixed quickly and one that
doesn't is almost always whether the root cause is backed by a minimal,
confirmed reproduction (see issues
[#1](https://github.com/johnhenry/ecmanim/issues/1),
[#2](https://github.com/johnhenry/ecmanim/issues/2),
[#3](https://github.com/johnhenry/ecmanim/issues/3) for the house style this
project's own maintainer uses), not a description of the symptom.

## A caching gotcha to be aware of

`<output-dir>/partial/` accumulates content-hash-keyed partial `.mp4`
segments across renders, reused via a "(N partial(s) reused)" message in
render output (see `ecmanim-render-cli` for the full caching model). If a
render's output looks stale despite source changes, clear this directory
before assuming a code bug — but don't assume it's the cause either; verify
by clearing it and reproducing the issue again, since a stale-partial
symptom and a genuine code bug can look identical.

## Package-bundled child skills

This repo ships portable skill docs under `skills/` covering API surface
this guide doesn't: `ecmanim-timeline` (sequencing/timing grammar),
`ecmanim-captions-audio`, `ecmanim-voiceover`, `ecmanim-presentation` (auto
shared-element transforms, diagram-as-code), `ecmanim-interchange`
(Lottie/OTIO/LaTeX), `ecmanim-physics`, `ecmanim-authoring-pipeline`
(topic-to-video without hand-writing a Scene), `ecmanim-studio`
(live-reload preview), `ecmanim-render-cli` (flags/quality
presets/caching). Read the relevant one directly from
`skills/<name>/SKILL.md` when a task needs that specific area — start from
`ecmanim` (the root skill) if unsure which one fits.
