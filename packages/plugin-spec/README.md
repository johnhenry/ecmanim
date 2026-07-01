# Manim Portable Plugin Manifest

A **portable, language-neutral** description of the *shareable* subset of a manim
plugin. The same JSON manifest is loaded by:

- **manim-js** (TypeScript) via `src/plugins/manifest.ts` → `loadManifest()`
- **Python manim** via `packages/manim-portable-plugins` → `load_manifest()`

so a plugin authored once runs on both engines. Anything engine-specific
(imperative animations, custom renderers, DOM access, Python/JS code) stays out
of the manifest — only the four declarative, cross-language categories below are
portable.

Schema: [`manifest.schema.json`](./manifest.schema.json) (JSON Schema draft-07).

## Top-level shape

```jsonc
{
  "name": "cyberpunk",          // required
  "version": "1.0.0",           // required
  "description": "…",           // optional
  "colors":        { … },       // optional
  "rateFunctions": { … },       // optional
  "surfaces":      { … },       // optional
  "shapes":        { … }        // optional
}
```

### `colors` — named color palette

```json
"colors": {
  "NEON_PINK": "#ff2d95",
  "NEON_CYAN": "#0ff0fc"
}
```

Each value is a hex string: `#rgb`, `#rgba`, `#rrggbb`, or `#rrggbbaa`.

- **manim-js**: `registry.registerColor(name, hex)`; resolvable via `Color.parse(name)`.
- **Python**: a module-level `manim.ManimColor` constant (and returned in a dict).

### `rateFunctions` — easing curves as expressions

```json
"rateFunctions": {
  "thump": "0.5 - 0.5*cos(t*2*pi)"
}
```

Each value is an **expression in the single variable `t`** (conventionally
`0..1`). Compiled to `(t) => number` / `callable(t) -> float`.

- **manim-js**: `registry.registerRateFunction(name, fn)`.
- **Python**: entry in the returned `rate_functions` dict.

### `surfaces` — parametric surfaces as expressions

```json
"surfaces": {
  "MobiusStrip": {
    "x": "(1 + (v/2)*cos(u/2))*cos(u)",
    "y": "(1 + (v/2)*cos(u/2))*sin(u)",
    "z": "(v/2)*sin(u/2)",
    "uRange": [0, 6.283185307179586],
    "vRange": [-1, 1],
    "resolution": [48, 8],
    "fillColor": "NEON_CYAN"
  }
}
```

`x`, `y`, `z` are **expressions in `u` and `v`** giving the 3D point.
`resolution` and `fillColor` are optional; `fillColor` may name a color from
this manifest's `colors` or be a hex string.

- **manim-js**: registered as a mobject class extending `Surface`; `new MobiusStrip()`.
- **Python**: a factory `MobiusStrip(**overrides)` → `manim.Surface(func, u_range, v_range, …)`.

### `shapes` — SVG shape library

```json
"shapes": {
  "NeonStar": "<svg viewBox=\"0 0 100 100\">…</svg>"
}
```

Each value is a complete **SVG document string**.

- **manim-js**: registered as a mobject class extending `SVGMobject`; `new NeonStar()`.
- **Python**: a factory `NeonStar(**kwargs)` → `manim.SVGMobject` (the string is
  written to a temp file, since Python manim's `SVGMobject` reads a path).

## Portable expression grammar

The expression language used by `rateFunctions` and `surfaces` is small and
identical on both engines. It is evaluated by a hand-written **recursive-descent
parser** — **never** `eval` / `new Function` / Python `eval` — so a manifest can
never execute arbitrary code. Reference implementations:

- TypeScript: [`expr.ts`](./expr.ts) → `src/plugins/expr.ts`
- Python: `manim_portable_plugins.compile_expr`

### Grammar (EBNF, lowest precedence first)

```
expr    := term  (('+' | '-') term)*
term    := unary (('*' | '/') unary)*
unary   := ('-' | '+') unary | power
power   := atom ('^' unary)?          // right-associative
atom    := number
         | name                        // variable or constant
         | name '(' args ')'           // function call
         | '(' expr ')'
args    := expr (',' expr)*
```

### Tokens

- **Numbers**: `12`, `3.14`, `.5`, `1e3`, `2.5e-4`.
- **Names**: `[A-Za-z_][A-Za-z0-9_]*` — a declared variable, a constant, or a
  function name.
- **Operators**: `+ - * / ^`, parentheses, comma.

### Semantics

| Feature        | Detail                                                              |
|----------------|---------------------------------------------------------------------|
| Variables      | `t` for rate functions; `u`, `v` for surfaces.                      |
| Constants      | `pi`, `e`, `tau` (= 2·pi).                                          |
| Unary minus    | `-x`; binds *looser* than `^`, so `-2^2 == -4`.                    |
| `^`            | Exponentiation, **right-associative**: `2^3^2 == 512`.             |
| `/`            | Floating-point division.                                           |
| Functions      | `sin cos tan asin acos atan exp log sqrt abs floor ceil pow` (fixed arity) and `min max` (variadic, ≥1 arg). |

Referencing an undeclared name, an unknown function, or a wrong argument count
is a **parse error** on both engines — malformed or malicious manifests fail
fast rather than doing anything unsafe.

### Example equivalences (verified JS == Python)

| Expression                       | Value           |
|----------------------------------|-----------------|
| `2*t+1` with `t=3`               | `7`             |
| `sin(pi/2)`                      | `1`             |
| `0.5 - 0.5*cos(t*2*pi)` at `t=0.5` | `1`           |
| `2^3^2`                          | `512`           |
| `-2^2`                           | `-4`            |
| `max(1,2,3)`                     | `3`             |
