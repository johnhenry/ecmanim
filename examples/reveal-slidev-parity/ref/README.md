# Reveal.js / Slidev deck reference corpus

Two official demo decks fetched verbatim (**MIT**, both projects), covering
Campaign 9 — the final campaign of the parity-campaigns roadmap. Unlike the
GSAP campaign (author-written pattern briefs, since GreenSock's own demos
aren't freely redistributable in full), reveal.js and Slidev ship their own
demo/starter decks as first-party MIT-licensed source in their public repos,
so — like the ECharts/D3/Lottie/p5.js campaigns before it — this corpus is
real fetched source, not authored content: `reveal-demo.html` is HTML pulled
directly from `hakimel/reveal.js`, `slidev-demo.md` is Markdown pulled
directly from `slidevjs/slidev`, both fetched 2026-07-11 via direct HTTPS
fetch of `raw.githubusercontent.com` (byte-exact, not run through any
summarizing/rendering step).

Each deck is trimmed/extended to land near the ~15-slide target this
campaign asked for, and each covers as much of the ten target patterns
(fragments, auto-animate, code walkthrough with highlight steps, vertical
stacks, backgrounds, transitions, speaker notes, incremental lists, math,
chart/data) as its *own official corpus* actually demonstrates. Two patterns
are not present anywhere in reveal.js's official repo in a form worth
fabricating (a literal chart/data-viz component) and Slidev has no built-in
concept of reveal.js-style nested vertical slide stacks — both gaps are
called out honestly below rather than invented.

## reveal-demo.html

Trimmed from `hakimel/reveal.js`'s official demo deck (master branch,
`demo.html` — 700 lines / ~34 top-level `<section>`s as fetched) down to the
14 sections most representative of this campaign's target patterns (some
containing nested vertical sub-slides, so the file has 29 total `<section>`
tags). Two patterns absent from `demo.html` itself — math and an explicit
per-list-item incremental fragment — are appended verbatim at the end from
two *other* official files in the same repo (`examples/math.html`,
`examples/markdown.html`), each marked with its own inline source comment.
Cut sections (touch-device blurb, theme-switcher links, markdown-support
blurb, lightbox, tables, quotes, iframe embeds, PDF export, global
state/state-events, "take a moment") were cosmetic/duplicative for this
campaign's target patterns, not because they're unrepresentative of
reveal.js generally.

| # | Section(s) | Pattern | Source |
|---|-----------|---------|--------|
| 1 | Title, Hello There | intro (context only) | `demo.html` |
| 2 | Vertical Slides (nested ×3) | **vertical stacks** | `demo.html` |
| 3 | Auto-Animate: Pretty Code | **code walkthrough** (`data-line-numbers`) | `demo.html` |
| 4 | Auto-Animate: With Animations | **code walkthrough with highlight steps** (`data-line-numbers="\|4,8-11\|17\|22-24"`) | `demo.html` |
| 5 | Auto-Animate boxes (nested ×3, r-hstack/r-stack) | **auto-animate** (`data-auto-animate` + `data-id` matching) | `demo.html` |
| 6 | Fragments (nested ×2) | **fragments** (`class="fragment"` + growth/fade/highlight variants) + **speaker notes** (`<aside class="notes">`) | `demo.html` |
| 7 | Transition Styles | **transitions** (none/fade/slide/convex/concave/zoom) | `demo.html` |
| 8 | Backgrounds (nested ×6) | **backgrounds** (color/gradient/image/tiled/video/gif) | `demo.html` |
| 9 | Background Transitions (zoom) | transitions (background-specific) | `demo.html` |
| 10 | Marvelous List | plain list (contrast case) | `demo.html` |
| 11 | Speaker View | **speaker notes** (`<aside class="notes">`) | `demo.html` |
| 12 | Much more, THE END | closing | `demo.html` |
| 13 | "reveal.js Math Plugin" + "The Lorenz Equations" | **math** (KaTeX/MathJax `\[...\]`) | `examples/math.html` (appended) |
| 14 | "Element attributes" | **incremental lists** (`data-fragment-index` per `<li>`) | `examples/markdown.html` (appended) |

