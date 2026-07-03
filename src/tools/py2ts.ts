// py2ts — a pragmatic Python-manim -> TypeScript-ecmanim scene transpiler.
//
// This is NOT a full Python parser. It is a best-effort line/regex +
// light-tokenizer converter that handles the common ~80% subset of manim
// scene scripts. Anything it cannot confidently translate is passed through
// with a `/* TODO py2ts: ... */` marker rather than crashing.
//
// Known unhandled constructs (NOT marked with a TODO comment -- they pass
// through silently as invalid TS, so review the diff by hand if your source
// uses either): list/generator comprehensions (`[x for x in y]`, `*[...]`
// unpacking) and any single Python statement whose call arguments span
// multiple lines. Both stem from the converter's line-by-line architecture;
// rewrite the source as a single line or an explicit loop before conversion.
//
//   import { convert } from "./tools/py2ts.ts";
//   const ts = convert(pySource);
//
// See test/py2ts.test.ts for the covered constructs.

export interface Py2TsOptions {
  /** Import specifier for the ecmanim package (default "ecmanim"). */
  importFrom?: string;
  /** If true, emit a single `import * as mn from ...` wildcard instead of a
   *  named import of detected identifiers. Default false. */
  wildcardImport?: boolean;
  /** Indent unit for emitted TS (default two spaces). */
  indent?: string;
}

// ---------------------------------------------------------------------------
// Known ecmanim identifiers. Constructor calls to these get a `new ` prefix.
// Kept broad; extracted from the ecmanim public API surface.
// ---------------------------------------------------------------------------

const KNOWN_CLASSES = new Set<string>([
  // core / scenes
  "Scene", "ThreeDScene", "MovingCameraScene", "ZoomedScene", "VectorScene",
  "LinearTransformationScene", "Mobject", "Group", "VMobject", "VGroup",
  "Camera", "ThreeDCamera", "MultiCamera", "MappingCamera", "CanvasRenderer",
  // geometry
  "Arc", "Circle", "Dot", "Ellipse", "Annulus", "Line", "DashedLine", "Arrow",
  "Polygon", "RegularPolygon", "Triangle", "Rectangle", "Square", "Dot3D",
  "Line3D", "Arrow3D",
  // text / tex
  "Text", "MarkupText", "RasterText", "VText", "MathTex", "Tex",
  "SingleStringMathTex",
  // numbers / trackers
  "DecimalNumber", "Integer", "ValueTracker", "ComplexValueTracker",
  "ChangingDecimal", "ChangeDecimalToValue",
  // coordinate systems / graphing
  "NumberLine", "Axes", "NumberPlane", "PolarPlane", "ComplexPlane",
  "UnitInterval", "ThreeDAxes",
  // surfaces / solids
  "Surface", "ParametricSurface", "Sphere", "Torus", "Cylinder", "Cone",
  "Box", "Cube", "Prism", "ThreeDVMobject",
  // polyhedra
  "Polyhedron", "Tetrahedron", "Octahedron", "Icosahedron", "Dodecahedron",
  "ConvexHull3D",
  // matrices / tables / braces
  "SVGMobject", "ImageMobject",
  // camera helpers
  "ScreenRectangle", "FullScreenRectangle",
  // animations
  "Animation", "Transform", "ReplacementTransform", "Create", "Write",
  "Uncreate", "FadeIn", "FadeOut", "ApplyMethod", "Shift", "MoveTo",
  "ScaleAnim", "FadeToColor", "AnimationGroup", "LaggedStart", "LaggedStartMap",
  "Succession", "GrowFromPoint", "GrowFromCenter", "GrowFromEdge",
  "SpinInFromNothing", "ShrinkToCenter", "Rotating", "Rotate", "MoveAlongPath",
  "Indicate", "Flash", "Wiggle", "Circumscribe", "FocusOn",
  "DrawBorderThenFill", "Unwrite", "ShowIncreasingSubsets",
  "ShowSubmobjectsOneByOne", "AddTextLetterByLetter", "RemoveTextLetterByLetter",
  "AddTextWordByWord", "TypeWithCursor", "Untype", "UntypeWithCursor", "SpiralIn",
  "TransformFromCopy", "ClockwiseTransform", "CounterclockwiseTransform",
  "MoveToTarget", "Restore", "ApplyFunction", "ApplyPointwiseFunction",
  "ApplyPointwiseFunctionToCenter", "ApplyMatrix", "ApplyComplexFunction",
  "ScaleInPlace", "FadeTransform", "FadeTransformPieces", "CyclicReplace",
  "Swap", "TransformMatchingShapes", "TransformMatchingTex", "Homotopy",
  "SmoothedVectorizedHomotopy", "ComplexHomotopy", "PhaseFlow",
  "ShowPassingFlash", "ShowPassingFlashWithThinningStrokeWidth", "ApplyWave",
  "Blink", "AnimatedBoundary", "TracedPath", "Broadcast", "ChangeSpeed",
  "Color",
]);

