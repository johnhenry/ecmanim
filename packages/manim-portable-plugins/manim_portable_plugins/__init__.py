"""Load a portable plugin MANIFEST into Python manim.

This is the Python adapter for the language-neutral plugin manifest format
described in ``packages/plugin-spec/manifest.schema.json``. The SAME manifest is
loaded into manim-js (TypeScript) by ``src/plugins/manifest.ts``; this module is
its mirror so a plugin authored once runs on both engines.

The manifest's shareable subset:

* ``colors``        -> module-level ``manim.ManimColor`` constants (also returned)
* ``rateFunctions`` -> ``callable(t) -> float`` compiled from expressions in ``t``
* ``surfaces``      -> ``manim.Surface`` built from expressions in ``u``, ``v``
* ``shapes``        -> ``manim.SVGMobject`` built from an inline SVG string

Nothing here uses Python's ``eval``/``exec``: expressions are parsed by a
hand-written recursive-descent parser (``compile_expr``) that mirrors, token for
token, the TypeScript evaluator in ``packages/plugin-spec/expr.ts``. ``manim`` is
imported lazily so the expression evaluator can be imported and unit-tested with
the standard library alone (no manim install required).

Stdlib only; ``manim`` is a runtime dependency, imported on demand.
"""

from __future__ import annotations

import json
import math
import sys
from typing import Any, Callable, Dict, List, Optional, Union

__all__ = [
    "compile_expr",
    "eval_expr",
    "load_manifest",
    "ExprError",
]


# ===========================================================================
# Safe expression evaluator — a faithful port of packages/plugin-spec/expr.ts.
# ===========================================================================

class ExprError(ValueError):
    """Raised for any malformed or disallowed expression."""


_CONSTANTS: Dict[str, float] = {
    "pi": math.pi,
    "e": math.e,
    "tau": math.tau,
}

# name -> (arity or "variadic", function taking a list of floats)
_FUNCTIONS: Dict[str, Any] = {
    "sin": (1, lambda a: math.sin(a[0])),
    "cos": (1, lambda a: math.cos(a[0])),
    "tan": (1, lambda a: math.tan(a[0])),
    "asin": (1, lambda a: math.asin(a[0])),
    "acos": (1, lambda a: math.acos(a[0])),
    "atan": (1, lambda a: math.atan(a[0])),
    "exp": (1, lambda a: math.exp(a[0])),
    "log": (1, lambda a: math.log(a[0])),
    "sqrt": (1, lambda a: math.sqrt(a[0])),
    "abs": (1, lambda a: abs(a[0])),
    "floor": (1, lambda a: float(math.floor(a[0]))),
    "ceil": (1, lambda a: float(math.ceil(a[0]))),
    "pow": (2, lambda a: math.pow(a[0], a[1])),
    "min": ("variadic", lambda a: min(a)),
    "max": ("variadic", lambda a: max(a)),
}


# --- tokenizer -------------------------------------------------------------

# A token is a tuple (kind, value, pos). kinds: num, name, op, lparen, rparen,
# comma, eof.
def _tokenize(src: str) -> List[tuple]:
    toks: List[tuple] = []
    i = 0
    n = len(src)

    def is_digit(c: str) -> bool:
        return "0" <= c <= "9"

    def is_name_start(c: str) -> bool:
        return c.isalpha() or c == "_"

    def is_name_part(c: str) -> bool:
        return c.isalnum() or c == "_"

    while i < n:
        c = src[i]
        if c in " \t\n\r":
            i += 1
            continue
        if is_digit(c) or (c == "." and i + 1 < n and is_digit(src[i + 1])):
            j = i
            while j < n and (is_digit(src[j]) or src[j] == "."):
                j += 1
            # optional exponent: 1e3, 2.5e-4
            if j < n and src[j] in "eE":
                k = j + 1
                if k < n and src[k] in "+-":
                    k += 1
                if k < n and is_digit(src[k]):
                    while k < n and is_digit(src[k]):
                        k += 1
                    j = k
            toks.append(("num", src[i:j], i))
            i = j
            continue
        if is_name_start(c):
            j = i
            while j < n and is_name_part(src[j]):
                j += 1
            toks.append(("name", src[i:j], i))
            i = j
            continue
        if c == "(":
            toks.append(("lparen", c, i))
            i += 1
            continue
        if c == ")":
            toks.append(("rparen", c, i))
            i += 1
            continue
        if c == ",":
            toks.append(("comma", c, i))
            i += 1
            continue
        if c in "+-*/^":
            toks.append(("op", c, i))
            i += 1
            continue
        raise ExprError(f"expr: unexpected character {c!r} at {i} in {src!r}")
    toks.append(("eof", "", n))
    return toks


# --- AST node forms (as tuples): ------------------------------------------
#   ("num", value)
#   ("var", name)
#   ("const", value)
#   ("neg", child)
#   ("bin", op, left, right)
#   ("call", name, [args])


