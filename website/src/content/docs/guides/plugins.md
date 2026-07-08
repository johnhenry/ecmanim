---
title: "Plugins"
---

ecmanim is extensible three ways, each aimed at a different portability level:

1. **Native plugins** — full JavaScript/TypeScript power via `use({ install })`:
   register custom mobjects, animations, rate functions, colors, and scenes.
2. **Portable manifests** — a language-neutral JSON file (`loadManifest`) whose
   colors / rate functions / surfaces / SVG shapes load into **both** ecmanim
   and **Python manim**.
3. **The shared WASM math core** — a Rust→WASM module callable from JS *and*
   Python, verified byte-identical across the two.

All three share the singleton `Registry` (`src/plugins/registry.ts`); the CLI's
`ecmanim plugins` subcommand lists everything currently registered.

---

## 1. Native plugins (`use`)

A plugin is any object with an `install(api)` method (or a bare
`(api) => {…}` function). `use(plugin)` runs it against the shared registry.
`api` is the `Registry`; `api.bases` exposes the base classes (`Mobject`,
`VMobject`, `VGroup`, `Animation`, `Scene`, `Color`) so you can extend without
deep imports.

### Registry API

```ts
interface Plugin { name?: string; version?: string; install(api: Registry): void; }

api.registerMobject(name, Class)       // a Mobject/VMobject subclass
api.registerAnimation(name, Class)     // an Animation subclass
api.registerRateFunction(name, fn)     // (t: number) => number
api.registerColor(name, hex)           // "#rrggbb" / "#rrggbbaa"
api.registerScene(name, Class)         // a Scene subclass
api.registerRenderer(name, factory)    // a renderer factory

api.bases        // { Mobject, VMobject, VGroup, Animation, Scene, Color }
api.get(kind, name) / api.has(kind, name) / api.list(kind)
```

`use()` is chainable and records the plugin in `registry.plugins`. Registering an
existing name overrides the built-in of that name.

### Worked example — `examples/plugins/heart-plugin.ts`

The shipped example registers a `Heart` VMobject, a `Heartbeat` animation, a
`thump` rate function, and a `brandPink` color:

```ts
import type { Plugin, Registry } from "ecmanim";   // (or ../../src/plugins/registry.ts)

const heartPlugin: Plugin = {
  name: "ecmanim-heart",
  version: "1.0.0",
  install(api: Registry) {
    const { VMobject, Animation } = api.bases;

    class Heart extends VMobject {
      constructor(config: any = {}) {
        super({ fillColor: "#D147BD", fillOpacity: 1, ...config });
        const pts: number[][] = [];
        for (let i = 0; i <= 64; i++) {
          const t = (i / 64) * Math.PI * 2;
          const x = 16 * Math.sin(t) ** 3;
          const y = 13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t);
          pts.push([x / 16, y / 16, 0]);
        }
        this.setPointsAsCorners(pts);
      }
    }

    class Heartbeat extends Animation {
      interpolateMobject(alpha: number) {
        const s = 1 + 0.15 * Math.abs(Math.sin(alpha * Math.PI * 2));
        const start = (this as any).startState, c = start.getCenter();
        for (let i = 0; i < this.mobject.points.length; i++) {
          const p = start.points[i];
          this.mobject.points[i] = [c[0] + (p[0]-c[0])*s, c[1] + (p[1]-c[1])*s, p[2]];
        }
      }
    }

    api.registerMobject("Heart", Heart);
    api.registerAnimation("Heartbeat", Heartbeat);
    api.registerRateFunction("thump", (t) => 0.5 - 0.5 * Math.cos(t * Math.PI * 2));
    api.registerColor("brandPink", "#D147BD");
  },
};

export default heartPlugin;
```

Use it:

```ts
import { use, registry, Scene, Create } from "ecmanim";
import heartPlugin from "./examples/plugins/heart-plugin.ts";

use(heartPlugin);

const Heart = registry.get("mobject", "Heart");
const Heartbeat = registry.get("animation", "Heartbeat");

class Demo extends Scene {
  async construct() {
    const h = new Heart();
    await this.play(new Create(h));
    await this.play(new Heartbeat(h, { rateFunc: registry.get("rateFunction", "thump") }));
  }
}
```

Native plugins run identically in Node and the unbundled browser — there is no
filesystem discovery, just `use()`.

### Config-file plugins (Node)

A `manim.config.{js,mjs}` may export `{ config, plugins }`; the loader merges
`config` into the layered settings. Import and `use()` your plugins alongside it
(or from the config module) so they are registered before rendering.

---

## 2. Portable manifests (`loadManifest`)

A **manifest** is the language-neutral, shareable subset of a plugin: a plain
JSON object with four declarative categories. The *same* file loads into
ecmanim (`src/plugins/manifest.ts`) and Python manim
(`packages/manim-portable-plugins`), so a plugin's portable subset is authored
once and runs on both engines. Nothing in a manifest executes arbitrary code —
expressions are parsed by a safe recursive-descent evaluator (no `eval`).

