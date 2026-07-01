// A small, SAFE arithmetic-expression evaluator for the portable plugin
// MANIFEST format. It is a hand-written recursive-descent parser + tree-walking
// interpreter — deliberately NO `eval` / `new Function`, so a manifest string
// can never execute arbitrary code. The exact same grammar is re-implemented in
// Python (packages/manim-portable-plugins) so a manifest evaluates identically
// on both sides.
//
// Grammar (lowest precedence first):
//   expr    := term (('+' | '-') term)*
//   term    := unary (('*' | '/') unary)*
//   unary   := ('-' | '+') unary | power
//   power   := atom ('^' unary)?          // right-associative
//   atom    := number
//            | name                        // variable or constant
//            | name '(' args ')'           // function call
//            | '(' expr ')'
//   args    := expr (',' expr)*
//
// Supported functions: sin cos tan asin acos atan exp log sqrt abs floor ceil
//                      min max pow
// Supported constants: pi, e, tau
//
// `compileExpr(src, varNames)` returns `(scope) => number`, reading variables
// from `scope` by name. Parsing happens once; the returned closure is cheap.

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
};

// Function table. Each takes the evaluated argument list. Arity is checked.
type Fn = (args: number[]) => number;
const FUNCTIONS: Record<string, { arity: number | "variadic"; fn: Fn }> = {
  sin: { arity: 1, fn: (a) => Math.sin(a[0]) },
  cos: { arity: 1, fn: (a) => Math.cos(a[0]) },
  tan: { arity: 1, fn: (a) => Math.tan(a[0]) },
  asin: { arity: 1, fn: (a) => Math.asin(a[0]) },
  acos: { arity: 1, fn: (a) => Math.acos(a[0]) },
  atan: { arity: 1, fn: (a) => Math.atan(a[0]) },
  exp: { arity: 1, fn: (a) => Math.exp(a[0]) },
  log: { arity: 1, fn: (a) => Math.log(a[0]) },
  sqrt: { arity: 1, fn: (a) => Math.sqrt(a[0]) },
  abs: { arity: 1, fn: (a) => Math.abs(a[0]) },
  floor: { arity: 1, fn: (a) => Math.floor(a[0]) },
  ceil: { arity: 1, fn: (a) => Math.ceil(a[0]) },
  pow: { arity: 2, fn: (a) => Math.pow(a[0], a[1]) },
  min: { arity: "variadic", fn: (a) => Math.min(...a) },
  max: { arity: "variadic", fn: (a) => Math.max(...a) },
};

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------
type TokKind = "num" | "name" | "op" | "lparen" | "rparen" | "comma" | "eof";
interface Token { kind: TokKind; value: string; pos: number; }