class _Parser:
    def __init__(self, toks: List[tuple], src: str, var_names: List[str]):
        self.toks = toks
        self.i = 0
        self.src = src
        self.var_set = set(var_names)

    def peek(self) -> tuple:
        return self.toks[self.i]

    def next(self) -> tuple:
        t = self.toks[self.i]
        self.i += 1
        return t

    def err(self, msg: str):
        raise ExprError(f"expr: {msg} in {self.src!r}")

    def parse(self):
        node = self.parse_expr()
        if self.peek()[0] != "eof":
            self.err(f"unexpected {self.peek()[1]!r}")
        return node

    # expr := term (('+' | '-') term)*
    def parse_expr(self):
        node = self.parse_term()
        while self.peek()[0] == "op" and self.peek()[1] in ("+", "-"):
            op = self.next()[1]
            rhs = self.parse_term()
            node = ("bin", op, node, rhs)
        return node

    # term := unary (('*' | '/') unary)*
    def parse_term(self):
        node = self.parse_unary()
        while self.peek()[0] == "op" and self.peek()[1] in ("*", "/"):
            op = self.next()[1]
            rhs = self.parse_unary()
            node = ("bin", op, node, rhs)
        return node

    # unary := ('-' | '+') unary | power
    def parse_unary(self):
        if self.peek()[0] == "op" and self.peek()[1] in ("-", "+"):
            op = self.next()[1]
            operand = self.parse_unary()
            return ("neg", operand) if op == "-" else operand
        return self.parse_power()

    # power := atom ('^' unary)?   (right-associative)
    def parse_power(self):
        base = self.parse_atom()
        if self.peek()[0] == "op" and self.peek()[1] == "^":
            self.next()
            exp = self.parse_unary()
            return ("bin", "^", base, exp)
        return base

    # atom := number | name | name '(' args ')' | '(' expr ')'
    def parse_atom(self):
        t = self.peek()
        kind, value, _ = t
        if kind == "num":
            self.next()
            try:
                v = float(value)
            except ValueError:
                self.err(f"bad number {value!r}")
            return ("num", v)
        if kind == "lparen":
            self.next()
            inner = self.parse_expr()
            if self.peek()[0] != "rparen":
                self.err("expected ')'")
            self.next()
            return inner
        if kind == "name":
            self.next()
            name = value
            # function call?
            if self.peek()[0] == "lparen":
                self.next()
                args = []
                if self.peek()[0] != "rparen":
                    args.append(self.parse_expr())
                    while self.peek()[0] == "comma":
                        self.next()
                        args.append(self.parse_expr())
                if self.peek()[0] != "rparen":
                    self.err("expected ')'")
                self.next()
                spec = _FUNCTIONS.get(name)
                if spec is None:
                    self.err(f"unknown function {name!r}")
                arity = spec[0]
                if arity != "variadic" and len(args) != arity:
                    self.err(
                        f"function {name!r} expects {arity} argument(s), got {len(args)}"
                    )
                if arity == "variadic" and len(args) < 1:
                    self.err(f"function {name!r} expects at least 1 argument")
                return ("call", name, args)
            # constant or variable
            if name in _CONSTANTS:
                return ("const", _CONSTANTS[name])
            if name in self.var_set:
                return ("var", name)
            self.err(f"unknown name {name!r} (not a declared variable or constant)")
        self.err(f"unexpected {value or 'end of input'!r}")


def _eval_node(node: tuple, scope: Dict[str, float]) -> float:
    kind = node[0]
    if kind == "num" or kind == "const":
        return node[1]
    if kind == "var":
        v = scope.get(node[1])
        return float(v) if isinstance(v, (int, float)) else 0.0
    if kind == "neg":
        return -_eval_node(node[1], scope)
    if kind == "bin":
        _, op, a_node, b_node = node
        a = _eval_node(a_node, scope)
        b = _eval_node(b_node, scope)
        if op == "+":
            return a + b
        if op == "-":
            return a - b
        if op == "*":
            return a * b
        if op == "/":
            return a / b
        if op == "^":
            return math.pow(a, b)
        return float("nan")
    if kind == "call":
        _, name, arg_nodes = node
        args = [_eval_node(a, scope) for a in arg_nodes]
        return _FUNCTIONS[name][1](args)
    raise ExprError(f"expr: bad node {node!r}")


def compile_expr(src: str, var_names: Optional[List[str]] = None) -> Callable[..., float]:
    """Compile an expression string into ``callable(scope: dict) -> float``.

    Mirrors ``compileExpr`` in ``packages/plugin-spec/expr.ts``.
    """
    var_names = list(var_names or [])
    ast = _Parser(_tokenize(src), src, var_names).parse()

    def evaluator(scope: Optional[Dict[str, float]] = None) -> float:
        return _eval_node(ast, scope or {})

    return evaluator


def eval_expr(
    src: str,
    scope: Optional[Dict[str, float]] = None,
    var_names: Optional[List[str]] = None,
) -> float:
    """Parse + evaluate an expression once (used mostly in tests)."""
    return compile_expr(src, var_names)(scope or {})


