---
name: ecmanim-presentation
description: Build slide-style/presentation ecmanim scenes — automatic shared-element transforms between two mobject states (TransformMatchingAuto, identity-keyed not position-keyed, plus Scene.autoAnimateToNextSection() and the GSAP-style FLIP helper), presenter/slide controls (Scene.nextSection sections + speaker notes, presenterMode pause-or-loop-at-boundary, playback rate/volume, fragment/step navigation, scroll-binding, <manim-player> keyboard nav and fullscreen), markdown-authored decks (deckFromMarkdown), and diagram-as-code (a tiny hand-rolled DSL, plus a real headless-Mermaid loader). Use this skill when the user wants Keynote/Reveal.js-style "morph" transitions, a presenter-mode video player with section/fragment navigation, a scroll-driven browser scene, a deck authored in markdown, or an animated flowchart/graph from text syntax.
metadata:
  tags: ecmanim, manim, presentation, slides, diagram, transform-matching, player
---

# ecmanim-presentation

Child skill of `ecmanim` (read `../ecmanim/SKILL.md` first for the shared
Plan→Code→Render→Verify→Iterate loop and `checkhealth`-first convention — not
repeated here). This skill covers a family of related but independent
features: auto-matched transforms (originally "Phase 4"), presenter/slide
controls, diagram-as-code, plus later gap-fills layered on the same Player/
section substrate — FLIP transitions and scroll-binding (the GSAP-parity
campaign) and `deckFromMarkdown` (the Reveal.js/Slidev-parity campaign, the
final campaign of the 9-campaign parity roadmap). Full source of truth for
the original Phase-4 trio: [../../docs/animation-presentation.md](../../docs/animation-presentation.md)
— it's short (61 lines) and doesn't cover the later additions; this skill
expands on all of it but does not invent capabilities beyond what's in the
source files cited per section. When in doubt, re-read the doc or the
source rather than assuming manim-Python or Reveal.js parity.

## 1. `TransformMatchingAuto` — shared-element transform

Author two independent mobject states (don't try to mutate one into the
other yourself) and let the engine pair up pieces and tween the deltas:

```js
import { TransformMatchingAuto } from "@johnhenry/ecmanim";

circle.matchId = "hero";
bigCircle.matchId = "hero";   // same id across states = "same element"
await scene.play(new TransformMatchingAuto(stateA, stateB));
```

**Match priority** (`src/animation/auto_matching.ts`, `autoKey()`): explicit
`matchId` (or `autoId`) → `text` (for text mobjects) → a shape signature
(constructor name + total point count across the family + rounded
width/height). This is the key difference from manim's
`TransformMatchingShapes`: matching is **identity-based, not
position-based**, so an element that moved between the two states still
matches and animates to its new place instead of being treated as
unmatched. Pieces with no match: source fades out, target fades in.

`TransformMatchingAuto` extends `AnimationGroup` (it's `introducer: true`,
`remover: true` under the hood) and takes an `AutoMatchingConfig`:
`transformMismatches?`, `fadeTransformMismatches?`, `keyMap?: Record<string,
string>` (override/supply keys directly, e.g. for pieces you can't tag with
`matchId`). Set `matchId` explicitly whenever you can — it's the only match
mode that's unambiguous; text- and shape-signature matching can pair the
wrong pieces on scenes with repeated/similar elements. `diagram()` /
`buildBoard()` (section 3) already do this for you (`node:<id>`,
`edge:<from>-><to>`).

**`Scene.autoAnimateToNextSection(name, buildNext, config?)`** (`src/scene/Scene.ts`)
is Reveal.js Auto-Animate as one call instead of hand-rolling the
snapshot/mutate/`TransformMatchingAuto` dance yourself: it copies the current
mobjects, runs your `buildNext()` callback (which mutates `scene.mobjects`
into the next slide's state however you like — add/remove/restyle), then
`nextSection(name, ...)`s and plays a `TransformMatchingAuto` from the
snapshot to the new state.

```js
await scene.autoAnimateToNextSection("slide-2", () => {
  scene.remove(oldTitle);
  scene.add(newTitle, newBody);
}); // config? defaults to a NORMAL section, whole-tree TransformMatchingAuto
```

`config` is `AutoMatchingConfig & { type?: string, skipAnimations? }` — same
matching knobs as `TransformMatchingAuto` above (`transformMismatches?`,
`fadeTransformMismatches?`, `keyMap?`), since that's what it plays under the
hood, plus `nextSection()`'s own `type`/`skipAnimations`. Note `SectionType`
(the `"section.normal"`-style string constants) is defined in `src/scene/Scene.ts`
but **not** re-exported from the top-level `"ecmanim"` package — pass the raw
string (`"section.loop"`, etc.) or import it from the source path directly if
you need a non-default type. It's strictly opt-in per transition (unlike
plain `nextSection()`, which never triggers whole-tree matching) — call it
only where you actually want a morph cut, not a hard cut.

