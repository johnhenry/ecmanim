"""Standalone unit tests for the portable expression evaluator (stdlib only,
no manim required). These mirror the assertions in the manim-js test
`test/manifest.test.ts`, keeping the two evaluators in lock-step.

Run:  python3 -m unittest packages/manim-portable-plugins/test_expr.py
"""

import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from manim_portable_plugins import compile_expr, eval_expr, ExprError  # noqa: E402


class TestExpr(unittest.TestCase):
    def test_arithmetic_and_variables(self):
        self.assertEqual(compile_expr("2*t+1", ["t"])({"t": 3}), 7)
        self.assertEqual(compile_expr("(1+2)*3")({}), 9)
        self.assertEqual(compile_expr("2^3^2")({}), 512)   # right-associative
        self.assertEqual(compile_expr("-2^2")({}), -4)     # unary looser than ^

    def test_functions_and_constants(self):
        self.assertAlmostEqual(compile_expr("sin(pi/2)")({}), 1.0)
        self.assertEqual(eval_expr("max(1,2,3)"), 3)
        self.assertAlmostEqual(eval_expr("sqrt(2)"), math.sqrt(2))
        self.assertAlmostEqual(
            compile_expr("0.5 - 0.5*cos(t*2*pi)", ["t"])({"t": 0.5}), 1.0
        )

    def test_rejects_unsafe_or_unknown(self):
        with self.assertRaises(ExprError):
            compile_expr("__import__", [])
        with self.assertRaises(ExprError):
            compile_expr("t", [])          # undeclared variable
        with self.assertRaises(ExprError):
            compile_expr("nope(1)", [])    # unknown function

    def test_surface_expression(self):
        f = compile_expr("(1 + (v/2)*cos(u/2))*cos(u)", ["u", "v"])
        val = f({"u": 1.0, "v": 0.5})
        self.assertAlmostEqual(val, 0.6588422763128993)


if __name__ == "__main__":
    unittest.main()