# ===========================================================================
# Manifest loader (requires manim at call time).
# ===========================================================================

def _load_json(path_or_dict: Union[str, Dict[str, Any]]) -> Dict[str, Any]:
    if isinstance(path_or_dict, dict):
        return path_or_dict
    if isinstance(path_or_dict, str):
        stripped = path_or_dict.lstrip()
        # A JSON document string vs a filesystem path.
        if stripped.startswith("{"):
            return json.loads(path_or_dict)
        with open(path_or_dict, "r", encoding="utf-8") as fh:
            return json.load(fh)
    raise TypeError("load_manifest: expected a path, JSON string, or dict")


def load_manifest(
    path_or_dict: Union[str, Dict[str, Any]],
    register_module: Optional[str] = None,
) -> Dict[str, Any]:
    """Load a manifest into Python manim.

    Parameters
    ----------
    path_or_dict:
        A filesystem path, a JSON document string, or an already-parsed dict.
    register_module:
        Optional module name (default: this module). Color constants and surface
        / shape classes are set as module-level attributes there so they can be
        imported like ``from manim_portable_plugins import NEON_PINK``.

    Returns
    -------
    dict with keys ``name``, ``version``, ``colors`` (dict of ManimColor),
    ``rate_functions`` (dict of callables), ``surfaces`` (dict of factory
    callables), ``shapes`` (dict of factory callables), and a ``summary`` dict of
    counts — mirroring the TypeScript loader's return.
    """
    import manim  # runtime dependency

    data = _load_json(path_or_dict)
    if not isinstance(data, dict) or "name" not in data or "version" not in data:
        raise ValueError("manifest: missing required `name` / `version`")

    mod = sys.modules[register_module] if register_module else sys.modules[__name__]

    colors: Dict[str, Any] = {}
    for name, hexval in (data.get("colors") or {}).items():
        color = manim.ManimColor(hexval)
        colors[name] = color
        setattr(mod, name, color)  # module-level constant

    def _resolve_color(value: Optional[str]):
        if value is None:
            return None
        if value in colors:
            return colors[value]
        return manim.ManimColor(value)

    rate_functions: Dict[str, Callable[[float], float]] = {}
    for name, expr_src in (data.get("rateFunctions") or {}).items():
        compiled = compile_expr(expr_src, ["t"])
        rate_functions[name] = (lambda c: (lambda t: c({"t": t})))(compiled)

    surfaces: Dict[str, Callable[..., Any]] = {}
    for name, spec in (data.get("surfaces") or {}).items():
        fx = compile_expr(spec["x"], ["u", "v"])
        fy = compile_expr(spec["y"], ["u", "v"])
        fz = compile_expr(spec["z"], ["u", "v"])
        u_range = tuple(spec["uRange"])
        v_range = tuple(spec["vRange"])
        resolution = tuple(spec["resolution"]) if spec.get("resolution") else None
        fill = _resolve_color(spec.get("fillColor"))

        def _make_surface_factory(fx=fx, fy=fy, fz=fz, u_range=u_range,
                                  v_range=v_range, resolution=resolution, fill=fill):
            def factory(**overrides):
                def func(u, v):
                    scope = {"u": u, "v": v}
                    return [fx(scope), fy(scope), fz(scope)]

                kwargs: Dict[str, Any] = dict(u_range=list(u_range), v_range=list(v_range))
                if resolution is not None:
                    kwargs["resolution"] = list(resolution)
                if fill is not None:
                    kwargs["fill_color"] = fill
                kwargs.update(overrides)
                return manim.Surface(func, **kwargs)

            return factory

        factory = _make_surface_factory()
        surfaces[name] = factory
        setattr(mod, name, factory)

    shapes: Dict[str, Callable[..., Any]] = {}
    for name, svg in (data.get("shapes") or {}).items():
        def _make_shape_factory(svg=svg):
            def factory(**kwargs):
                # manim's SVGMobject reads from a file path; wrap the inline
                # string in a temp file so a manifest stays self-contained.
                import tempfile
                import os

                fd, tmp = tempfile.mkstemp(suffix=".svg")
                try:
                    with os.fdopen(fd, "w", encoding="utf-8") as fh:
                        fh.write(svg)
                    return manim.SVGMobject(tmp, **kwargs)
                finally:
                    try:
                        os.unlink(tmp)
                    except OSError:
                        pass

            return factory

        factory = _make_shape_factory()
        shapes[name] = factory
        setattr(mod, name, factory)

    return {
        "name": data["name"],
        "version": data["version"],
        "colors": colors,
        "rate_functions": rate_functions,
        "surfaces": surfaces,
        "shapes": shapes,
        "summary": {
            "colors": len(colors),
            "rateFunctions": len(rate_functions),
            "surfaces": len(surfaces),
            "shapes": len(shapes),
        },
    }
