import { test, before } from "node:test";
import assert from "node:assert";
import { normalizeUnicodeScripts } from "../src/core/unicode_scripts.ts";
import { MathTex, Tex, initMathTex } from "../src/mobject/mathtex.ts";

before(async () => { await initMathTex(); });

test("each superscript glyph maps", () => {
  const sup = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ";
  const exp = "0123456789+-=()ni";
  for (let i = 0; i < sup.length; i++) {
    assert.strictEqual(normalizeUnicodeScripts("x" + sup[i]), `x^{${exp[i]}}`);
  }
});

test("each subscript glyph maps", () => {
  const sub = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₕₖₗₘₙₚₛₜ";
  const exp = "0123456789+-=()aeoxhklmnpst";
  for (let i = 0; i < sub.length; i++) {
    assert.strictEqual(normalizeUnicodeScripts("x" + sub[i]), `x_{${exp[i]}}`);
  }
});

test("runs merge", () => {
  assert.strictEqual(normalizeUnicodeScripts("x²³"), "x^{23}");
  assert.strictEqual(normalizeUnicodeScripts("x₁₂"), "x_{12}");
  assert.strictEqual(normalizeUnicodeScripts("x⁻¹"), "x^{-1}");
});

test("mixed super and sub", () => {
  assert.strictEqual(normalizeUnicodeScripts("x₁²+y₂³"), "x_{1}^{2}+y_{2}^{3}");
});

test("no-op returns identical string", () => {
  for (const s of ["", "a+b", "x^2 + y_1", "\\frac{a}{b}", "héllo"]) {
    assert.strictEqual(normalizeUnicodeScripts(s), s);
  }
});

test("already-caret input untouched", () => {
  assert.strictEqual(normalizeUnicodeScripts("a^{2}+b^2"), "a^{2}+b^2");
});

test("pythagoras", () => {
  assert.strictEqual(normalizeUnicodeScripts("a²+b²=c²"), "a^{2}+b^{2}=c^{2}");
});

function sig(m: any) {
  const gl = m.glyphs();
  const pts = gl.reduce((n: number, g: any) => n + (g.points?.length ?? 0), 0);
  return { n: gl.length, pts, w: m.getWidth(), h: m.getHeight() };
}

test("MathTex unicode == caret geometry", () => {
  assert.deepStrictEqual(sig(new MathTex("a²+b²=c²")), sig(new MathTex("a^{2}+b^{2}=c^{2}")));
  assert.deepStrictEqual(sig(new MathTex("x₁₂")), sig(new MathTex("x_{12}")));
});

test("MathTex multi-arg parts normalize", () => {
  assert.deepStrictEqual(sig(new MathTex("a²", "+", "b²")), sig(new MathTex("a^{2}", "+", "b^{2}")));
});

test("Tex: math segments and text-mode scripts render as scripts", () => {
  assert.deepStrictEqual(sig(new Tex("area $a²$")), sig(new Tex("area $a^{2}$")));
  assert.deepStrictEqual(sig(new Tex("m²")), sig(new MathTex("\\text{m}^{2}")));
});
