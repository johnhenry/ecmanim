# ASS/SSA subtitles

Real ASS/SSA ("Advanced SubStation Alpha") subtitle import and export.
Unlike SRT (see `docs/captions-audio.md`), ASS is a genuine 2D animation
description language: per-run override tags for position, movement,
rotation, scale, color, clipping, and karaoke timing, plus an embedded
vector-drawing mini-language for fansub sign/logo redraws. This module
treats `.ass`/`.ssa` files as a first-class ecmanim import format — real
files render through ecmanim's own Canvas-2D renderer — and also exports
ecmanim's own caption/shape data back out to `.ass`.

Architecture mirrors the Lottie campaign: a pure-parsing loader
(`src/loaders/ass_loader.ts`, no mobjects/DOM/`node:` imports) + a
pure-function-of-time mobject player (`src/mobject/ass_mobject.ts`), plus
an interchange bridge for export (`src/interchange/ass.ts`). Same
"never throw, degrade + warn" contract every foreign-format importer in
this codebase follows.

## Import: `loadASS`

```ts
import { loadASS } from "@johnhenry/ecmanim";
import { readFileSync } from "node:fs";

const subs = loadASS(readFileSync("movie.ass", "utf8"), { width: 13 });
subs.attachTo(scene);
await scene.wait(subs.durationMs / 1000);
```

```ts
interface ASSConfig {
  width?: number;    // target world size; fits ~10 units wide by default
  height?: number;   // tighter fit wins if both width and height are given
  speed?: number;     // attachTo() clock multiplier, default 1
  fontResolver?: (styleFontName: string) => string | undefined;
}

class ASSMobject extends Group {
  readonly warnings: string[];       // deduped by tag NAME (not full message)
  readonly resX: number;              // script's PlayResX
  readonly resY: number;              // script's PlayResY
  readonly durationMs: number;
  speed: number;
  setTime(tMs: number): this;         // pure function of tMs -- rebuilds every visible cue from scratch
  setFrame(f: number, fps?: number): this;
  attachTo(scene): this;              // adds a dt-driven clock updater + scene.add()
  cues(): string[];                   // one summary line per Dialogue event
  cue(index: number): Mobject | undefined;
  styles(): string[];                 // style names from [V4+ Styles]
  style(name: string): ASSStyle | undefined;
}
```

**No `loop` option** — subtitles have a natural non-looping end
(`durationMs`), unlike `LottieConfig.loop`.

### Caching contract

`setTime(tMs)` must be a pure, idempotent function of `tMs` alone — same
requirement `LottieMobject`/`CaptionTrack`/`WordCaptionTrack` already meet,
because `Scene._mobjectFingerprint()` reads a mobject's *current*
geometry/paint at `wait()`-time and never re-invokes updaters to probe for
hidden state. `ASSMobject` satisfies this by rebuilding every visible cue's
geometry from scratch on every `setTime` call (never mutating
incrementally) — scrub-safe and render-cache-safe by construction.

## Tag support

Every tag below is real and rendered end-to-end (not just parsed); a tag
NOT in this list is recognized by the tokenizer (so it doesn't corrupt
parsing of the rest of the line) but produces a `"\\tagname is recognized
but not yet implemented -- ignored"` warning rather than silently doing
nothing with no explanation.

| Tag | Behavior |
|---|---|
| `\pos(x,y)` | Absolute position override (PlayRes pixels) |
| `\move(x1,y1,x2,y2[,t1,t2])` | Linear interpolation, no easing (per spec) |
| `\an1`-`\an9` (+legacy `\a`) | Numpad alignment; legacy `\a` values remap through a fixed SSA→ASS table |
| `\fad(in,out)` | Simple fade |
| `\fade(a1,a2,a3,t1,t2,t3,t4)` | Piecewise fade through 3 alpha levels |
| `\c`/`\1c`-`\4c` | Primary/secondary/outline/back color |
| `\alpha`/`\1a`-`\4a` | Per-channel alpha |
| `\fscx`/`\fscy`/`\fs` | Scale/font size |
| `\fn` | Font name (fallback + warn if unresolved) |
| `\b`/`\i`/`\u`/`\s` | Bold/italic/underline/strikeout |
| `\frz`/`\fr` | Z rotation, pivoted at the run's own bbox center unless `\org` is set |
| `\bord`/`\shad` | Outline width / shadow depth |
| `\k`/`\kf`/`\K`/`\ko` | Karaoke (see below) |
| `\r`/`\r[Name]` | Reset to base style or a named style |
| `\N`/`\n` | Hard line break (`\n` only breaks under `WrapStyle 2`, otherwise a plain space) |
| `\t(t1,t2[,accel],tags)` | Transform composition over numeric/color fields |
| `\clip`/`\iclip(x1,y1,x2,y2)` | Rectangular clip/inverse-clip |
| `\org(x,y)` | Explicit rotate/shear pivot (overrides the bbox-center default) |
| `\fax`/`\fay` | Shear |
| `\be`/`\blur` | Blur |
| `\p<n>` | Drawing mode — the run's TEXT is drawing commands, not literal text (see below) |

