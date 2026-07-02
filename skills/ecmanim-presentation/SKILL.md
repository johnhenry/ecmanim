---
name: ecmanim-presentation
description: Build slide-style/presentation ecmanim scenes — automatic shared-element transforms between two mobject states (TransformMatchingAuto, identity-keyed not position-keyed), presenter/slide controls (Scene.nextSection sections, presenterMode pause-or-loop-at-boundary, playback rate/volume, <manim-player> keyboard nav and fullscreen), and diagram-as-code (a tiny Mermaid/D2-ish DSL parsed + laid out into a VGroup board, animated between layouts via TransformMatchingAuto). Use this skill when the user wants Keynote/Reveal.js-style "morph" transitions, a presenter-mode video player with section navigation, or an animated flowchart/graph from text syntax.
metadata:
  tags: ecmanim, manim, presentation, slides, diagram, transform-matching, player
---

# ecmanim-presentation

Child skill of `ecmanim` (read `../ecmanim/SKILL.md` first for the shared
Plan→Code→Render→Verify→Iterate loop and `checkhealth`-first convention — not
repeated here). This skill covers three related but independent features, all
introduced together as "Phase 4": auto-matched transforms, presenter/slide
controls, and diagram-as-code. Full source of truth:
[../../docs/animation-presentation.md](../../docs/animation-presentation.md)
— it's short (61 lines); this skill expands on it but does not invent
capabilities beyond it. When in doubt, re-read that doc or the source files
below rather than assuming manim-Python or Reveal.js parity.

## 1. `TransformMatchingAuto` — shared-element transform

Author two independent mobject states (don't try to mutate one into the
other yourself) and let the engine pair up pieces and tween the deltas:

```js
import { TransformMatchingAuto } from "ecmanim";

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

Sections come from `scene.nextSection(name = "unnamed", type = SectionType.NORMAL, skipAnimations = false)`
(`src/scene/Scene.ts`), called during `construct()` at each beat boundary you
want navigable — this is what populates `player.sections()`
(`{ name, type, skipAnimations, startFrame, endFrame, id }`). `SectionType`
mirrors manim's `PresentationSectionType`: `NORMAL`, `SKIP`, `LOOP`,
`COMPLETE_LOOP`. When `presenterMode` is on, playback checks
`sectionContaining(currentFrame)` each tick: if the section's `type`
contains `"loop"` it seeks back to the section start and keeps playing
(loop-until-advance); otherwise it seeks to the section's last frame and
pauses there, waiting for `nextSection()`/`prevSection()`/`seekToSection()`.

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
import { diagram, parseDiagram, buildBoard, TransformMatchingAuto } from "ecmanim";

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
