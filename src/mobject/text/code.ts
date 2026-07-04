// Code: render source code as monospaced Text lines with optional line numbers
// and a background Rectangle / window frame. Mirrors manim.mobject.text.code_mobject
// (loosely). Syntax highlighting is done by a small built-in tokenizer that
// colors keywords / strings / comments / numbers for common languages — no
// heavy highlighter dependency.

import { VGroup } from "../VMobject.ts";
import { Text } from "./Text.ts";
import type { TextConfig } from "./Text.ts";
import { Rectangle, Dot } from "../geometry.ts";
import * as V from "../../core/math/vector.ts";
import { Transform } from "../../animation/Animation.ts";
import { AnimationGroup } from "../../animation/composition.ts";
import { TransformMatchingAuto } from "../../animation/auto_matching.ts";
import type { AutoMatchingConfig } from "../../animation/auto_matching.ts";

export interface CodeConfig extends TextConfig {
  language?: string;
  tabWidth?: number;
  lineNumbers?: boolean;
  lineSpacing?: number;
  style?: Record<string, string>;
  background?: "rectangle" | "window";
  backgroundColor?: string;
  cornerRadius?: number;
}

// Lightweight per-language keyword sets. Enough for js/ts and python coloring.
const KEYWORDS: Record<string, string[]> = {
  js: [
    "const", "let", "var", "function", "return", "if", "else", "for", "while",
    "class", "extends", "new", "import", "export", "from", "async", "await",
    "true", "false", "null", "undefined", "this", "super", "typeof", "instanceof",
    "throw", "try", "catch", "finally", "switch", "case", "break", "continue", "of", "in",
  ],
  ts: [
    "const", "let", "var", "function", "return", "if", "else", "for", "while",
    "class", "extends", "new", "import", "export", "from", "async", "await",
    "true", "false", "null", "undefined", "this", "super", "typeof", "instanceof",
    "interface", "type", "enum", "public", "private", "readonly", "as",
    "throw", "try", "catch", "finally", "switch", "case", "break", "continue", "of", "in",
  ],
  python: [
    "def", "return", "if", "elif", "else", "for", "while", "class", "import",
    "from", "as", "with", "try", "except", "finally", "raise", "lambda", "pass",
    "True", "False", "None", "and", "or", "not", "in", "is", "print", "yield", "async", "await",
  ],
  py: [
    "def", "return", "if", "elif", "else", "for", "while", "class", "import",
    "from", "as", "with", "try", "except", "finally", "raise", "lambda", "pass",
    "True", "False", "None", "and", "or", "not", "in", "is", "print", "yield", "async", "await",
  ],
};

// Default token palette (Monokai-ish).
const DEFAULT_STYLE: Record<string, string> = {
  keyword: "#66D9EF",
  string: "#E6DB74",
  comment: "#75715E",
  number: "#AE81FF",
  default: "#F8F8F2",
};

interface Tok { text: string; color: string; }

function normalizeLang(lang?: string): string {
  const l = (lang ?? "js").toLowerCase();
  if (l === "javascript") return "js";
  if (l === "typescript") return "ts";
  if (l === "python") return "python";
  return l;
}