**Not yet implemented** (recognized, warned by name, never thrown):
vector-drawing-shape `\clip`/`\iclip` (`\clip([scale,]m ...)` — the drawing
PARSER this needs now exists via `\p` support; only the clip-mask wiring is
still open), `\pbo` (drawing baseline offset).

**Permanent cuts** (approximate + warn, not staged for a future pass):
`\frx`/`\fry` (3D perspective rotation — the only tag needing genuinely
different math, a full projection matrix, than every other tag), embedded
`[Fonts]`/`[Graphics]` UUencoded attachments (never decoded), collision-
avoidance dialogue stacking (overlaps silently), legacy SSA `Effect:`
marquee (renders static, ignores scroll), `\fe` codepage (true no-op).

### Karaoke: `\k`/`\kf`/`\K`/`\ko`

**`\K` is a documented libass/Aegisub alias for `\kf` (continuous sweep) —
not an instant-swap sibling of lowercase `\k`**, despite the capitalization
looking that way. Get this right when hand-authoring or debugging a script.

- **`\k<centiseconds>`** — instant color swap: a syllable is fully
  "sung" (primary color) the instant it becomes active, no in-between state.
- **`\kf<centiseconds>` / `\K<centiseconds>`** — continuous sweep: the
  active syllable renders as a secondary-colored base plus a primary-
  colored overlay clipped to the sampled per-frame sweep fraction, reusing
  the same `CompositeGroup`+`destination-in` mask mechanism `\clip` uses.
- **`\ko<centiseconds>`** — spec'd as a true outline-only sweep, but
  **approximated here as an instant color swap** (same as `\k`), not a real
  stroke-only sweep. Real-world `\ko` usage is rare enough that a second
  fill/stroke-split rendering pipeline wasn't worth building; if you need
  faithful `\ko` sweep, this is the one karaoke variant genuinely not to
  trust visually.

### Drawing mode: `\p<n>`

```
{\pos(700,300)\an7\p1}m 0 0 l 300 0 150 260 0 0
```