// Scene base classes that trigger `class X extends Base {` conversion.
const SCENE_BASES = new Set<string>([
  "Scene", "ThreeDScene", "MovingCameraScene", "ZoomedScene", "VectorScene",
  "LinearTransformationScene",
]);

// Constants / globals that should be imported when referenced.
const KNOWN_CONSTS = new Set<string>([
  "ORIGIN", "UP", "DOWN", "LEFT", "RIGHT", "IN", "OUT", "UL", "UR", "DL", "DR",
  "PI", "TAU", "DEGREES", "X_AXIS", "Y_AXIS", "Z_AXIS", "TOP", "BOTTOM",
  "LEFT_SIDE", "RIGHT_SIDE", "SMALL_BUFF", "MED_SMALL_BUFF", "MED_LARGE_BUFF",
  "LARGE_BUFF", "FRAME_HEIGHT", "FRAME_WIDTH", "FRAME_X_RADIUS", "FRAME_Y_RADIUS",
  // common colors
  "WHITE", "BLACK", "GRAY", "GREY", "RED", "GREEN", "BLUE", "YELLOW", "ORANGE",
  "PURPLE", "PINK", "TEAL", "GOLD", "MAROON", "DARK_BLUE", "DARK_BROWN",
  "LIGHT_BROWN", "LIGHT_GRAY", "LIGHT_GREY", "DARK_GRAY", "DARK_GREY",
  "BLUE_A", "BLUE_B", "BLUE_C", "BLUE_D", "BLUE_E", "RED_A", "RED_B", "RED_C",
  "RED_D", "RED_E", "GREEN_A", "GREEN_B", "GREEN_C", "GREEN_D", "GREEN_E",
  "YELLOW_A", "YELLOW_B", "YELLOW_C", "YELLOW_D", "YELLOW_E", "GRAY_A", "GRAY_B",
  "GRAY_C", "GRAY_D", "GRAY_E", "PURPLE_A", "PURPLE_B", "PURPLE_C", "PURPLE_D",
  "PURPLE_E", "TEAL_A", "TEAL_B", "TEAL_C", "TEAL_D", "TEAL_E", "MAROON_A",
  "MAROON_B", "MAROON_C", "MAROON_D", "MAROON_E",
]);

