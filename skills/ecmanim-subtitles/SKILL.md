---
name: ecmanim-subtitles
description: Import and export real ASS/SSA subtitle files ("Advanced SubStation Alpha", the fansub-typesetting format Aegisub/libass use) — loadASS() plays a .ass/.ssa file as first-class ecmanim mobjects (positioning, color, karaoke sweep, rotation/shear, clipping, vector-drawing signs), and wordCaptionTrackToAss()/vmobjectToAssDrawing() export ecmanim captions/shapes back out to .ass. Use this skill when a task mentions ASS, SSA, Aegisub, libass, JASSUB, fansub subtitles, karaoke .ass export, or "\k"/"\pos"/"\p1"-style subtitle override tags.
metadata:
  tags: ecmanim, ass, ssa, subtitles, karaoke, aegisub, libass, typesetting
---

# ecmanim-subtitles

Child skill of `ecmanim` (read `../ecmanim/SKILL.md` first for the shared
Plan→Code→Render→Verify→Iterate loop and `checkhealth`-first convention — not
repeated here). ASS/SSA is a real 2D animation description language, not
just a fancier caption box: per-run override tags for position, movement,
rotation, scale, color, clipping, and karaoke timing, plus an embedded
vector-drawing mini-language. This skill covers both directions: **import**
(render a `.ass`/`.ssa` file through ecmanim's own renderer) and **export**
(turn ecmanim's own caption/shape data into a portable `.ass` deliverable).
Full detail: [../../docs/subtitles.md](../../docs/subtitles.md) — read it
before asserting an exact tag's behavior; this file only orients you.

**Looking for plain-timing SRT captions or TikTok-style word reveal
instead?** See `ecmanim-captions-audio` — its `CaptionTrack`/
`WordCaptionTrack` don't understand ASS override tags at all; this skill is
for the richer, tag-based format specifically.

## Quickstart: import

```ts
import { loadASS } from "ecmanim";
import { readFileSync } from "node:fs";

const subs = loadASS(readFileSync("movie.ass", "utf8"), { width: 13 });
subs.attachTo(scene);          // adds a dt-driven clock updater + scene.add()
await scene.wait(subs.durationMs / 1000);

// or drive it by hand instead of attachTo():
subs.setTime(1500);            // ms into the script
subs.setFrame(45, 30);         // exact frame at a given fps
subs.cues();                   // -> one summary line per Dialogue event
subs.styles();                 // -> style names declared in [V4+ Styles]
subs.warnings;                 // string[] of skipped/approximated features, deduped by tag name
```

`ASSConfig`: `width?`/`height?` (target world size; fits ~10 units wide by
default, tighter fit wins if both given — same convention as `LottieConfig`),
`speed?` (default 1, only affects `attachTo`'s clock), `fontResolver?`
(`(styleFontName) => string | undefined`, mapping a `Style`'s `Fontname` to
a font ecmanim can actually load; unresolved names fall back to the default
font and warn once per distinct missing name). **No `loop` option** —
subtitles have a natural non-looping end (`durationMs`), unlike Lottie.

Same purity contract as `LottieMobject`/`CaptionTrack`: `setTime(tMs)` is a
pure, idempotent function of `tMs` alone (rebuilds every visible cue's
geometry from scratch each call) — scrub-safe, and safe under the
partial-movie content-hash render cache.

## Supported / not yet supported

Every override tag below is real and rendered; unsupported ones are
recognized (so a warning names the exact tag, not a vague "unknown tag") but
never throw — malformed/unrecognized input degrades and warns instead.

**Supported:** `\pos`, `\move` (linear, no easing per spec), `\an`(+legacy
`\a`)+margins, `\fad`, `\fade`, `\c`/`\1c`-`\4c`+`\alpha`/`\1a`-`\4a`,
`\fscx`/`\fscy`/`\fs`/`\fn` (fallback+warn), `\b`/`\i`/`\u`/`\s` (bold/
italic route through vector-Text's `t2w`/`t2s` substring maps, not a real
bold font face), `\frz`/`\fr` (bbox-center pivot unless `\org` is also set),
`\bord`/`\shad`, `\r`/`\r[Name]`, `\N`/`\n`+WrapStyle, greedy word-wrap,
legacy `[V4 Styles]` (SSA) alignment remap; `\t(t1,t2[,accel],tags)`
transform composition; rectangular `\clip`/`\iclip(x1,y1,x2,y2)`; `\org(x,y)`
explicit rotate/shear pivot; `\fax`/`\fay` shear; `\be`/`\blur`; **karaoke**
`\k` (instant swap), `\kf`/`\K` (continuous sweep — `\K` is a documented
libass/Aegisub *alias* for `\kf`, not an instant-swap sibling of lowercase
`\k`), `\ko` (approximated as an instant swap, not a true outline-only
sweep — see `docs/subtitles.md` for why); `\p<n>` drawing-mode dialogue
lines (`m`/`l`/`b`/`s`/`p`/`c` mini-language, including uniform-cubic-
B-spline `s` blocks).

**Not yet supported** (recognized + warned, never thrown): vector-drawing-
shape `\clip`/`\iclip` (the drawing parser this needs now exists via `\p`
support — only the clip-mask wiring itself is still open), `\pbo` (drawing
baseline offset). **Permanent cuts** (won't be built — approximate + warn
instead): `\frx`/`\fry` (3D perspective rotation), embedded `[Fonts]`/
`[Graphics]` UUencoded attachments (never decoded), collision-avoidance
dialogue stacking (overlaps silently), legacy SSA `Effect:` marquee (renders
static, ignores scroll), `\fe` codepage (true no-op).

## Karaoke export: `wordCaptionTrackToAss`

Turn an existing `WordCaptionTrack`'s word timing into a real, portable
karaoke `.ass` file — a soft-subtitle deliverable ecmanim doesn't otherwise
have (burned-in captions are the only option without this):

```ts
import { wordCaptionTrackToAss } from "ecmanim";
import { writeFileSync } from "node:fs";

const ass = wordCaptionTrackToAss(track, {
  primaryColor: "#FFFFFF",     // "already sung" color
  secondaryColor: "#FFE066",   // "not yet sung" color
  fontSize: 64,                // PlayRes pixels
  playResX: 1920, playResY: 1080,
});
writeFileSync("captions.ass", ass);
// plays synced karaoke captions over the RAW (unburned) ecmanim mp4 in any
// libass-capable player (mpv, VLC, browsers via JASSUB), or hands off
// cleanly to Aegisub for manual polish -- without touching ecmanim at all.
```

One `Dialogue:` line per `WordCaptionTrack` page, one `\k<centiseconds>`
syllable per token, timing taken directly from the token's own
`{fromMs, toMs}`. **Caption/typography scope only** — this is not a general
ecmanim-scene exporter; ASS has no equivalent for spring dynamics, custom
rate functions, or `TransformMatchingAuto`'s point-correspondence morphing.

`vmobjectToAssDrawing(shape, config?)` is the shape-export sibling: a single
static `VMobject` (title card, icon, simple logo) becomes a standalone `\p1`
drawing-mode `.ass` file, centered on the shape's own `getCenter()`. Also
scoped to **one static shape** — no keyframes, no `\t`-driven animation
export; for anything with real motion, render normally and use
`wordCaptionTrackToAss` for the caption track alongside it.

## Gotchas

- **Real-corpus honesty**: this campaign's own test fixtures are 100%
  synthetic (`examples/ass-parity/fixtures/`) — no specific real fansub
  `.ass` file is bundled or asserted safe to use from memory. Bring your own
  file; `loadASS` degrades and warns rather than throwing on anything it
  doesn't recognize, but always spot-check a real-world file's render
  against what you expect before trusting it.
- **Colors are `&HBBGGRR&`** (BGR byte order, ASS convention) — not the
  `#RRGGBB` you'd write elsewhere in ecmanim. `wordCaptionTrackToAss`/
  `vmobjectToAssDrawing` accept normal ecmanim `ColorLike` values and do the
  BGR reorder internally; you never hand-write the BGR form yourself unless
  editing the exported `.ass` text directly.
- **`\bord`/`\shad`/`\blur`/`\be` are PlayRes-pixel values, scaled
  internally to the render's actual resolution** (via the script's own
  `PlayResY`, not the world-unit fit) — this was a real bug in an earlier
  version of this campaign (border/shadow/blur rendered imperceptibly at
  any realistic tag value); if you're reading old cached output or a
  vendored copy, confirm the fix (`_refPx` in `src/mobject/ass_mobject.ts`)
  is present.
