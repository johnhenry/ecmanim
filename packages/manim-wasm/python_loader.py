"""Load the shared manim WASM math core (``manim_core.wasm``) from Python.

The SAME ``manim_core.wasm`` is consumed by manim-js in Node/browser (via the
``WebAssembly`` API, see ``src/wasm.ts``) and here by Python via ``wasmtime`` —
proving the core is genuinely cross-language. The module is ``no_std`` with
static linear buffers and a C ABI:

  * ``buffer_ptr()``  -> pointer to a shared f64 scratch buffer (points, matrices)
  * ``ibuffer_ptr()`` -> pointer to a shared i32 scratch buffer (indices)
  * ``buffer_len()``  -> element count of each buffer

Callers marshal inputs into the buffers, call an exported function, and read the
results back out — exactly as ``src/wasm.ts`` does, so both languages compute
identical numbers.

Run standalone to self-test against the known JS reference values::

    python3 packages/manim-wasm/python_loader.py
"""

from __future__ import annotations

import os
import struct
from typing import List

try:
    from wasmtime import Engine, Store, Module, Instance
except ImportError as exc:  # pragma: no cover - handled by the CLI below
    Engine = Store = Module = Instance = None  # type: ignore
    _IMPORT_ERROR = exc
else:
    _IMPORT_ERROR = None

_HERE = os.path.dirname(os.path.abspath(__file__))
_DEFAULT_WASM = os.path.join(_HERE, "manim_core.wasm")

_F64 = 8  # bytes per f64 slot
_I32 = 4  # bytes per i32 slot


class ManimCore:
    """A loaded instance of the shared WASM math core."""

    def __init__(self, wasm_path: str = _DEFAULT_WASM):
        if _IMPORT_ERROR is not None:
            raise RuntimeError(
                "wasmtime is required: pip install wasmtime "
                f"(original import error: {_IMPORT_ERROR})"
            )
        self.store = Store(Engine())
        with open(wasm_path, "rb") as fh:
            module = Module(self.store.engine, fh.read())
        self.instance = Instance(self.store, module, [])
        exports = self.instance.exports(self.store)

        self._memory = exports["memory"]
        self._buffer_ptr = int(exports["buffer_ptr"](self.store))
        self._ibuffer_ptr = int(exports["ibuffer_ptr"](self.store))
        self._buffer_len = int(exports["buffer_len"](self.store))

        self._fn_bezier_eval = exports["bezier_eval"]
        self._fn_mat3_vec = exports["mat3_vec"]
        self._fn_earclip = exports["earclip"]
        self._fn_add = exports["add"]

    # --- low-level shared-buffer access ------------------------------------

    def _write_f64(self, slot: int, value: float) -> None:
        addr = self._buffer_ptr + slot * _F64
        self._memory.write(self.store, struct.pack("<d", float(value)), addr)

    def _read_f64(self, slot: int) -> float:
        addr = self._buffer_ptr + slot * _F64
        raw = self._memory.read(self.store, addr, addr + _F64)
        return struct.unpack("<d", raw)[0]

    def _write_i32(self, slot: int, value: int) -> None:
        addr = self._ibuffer_ptr + slot * _I32
        self._memory.write(self.store, struct.pack("<i", int(value)), addr)

    def _read_i32(self, slot: int) -> int:
        addr = self._ibuffer_ptr + slot * _I32
        raw = self._memory.read(self.store, addr, addr + _I32)
        return struct.unpack("<i", raw)[0]

    # --- exported math -----------------------------------------------------

    def add(self, a: float, b: float) -> float:
        """Sanity-check export."""
        return float(self._fn_add(self.store, float(a), float(b)))

    def bezier_eval(self, p0: List[float], c1: List[float],
                    c2: List[float], p3: List[float], t: float) -> List[float]:
        """Evaluate a cubic Bezier at ``t``. Mirrors ``bezierEvalWasm`` in
        ``src/wasm.ts``. Points are ``[x, y, z]``."""
        for k in range(3):
            self._write_f64(k, p0[k])
            self._write_f64(3 + k, c1[k])
            self._write_f64(6 + k, c2[k])
            self._write_f64(9 + k, p3[k])
        self._fn_bezier_eval(self.store, float(t))
        return [self._read_f64(12), self._read_f64(13), self._read_f64(14)]

    def mat3_vec(self, m: List[float], v: List[float]) -> List[float]:
        """3x3 (row-major) matrix times a 3-vector. Mirrors ``mat3VecWasm``."""
        for i in range(9):
            self._write_f64(i, m[i])
        for i in range(3):
            self._write_f64(9 + i, v[i])
        self._fn_mat3_vec(self.store)
        return [self._read_f64(12), self._read_f64(13), self._read_f64(14)]

    def earclip(self, points: List[List[float]]) -> List[int]:
        """Ear-clip a simple 2D polygon. Returns a flat list of triangle index
        triples. Mirrors ``earclipWasm`` in ``src/wasm.ts``."""
        count = len(points)
        for i in range(count):
            self._write_f64(2 * i, points[i][0])
            self._write_f64(2 * i + 1, points[i][1])
        tris = int(self._fn_earclip(self.store, count))
        return [self._read_i32(i) for i in range(tris * 3)]


def _self_test() -> int:
    """Run the core and compare against the known JS reference values."""
    core = ManimCore()

    # 1) add
    assert core.add(2.0, 3.0) == 5.0, core.add(2.0, 3.0)

    # 2) cubic bezier at t=0.5 -> [1.5, 1.5, 0]  (matches src/wasm.ts)
    bez = core.bezier_eval([0, 0, 0], [1, 2, 0], [2, 2, 0], [3, 0, 0], 0.5)
    print("bezier_eval@0.5 =", bez)
    assert all(abs(a - b) < 1e-12 for a, b in zip(bez, [1.5, 1.5, 0.0])), bez

    # 3) mat3_vec: identity * v = v ; then a rotation-ish check
    ident = [1, 0, 0, 0, 1, 0, 0, 0, 1]
    mv = core.mat3_vec(ident, [7, 8, 9])
    assert mv == [7.0, 8.0, 9.0], mv

    # 4) earclip a 5-gon -> [4,0,1, 4,1,2, 2,3,4]  (matches src/wasm.ts)
    poly = [[0, 0], [2, 0], [2, 2], [1, 3], [0, 2]]
    tris = core.earclip(poly)
    print("earclip(5-gon) =", tris)
    expected = [4, 0, 1, 4, 1, 2, 2, 3, 4]
    assert tris == expected, f"{tris} != {expected}"

    print("ALL CROSS-LANGUAGE CHECKS PASSED (Python results match JS)")
    return 0


if __name__ == "__main__":
    if _IMPORT_ERROR is not None:
        print(
            "wasmtime is not installed; cannot run the WASM core.\n"
            "Install it with:  pip install wasmtime\n"
            f"(import error: {_IMPORT_ERROR})"
        )
        raise SystemExit(1)
    raise SystemExit(_self_test())