The full spec (JSON Schema + grammar) lives in
[`packages/plugin-spec/README.md`](https://github.com/johnhenry/ecmanim/blob/main/packages/plugin-spec/README.md).

### Shape

```jsonc
{
  "name": "cyberpunk",          // required
  "version": "1.0.0",           // required
  "description": "…",           // optional
  "colors":        { NAME: "#hex", … },
  "rateFunctions": { NAME: "expr in t", … },
  "surfaces":      { NAME: { x, y, z: "expr in u,v", uRange, vRange, resolution?, fillColor? }, … },
  "shapes":        { NAME: "<svg>…</svg>", … }
}
```

- **`colors`** → `registry.registerColor` (ecmanim) / `ManimColor` constants (Python).
- **`rateFunctions`** → compiled `(t) => number`; expression in the single var `t`.
- **`surfaces`** → a `Surface` subclass (ecmanim) / a `manim.Surface` factory
  (Python); `x`/`y`/`z` are expressions in `u`,`v`.
- **`shapes`** → an `SVGMobject` subclass (ecmanim) / `manim.SVGMobject` factory
  (Python) from a complete SVG document string.

### Expression grammar

Used by `rateFunctions` (`t`) and `surfaces` (`u`,`v`). Supports `+ - * / ^`
(`^` right-associative), unary minus, parentheses; constants `pi`, `e`, `tau`;
functions `sin cos tan asin acos atan exp log sqrt abs floor ceil pow` and
variadic `min`/`max`. Any undeclared name, unknown function, or wrong arity is a
**parse error** on both engines. Reference evaluators:
`src/plugins/expr.ts` (TS, re-exported by `packages/plugin-spec/expr.ts`) and
`manim_portable_plugins.compile_expr` (Python) — verified to agree bit-for-bit.

### Loading in ecmanim — `examples/plugins/cyberpunk.manifest.json`

```ts
import { loadManifest, loadManifestFromFile, registry } from "ecmanim";
import cyberpunk from "./examples/plugins/cyberpunk.manifest.json" with { type: "json" };

const summary = loadManifest(cyberpunk);
// { name: "cyberpunk", version: "1.0.0", colors: 4, rateFunctions: 2, surfaces: 2, shapes: 1 }

// Node-only convenience: read + load from disk.
await loadManifestFromFile("./examples/plugins/cyberpunk.manifest.json");

const MobiusStrip = registry.get("mobject", "MobiusStrip");   // extends Surface
const NeonStar    = registry.get("mobject", "NeonStar");      // extends SVGMobject
const neonPink    = registry.get("color", "NEON_PINK");       // "#ff2d95"
const thump       = registry.get("rateFunction", "thump");
```

The `cyberpunk` example ships a neon palette, a `thump` / `overshoot` rate
function, a `MobiusStrip` and `NeonTorus` parametric surface, and a `NeonStar`
SVG shape.

### Loading the same file in Python manim

```python
from manim_portable_plugins import load_manifest
result = load_manifest("cyberpunk.manifest.json")   # path, JSON string, or dict

neon   = result["colors"]["NEON_PINK"]       # a ManimColor
thump  = result["rate_functions"]["thump"]   # callable(t) -> float
mobius = result["surfaces"]["MobiusStrip"]() # a manim.Surface
star   = result["shapes"]["NeonStar"]()      # a manim.SVGMobject
```

Install with `pip install "manim-portable-plugins[manim]"` (manim itself is an
optional runtime dependency — only needed for `load_manifest`; the expression
evaluator works stdlib-only). manim discovers the adapter via the `manim.plugins`
entry point `portable`.

---

## 3. The shared WASM math core

`packages/manim-wasm/` holds a Rust `lib.rs` compiled to `manim_core.wasm`
(via `build.sh`) exposing a small hot-path math kernel: cubic-Bézier eval,
Bézier splitting, polygon ear-clipping, and 3×3 matrix×vector. The **same bytes**
are consumed from JavaScript and Python, so both engines compute identically.

### From JavaScript

```ts
import { loadWasm, isWasmLoaded, bezierEvalWasm, earclipWasm, mat3VecWasm } from "ecmanim";

const ok = await loadWasm();        // Node reads the .wasm via fs, browser via fetch
if (isWasmLoaded()) {
  bezierEvalWasm(p0, c1, c2, p3, 0.5);   // -> [x,y,z]
  earclipWasm(polygonPoints);            // -> flat index triples
  mat3VecWasm(m9, v3);                   // -> [x,y,z]
}
```

Loading is optional and lazy: `loadWasm()` also wires the accelerator into the
pure-JS core (used by triangulation). If the `.wasm` is missing, `isWasmLoaded()`
stays `false` and everything falls back to the pure-JS implementations — nothing
breaks.

### From Python (`wasmtime`)

```python
from python_loader import ManimCore   # packages/manim-wasm/python_loader.py
core = ManimCore()                     # loads manim_core.wasm via wasmtime
core.bezier_eval(p0, c1, c2, p3, 0.5)  # -> [x, y, z]
core.mat3_vec(m9, v3)                  # -> [x, y, z]
core.earclip(points)                   # -> [i, j, k, …]
```

Requires `pip install wasmtime`. The two loaders exercise the same exported
functions (`bezier_eval`, `split_bezier`, `mat3_vec`, `earclip`, plus the shared
`buffer_ptr`/`ibuffer_ptr`/`buffer_len` scratch buffers) and are verified
byte-identical.

---

## Which extension should I use?

| Need | Use |
|------|-----|
| Custom imperative animation, updater logic, or a bespoke mobject class | Native `use()` plugin (§1) |
| A color palette / easing curve / parametric surface / SVG shape that should also work in Python manim | Portable manifest (§2) |
| A performance-critical numeric kernel shared across languages | The WASM core (§3) |

Native plugins are the most powerful but JS-only; manifests are the most
portable but declarative-only; the WASM core is the shared numeric substrate
under both.