Sets the run's TEXT to be interpreted as ASS's own drawing mini-language
(`m`/`l`/`b`/`s`/`p`/`c`, space-separated — **not SVG syntax**) instead of
literal glyphs. `\p0` (or the tag's absence) returns to normal text. `n`
is the drawing's scale exponent: `n=1` is unscaled; `n>=2` divides every
coordinate by `2^(n-1)` (ASS's "higher internal precision" convention).

Commands: `m x y` (move, starts a new subpath), `l x y [x y ...]` (line
to, one or more points), `b x1 y1 x2 y2 x3 y3 [...]` (cubic Bézier, one
segment per group of 3 point pairs — passed straight through, no
conversion needed), `s x1 y1 ... xn yn` (uniform cubic B-spline, n≥3
points — converted to a chained cubic-Bézier via `uniformBSplineToBezier`,
derived from the canonical uniform-cubic-B-spline blending function), `p x
y` (extend the currently-open spline with one more point), `c` (close the
open spline into a loop by wrapping its first 3 points back onto the end).

A drawing run's own `(0,0)` origin maps **directly** to the line's
`\pos`/alignment anchor point — a documented simplification of the real
alignment-vs-bbox interaction libass uses for drawings. This matches how
the overwhelming majority of real `\p` content is actually authored
(`\an7`+`\pos` for exactly this top-left-origin placement), so it's rarely
visible in practice; if a real-world script pairs `\p` with a non-corner
alignment expecting bbox-relative positioning, the result may sit
differently than in libass.

Fill comes from `\c`/PrimaryColour, stroke from `\3c`/OutlineColour+`\bord`;
rotation/shear/blur reuse the exact same `_applyOrgTransform`/
`Mobject.blur()` machinery text runs use. Mixing plain text into the same
`\p1` line (rare in real content) is not supported — non-drawing runs on a
drawing-mode line are silently skipped.

## Export

### `wordCaptionTrackToAss` — karaoke captions

```ts
import { wordCaptionTrackToAss } from "@johnhenry/ecmanim";
import { writeFileSync } from "node:fs";

const ass = wordCaptionTrackToAss(track, {
  playResX: 1920, playResY: 1080,
  fontName: "Arial", fontSize: 64,
  primaryColor: "#FFFFFF",    // "already sung"
  secondaryColor: "#FFE066",  // "not yet sung"
  outlineColor: "#000000",
  alignment: 2,                // ASS numpad alignment, default bottom-center
  marginV: 60,
  styleName: "Default",
});
writeFileSync("captions.ass", ass);
```

One `Dialogue:` line per `WordCaptionTrack` page, one `\k<centiseconds>`
syllable per token — timing taken directly from the token's own
`{fromMs, toMs}` (ms → centiseconds, no new animation math). Produces a
real soft-subtitle deliverable: plays synced karaoke captions over the
**raw, unburned** ecmanim mp4 in any libass-capable player (mpv, VLC,
browsers via JASSUB) — ecmanim's captions were burn-in only before this —
and hands off cleanly to Aegisub for manual human polish without touching
ecmanim or re-rendering.

**Caption/typography scope only, same as `interchange/lottie.ts`'s own
"static geometry" disclaimer** — not a general ecmanim-scene-to-`.ass`
exporter. ASS's animation vocabulary has no equivalent for spring
dynamics, custom rate functions, `TransformMatchingAuto`'s point-
correspondence morphing, or 3D/mesh content; only caption timing/color/text
is representable, so that's all this function ever attempts.

### `vmobjectToAssDrawing` — a static shape/icon/title card

```ts
import { vmobjectToAssDrawing } from "@johnhenry/ecmanim";
import { writeFileSync } from "node:fs";

const ass = vmobjectToAssDrawing(star, {
  playResX: 1920, playResY: 1080,
  scale: 100,           // PlayRes pixels per ecmanim world unit
  pos: [960, 540],       // where the shape's own center lands (default: PlayRes center)
  durationMs: 5000,
});
writeFileSync("logo.ass", ass);
```

The inverse serializer of the `\p` drawing parser: `VMobject.getSubpaths()`
already returns the same flat cubic-point-list shape
`parseDrawingCommands`/`parsePathToSubpaths` produce, so this just walks
that shape and emits `m`/`b` commands (no `\s` b-spline emission — fitting
an arbitrary cubic path back into a lossy uniform-B-spline isn't
attempted). Geometry is centered on the shape's own `getCenter()` before
scaling (so `\pos` places the visual center, matching how most real `\p`
content is authored) and Y-flipped (ecmanim world space is Y-up, ASS
drawing space is Y-down like SVG). Fill/stroke/opacity come directly from
the `VMobject`'s own `fillColor`/`strokeColor`/`strokeWidth`/`fillOpacity`.

**Single static shape only** — no keyframes, no `\t`-driven animation
export. ASS interpolates TAG PARAMETERS (affine transforms of one fixed
path), never vertex-by-vertex path morphing, so this captures the shape at
call time, the same "one frozen frame" scope
`vmobjectToLottieJSON`/`interchange/lottie.ts` documents for its own static
export.

## Known bugs found + fixed during development

- **Word-overlap / mid-line spacing**: `estimateTextSize`'s approximate
  widths disagreed with real constructed `Text` mobjects by enough to
  visibly close word gaps — fixed by a measure-then-position discipline
  (build the real mobject, measure `getWidth()`, position from that).
- **Alignment ternary bug** (found twice, same root cause): a 3-way ternary
  on the alignment fraction mislabeled the right-edge and center cases,
  sending the default bottom-center `\an2` anchor to the right edge instead
  of center. Both sites were rewritten with an explicit lerp formula
  instead of a ternary chain (see the code comments at `_lineLeftX`/
  `_marginAnchor` in `ass_mobject.ts` for why).
- **Bold/italic silently inert**: `Text`'s `weight`/`slant` constructor
  fields are stored but never actually applied to glyph outlines — bold/
  italic only have a visible effect through `Text`'s `t2w`/`t2s` substring
  style maps, which is what `ass_mobject.ts` routes through instead.
- **`\bord`/`\shad`/`\blur`/`\be` scaled into the wrong unit space**:
  these PlayRes-pixel tag values were converted through the PlayRes→world-
  unit scale (used everywhere else on the class) instead of the "roughly
  px at 1080p" reference space `Mobject.strokeWidth`/`.blur()`/
  `.dropShadow()` actually expect — border/shadow/blur rendered
  imperceptibly at any realistic tag value, including in the v1 goldens
  that had already shipped. Fixed with a `_refPx()` helper keyed off the
  script's own `PlayResY`.
- **Karaoke double-spacing**: unconditionally injecting a space between
  every karaoke syllable conflicted with syllables that already embed
  their own trailing space — fixed by relying only on embedded spaces for
  karaoke (deliberately different from the word-wrap path, which DOES need
  injected spacing since wrapped words don't carry their own gaps).
- **`parseDrawingCommands` crashed on a dangling odd coordinate** (e.g. a
  truncated `l 10` with no `y`) — fixed to bail with `null` and discard the
  dangling number rather than reading past the token list.

## Real-corpus honesty

This campaign's synthetic fixtures (`examples/ass-parity/fixtures/`,
23 files) do the load-bearing feature-coverage work — no specific real
fansub-distributed `.ass` file is bundled or assumed safe to use from
memory (unlike Lottie's confirmed-MIT lottie-web demo corpus, fansub
scripts don't have comparably clear licensing in general). Bring your own
real-world file to validate against; `loadASS` degrades and warns rather
than throwing on anything it doesn't recognize, but always spot-check a
real file's actual render before trusting it end-to-end.