## 2. Presenter mode + `<manim-player>` controls

These live on the `Player` class (`src/player.ts`) and, in the browser, on
the `<manim-player>` custom element (`src/web-component.ts`) that wraps it.

```js
player.presenterMode = true;          // pause (or loop) at each section boundary
player.setPlaybackRate(1.5);          // clamped to >= 0.05
player.setVolume(0.8);                // clamped to [0,1]
player.seekToSection("proof");        // by name or index
player.nextSection();
player.prevSection();
```

Sections come from `scene.nextSection(name = "unnamed", type = SectionType.NORMAL, skipAnimations = false, notes?: string)`
(`src/scene/Scene.ts`), called during `construct()` at each beat boundary you
want navigable — this is what populates `player.sections()`
(`{ name, type, skipAnimations, startFrame, endFrame, id, notes }`). The
trailing `notes` argument is presenter-mode speaker notes for that section —
pass a string and it rides along on the section record for a presenter UI to
show (nothing in `Player`/`<manim-player>` renders notes on screen itself;
read `sections()[i].notes` and display it yourself). `SectionType`
mirrors manim's `PresentationSectionType`: `NORMAL`, `SKIP`, `LOOP`,
`COMPLETE_LOOP`. When `presenterMode` is on, playback checks
`sectionContaining(currentFrame)` each tick: if the section's `type`
contains `"loop"` it seeks back to the section start and keeps playing
(loop-until-advance); otherwise it seeks to the section's last frame and
pauses there, waiting for `nextSection()`/`prevSection()`/`seekToSection()`.

### Fragment/step navigation (finer-grained than sections)

`Player` also navigates by **step** — every `play()`/`wait()` call recorded
in `scene.playRecords`, independent of section boundaries and needing no
extra authoring — the same substrate `deckFromMarkdown` (section 5) rides to
get per-bullet fragment reveal "for free":

```js
player.steps();               // scene.playRecords, or [] if none
player.stepContaining(frame); // the step spanning a given frame, if any
player.seekToStep(3);         // by 0-based index
player.nextStep();
player.prevStep();
```

Mirrors the section-navigation methods exactly, but `PlayRecord` carries no
name/label by design — a step-nav UI can only show "step 3/17," not a
semantic name, unlike `seekToSection("proof")`.

### Player scroll-binding (browser-only)

`bindScroll(options)` / `bindPlayerToScroll(player, options)` (`src/player.ts`,
GSAP-parity gap-fill) drive playback from page scroll position instead of
real time — a small subset of GSAP ScrollTrigger's scrub/pin core:

```js
import { bindPlayerToScroll } from "@johnhenry/ecmanim"; // isomorphic export; throws if called outside a browser

const binding = bindPlayerToScroll(player, {
  trigger: document.querySelector("#scroll-spacer"),
  start: "top top",      // default; mini-DSL: "<edge> <viewportEdge>" | "+=N"/"-=N" | absolute scrollY
  end: "bottom top",     // default
  pin: true,              // position:fixed the trigger while 0 < progress < 1 (default false)
});
// later: binding.refresh() after a layout change, binding.destroy() to tear down
```

`bindScroll(options)` is the lower-level primitive (`onProgress: (p) => void`
instead of driving a `Player`) if you're scrubbing something other than a
`Player` — e.g. per-layer parallax `translateY` — from the same scroll range;
`computeScrollProgress(input)` is the pure scroll-position-to-progress math
with no DOM access, exported for testing/reuse. Both `bindScroll` and
`bindPlayerToScroll` **throw** (not a silent no-op) if called without a
browser `window`/`document` — guard call sites accordingly in isomorphic
code. Geometry is measured once at bind time and cached (matching real
ScrollTrigger); call `refresh()` after any layout change rather than
expecting it to re-measure on every scroll.

In HTML, the same behavior is attribute-driven:

```html
<manim-player presenter playback-rate="1.5" volume="0.8" controls></manim-player>
```

`presenter`, `playback-rate`, `volume` map straight onto `presenterMode` /
`setPlaybackRate()` / `setVolume()` at connect time. The element also wires
a `keydown` listener (`_onKeyDown` in `src/web-component.ts`) for:

