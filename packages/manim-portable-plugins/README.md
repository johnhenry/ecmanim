# manim-portable-plugins

Load **portable plugin manifests** into **Python manim**. The exact same JSON
manifest also loads into [ecmanim](../../) via `src/plugins/manifest.ts`, so a
plugin's shareable subset — color palettes, rate functions, parametric surfaces,
and SVG shape libraries — is authored once and runs on both engines.

Manifest format & expression grammar:
[`../plugin-spec/README.md`](../plugin-spec/README.md).

## Install

```bash
pip install manim-portable-plugins
# manim itself is an optional runtime dependency (needed only for load_manifest):
pip install "manim-portable-plugins[manim]"
```

manim discovers this via the `manim.plugins` entry point (`portable`).

## Usage

```python
from manim_portable_plugins import load_manifest

result = load_manifest("cyberpunk.manifest.json")

# colors -> ManimColor constants (also module-level attributes)
neon = result["colors"]["NEON_PINK"]

# rate functions -> callables of t
thump = result["rate_functions"]["thump"]
assert abs(thump(0.5) - 1.0) < 1e-9

# surfaces -> factory callables returning manim.Surface
mobius = result["surfaces"]["MobiusStrip"]()      # a manim.Surface

# shapes -> factory callables returning manim.SVGMobject
star = result["shapes"]["NeonStar"]()             # a manim.SVGMobject
```

`load_manifest` accepts a **file path**, a **JSON string**, or an already-parsed
**dict**. It returns a dict with `name`, `version`, `colors`, `rate_functions`,
`surfaces`, `shapes`, and a `summary` of counts (mirroring the ecmanim loader).
Color constants and surface/shape factories are also set as module-level
attributes, so `from manim_portable_plugins import NEON_PINK, MobiusStrip` works
after loading.

## Safe expression evaluator

`rateFunctions` and `surfaces` use expressions in `t` / `u,v`. They are evaluated
by a hand-written recursive-descent parser — **no `eval`/`exec`** — that mirrors,
token for token, the TypeScript evaluator in `packages/plugin-spec/expr.ts`. The
evaluator uses only the standard library, so it can be imported and tested
without manim:

```python
from manim_portable_plugins import compile_expr
f = compile_expr("0.5 - 0.5*cos(t*2*pi)", ["t"])
f({"t": 0.5})   # -> 1.0
```

Both engines are verified to agree bit-for-bit on a shared set of expressions
(see `test_expr.py`).

## Development / tests

```bash
# Standalone expression-evaluator tests (stdlib only, no manim required):
python3 -m unittest packages/manim-portable-plugins/test_expr.py

# Validate the module parses:
python3 -c "import ast; ast.parse(open('manim_portable_plugins/__init__.py').read())"
```