// snake_case -> camelCase overrides for names where a plain conversion would
// be wrong or where we want to be explicit.
const NAME_MAP: Record<string, string> = {
  run_time: "runTime",
  stroke_width: "strokeWidth",
  fill_opacity: "fillOpacity",
  stroke_opacity: "strokeOpacity",
  fill_color: "fillColor",
  stroke_color: "strokeColor",
  num_decimal_places: "numDecimalPlaces",
  bring_to_front: "bringToFront",
  bring_to_back: "bringToBack",
  set_color: "setColor",
  set_fill: "setFill",
  set_stroke: "setStroke",
  set_opacity: "setOpacity",
  next_to: "nextTo",
  move_to: "moveTo",
  to_edge: "toEdge",
  to_corner: "toCorner",
  scale_to_fit_width: "scaleToFitWidth",
  scale_to_fit_height: "scaleToFitHeight",
  get_center: "getCenter",
  get_top: "getTop",
  get_bottom: "getBottom",
  get_left: "getLeft",
  get_right: "getRight",
  get_corner: "getCorner",
  add_updater: "addUpdater",
  remove_updater: "removeUpdater",
  clear_updaters: "clearUpdaters",
  set_value: "setValue",
  get_value: "getValue",
  add_fixed_in_frame_mobjects: "addFixedInFrameMobjects",
  set_camera_orientation: "setCameraOrientation",
  begin_ambient_camera_rotation: "beginAmbientCameraRotation",
  stop_ambient_camera_rotation: "stopAmbientCameraRotation",
};

/** Convert a snake_case identifier to camelCase (respecting overrides). */
function toCamel(name: string): string {
  if (Object.prototype.hasOwnProperty.call(NAME_MAP, name)) return NAME_MAP[name];
  if (!name.includes("_")) return name;
  // Leave ALL_CAPS constants alone.
  if (/^[A-Z0-9_]+$/.test(name)) return name;
  return name.replace(/_([a-zA-Z0-9])/g, (_m, c: string) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Expression-level rewrites operating on a single logical code fragment.
// These are regex/string based and deliberately conservative.
// ---------------------------------------------------------------------------

/** Split a top-level argument list (comma separated, respecting brackets and
 *  strings) into an array of raw argument strings. */
function splitArgs(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  let inStr: string | null = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      cur += ch;
      if (ch === inStr && src[i - 1] !== "\\") inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      cur += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim().length > 0) out.push(cur.trim());
  return out;
}

/** Find the matching close paren for the `(` at `open`, returns its index. */
function matchParen(src: string, open: number): number {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === inStr && src[i - 1] !== "\\") inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const KW_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/;

/**
 * Rewrite a single expression fragment: f-strings, literals, numpy arrays,
 * `math.pi`, and — recursively — call expressions (adding `new ` + config
 * object where appropriate).
 */
function rewriteExpr(src: string): string {
  let s = src;

  // f-strings -> template literals (handle before other string handling).
  s = convertFStrings(s);

  // np.array([...]) -> [...]
  s = s.replace(/\bnp\.array\s*\(\s*(\[[^\]]*\])\s*\)/g, "$1");
  s = s.replace(/\bnumpy\.array\s*\(\s*(\[[^\]]*\])\s*\)/g, "$1");

  // [a,b,c] * RIGHT / RIGHT * [a,b,c]  -> [a,b,c]  (scale-by-direction idiom)
  s = s.replace(/(\[[^\]]*\])\s*\*\s*(RIGHT|LEFT|UP|DOWN|IN|OUT|ORIGIN)\b/g, "$1");
  s = s.replace(/\b(RIGHT|LEFT|UP|DOWN|IN|OUT|ORIGIN)\s*\*\s*(\[[^\]]*\])/g, "$2");

  // math.pi / np.pi -> Math.PI, math.tau, etc.
  s = s.replace(/\bmath\.pi\b/g, "Math.PI");
  s = s.replace(/\bnp\.pi\b/g, "Math.PI");
  s = s.replace(/\bmath\.tau\b/g, "(2 * Math.PI)");
  s = s.replace(/\bmath\.e\b/g, "Math.E");
  s = s.replace(/\b(?:math|np)\.(sqrt|sin|cos|tan|exp|log|abs|floor|ceil|pow|atan2|atan|asin|acos)\b/g,
    (_m, fn: string) => "Math." + fn);

  // Python literals.
  s = s.replace(/\bTrue\b/g, "true");
  s = s.replace(/\bFalse\b/g, "false");
  s = s.replace(/\bNone\b/g, "null");

  // Recursively process call expressions.
  s = rewriteCalls(s);

  return s;
}

