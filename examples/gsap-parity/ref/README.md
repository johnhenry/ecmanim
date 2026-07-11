# GSAP pattern reference corpus

13 pattern reference briefs — **not** extracted example files. GSAP's
documentation is copyrighted prose (GreenSock docs), not an open-source
repo of raw example sources, so this corpus differs from every prior
campaign's `ref/`: instead of bulk-copying gallery/demo files verbatim,
each `NN-slug.md` here is an original brief written for this project that
(a) names the pattern and the GSAP feature/API it demonstrates, (b)
quotes a **short** (5–15 line) illustrative code snippet fetched live
from the relevant docs.greensock.com / gsap.com page, clearly marked as a
quote with its exact source URL, and (c) describes the visual/behavioral
effect being demonstrated in our own words. A later port phase reads
these briefs to build an ecmanim recreation of each *pattern* — not a
line-for-line port of GSAP's code, since none of it is committed here in
bulk.

| # | Pattern | Effect | Source |
|---|---------|--------|--------|
| 01 | [timeline labels + position params](./01-timeline-labels.md) | tweens sequenced on a timeline via relative position parameters (`<`, `>`, `-=`, `+=`, label offsets) instead of hard-coded absolute times | https://gsap.com/resources/position-parameter/ |
| 02 | [stagger distributions](./02-stagger-distributions.md) | a grid of elements animates with start-time offsets shaped by a distribution (`from: "center"`/`"edges"`/`"random"`, spatial `grid`) instead of plain array order | https://gsap.com/resources/getting-started/Staggers |
| 03 | [text split reveal](./03-text-split-reveal.md) | a line of text decomposed into per-character/word elements that reveal in a staggered wave (SplitText pattern) | https://gsap.com/docs/v3/Plugins/SplitText/ |
| 04 | [shape morph](./04-shape-morph.md) | one SVG path's outline continuously deforms into a second, distinct shape (MorphSVG pattern) | https://gsap.com/docs/v3/Plugins/MorphSVGPlugin/ |
| 05 | [motion path + autoRotate](./05-motion-path-autorotate.md) | an object travels along a curved path and reorients to face its direction of travel as it goes | https://gsap.com/docs/v3/Plugins/MotionPathPlugin/ |
| 06 | [FLIP transition](./06-flip-transition.md) | an element that jumps to a structurally different layout instead glides smoothly from its old bounding box to its new one (First-Last-Invert-Play) | https://gsap.com/docs/v3/Plugins/Flip/ |
| 07 | [scroll-scrubbed timeline](./07-scroll-scrubbed-timeline.md) | a timeline's playhead is a direct function of scroll position — scrolling up plays it backward, stopping freezes it mid-animation | https://gsap.com/docs/v3/Plugins/ScrollTrigger/ |
| 08 | [pin + progress](./08-pin-progress.md) | an element holds fixed on screen for a scroll range while a paired animation, driven by the same scroll distance, plays out | https://gsap.com/docs/v3/Plugins/ScrollTrigger/ |
| 09 | [parallax layers](./09-parallax-layers.md) | stacked layers move at different rates relative to scroll, producing an illusion of depth | https://gsap.com/docs/v3/Plugins/ScrollSmoother/ |
| 10 | [elastic + back easing](./10-elastic-back-easing.md) | the same move/scale tween plays under two named eases — elastic oscillates and settles, back overshoots once and returns | https://gsap.com/docs/v3/Eases/ |
| 11 | [repeat + yoyo](./11-repeat-yoyo.md) | an object ping-pongs continuously between two states with no reset jump at the loop boundary | https://gsap.com/docs/v3/GSAP/Tween/ |
| 12 | [keyframes syntax](./12-keyframes-syntax.md) | one tween call sequences several distinct animation states back-to-back on a single target | https://gsap.com/docs/v3/GSAP/Tween/ |
| 13 | [onUpdate callback](./13-onupdate-callback.md) | a side effect (readout, canvas redraw, second element) updates every frame in lockstep with a tween's live progress | https://gsap.com/docs/v3/GSAP/Tween/ |

## Out of scope: `draggable`

GSAP's `Draggable` plugin (free-form pointer dragging of DOM elements) is
explicitly **excluded** from this corpus per the roadmap. It's an
interactive, pointer-driven input pattern with no meaningful rendered-
video or programmatic-recreation equivalent — there's nothing to "port"
to a headless render pipeline, unlike the other 13 patterns which all
resolve to a deterministic, playable timeline. It is intentionally *not*
represented as a numbered ref file here; this paragraph is its record in
the corpus.

## Licensing / attribution

Every code block in `ref/*.md` is a short (5–15 line) illustrative quote
fetched live from GreenSock's public documentation (docs.greensock.com /
gsap.com), reproduced under fair-use quotation for reference and
educational purposes, with the exact source URL cited per pattern in the
table above and again in each file. These are **not** bulk copies of
GSAP's docs pages, demo source, or plugin source code — each brief is
original writing (pattern description, effect description, and framing)
by this project, with only the minimal illustrative snippet quoted
verbatim and attributed. Several patterns referenced here (SplitText,
MorphSVGPlugin) are paid/Club GreenSock plugins in the real GSAP product;
this corpus recreates the *pattern* they demonstrate, not their plugin
internals, and does not include or redistribute any GreenSock plugin
source.