**Not present / no substitute added:** a chart or data-visualization slide.
reveal.js's official repo (demo, examples/, plugin/) ships no chart
component or example anywhere — charts are simply outside reveal.js's own
scope (it's an HTML-slide framework, not a charting library), so nothing was
fabricated for this row; Slidev's "Diagrams" slide (mermaid/plantuml) is the
closer analog across the whole corpus, noted below.

**License:** MIT (`hakimel/reveal.js`, confirmed via GitHub repo metadata).

**Sources fetched:**
- https://raw.githubusercontent.com/hakimel/reveal.js/master/demo.html
- https://raw.githubusercontent.com/hakimel/reveal.js/master/examples/math.html
- https://raw.githubusercontent.com/hakimel/reveal.js/master/examples/markdown.html

## slidev-demo.md

The full, unmodified official Slidev starter deck: `slidevjs/slidev` (main
branch) `demo/starter/slides.md` — confirmed via
`packages/create-app/template/README.md` to be the literal deck scaffolded
by `npm init slidev` / `npm create slidev`, not a documentation sample. 662
lines, 16 `---`-delimited slides, fetched whole (no trimming needed — it
already lands almost exactly on this campaign's ~15-slide target and
already covers most of the breadth list in one deck). One supplementary
section is appended at the end, verbatim, from Slidev's own animations
guide in the same repo (`docs/guide/animations.md`) for the one pattern the
starter deck doesn't demonstrate on its own.

| # | Slide | Pattern | Source |
|---|-------|---------|--------|
| 1 | Welcome to Slidev | intro; frontmatter (`theme`, `background`, `transition: slide-left`) | `demo/starter/slides.md` |
| 2 | What is Slidev? | **transitions** (`transition: fade-out`) | `demo/starter/slides.md` |
| 3 | Navigation | **fragments** (`v-click`, `v-after`), `transition: slide-up` | `demo/starter/slides.md` |
| 4 | Table of contents | layout (`layout: two-cols`) | `demo/starter/slides.md` |
| 5 | Code | **code walkthrough with highlight steps** (`` ```ts [filename-example.ts] {all\|4\|6\|6-7\|9\|all} twoslash ``) | `demo/starter/slides.md` |
| 6 | Shiki Magic Move | **auto-animate** analog (animated transform between successive code snippets) | `demo/starter/slides.md` |
| 7 | Components | Vue component embedding | `demo/starter/slides.md` |
| 8 | Themes | theming | `demo/starter/slides.md` |
| 9 | Clicks Animations | **fragments** (`v-click` modifiers: `.up`, `.fade-in`, `.fade`, `.fade.right.scale`, `.none`; `v-mark`) | `demo/starter/slides.md` |
| 10 | Motions | `v-motion` (not in target list, kept — canonical Slidev animation primitive) | `demo/starter/slides.md` |
| 11 | $\LaTeX$ | **math** (KaTeX, inline + block with step annotation `{1\|3\|all}`) | `demo/starter/slides.md` |
| 12 | Diagrams | **chart/data slide** analog (Mermaid sequence/flowchart/mindmap + PlantUML — closest official match; Slidev has no literal charting component) | `demo/starter/slides.md` |
| 13 | Draggable Elements | `v-drag` (not in target list, kept — deck fidelity) | `demo/starter/slides.md` |
| 14 | Monaco Editor | live code editor (not in target list, kept — deck fidelity) | `demo/starter/slides.md` |
| 15 | Learn More | closing, `layout: center` | `demo/starter/slides.md` |
| 16 | `v-clicks` guide excerpt | **incremental lists** (`<v-clicks>`, `<v-clicks depth="2">`, `<v-clicks every="2">`) | `docs/guide/animations.md` (appended, lines 61–101) |

Every slide in the starter deck also carries its own **speaker notes** via
the trailing HTML-comment convention (`<!-- ... -->` as the last comment
block of a slide) — demonstrated on slides 1, 2, 5, 7 in particular, per
Slidev's own documented convention (stated inline on slide 1).

**Not present / documented gap:** Slidev has no built-in concept of
reveal.js-style nested **vertical slide stacks** (`<section><section>`) —
its decks are a single linear `---`-delimited sequence. This pattern is
covered only by the reveal.js side of this corpus (`reveal-demo.html`,
"Vertical Slides" section). No substitute was fabricated.

**License:** MIT (`slidevjs/slidev`, confirmed via GitHub repo metadata).

**Sources fetched:**
- https://raw.githubusercontent.com/slidevjs/slidev/main/demo/starter/slides.md
- https://raw.githubusercontent.com/slidevjs/slidev/main/docs/guide/animations.md

## Substitution summary

Both decks needed one small supplementary fetch each (not a substitution of
the primary source — an *addition* alongside it) to reach full coverage of
the ten target patterns, since neither single file happens to demonstrate
every pattern on its own:

- **reveal.js** — math (`examples/math.html`) and per-item incremental list
  fragments (`examples/markdown.html`, "Element attributes" section) are
  appended to `reveal-demo.html`, each clearly marked with its own source
  comment; `demo.html` itself has neither.
- **Slidev** — the `<v-clicks>` incremental-list component
  (`docs/guide/animations.md`) is appended to `slidev-demo.md`; the starter
  deck itself only demonstrates the lower-level `v-click` directive on
  individual elements, not the list-shorthand component.

No slide content anywhere in either file was authored or fabricated — every
line is a verbatim byte-for-byte fetch from an official repo, cited above.
The only non-verbatim additions are this README and the HTML/Markdown
*comments* inside each ref file that mark where supplementary sections
begin and cite their source (the comments are new; the content they
introduce is not).