| Key | Action |
|---|---|
| `space` / `k` | play/pause |
| `→` / `PageDown` | `nextSection()` |
| `←` / `PageUp` | `prevSection()` |
| `f` | toggle fullscreen |
| `Home` | seek to frame 0 |

`defineManimPlayer(tag = "manim-player")` registers the element; it no-ops
(returns `false`) in Node/headless environments where `customElements`
doesn't exist, so it's safe to import from isomorphic code — only call it in
browser entry points.

## 3. Diagram-as-code

```js
import { diagram, parseDiagram, buildBoard, TransformMatchingAuto } from "@johnhenry/ecmanim";

const board = diagram(`
  A[Start]
  A --> B
  B -- yes --> C
`);
scene.add(board);

const ring = buildBoard(parseDiagram("A --> B\nB --> C\nC --> A"), { algorithm: "circular" });
await scene.play(new TransformMatchingAuto(board, ring));
```

**DSL** (`src/diagram/diagram.ts`, `parseDiagram`): one statement per line —
`A` (bare node, id doubles as label), `A[Label text]` (node with a label),
`A --> B` (edge), `A -- label --> B` (labeled edge). Node ids are
auto-created on first reference. Blank lines and `//`/`#` comments are
ignored. There is no subgraph/cluster or styling syntax — this is a small,
literal parser, not a Mermaid-compatible one.

**If you actually need real Mermaid syntax** (flowchart/sequence/class/
state/ER/gantt/pie/journey/timeline/mindmap/quadrant/gitGraph — the full
mermaid.js grammar), that's a *separate*, more powerful tool from the
Mermaid-parity campaign, not this DSL: `loadMermaid(source, config?)`
(`src/loaders/mermaid_loader.ts`) headlessly renders real mermaid source
(via the `mermaid` + `jsdom` optional deps — no browser) into a
`DiagramMobject` (an `SVGMobject` subclass) with `byId(id)`, `nodeIds()`,
`edgeIds()`, `labels()`. Pair it with `revealDiagram(diagram, {order?})`
(`src/animation/diagram_reveal.ts` — `"topological" | "source" | "spatial"`
node ordering, edges after their nodes) for a staged reveal, or
`diffDiagrams(oldDiagram, newDiagram, config?)` (`src/animation/diagram_diff.ts`)
to morph one real Mermaid diagram into another by matching friendly ids —
the diagram-diff killer feature the roadmap targeted. This is enough surface
that it deserves its own read of those three files before reaching for it;
treat `diagram()`/`buildBoard()` above as the tool for a graph you're
constructing/laying out programmatically, and `loadMermaid` as the tool for
rendering/animating Mermaid source someone already wrote.

