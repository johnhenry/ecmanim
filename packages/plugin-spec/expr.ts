// Portable, SAFE arithmetic-expression evaluator for the plugin MANIFEST format
// — the shared "reference" entry point for the expression grammar (documented
// in README.md alongside this file). NO `eval` / `new Function`: expressions are
// parsed by a hand-written recursive-descent parser and walked as an AST, so a
// manifest string can never execute arbitrary code. The identical grammar is
// re-implemented in Python (packages/manim-portable-plugins) so a manifest
// evaluates the same on both engines.
//
// Grammar (lowest precedence first):
//   expr    := term (('+' | '-') term)*
//   term    := unary (('*' | '/') unary)*
//   unary   := ('-' | '+') unary | power
//   power   := atom ('^' unary)?          // right-associative
//   atom    := number | name | name '(' args ')' | '(' expr ')'
//   args    := expr (',' expr)*
//
// Functions: sin cos tan asin acos atan exp log sqrt abs floor ceil min max pow
// Constants: pi, e, tau
//
// The implementation lives in `src/plugins/expr.ts` (so it type-checks under the
// package's rootDir) and is re-exported here as the portable spec's public API.
// `compileExpr(src, varNames)` -> `(scope) => number`.

export { compileExpr, evalExpr, type CompiledExpr } from "../../src/plugins/expr.ts";