/** Convert Python f-strings f"...{expr}..." into JS template literals. */
function convertFStrings(src: string): string {
  return src.replace(/\bf(["'])((?:\\.|(?!\1).)*)\1/g, (_m, _q: string, body: string) => {
    // {{ }} escape to literal braces; {expr} to ${expr}.
    const converted = body
      .replace(/\{\{/g, " L")
      .replace(/\}\}/g, " R")
      .replace(/\{([^}]*)\}/g, (_mm, expr: string) => "${" + rewriteExpr(expr.trim()) + "}")
      .replace(/ L/g, "{")
      .replace(/ R/g, "}");
    return "`" + converted + "`";
  });
}

/**
 * Scan `src` for `Ident(...)` call expressions and rewrite them. For known
 * classes, prefix `new ` and fold keyword args into a trailing config object.
 * Recurses into argument lists.
 */
function rewriteCalls(src: string): string {
  let out = "";
  let i = 0;
  const idRe = /[A-Za-z_$][A-Za-z0-9_$]*/y;
  while (i < src.length) {
    const ch = src[i];
    // Python raw string r"..." / R'...' (f-strings are already converted to
    // template literals earlier in rewriteExpr). Drop the prefix and escape
    // backslashes in the body, since raw-string semantics ("\p" is a literal
    // backslash+p) become normal-string semantics in the JS output ("\n"
    // would otherwise be read back as an actual newline).
    if ((ch === "r" || ch === "R") && (src[i + 1] === '"' || src[i + 1] === "'")) {
      const quote = src[i + 1];
      let j = i + 2;
      while (j < src.length && !(src[j] === quote && src[j - 1] !== "\\")) j++;
      const body = src.slice(i + 2, j);
      out += quote + body.replace(/\\/g, "\\\\") + quote;
      i = j + 1;
      continue;
    }
    // Skip string literals verbatim.
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < src.length && !(src[j] === quote && src[j - 1] !== "\\")) j++;
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    // Try to match an identifier followed by `(`.
    idRe.lastIndex = i;
    const m = idRe.exec(src);
    if (m && m.index === i) {
      let name = m[0];
      let after = i + name.length;
      // Skip whitespace between name and paren.
      let k = after;
      while (k < src.length && src[k] === " ") k++;
      // Handle both constructor calls (`Name(`) and dotted method calls
      // (`.method(`). Dotted calls never get `new`, but their keyword args are
      // still folded into a trailing config object.
      if (src[k] === "(") {
        const close = matchParen(src, k);
        if (close !== -1) {
          const dotted = isPrecededByDot(src, i);
          const argsRaw = src.slice(k + 1, close);
          const rebuilt = rebuildCall(name, argsRaw, dotted);
          out += rebuilt;
          i = close + 1;
          continue;
        }
      }
      // Not a call head we transform; but still camelCase method names that
      // follow a dot (e.g. `.set_fill(`), handled elsewhere. Emit as-is.
      out += name;
      i = after;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function isPrecededByDot(src: string, idx: number): boolean {
  let j = idx - 1;
  while (j >= 0 && src[j] === " ") j--;
  return j >= 0 && src[j] === ".";
}

/** Rebuild a `Name(argsRaw)` call into TS, recursing into args. When `dotted`
 *  the call is a method call (`.method(...)`) so it never gets a `new` prefix,
 *  but keyword args are still folded into a trailing config object. */
function rebuildCall(name: string, argsRaw: string, dotted = false): string {
  const args = splitArgs(argsRaw);
  const positional: string[] = [];
  const kwargs: string[] = [];
  for (const a of args) {
    const km = KW_RE.exec(a);
    if (km) {
      const key = km[1];
      const val = a.slice(km[0].length).trim();
      kwargs.push(`${toCamel(key)}: ${rewriteExpr(val)}`);
    } else {
      positional.push(rewriteExpr(a));
    }
  }

  const parts: string[] = [...positional];
  if (kwargs.length > 0) parts.push(`{ ${kwargs.join(", ")} }`);

  const isKnown = !dotted && KNOWN_CLASSES.has(name);
  const prefix = isKnown ? "new " : "";
  // Known classes are already PascalCase (toCamel is a no-op on them); a bare
  // call to a user-defined snake_case helper needs to match its camelCased
  // `function` declaration (see the top-level `def` handling above).
  const callee = dotted ? name : toCamel(name);
  return `${prefix}${callee}(${parts.join(", ")})`;
}

// ---------------------------------------------------------------------------
// Statement-level rewrite (applied to a single logical line's body, after
// self./method-name handling).
// ---------------------------------------------------------------------------

function rewriteStatement(body: string): string {
  let s = body;

  // self.play / self.wait get awaited; must run before generic self. rewrite.
  // Detect leading (possibly after assignment) self.play( / self.wait(.
  s = s.replace(/\bself\.play\b/g, " AWAIT this.play");
  s = s.replace(/\bself\.wait\b/g, " AWAIT this.wait");

  // self.<name> -> this.<camel name>
  s = s.replace(/\bself\.([A-Za-z_][A-Za-z0-9_]*)/g, (_m, n: string) => "this." + toCamel(n));

  // .method_name( snake case -> camelCase (dotted calls).
  s = s.replace(/\.([a-z_][A-Za-z0-9_]*)\s*\(/g, (_m, n: string) => "." + toCamel(n) + "(");
  // .property snake case (no call) -> camelCase for known accessors.
  s = s.replace(/\.([a-z]+_[a-z_]*)\b(?!\s*\()/g, (_m, n: string) => "." + toCamel(n));

  // Expression rewrites (calls, literals, f-strings, numpy).
  s = rewriteExpr(s);

  // Power operator: Python `**` already valid in JS; leave as-is.

  // self.play(...) special: append play-config object when kwargs present.
  s = foldPlayConfig(s);

  // Restore await markers.
  s = s.replace(/ AWAIT /g, "await ");

  return s;
}

/**
 * For `this.play(<args>)`, mark the trailing config object (already produced by
 * the generic call rewriter from run_time=... etc.) with `_playConfig: true`,
 * matching ecmanim's play() signature. Runs after rewriteExpr, so keyword args
 * have already been folded into a `{ ... }` object argument.
 */
function foldPlayConfig(s: string): string {
  const idx = s.indexOf("this.play(");
  if (idx === -1) return s;
  const open = idx + "this.play".length;
  const close = matchParen(s, open);
  if (close === -1) return s;
  const inner = s.slice(open + 1, close);
  const args = splitArgs(inner);
  if (args.length === 0) return s;
  const last = args[args.length - 1];
  // Only fold when the final argument is a plain object literal (the config).
  if (!(last.startsWith("{") && last.endsWith("}"))) return s;
  if (last.includes("_playConfig")) return s;
  const body = last.slice(1, -1).trim();
  const merged = body.length > 0
    ? `{ _playConfig: true, ${body} }`
    : `{ _playConfig: true }`;
  args[args.length - 1] = merged;
  const rebuilt = `this.play(${args.join(", ")})`;
  return s.slice(0, idx) + rebuilt + s.slice(close + 1);
}

// ---------------------------------------------------------------------------
// Import detection.
// ---------------------------------------------------------------------------

const IDENT_G = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;

function detectImports(tsBody: string): string[] {
  const used = new Set<string>();
  let m: RegExpExecArray | null;
  IDENT_G.lastIndex = 0;
  while ((m = IDENT_G.exec(tsBody)) !== null) {
    const id = m[0];
    if (KNOWN_CLASSES.has(id) || KNOWN_CONSTS.has(id)) used.add(id);
  }
  // Scene bases the user extends must also be imported.
  const ext = /\bextends\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  while ((m = ext.exec(tsBody)) !== null) {
    if (KNOWN_CLASSES.has(m[1])) used.add(m[1]);
  }
  return [...used].sort();
}

// ---------------------------------------------------------------------------
// Main line-by-line conversion with indentation-based brace tracking.
// ---------------------------------------------------------------------------

interface Block {
  indent: number; // python indentation column that opened the block
  kind?: "class"; // set for `class X:` blocks, so nested `def`s know they're methods
}

export function convert(pythonSource: string, opts: Py2TsOptions = {}): string {
  const importFrom = opts.importFrom ?? "ecmanim";
  const indentUnit = opts.indent ?? "  ";

  const rawLines = pythonSource.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  const blocks: Block[] = []; // stack of open python blocks (needing `}`)

  const emit = (depth: number, text: string) => {
    out.push(indentUnit.repeat(depth) + text);
  };

  const closeTo = (col: number) => {
    while (blocks.length > 0 && blocks[blocks.length - 1].indent >= col) {
      blocks.pop();
      emit(blocks.length, "}");
    }
  };

  for (let li = 0; li < rawLines.length; li++) {
    const raw = rawLines[li];
    const trimmed = raw.trim();

    // Blank line: preserve.
    if (trimmed === "") {
      out.push("");
      continue;
    }

    const indent = raw.length - raw.replace(/^\s+/, "").length;

    // Pure comment line.
    if (trimmed.startsWith("#")) {
      closeTo(indent);
      emit(blocks.length, "//" + trimmed.slice(1));
      continue;
    }

    // Import handling: drop; we synthesize a header later.
    if (/^\s*(from\s+manim\b|import\s+manim\b|from\s+manim\.|import\s+numpy|from\s+numpy\b|import\s+math\b)/.test(raw)) {
      continue;
    }

    // Close any blocks we've dedented out of before emitting this line.
    closeTo(indent);
    const depth = blocks.length;

    // Split trailing inline comment (best-effort; avoids strings).
    const { code, comment } = splitInlineComment(trimmed);

    // --- class X(Base): ------------------------------------------------
    let m = /^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\))?\s*:\s*$/.exec(code);
    if (m) {
      const cls = m[1];
      const base = m[2];
      const ext = base && SCENE_BASES.has(base) ? ` extends ${base}` : base ? ` extends ${base}` : "";
      emit(depth, `class ${cls}${ext} {${commentSuffix(comment)}`);
      blocks.push({ indent, kind: "class" });
      continue;
    }

    // --- def construct(self): / def m(self, ...): -- OR a top-level def ---
    m = /^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*:\s*$/.exec(code);
    if (m) {
      const fn = m[1];
      const params = m[2];
      const isMethod = blocks.length > 0 && blocks[blocks.length - 1].kind === "class";
      const paramList = splitArgs(params).filter((p) => p !== "self" && p !== "cls");
      const paramStr = paramList.map((p) => rewriteParam(p)).join(", ");
      const isConstruct = isMethod && fn === "construct";
      const asyncKw = isConstruct ? "async " : "";
      const jsName = isConstruct ? "construct" : (isMethod && fn === "__init__" ? "constructor" : toCamel(fn));
      const fnKw = isMethod ? "" : "function ";
      emit(depth, `${fnKw}${asyncKw}${jsName}(${paramStr}) {${commentSuffix(comment)}`);
      blocks.push({ indent });
      continue;
    }

    // --- for X in Y: ---------------------------------------------------
    m = /^for\s+(.+?)\s+in\s+(.+?)\s*:\s*$/.exec(code);
    if (m) {
      const varPart = m[1].trim();
      const iterRaw = m[2].trim();
      const { loopVar, iter } = convertForIter(varPart, iterRaw);
      emit(depth, `for (const ${loopVar} of ${iter}) {${commentSuffix(comment)}`);
      blocks.push({ indent });
      continue;
    }

    // --- while COND: ---------------------------------------------------
    m = /^while\s+(.+?)\s*:\s*$/.exec(code);
    if (m) {
      emit(depth, `while (${rewriteCondition(m[1])}) {${commentSuffix(comment)}`);
      blocks.push({ indent });
      continue;
    }

    // --- if / elif / else ---------------------------------------------
    m = /^if\s+(.+?)\s*:\s*$/.exec(code);
    if (m) {
      emit(depth, `if (${rewriteCondition(m[1])}) {${commentSuffix(comment)}`);
      blocks.push({ indent });
      continue;
    }
    m = /^elif\s+(.+?)\s*:\s*$/.exec(code);
    if (m) {
      // Close the previous if-block and chain.
      if (blocks.length > 0 && blocks[blocks.length - 1].indent === indent) {
        blocks.pop();
        emit(blocks.length, `} else if (${rewriteCondition(m[1])}) {${commentSuffix(comment)}`);
        blocks.push({ indent });
        continue;
      }
      emit(depth, `else if (${rewriteCondition(m[1])}) {`);
      blocks.push({ indent });
      continue;
    }
    if (/^else\s*:\s*$/.test(code)) {
      if (blocks.length > 0 && blocks[blocks.length - 1].indent === indent) {
        blocks.pop();
        emit(blocks.length, `} else {${commentSuffix(comment)}`);
        blocks.push({ indent });
        continue;
      }
      emit(depth, `else {`);
      blocks.push({ indent });
      continue;
    }

    // --- with EXPR (as X): --------------------------------------------
    m = /^with\s+(.+?)\s*:\s*$/.exec(code);
    if (m) {
      emit(depth, `/* TODO py2ts: with-statement */ {${commentSuffix(comment)}`);
      // still translate the expression as a statement inside.
      emit(depth + 1, rewriteStatement(m[1].replace(/\s+as\s+\w+$/, "")) + ";");
      blocks.push({ indent });
      continue;
    }

    // --- return ---------------------------------------------------------
    m = /^return\b(.*)$/.exec(code);
    if (m) {
      const val = m[1].trim();
      emit(depth, val ? `return ${rewriteStatement(val)};${commentSuffix(comment)}` : `return;${commentSuffix(comment)}`);
      continue;
    }

    if (code === "pass") {
      emit(depth, `/* pass */${commentSuffix(comment)}`);
      continue;
    }
    if (code === "break") { emit(depth, `break;${commentSuffix(comment)}`); continue; }
    if (code === "continue") { emit(depth, `continue;${commentSuffix(comment)}`); continue; }

    // --- plain statement (assignment / expression) --------------------
    emit(depth, rewriteAssignmentOrExpr(code) + `;${commentSuffix(comment)}`);
  }

  // Close any remaining open blocks.
  while (blocks.length > 0) {
    blocks.pop();
    emit(blocks.length, "}");
  }

  const bodyStr = out.join("\n");
  const header = buildHeader(bodyStr, importFrom, opts.wildcardImport ?? false);
  return header + bodyStr + (bodyStr.endsWith("\n") ? "" : "\n");
}

// ---------------------------------------------------------------------------
// Helpers for statement forms.
// ---------------------------------------------------------------------------

function rewriteParam(p: string): string {
  // default values: `name=val`
  const eq = p.indexOf("=");
  if (eq !== -1) {
    const name = p.slice(0, eq).trim();
    const val = p.slice(eq + 1).trim();
    return `${toCamel(name)} = ${rewriteExpr(val)}`;
  }
  // strip type annotations `name: Type`
  const colon = p.indexOf(":");
  const name = colon !== -1 ? p.slice(0, colon).trim() : p.trim();
  return toCamel(name);
}

function rewriteAssignmentOrExpr(code: string): string {
  // Assignment: LHS = RHS  (skip ==, <=, >=, != and kwargs are line-internal).
  const m = /^([A-Za-z_$][A-Za-z0-9_$.\[\]]*)\s*(\+=|-=|\*=|\/=|=)\s*(.+)$/.exec(code);
  if (m && !/[=!<>]$/.test(m[1])) {
    const lhs = m[1];
    const op = m[2];
    const rhs = m[3];
    // Declare with const for simple new-binding assignments (single `=`, plain
    // identifier LHS, not previously seen — we can't track scope reliably, so
    // use `const` for `=` on a bare identifier).
    const decl = op === "=" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(lhs) ? "const " : "";
    return `${decl}${lhs} ${op} ${rewriteStatement(rhs)}`;
  }
  return rewriteStatement(code);
}

function convertForIter(varPart: string, iterRaw: string): { loopVar: string; iter: string } {
  // Tuple unpacking: `for a, b in ...` -> `[a, b]`
  let loopVar: string;
  if (varPart.includes(",")) {
    loopVar = "[" + splitArgs(varPart).map((v) => toCamel(v.trim())).join(", ") + "]";
  } else {
    loopVar = toCamel(varPart);
  }
  // range(n) / range(a, b) / range(a, b, step)
  const r = /^range\s*\((.*)\)$/.exec(iterRaw);
  if (r) {
    const parts = splitArgs(r[1]).map((p) => rewriteExpr(p));
    let start = "0", stop = "0", step = "1";
    if (parts.length === 1) { stop = parts[0]; }
    else if (parts.length === 2) { start = parts[0]; stop = parts[1]; }
    else if (parts.length >= 3) { start = parts[0]; stop = parts[1]; step = parts[2]; }
    // Prefer a readable helper: build an inline range array.
    return { loopVar, iter: `range(${[start, stop, step].join(", ")})` };
  }
  return { loopVar, iter: rewriteExpr(iterRaw) };
}

function rewriteCondition(cond: string): string {
  let s = rewriteExpr(cond);
  s = s.replace(/\band\b/g, "&&").replace(/\bor\b/g, "||").replace(/\bnot\s+/g, "!");
  return s;
}

function splitInlineComment(line: string): { code: string; comment: string } {
  let inStr: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === inStr && line[i - 1] !== "\\") inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "#") {
      return { code: line.slice(0, i).trim(), comment: line.slice(i + 1) };
    }
  }
  return { code: line.trim(), comment: "" };
}