**Layout** (`layoutDiagram`, called internally by `buildBoard`/`diagram`):
`{ algorithm: "layered" | "circular", layerGap?: number, nodeGap?: number }`.
`"layered"` (default) is a deterministic left→right BFS-depth layering with
two barycenter sweeps for crossing reduction — a hand-rolled algorithm, not
elkjs (elkjs is mentioned only in a source comment as a possible *future*
backend; do not tell users it's already wired up). `"circular"` places nodes
evenly around a ring.

**Build** (`buildBoard`): returns a `VGroup` of per-node `VGroup`s
(`RoundedRectangle` + `RasterText` label, so no font file is required) and
`Arrow` edges trimmed to node boundaries. Every node/edge gets a stable
`matchId` (`node:<id>`, `edge:<from>-><to>`), which is exactly what lets
`TransformMatchingAuto` animate one board into a re-laid-out or edited one:
build two boards (different DSL, different `algorithm`, or the same graph
after edits) and `scene.play(new TransformMatchingAuto(boardA, boardB))`.
`BoardOptions` extends `LayoutOptions` with `nodeColor?`, `edgeColor?`,
`textColor?`, `fontSize?` (default `0.32`). See `examples/diagram.ts` for a
worked example.

## 4. FLIP transitions (`flipGetState` / `flipFrom`)

GSAP Flip's First-Last-Invert-Play technique (`src/animation/flip.ts`):
capture state, make an *instant* layout change however you like (move/
resize/reparent mobjects directly, no animation), then play the jump as a
smooth glide. This is a different tool from `TransformMatchingAuto` above —
FLIP animates the SAME mobjects between two of their own states, not two
independent constructed states matched by id:

```js
import { flipGetState, flipFrom } from "@johnhenry/ecmanim";

const state = flipGetState([card1, card2, card3]);  // capture BEFORE the jump
// ...make the instant change: card1.moveTo(newSlot), card2.scale(2), etc.
await scene.play(flipFrom(state, [card1, card2, card3]));
```

`flipFrom` returns a single `Animation` for one target, an `AnimationGroup`
(accepts `lagRatio?`) for several. When a target's point count is unchanged
between capture and play (the common "moved/resized, same shape" case) it
interpolates the exact captured geometry; if the point count changed (the
shape itself was rebuilt, not just moved), it falls back to a rigid
bounding-box-only interpolation instead of truncating points — expect a
correct bbox glide but not exact per-point shape fidelity in that case.

## 5. Markdown-authored decks (`deckFromMarkdown`)

The Reveal.js/Slidev-parity campaign's one new addition: a loader for a
small, generic presentation-markdown dialect (headings, `---` slide
separators, bullet lists, fenced code with Slidev-style `{2,4-6}` line-
highlight-step annotations, `$$...$$` math, speaker notes as a trailing
`<!-- ... -->` comment or `<aside class="notes">`) — **not** a full Reveal.js
or Slidev markdown engine (no Vue components, no UnoCSS, no frontmatter
layout switching; a leading `---`-delimited frontmatter block is skipped,
not parsed).

```js
import { deckFromMarkdown, render } from "@johnhenry/ecmanim/node"; // deckFromMarkdown itself is isomorphic, exported from root "ecmanim" too

const construct = deckFromMarkdown(markdownSource, {
  autoAnimate: true,       // Scene.autoAnimateToNextSection() between slides instead of a hard cut (default false)
  holdTime: 0.5,            // seconds after a slide finishes revealing, before advancing (default)
  fragmentRunTime: 0.4,     // per-bullet reveal duration (default)
});
await render(construct, { output: "deck.mp4" });
```

`deckFromMarkdown(md, config?)` returns a plain `(scene) => Promise<void>`
construct function — the same bare-construct-function shape `render()`
already accepts alongside a `Scene` subclass. Under the hood: each heading
becomes a
`scene.nextSection(heading, ..., notes)` call (speaker notes come along for
free per section 2 above), each bullet is its own `play()` (one fragment
step, navigable via `Player.nextStep()`/`prevStep()` — section 2 again, no
extra API needed), fenced code becomes a `Code` mobject stepped through its
highlight ranges via `code.selection(lines(...))`, and `$$...$$` becomes
`MathTex` — **you must `await initMathTex()` yourself first** if any slide
has math, same requirement as every other MathTex-using scene. `parseDeckMarkdown(md)`
is the pure parser half (`DeckSlide[]`) if you want to inspect or hand-edit
slides before building.

## Gotchas

- **Layout is not publication-grade.** The layered algorithm *reduces*, not
  *minimizes*, edge crossings, and there is no edge routing — edges are
  straight lines that can pass through unrelated nodes on dense graphs.
  Expect clean results only for small diagrams (≲15 nodes). For larger or
  presentation-critical graphs, compute positions yourself (e.g. with a real
  ELK/dagre integration) and pass them to `buildBoard` rather than trusting
  the built-in layout.
- **Auto-matching is a heuristic, not magic.** Without an explicit `matchId`,
  matching falls back to text or a coarse shape signature; scenes with
  several visually-similar, unlabeled pieces can mismatch silently (wrong
  element morphs into wrong element) rather than erroring. Always render a
  still of both states and check the transform visually before trusting it,
  per the root skill's Verify step.
- **`<manim-player>` is browser-only.** `defineManimPlayer()` is a safe no-op
  under Node, but there's no server-side equivalent of the keyboard-nav
  behavior — presenter navigation via keys only exists once the custom
  element is actually connected in a DOM.
- **`bindScroll`/`bindPlayerToScroll` are browser-only too, and throw rather
  than no-op** without `window`/`document` — don't call them from isomorphic
  construct() code without a capability guard.
- **`deckFromMarkdown` is a generic dialect, not a Slidev/Reveal.js
  converter.** It intentionally doesn't parse real Slidev decks (Vue
  components, UnoCSS, frontmatter layouts) — hand-adapt those onto the
  dialect or straight onto the Scene API instead of expecting a literal
  drop-in conversion.
- **`autoAnimateToNextSection`/`deckFromMarkdown({autoAnimate: true})` are
  strictly opt-in**, same stance as plain `nextSection()` — matching
  unrelated same-shape elements across a hard cut by default would be
  surprising, so nothing triggers whole-tree auto-matching unless you ask
  for it.
