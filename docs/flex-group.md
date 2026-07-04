# FlexGroup — opt-in Yoga-backed Flexbox layout

`FlexGroup` lays out its direct children using real Flexbox semantics, powered
by [Yoga](https://www.yogalayout.dev/) (Meta/React's portable WASM Flexbox
engine — also what Vercel's Satori uses). It's an `optionalDependency`
(`yoga-layout`), mirroring `@napi-rs/canvas`/`three`/`harfbuzzjs`'s
graceful-degrade pattern elsewhere in this codebase.

Fully additive: a `Mobject` outside a `FlexGroup` is completely unaffected,
and a child inside one can still pin its own size — Yoga only overrides what
it's actually told to control (e.g. a child's explicit height survives
`alignItems: "stretch"` unless you leave the height unset).

## ⚠️ The one sharp edge: `layout()` is async

Yoga ships as WASM. `FlexGroup` doesn't compute anything until you explicitly
call and `await` `layout()` — nothing happens implicitly on construction, on
`add()`, or on render. Forgetting the `await` (or never calling `layout()` at
all) leaves children exactly where they were before, which usually means
stacked on top of each other at whatever position they were constructed at.

```js
import { FlexGroup, Square } from "ecmanim";

const row = new FlexGroup({
  direction: "row",
  justifyContent: "space-between",
  alignItems: "flex-start",
  width: 10,
  height: 4,
});
row.add(new Square({ sideLength: 2 }), new Square({ sideLength: 2 }), new Square({ sideLength: 2 }));

await row.layout(); // <-- required. Nothing is positioned before this resolves.

this.add(row);
await this.play(new FadeIn(row));
```

Call `layout()` again any time you add/remove children or change
`flexConfig`/`setChildFlex()` — each call builds a fresh Yoga node tree from
the group's *current* children and repositions them; it doesn't retain state
between calls. `isYogaLoaded()` reports whether the WASM has been loaded yet
(true after the first `layout()` call anywhere in the process).

## Container config (`FlexGroupConfig`)

| Field | Type | Notes |
|---|---|---|
| `direction` | `"row" \| "column" \| "row-reverse" \| "column-reverse"` | default `"row"` |
| `justifyContent` | `"flex-start" \| "center" \| "flex-end" \| "space-between" \| "space-around" \| "space-evenly"` | main-axis distribution |
| `alignItems` | `"flex-start" \| "center" \| "flex-end" \| "stretch" \| "baseline"` | cross-axis alignment |
| `gap` | `number` | uniform gap between children |
| `width`, `height` | `number` | container size; defaults to the group's own current bounding box (its children's pre-layout extent) when omitted — give these explicitly whenever `justifyContent`/`gap` needs real leftover space to distribute |

## Per-child config (`setChildFlex`)

```js
group.setChildFlex(someChild, { flexGrow: 1, flexShrink: 0, flexBasis: 3, margin: 0.2 });
```

A child with no `setChildFlex()` entry uses its own current `getWidth()`/
`getHeight()` as a fixed flex-basis (i.e. it neither grows nor shrinks unless
you say so).

### ⚠️ `flexGrow`/`flexShrink` affect layout math, not the child's rendered size

Unlike CSS Flexbox, `layout()` only ever **repositions** children (via
`moveTo()`) to the center of the box Yoga computes for them — it never
resizes a child mobject to actually fill that box. A child with
`flexGrow: 1` is given more space in Yoga's internal model (and other
siblings are positioned accordingly around it), but the child's own
`getWidth()`/`getHeight()` are completely unchanged after `layout()`
returns, so it will NOT visually grow to fill the space the way it would in
a browser. Confirmed directly: a `Square({ sideLength: 2 })` with
`flexGrow: 1` in a 10-wide row (computed box width 8, centered at x=6)
still reports `getWidth() === 2` post-layout. If you want a child to visibly
fill its computed box, resize it yourself after `layout()` (e.g.
`child.scaleToFitWidth(computedWidth)`), or size it explicitly up front via
`flexBasis` and don't rely on `flexGrow` for visual sizing. Tracked as
[issue #23](https://github.com/johnhenry/ecmanim/issues/23).

## Coordinate systems

Yoga computes layout in a top-left-origin, Y-down space (like CSS). This
codebase's world space is Y-up. `layout()` handles the conversion for you —
anchoring the container's top-left corner at the group's own pre-layout
`getCenter()` — so you always just read back ordinary world-space positions
via `child.getCenter()` afterward.