// Tokenize a single line into colored spans. A single-pass regex scan handles
// comments, strings, numbers, and identifiers; everything else keeps the
// default color.
function tokenizeLine(line: string, lang: string, style: Record<string, string>): Tok[] {
  const keywords = new Set(KEYWORDS[lang] ?? KEYWORDS.js);
  const toks: Tok[] = [];
  let i = 0;

  const commentPrefix = lang === "python" || lang === "py" ? "#" : "//";

  while (i < line.length) {
    const rest = line.slice(i);

    // Comments run to end of line.
    if (rest.startsWith(commentPrefix)) {
      toks.push({ text: rest, color: style.comment });
      break;
    }

    // Strings (single/double/back quotes).
    const q = line[i];
    if (q === '"' || q === "'" || q === "`") {
      let j = i + 1;
      while (j < line.length && line[j] !== q) {
        if (line[j] === "\\") j++;
        j++;
      }
      j = Math.min(j + 1, line.length);
      toks.push({ text: line.slice(i, j), color: style.string });
      i = j;
      continue;
    }

    // Numbers.
    const numMatch = /^\d+(\.\d+)?/.exec(rest);
    if (numMatch) {
      toks.push({ text: numMatch[0], color: style.number });
      i += numMatch[0].length;
      continue;
    }

    // Identifiers / keywords.
    const idMatch = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(rest);
    if (idMatch) {
      const word = idMatch[0];
      const color = keywords.has(word) ? style.keyword : style.default;
      toks.push({ text: word, color });
      i += word.length;
      continue;
    }

    // Any other single character (operators, punctuation, whitespace).
    toks.push({ text: line[i], color: style.default });
    i++;
  }

  if (toks.length === 0) toks.push({ text: "", color: style.default });
  return toks;
}

export class Code extends VGroup {
  codeString: string;
  language: string;
  tabWidth: number;
  showLineNumbers: boolean;
  style: Record<string, string>;
  codeLines: VGroup;
  lineNumbers: VGroup;
  codeTokens: VGroup; // flat group of every colored token mobject
  background: any;
  // Parallel to codeTokens.submobjects -- each token's (line, column) in the
  // rendered source, used by diffTo() to disambiguate repeated identical
  // tokens (autoKey() alone would otherwise match every "x" on a line to
  // the same key, since it falls back to matching by .text).
  private _tokenLoc: Array<{ line: number; col: number }> = [];

  constructor(codeOrConfig: string | CodeConfig = "", config: CodeConfig = {}) {
    super();

    // Allow Code({ code, ... }) as well as Code("src", { ... }).
    let code: string;
    if (typeof codeOrConfig === "object" && codeOrConfig !== null) {
      config = codeOrConfig;
      code = String((config as any).code ?? "");
    } else {
      code = String(codeOrConfig);
    }

    this.language = normalizeLang(config.language);
    this.tabWidth = config.tabWidth ?? 4;
    this.showLineNumbers = config.lineNumbers ?? true;
    this.style = { ...DEFAULT_STYLE, ...(config.style ?? {}) };
    this.codeString = code;

    const lineSpacing = config.lineSpacing ?? 0.1;
    const tab = " ".repeat(this.tabWidth);
    const rawLines = code.replace(/\t/g, tab).split("\n");

    this.codeLines = new VGroup();
    this.lineNumbers = new VGroup();
    this.codeTokens = new VGroup();

    const lineMobs: VGroup[] = [];
    rawLines.forEach((rawLine, idx) => {
      const toks = tokenizeLine(rawLine, this.language, this.style);
      const lineGroup = new VGroup();
      let prev: Text | null = null;
      let col = 0;
      for (const t of toks) {
        // Render leading spaces so indentation is preserved; empty tokens skip.
        const display = t.text === "" ? " " : t.text;
        const tokMob = new Text(display, { ...config, color: t.color, align: "left" } as TextConfig);
        if (prev) tokMob.nextTo(prev, V.RIGHT, 0.05);
        lineGroup.add(tokMob);
        this.codeTokens.add(tokMob);
        this._tokenLoc.push({ line: idx, col });
        col += t.text.length;
        prev = tokMob;
      }
      this.codeLines.add(lineGroup);
      lineMobs.push(lineGroup);

      if (this.showLineNumbers) {
        const num = new Text(String(idx + 1), { ...config, color: this.style.comment, align: "left" } as TextConfig);
        this.lineNumbers.add(num);
      }
    });

    // Stack the code lines vertically, left-aligned.
    for (let i = 1; i < lineMobs.length; i++) {
      lineMobs[i].nextTo(lineMobs[i - 1], V.DOWN, lineSpacing);
      lineMobs[i].alignTo(lineMobs[0], V.LEFT);
    }

    // Position line numbers beside their lines.
    if (this.showLineNumbers) {
      const nums = this.lineNumbers.submobjects;
      for (let i = 0; i < nums.length; i++) {
        nums[i].nextTo(lineMobs[i], V.LEFT, 0.4);
        nums[i].alignTo(lineMobs[i], V.UP);
      }
    }

    const content = new VGroup(this.codeLines);
    if (this.showLineNumbers) content.add(this.lineNumbers);

    // Background.
    const bgColor = config.backgroundColor ?? "#272822";
    const pad = 0.3;
    const bgWidth = Math.max(content.getWidth() + 2 * pad, 1);
    const bgHeight = Math.max(content.getHeight() + 2 * pad, 1);
    const rect = new Rectangle({
      width: bgWidth,
      height: bgHeight,
      fillColor: bgColor,
      fillOpacity: 1,
      strokeWidth: 0,
    });
    rect.moveTo(content.getCenter());

    if ((config.background ?? "rectangle") === "window") {
      // A window frame: the rectangle plus three "traffic light" dots.
      const win = new VGroup(rect);
      const colors = ["#FF5F56", "#FFBD2E", "#27C93F"];
      const topLeft = rect.getCorner(V.UL);
      for (let k = 0; k < 3; k++) {
        const d = new Dot({ radius: 0.06, color: colors[k] });
        d.moveTo([topLeft[0] + 0.2 + k * 0.18, topLeft[1] - 0.18, 0]);
        win.add(d);
      }
      this.background = win;
    } else {
      this.background = rect;
    }

    // Order: background behind, then content.
    this.add(this.background, content);
    this.center();
  }

