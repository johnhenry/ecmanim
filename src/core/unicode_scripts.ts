// Unicode superscript/subscript -> TeX normalization. MathJax has no glyphs
// for these characters, so they render as blank-but-spacing boxes. Rewriting
// them to `^{…}` / `_{…}` makes them render as real scripts.

const SUP: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "-", "⁼": "=", "⁽": "(", "⁾": ")", "ⁿ": "n", "ⁱ": "i",
};
const SUB: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
  "₊": "+", "₋": "-", "₌": "=", "₍": "(", "₎": ")",
  "ₐ": "a", "ₑ": "e", "ₒ": "o", "ₓ": "x", "ₕ": "h", "ₖ": "k", "ₗ": "l", "ₘ": "m", "ₙ": "n", "ₚ": "p", "ₛ": "s", "ₜ": "t",
};

const SUP_RUN = new RegExp(`[${Object.keys(SUP).join("")}]+`, "g");
const SUB_RUN = new RegExp(`[${Object.keys(SUB).join("")}]+`, "g");
const ANY_SCRIPT_RUN = new RegExp(`[${Object.keys(SUP).join("")}]+|[${Object.keys(SUB).join("")}]+`, "gu");

/** True if `src` contains any Unicode super/subscript character handled here. */
export function hasUnicodeScripts(src: string): boolean {
  ANY_SCRIPT_RUN.lastIndex = 0;
  return ANY_SCRIPT_RUN.test(src);
}

/**
 * Convert Unicode superscripts/subscripts to TeX `^{…}` / `_{…}`, merging
 * consecutive runs (`x²³` -> `x^{23}`, `x₁₂` -> `x_{12}`). Input without such
 * characters is returned as the identical string. Pure.
 */
export function normalizeUnicodeScripts(src: string): string {
  if (!hasUnicodeScripts(src)) return src;
  return src
    .replace(SUP_RUN, (m) => `^{${[...m].map((c) => SUP[c]).join("")}}`)
    .replace(SUB_RUN, (m) => `_{${[...m].map((c) => SUB[c]).join("")}}`);
}
