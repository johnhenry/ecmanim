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
import { Transform, Animation } from "../../animation/Animation.ts";
import type { AnimationConfig } from "../../animation/Animation.ts";
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

// --- Motion Canvas parity (MC3): ranges, selection, tagged-template edits ---

/** A half-open-ish source range in EXPANDED (tab -> spaces) coordinates:
 *  lines are 0-based, cols count characters; end is inclusive of the line,
 *  exclusive of endCol. */
export interface CodeRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

/** Whole-line range: `lines(2)` = line 2, `lines(1, 3)` = lines 1-3
 *  (0-based, inclusive) — MC's `lines()` selection helper. */
export function lines(from: number, to?: number): CodeRange {
  return { startLine: from, startCol: 0, endLine: to ?? from, endCol: Infinity };
}

/** Single-word range at (line, col) spanning `length` chars (MC's `word()`). */
export function word(line: number, col: number, length = Infinity): CodeRange {
  return { startLine: line, startCol: col, endLine: line, endCol: col + length };
}

type CodeEditMarker =
  | { __codeEdit: "insert"; text: string }
  | { __codeEdit: "remove"; text: string }
  | { __codeEdit: "edit"; from: string; to: string };

/** Marks text ADDED by a `code.edit` template (absent before, present after). */
export function insert(text: string): CodeEditMarker {
  return { __codeEdit: "insert", text };
}

/** Marks text REMOVED by a `code.edit` template (present before, absent after). */
export function remove(text: string): CodeEditMarker {
  return { __codeEdit: "remove", text };
}

/** Marks text REPLACED by a `code.edit` template (`from` before, `to` after). */
export function edit(from: string, to: string): CodeEditMarker {
  return { __codeEdit: "edit", from, to };
}

/** Result of `code.edit(...)`: play `animation`, then keep using `target`
 *  (same contract as `matchTex`). */
export interface CodeEditResult {
  animation: AnimationGroup;
  target: Code;
}

// Lerp every code token's opacity toward a per-token target (1 selected,
// dimmed otherwise). One animation for the whole token set -- begin()
// captures live start opacities so chained selections hand off smoothly.
class CodeSelectionAnimation extends Animation {
  private _targets: number[];
  private _starts: number[] = [];

  constructor(tokens: VGroup, targets: number[], config: AnimationConfig = {}) {
    super(tokens, config);
    this._targets = targets;
    if (config.runTime == null) this.runTime = 0.3;
  }

  begin(): this {
    this._starts = this.mobject.submobjects.map((t: any) => t.opacity ?? 1);
    return super.begin();
  }

  interpolateMobject(alpha: number): void {
    const toks = this.mobject.submobjects;
    for (let i = 0; i < toks.length; i++) {
      const start = this._starts[i] ?? 1;
      toks[i].setOpacity(start + (this._targets[i] - start) * alpha);
    }
  }
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
  // Construction config retained so edit()/replace()/setCode() can rebuild
  // an identically-styled Code.
  private _config: CodeConfig = {};

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

