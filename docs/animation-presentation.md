# Auto-matching · presenter · diagram-as-code

Phase-4 adoption additions.

## Automatic shared-element matching

Author two states; the engine pairs pieces by **identity** and tweens the delta
(unlike `TransformMatchingShapes`, it keys on identity, not position — so a moved
element still matches).

```js
import { TransformMatchingAuto } from "ecmanim";
circle.matchId = "hero"; bigCircle.matchId = "hero";   // explicit id (best)
await scene.play(new TransformMatchingAuto(stateA, stateB));
```

Match priority per piece: `matchId` → `text` → shape signature (type + point
count + size). Unmatched source pieces fade out; unmatched target pieces fade in.

Two more places reuse this same matching engine:

- **`code.diffTo(otherCode)`** — morphs one `Code` snapshot's tokens into
  another's (color changes become `Transform`s, not fade in/out), seeding each
  token's `matchId` from `${text}:${line}:${col}` to disambiguate repeats on
  one line. Known limitation: inserting a line above unchanged content shifts
  every later token's key, so that content fades instead of morphing — the
  same trade-off manim's own `TransformMatchingTex` has.
  ```js
  await scene.play(oldCode.diffTo(newCode));
  ```
- **`scene.autoAnimateToNextSection(name, buildNext, config?)`** — an opt-in
  Reveal.js Auto-Animate-style section transition. `buildNext()` mutates
  `this.mobjects` into the next section's state (moves, additions, removals);
  the method snapshots before/after and plays a `TransformMatchingAuto`
  between them instead of a hard cut, landing back on the true original
  mobjects afterward so identity is preserved for later code.
  ```js
  await scene.autoAnimateToNextSection("act-2", () => {
    circle.moveTo([2, 0, 0]);
    scene.add(new Square({ matchId: "new-thing" }));
  });
  ```
  Strictly opt-in — a plain `nextSection()` call never triggers whole-tree
  matching (matching unrelated same-shape elements by default would be
  surprising).

## Presenter mode + player controls

```js
player.presenterMode = true;          // pause (or loop) at each section boundary
player.setPlaybackRate(1.5);
player.seekToSection("proof");
player.nextSection(); player.prevSection();     // coarse: jump a whole section
player.nextStep(); player.prevStep();           // fine: jump a play()/wait() segment
```

`<manim-player presenter playback-rate="1.5" volume="0.8">` enables keyboard
navigation with two tiers: plain **←/→** step through `playRecords` (one
`play()`/`wait()` segment at a time — finer-grained, independent of section
boundaries); **Shift+←/→** (or **PageUp/PageDown**) jump whole sections;
**space/k** play-pause; **f** fullscreen; **Home** to the start. Sections come
from `nextSection()` (which also accepts an optional 4th `notes` argument for
presenter speaker notes); `SectionType.LOOP` sections loop until you advance.
`Player.drawFrameTo(ctx, frameIndex, opts?)` draws an arbitrary recorded frame
to an arbitrary ctx/position/size — the primitive behind a "next section"
thumbnail preview, and behind `src/studio/timeline.ts`'s
`renderSectionOverview()` (a jump-to-section strip; see
[docs/authoring-studio.md](authoring-studio.md)).

Named camera stops (`MovingCameraScene.defineCameraStop()`/`goToCameraStop()`)
pair naturally with sections — see
[docs/authoring-studio.md](authoring-studio.md#named-camera-stops--sections).

## Resuming playback across a page navigation

`ecmanim/browser` (not the isomorphic core — this needs `sessionStorage` and
`pagehide`/a live player element) can carry a `<manim-player>`'s playback
position across a full page navigation:

```js
import { enablePageTransitionResume } from "ecmanim/browser";

const handle = enablePageTransitionResume(document.querySelector("manim-player"));
// on pagehide: saves { time: player.currentTime } to sessionStorage
// on the new page, once the player's "ready" event fires: seekTime()s back to it
// handle.detach() removes both listeners
```

What survives a navigation is deliberately tiny — just the current time, not
the recorded frames. `Player.record()` still re-runs fresh on the new page as
always; this only restores *where in the timeline* you were.

For visual continuity across the swap (not just resuming position), opt into
a View Transitions snapshot handoff — canvases don't participate in the
browser's DOM-snapshot mechanism directly, so this captures the outgoing
frame into a plain `<img>` (tagged with a shared `view-transition-name`) right
before the page unloads, and tags the incoming canvas with the same name so
the browser can cross-fade/morph between them:

```js
enablePageTransitionResume(playerEl, { viewTransition: true });
```

`savePlaybackPosition(player, opts?)`/`restorePlaybackPosition(player, opts?)`
are the underlying pure functions (no event wiring), if you want to call them
yourself from your own `pagehide`/lifecycle hooks instead.

## Diagram-as-code

```js
import { diagram, parseDiagram, buildBoard, TransformMatchingAuto } from "ecmanim";

const board = diagram(`
  A[Start]
  A --> B
  B -- yes --> C
`); // parse + layered layout + build a board (VGroup of nodes + edges)
scene.add(board);

// Animated board transition: re-layout, then morph via auto-matching.
const ring = buildBoard(parseDiagram("A --> B\nB --> C\nC --> A"), { algorithm: "circular" });
await scene.play(new TransformMatchingAuto(board, ring));
```

DSL: `A`, `A[Label]`, `A --> B`, `A -- label --> B` (blank/`//` lines ignored).
`layoutDiagram` supports `"layered"` (default) and `"circular"`; nodes/edges are
tagged with `matchId` (`node:A`, `edge:A->B`) so transitions pair them
automatically. See `examples/diagram.ts`.

**Layout limitations:** the layered algorithm assigns ranks and orders nodes with
a barycenter heuristic — it reduces but does not minimize edge crossings, and
there is no edge routing (edges are straight lines that may pass through other
nodes on dense graphs). Expect clean output for small diagrams (≲15 nodes);
for publication-grade layout of large graphs, compute positions with a real
engine (e.g. ELK/dagre) and pass them to `buildBoard` yourself.