function commentSuffix(comment: string): string {
  return comment ? ` //${comment}` : "";
}

function buildHeader(body: string, importFrom: string, wildcard: boolean): string {
  if (wildcard) {
    return `import * as mn from "${importFrom}";\n\n`;
  }
  const names = detectImports(body);
  // Also provide small `range`/`enumerate` helpers if referenced.
  const usesRange = /\brange\(/.test(body);
  const usesEnumerate = /\benumerate\(/.test(body);
  let header = "";
  if (names.length > 0) {
    header += `import { ${names.join(", ")} } from "${importFrom}";\n`;
  } else {
    header += `import "${importFrom}";\n`;
  }
  if (usesRange) {
    header +=
      "\n// py2ts helper: Python range() -> array.\n" +
      "function range(start: number, stop?: number, step = 1): number[] {\n" +
      "  if (stop === undefined) { stop = start; start = 0; }\n" +
      "  const out: number[] = [];\n" +
      "  if (step > 0) for (let i = start; i < stop; i += step) out.push(i);\n" +
      "  else for (let i = start; i > stop; i += step) out.push(i);\n" +
      "  return out;\n" +
      "}\n";
  }
  if (usesEnumerate) {
    header +=
      "\n// py2ts helper: Python enumerate() -> [index, item] pairs.\n" +
      "function* enumerate<T>(iterable: Iterable<T>, start = 0): Generator<[number, T]> {\n" +
      "  let i = start;\n" +
      "  for (const x of iterable) yield [i++, x];\n" +
      "}\n";
  }
  return header + "\n";
}