    this._config = { ...config };
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
      let lineBaseline: number | null = null;
      for (const t of toks) {
        // Render leading spaces so indentation is preserved; empty tokens skip.
        const display = t.text === "" ? " " : t.text;
        const tokMob = new Text(display, { ...config, color: t.color, align: "left" } as TextConfig);
        if (prev) {
          tokMob.nextTo(prev, V.RIGHT, 0.05);
          // nextTo aligns bounding-box CENTERS, so mixed-height tokens (caps
          // vs descenders) wobble vertically. Vector Texts record their real
          // baseline — snap every token onto the line's shared baseline.
          if (lineBaseline != null && tokMob.baselineOffset != null) {
            const tokBaseline = tokMob.getCenter()[1] + tokMob.baselineOffset;
            tokMob.shift([0, lineBaseline - tokBaseline, 0]);
          }
        }
        if (lineBaseline == null && tokMob.baselineOffset != null) {
          lineBaseline = tokMob.getCenter()[1] + tokMob.baselineOffset;
        }
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

  // --- MC3: tagged-template edits -----------------------------------------

  /** The source with tabs expanded — the coordinate space CodeRange,
   *  findFirstRange() and replace() all use. */
  expandedCode(): string {
    return this.codeString.replace(/\t/g, " ".repeat(this.tabWidth));
  }

  /**
   * Motion Canvas's `code().edit(duration)\`...\`` as a tagged template:
   * plain template text is unchanged, `${insert(x)}` appears only after,
   * `${remove(y)}` only before, `${edit(a, b)}` swaps a -> b. Returns the
   * diffTo-based animation plus the resulting Code (anchored at this
   * Code's top-left):
   *
   * ```ts
   * const { animation, target } = code.edit(0.8)\`const x = \${edit("1", "2")};\`;
   * await scene.play(animation);
   * ```
   */
  edit(duration = 1): (strings: TemplateStringsArray, ...subs: Array<CodeEditMarker | string>) => CodeEditResult {
    return (strings, ...subs) => {
      let before = "";
      let after = "";
      for (let i = 0; i < strings.length; i++) {
        before += strings[i];
        after += strings[i];
        const sub = subs[i];
        if (sub == null) continue;
        if (typeof sub === "string") {
          before += sub;
          after += sub;
        } else if (sub.__codeEdit === "insert") {
          after += sub.text;
        } else if (sub.__codeEdit === "remove") {
          before += sub.text;
        } else if (sub.__codeEdit === "edit") {
          before += sub.from;
          after += sub.to;
        }
      }
      const target = new Code(after, { ...this._config });
      // Anchor the result where this code sits (top-left, like an editor).
      const myUL = this.getCorner(V.UL);
      const itsUL = target.getCorner(V.UL);
      target.shift(V.sub(myUL, itsUL));
      const animation = this.diffTo(target);
      animation.runTime = duration;
      // Same scene-cleanup contract as matchTex: after the morph, remove
      // this Code and the loose target tokens the child FadeIns introduced,
      // and add the real `target` (geometries coincide at alpha 1).
      const introduced = animation.getMobjectsToIntroduce();
      const self = this;
      (animation as any).getMobjectsToRemove = () => [...introduced, self];
      (animation as any).introduced = target;
      return { animation, target, before } as CodeEditResult & { before: string };
    };
  }

  // --- MC3: selection ------------------------------------------------------

  private _tokenInRange(i: number, r: CodeRange): boolean {
    const loc = this._tokenLoc[i];
    if (!loc) return false;
    if (loc.line < r.startLine || loc.line > r.endLine) return false;
    const text = (this.codeTokens.submobjects[i] as any).text ?? "";
    const tokStart = loc.col;
    const tokEnd = loc.col + Math.max(1, text.length);
    const from = loc.line === r.startLine ? r.startCol : 0;
    const to = loc.line === r.endLine ? r.endCol : Infinity;
    return tokEnd > from && tokStart < to;
  }

  /**
   * Highlight a range (or ranges) by dimming everything else — MC's
   * `code.selection(lines(5, 8), 0.3)`. Pass `null` to clear (everything
   * back to full opacity). Returns an Animation to play():
   *
   * ```ts
   * await scene.play(code.selection(lines(1, 2)));
   * await scene.play(code.selection(code.findFirstRange("return")!));
   * await scene.play(code.selection(null)); // reset
   * ```
   */
  selection(
    sel: CodeRange | CodeRange[] | null,
    duration = 0.3,
    config: AnimationConfig & { dimOpacity?: number } = {},
  ): Animation {
    const dim = config.dimOpacity ?? 0.25;
    const ranges = sel == null ? null : Array.isArray(sel) ? sel : [sel];
    const targets = this.codeTokens.submobjects.map((_t, i) => {
      if (ranges == null) return 1;
      return ranges.some((r) => this._tokenInRange(i, r)) ? 1 : dim;
    });
    const anim = new CodeSelectionAnimation(this.codeTokens, targets, config);
    anim.runTime = config.runTime ?? duration;
    return anim;
  }

  /** First occurrence of `pattern` (string or RegExp) in the expanded
   *  source, as a CodeRange — MC's `findFirstRange()`. Null if absent. */
  findFirstRange(pattern: string | RegExp): CodeRange | null {
    const src = this.expandedCode();
    let start = -1, length = 0;
    if (typeof pattern === "string") {
      start = src.indexOf(pattern);
      length = pattern.length;
    } else {
      const m = pattern.exec(src);
      if (m) { start = m.index; length = m[0].length; }
    }
    if (start < 0) return null;
    const toLineCol = (offset: number) => {
      const pre = src.slice(0, offset);
      const line = (pre.match(/\n/g) ?? []).length;
      const col = offset - (pre.lastIndexOf("\n") + 1);
      return { line, col };
    };
    const a = toLineCol(start);
    const b = toLineCol(start + length);
    return { startLine: a.line, startCol: a.col, endLine: b.line, endCol: b.col };
  }

  // --- MC3: instant mutators -----------------------------------------------

  /**
   * Rebuild this Code IN PLACE around new source (identity-preserving, like
   * PieChart.setValues): same styling config, background top-left stays
   * anchored. The instant counterpart of edit() — use inside updaters or
   * between animations.
   */
  setCode(code: string): this {
    const anchor = this.getCorner(V.UL);
    const fresh = new Code(code, { ...this._config });
    fresh.shift(V.sub(anchor, fresh.getCorner(V.UL)));
    this.submobjects.length = 0;
    this.points = [];
    for (const child of fresh.submobjects) this.add(child);
    this.codeString = fresh.codeString;
    this.codeLines = fresh.codeLines;
    this.lineNumbers = fresh.lineNumbers;
    this.codeTokens = fresh.codeTokens;
    this.background = fresh.background;
    (this as any)._tokenLoc = (fresh as any)._tokenLoc;
    return this;
  }

  /** Replace `range` (expanded coordinates) with `text`, instantly.
   *  Also still accepts a Mobject (manim's replace-in-space) — the two
   *  signatures share a name by dispatch, MC's vs manim's `replace`. */
  replace(range: CodeRange, text: string): this;
  replace(other: any, config?: { dimToMatch?: number; stretch?: boolean }): this;
  replace(rangeOrMobject: any, textOrConfig?: any): this {
    if (rangeOrMobject == null || typeof rangeOrMobject.startLine !== "number") {
      return super.replace(rangeOrMobject, textOrConfig);
    }
    const range = rangeOrMobject as CodeRange;
    const text = String(textOrConfig ?? "");
    const src = this.expandedCode();
    const lineStarts: number[] = [0];
    for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
    const clampCol = (line: number, col: number) => {
      const startOfLine = lineStarts[Math.min(line, lineStarts.length - 1)] ?? 0;
      const endOfLine = line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : src.length;
      return Math.min(startOfLine + Math.max(0, col), endOfLine);
    };
    const from = clampCol(range.startLine, range.startCol);
    const to = clampCol(range.endLine, range.endCol === Infinity ? Number.MAX_SAFE_INTEGER : range.endCol);
    return this.setCode(src.slice(0, from) + text + src.slice(to));
  }

  /** Prepend text to the source, instantly (MC's `code.prepend()`). */
  prepend(text: string): this {
    return this.setCode(text + this.expandedCode());
  }

  /** Append text to the source, instantly (MC's `code.append()`). */
  append(text: string): this {
    return this.setCode(this.expandedCode() + text);
  }
}