function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  const n = src.length;
  const isDigit = (c: string) => c >= "0" && c <= "9";
  const isNameStart = (c: string) => /[A-Za-z_]/.test(c);
  const isNamePart = (c: string) => /[A-Za-z0-9_]/.test(c);

  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (isDigit(c) || (c === "." && isDigit(src[i + 1] ?? ""))) {
      let j = i;
      while (j < n && (isDigit(src[j]) || src[j] === ".")) j++;
      // optional exponent: 1e3, 2.5e-4
      if (j < n && (src[j] === "e" || src[j] === "E")) {
        let k = j + 1;
        if (k < n && (src[k] === "+" || src[k] === "-")) k++;
        if (k < n && isDigit(src[k])) { while (k < n && isDigit(src[k])) k++; j = k; }
      }
      toks.push({ kind: "num", value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if (isNameStart(c)) {
      let j = i;
      while (j < n && isNamePart(src[j])) j++;
      toks.push({ kind: "name", value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if (c === "(") { toks.push({ kind: "lparen", value: c, pos: i++ }); continue; }
    if (c === ")") { toks.push({ kind: "rparen", value: c, pos: i++ }); continue; }
    if (c === ",") { toks.push({ kind: "comma", value: c, pos: i++ }); continue; }
    if ("+-*/^".includes(c)) { toks.push({ kind: "op", value: c, pos: i++ }); continue; }
    throw new Error(`expr: unexpected character '${c}' at ${i} in "${src}"`);
  }
  toks.push({ kind: "eof", value: "", pos: n });
  return toks;
}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------
type Node =
  | { t: "num"; v: number }
  | { t: "var"; name: string }
  | { t: "const"; v: number }
  | { t: "neg"; a: Node }
  | { t: "bin"; op: string; a: Node; b: Node }
  | { t: "call"; name: string; args: Node[] };

// ---------------------------------------------------------------------------
// Parser (recursive descent)
// ---------------------------------------------------------------------------
class Parser {
  toks: Token[];
  i = 0;
  src: string;
  varSet: Set<string>;

  constructor(toks: Token[], src: string, varNames: string[]) {
    this.toks = toks;
    this.src = src;
    this.varSet = new Set(varNames);
  }

  peek(): Token { return this.toks[this.i]; }
  next(): Token { return this.toks[this.i++]; }
  err(msg: string): never { throw new Error(`expr: ${msg} in "${this.src}"`); }

  parse(): Node {
    const node = this.parseExpr();
    if (this.peek().kind !== "eof") this.err(`unexpected '${this.peek().value}'`);
    return node;
  }

  // expr := term (('+' | '-') term)*
  parseExpr(): Node {
    let node = this.parseTerm();
    while (this.peek().kind === "op" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.next().value;
      const rhs = this.parseTerm();
      node = { t: "bin", op, a: node, b: rhs };
    }
    return node;
  }

  // term := unary (('*' | '/') unary)*
  parseTerm(): Node {
    let node = this.parseUnary();
    while (this.peek().kind === "op" && (this.peek().value === "*" || this.peek().value === "/")) {
      const op = this.next().value;
      const rhs = this.parseUnary();
      node = { t: "bin", op, a: node, b: rhs };
    }
    return node;
  }

  // unary := ('-' | '+') unary | power
  parseUnary(): Node {
    if (this.peek().kind === "op" && (this.peek().value === "-" || this.peek().value === "+")) {
      const op = this.next().value;
      const operand = this.parseUnary();
      return op === "-" ? { t: "neg", a: operand } : operand;
    }
    return this.parsePower();
  }

  // power := atom ('^' unary)?   (right-associative)
  parsePower(): Node {
    const base = this.parseAtom();
    if (this.peek().kind === "op" && this.peek().value === "^") {
      this.next();
      const exp = this.parseUnary(); // right-assoc: unary lets 2^-3 parse
      return { t: "bin", op: "^", a: base, b: exp };
    }
    return base;
  }

  // atom := number | name | name '(' args ')' | '(' expr ')'
  parseAtom(): Node {
    const t = this.peek();
    if (t.kind === "num") {
      this.next();
      const v = Number(t.value);
      if (!Number.isFinite(v)) this.err(`bad number '${t.value}'`);
      return { t: "num", v };
    }
    if (t.kind === "lparen") {
      this.next();
      const inner = this.parseExpr();
      if (this.peek().kind !== "rparen") this.err("expected ')'");
      this.next();
      return inner;
    }
    if (t.kind === "name") {
      this.next();
      const name = t.value;
      // function call?
      if (this.peek().kind === "lparen") {
        this.next();
        const args: Node[] = [];
        if (this.peek().kind !== "rparen") {
          args.push(this.parseExpr());
          while (this.peek().kind === "comma") { this.next(); args.push(this.parseExpr()); }
        }
        if (this.peek().kind !== "rparen") this.err("expected ')'");
        this.next();
        const spec = FUNCTIONS[name];
        if (!spec) this.err(`unknown function '${name}'`);
        if (spec.arity !== "variadic" && args.length !== spec.arity) {
          this.err(`function '${name}' expects ${spec.arity} argument(s), got ${args.length}`);
        }
        if (spec.arity === "variadic" && args.length < 1) {
          this.err(`function '${name}' expects at least 1 argument`);
        }
        return { t: "call", name, args };
      }
      // constant or variable
      if (name in CONSTANTS) return { t: "const", v: CONSTANTS[name] };
      if (this.varSet.has(name)) return { t: "var", name };
      this.err(`unknown name '${name}' (not a declared variable or constant)`);
    }
    this.err(`unexpected '${t.value || "end of input"}'`);
  }
}

// ---------------------------------------------------------------------------
// Evaluator (tree walker)
// ---------------------------------------------------------------------------
function evalNode(node: Node, scope: Record<string, number>): number {
  switch (node.t) {
    case "num": return node.v;
    case "const": return node.v;
    case "var": {
      const v = scope[node.name];
      return typeof v === "number" ? v : 0;
    }
    case "neg": return -evalNode(node.a, scope);
    case "bin": {
      const a = evalNode(node.a, scope);
      const b = evalNode(node.b, scope);
      switch (node.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return a / b;
        case "^": return Math.pow(a, b);
      }
      return NaN;
    }
    case "call": {
      const args = node.args.map((a) => evalNode(a, scope));
      return FUNCTIONS[node.name].fn(args);
    }
  }
}

export interface CompiledExpr {
  (scope?: Record<string, number>): number;
}

/**
 * Compile an expression string into a fast evaluator.
 * @param src expression, e.g. "0.5 - 0.5*cos(t*2*pi)"
 * @param varNames variable names the expression may reference, e.g. ["t"] or ["u","v"]
 * @returns (scope) => number
 */
export function compileExpr(src: string, varNames: string[] = []): CompiledExpr {
  const ast = new Parser(tokenize(src), src, varNames).parse();
  return (scope: Record<string, number> = {}) => evalNode(ast, scope);
}

/** Convenience: parse + evaluate once (used mostly in tests). */
export function evalExpr(src: string, scope: Record<string, number> = {}, varNames: string[] = []): number {
  return compileExpr(src, varNames)(scope);
}