  // Seed each token's matchId as "text:line:col" -- autoKey() (auto_matching.ts)
  // otherwise falls back to matching by .text alone, so two instances of the
  // same identifier on one line (e.g. two "x"s) would both resolve to the
  // same key and pair arbitrarily. Position-sensitive by design: see diffTo()'s
  // own doc comment for the resulting tradeoff on inserted/removed lines.
  private _seedMatchIds(): void {
    const toks = this.codeTokens.submobjects;
    for (let i = 0; i < toks.length; i++) {
      const loc = this._tokenLoc[i];
      (toks[i] as any).matchId = `${(toks[i] as any).text}:${loc.line}:${loc.col}`;
    }
  }

  /**
   * Morph this Code's tokens into `other`'s via TransformMatchingAuto (the
   * Reveal.js Auto-Animate / Framer Motion layoutId idea), reusing the
   * matching machinery as-is -- every token is already a `Text` mobject
   * keyed by its own literal string, so no new engine code is needed, just
   * disambiguating repeated tokens via `matchId` before matching.
   *
   * Known, deliberate limitation: because the key includes literal
   * `line:col`, inserting or removing a line shifts every later token's
   * key, so content below the change fades out/in rather than morphing --
   * the same trade-off real manim's own `TransformMatchingTex` has. This is
   * not a bug to fix here; a true diff/patience-alignment algorithm would be
   * a separate, larger feature.
   *
   * Cleanup gotcha (confirmed via a real end-to-end scene render, not just
   * this file's own unit tests): tokens present ONLY in `other` (e.g. a
   * newly-inserted argument) are real children of `other`, individually
   * `FadeIn`-ed by the underlying `TransformMatchingAuto` -- `Scene.play()`
   * auto-adds any animation's introduced mobjects directly to the scene,
   * even though `other` itself was never explicitly added. Fading out only
   * `this` afterward leaves those new-token mobjects behind as permanent,
   * untracked scene members. Fade out `other` too (in addition to `this`)
   * to fully clear the diff's result -- same pattern real manim's
   * `TransformMatchingTex` callers already have to follow.
   */
  diffTo(other: Code, config: AutoMatchingConfig = {}): AnimationGroup {
    this._seedMatchIds();
    other._seedMatchIds();
    const tokenAnims = new TransformMatchingAuto(this.codeTokens, other.codeTokens, config).animations;
    const bg = new Transform(this.background, other.background);
    return new AnimationGroup([...tokenAnims, bg]);
  }
}
