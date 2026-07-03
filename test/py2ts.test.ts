import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { convert } from "../src/tools/py2ts.ts";

const CLI = fileURLToPath(new URL("../bin/py2ts.ts", import.meta.url));
// Absolute file:// URL to the real, uncompiled library source, so execution
// tests can run converted output directly without the package being installed.
const NODE_ENTRY = new URL("../src/node.ts", import.meta.url).href;

/**
 * Convert `py` and actually RUN the result: write it to a temp .ts file,
 * import it, instantiate the first exported Scene subclass with a no-op
 * frameHandler (no ffmpeg/rendering involved), and run its construct().
 * Returns the live scene instance for assertions on real runtime state —
 * this catches cases where generated text merely *looks* right but doesn't
 * behave correctly, which regex-matching the source can't.
 */
async function runScene(py: string, className?: string): Promise<any> {
  const ts = convert(py, { importFrom: NODE_ENTRY });
  const dir = mkdtempSync(join(tmpdir(), "py2ts-exec-"));
  const file = join(dir, "scene.ts");
  writeFileSync(file, ts);
  try {
    const mod: any = await import(pathToFileURL(file).href);
    const target = (className && mod[className]) || mod.default ||
      Object.values(mod).find((v: any) => typeof v === "function");
    if (!target) throw new Error("runScene: no exported class found in converted output:\n" + ts);
    const scene = new target({ fps: 10, frameHandler: async () => {} });
    await scene.render();
    return scene;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("class + construct: Scene subclass -> extends Scene / async construct()", async () => {
  const py = [
    "from manim import *",
    "",
    "class MyScene(Scene):",
    "    def construct(self):",
    "        c = Circle()",
    "        self.add(c)",
  ].join("\n");
  const ts = convert(py);
  assert.match(ts, /export class MyScene extends Scene \{/);
  assert.match(ts, /async construct\(\) \{/);
  assert.match(ts, /this\.add\(c\)/);
  // import header references detected identifiers.
  assert.match(ts, /import \{[^}]*\bCircle\b[^}]*\} from "ecmanim"/);
  assert.match(ts, /import \{[^}]*\bScene\b[^}]*\} from "ecmanim"/);

  // Execution: the class is actually discoverable (it's exported — the CLI's
  // scene-lookup depends entirely on module exports) and self.add() really
  // adds a real Circle to the scene.
  const scene = await runScene(py);
  assert.equal(scene.mobjects.length, 1);
  assert.equal(scene.mobjects[0].constructor.name, "Circle");
});

test("self.play(Create(Circle(radius=2, color=RED)), run_time=2) folds config objects", async () => {
  const py = [
    "class S(Scene):",
    "    def construct(self):",
    "        self.play(Create(Circle(radius=2, color=RED)), run_time=2)",
  ].join("\n");
  const ts = convert(py);
  // Key substrings (allow whitespace differences).
  assert.match(ts, /await this\.play\(/);
  assert.match(ts, /new Create\(new Circle\(\{ radius: 2, color: RED \}\)\)/);
  assert.match(ts, /_playConfig: true/);
  assert.match(ts, /runTime: 2/);

  // Execution: the circle really has radius 2 / color RED, and run_time=2
  // really governs the scene clock (not just present in the source text).
  const scene = await runScene(py);
  const circle = scene.mobjects[0];
  assert.equal(circle.radius, 2);
  // ecmanim's RED is manim's curated palette red, not pure CSS #ff0000.
  assert.equal(circle.color.toHex ? circle.color.toHex() : circle.color, "#fc6255");
  assert.ok(Math.abs(scene.time - 2) < 0.01, `expected scene.time ~2, got ${scene.time}`);
});

test("self.wait(0.5) -> await this.wait(0.5)", async () => {
  const py = "class S(Scene):\n    def construct(self):\n        self.wait(0.5)";
  const ts = convert(py);
  assert.match(ts, /await this\.wait\(0\.5\)/);

  const scene = await runScene(py);
  assert.ok(Math.abs(scene.time - 0.5) < 0.01, `expected scene.time ~0.5, got ${scene.time}`);
});

test("snake_case kwargs are camelCased", async () => {
  const py =
    "class S(Scene):\n    def construct(self):\n" +
    "        self.sq = Square(side_length=3, stroke_width=4, fill_opacity=0.5)\n" +
    "        self.add(self.sq)";
  const ts = convert(py);
  assert.match(ts, /new Square\(\{ sideLength: 3, strokeWidth: 4, fillOpacity: 0\.5 \}\)/);

  // Execution: the real Square instance actually received these config
  // values (kwarg folding could produce plausible-looking but wrong JSON).
  const scene = await runScene(py);
  assert.equal(scene.sq.sideLength, 3);
  assert.equal(scene.sq.strokeWidth, 4);
  assert.equal(scene.sq.fillOpacity, 0.5);
});

test("comments, True/False/None conversion", async () => {
  const py = [
    "class S(Scene):",
    "    def construct(self):",
    "        # make a dot",
    "        d = Dot(fill_opacity=1.0)  # inline",
    "        self.flag = True",
    "        self.off = False",
    "        self.empty = None",
  ].join("\n");
  const ts = convert(py);
  assert.match(ts, /\/\/ make a dot/);
  assert.match(ts, /\/\/ inline/);
  assert.match(ts, /this\.flag = true/);
  assert.match(ts, /this\.off = false/);
  assert.match(ts, /this\.empty = null/);

  const scene = await runScene(py);
  assert.equal(scene.flag, true);
  assert.equal(scene.off, false);
  assert.equal(scene.empty, null);
});

test("f-strings -> template literals; np.array + math.pi", async () => {
  const py = [
    "class S(Scene):",
    "    def construct(self):",
    "        x = 3",
    "        self.label = f\"value {x}\"",
    "        self.v = np.array([1, 2, 3])",
    "        self.a = math.pi",
  ].join("\n");
  const ts = convert(py);
  assert.match(ts, /`value \$\{x\}`/);
  assert.match(ts, /\[1, 2, 3\]/);
  assert.match(ts, /Math\.PI/);

  const scene = await runScene(py);
  assert.equal(scene.label, "value 3");
  assert.deepEqual(scene.v, [1, 2, 3]);
  assert.equal(scene.a, Math.PI);
});

test("ThreeDScene base and camera frame; for-range loop", async () => {
  const py = [
    "class Demo(ThreeDScene):",
    "    def construct(self):",
    "        for i in range(3):",
    "            self.wait(0.1)",
  ].join("\n");
  const ts = convert(py);
  assert.match(ts, /export class Demo extends ThreeDScene \{/);
  assert.match(ts, /for \(const i of range\(0, 3, 1\)\) \{/);
  assert.match(ts, /await this\.wait\(0\.1\)/);

  const scene = await runScene(py);
  assert.equal(scene.constructor.name, "Demo");
  // 3 iterations of wait(0.1) -> ~0.3s total.
  assert.ok(Math.abs(scene.time - 0.3) < 0.01, `expected scene.time ~0.3, got ${scene.time}`);
});

test("mob.animate.shift(RIGHT) and dotted method camelCasing pass through", async () => {
  const py =
    "class S(Scene):\n    def construct(self):\n" +
    "        self.sq = Square()\n        self.add(self.sq)\n" +
    "        self.play(self.sq.animate.shift(RIGHT))\n" +
    "        self.sq.set_fill(RED, opacity=0.3)";
  const ts = convert(py);
  assert.match(ts, /this\.sq\.animate\.shift\(RIGHT\)/);
  assert.match(ts, /this\.sq\.setFill\(RED, \{ opacity: 0\.3 \}\)/);

  const scene = await runScene(py);
  // RIGHT shifts +x by 1 unit; setFill(RED, opacity: 0.3) really applies.
  assert.ok(Math.abs(scene.sq.getCenter()[0] - 1) < 0.01);
  assert.equal(scene.sq.fillOpacity, 0.3);
});

test("raw strings r\"...\" drop the prefix and escape backslashes", async () => {
  const py =
    "class S(Scene):\n    def construct(self):\n" +
    "        self.a = Text(r\"e^{i\\pi} + 1 = 0\")\n" +
    "        self.b = Text(r'line1\\nline2')";
  const ts = convert(py);
  assert.match(ts, /new Text\("e\^\{i\\\\pi\} \+ 1 = 0"\)/);
  // \n inside a raw string is literal backslash+n, not a newline -- must stay escaped.
  assert.match(ts, /new Text\('line1\\\\nline2'\)/);

  // Execution: the real Text mobject's .text is exactly the raw-string value
  // -- a literal backslash+n, NOT an actual newline (which is what a naive
  // "just strip the r prefix" fix without escaping would have produced).
  const scene = await runScene(py);
  assert.equal(scene.a.text, "e^{i\\pi} + 1 = 0");
  assert.equal(scene.b.text, "line1\\nline2");
  assert.ok(!scene.b.text.includes("\n"), "raw \\n must stay literal, not become a real newline");
});

test("enumerate() emits a generator helper and converts for i, x in enumerate(...)", async () => {
  const py =
    "class S(Scene):\n    def construct(self):\n" +
    "        dots = VGroup(Dot(), Dot(), Dot())\n" +
    "        self.order = []\n" +
    "        for i, d in enumerate(dots):\n            self.order.append(i)";
  const ts = convert(py);
  assert.match(ts, /function\* enumerate/);
  assert.match(ts, /for \(const \[i, d\] of enumerate\(dots\)\) \{/);

  // Execution: real indices, in order, over a real VGroup (this also
  // regression-tests Mobject's new [Symbol.iterator] -- enumerate()'s
  // `for (const x of iterable)` needs a genuinely iterable VGroup).
  const scene = await runScene(py);
  assert.deepEqual(scene.order, [0, 1, 2]);
});

test("enumerate(dots, 1) honors a custom start index", async () => {
  const py =
    "class S(Scene):\n    def construct(self):\n" +
    "        dots = VGroup(Dot(), Dot())\n" +
    "        self.order = []\n" +
    "        for i, d in enumerate(dots, 1):\n            self.order.append(i)";
  const scene = await runScene(py);
  assert.deepEqual(scene.order, [1, 2]);
});

test("top-level def gets `function` keyword; call site matches the camelCased name", async () => {
  const py =
    "def helper_positions(n):\n    return n * 2\n\n" +
    "class S(Scene):\n    def construct(self):\n        self.positions = helper_positions(4)";
  const ts = convert(py);
  assert.match(ts, /export function helperPositions\(n\) \{/);
  assert.match(ts, /this\.positions = helperPositions\(4\)/);

  const scene = await runScene(py);
  assert.equal(scene.positions, 8);

  // The method-shorthand form (no `function` keyword, no `export`) must
  // still be used for an actual method with the same name pattern, inside
  // a class.
  const py2 = "class S(Scene):\n    def do_thing(self):\n        pass";
  const ts2 = convert(py2);
  assert.match(ts2, /doThing\(\) \{/);
  assert.doesNotMatch(ts2, /function doThing/);
  assert.doesNotMatch(ts2, /export function/);
});

test("multiple top-level functions, including one calling another", async () => {
  const py = [
    "def double(n):",
    "    return n * 2",
    "",
    "def quadruple(n):",
    "    return double(double(n))",
    "",
    "class S(Scene):",
    "    def construct(self):",
    "        self.result = quadruple(3)",
  ].join("\n");
  const ts = convert(py);
  assert.match(ts, /export function double\(n\) \{/);
  assert.match(ts, /export function quadruple\(n\) \{/);
  assert.match(ts, /return double\(double\(n\)\)/);

  const scene = await runScene(py);
  assert.equal(scene.result, 12);
});

test("self.attr = value assignments: self. -> this. on the LEFT-hand side too", async () => {
  // Regression test: rewriteStatement only ever runs on an assignment's RHS
  // (see rewriteAssignmentOrExpr), so `self.x = ...` previously left literal,
  // undefined-at-runtime `self.x = ...` on the LHS.
  const py = [
    "class S(Scene):",
    "    def construct(self):",
    "        self.count = 1",
    "        self.count = self.count + 1",
    "        c = Circle()",
    "        self.my_circle = c",
  ].join("\n");
  const ts = convert(py);
  assert.match(ts, /this\.count = 1/);
  assert.match(ts, /this\.count = this\.count \+ 1/);
  assert.match(ts, /this\.myCircle = c/);
  assert.doesNotMatch(ts, /(?<!this\.)(?<![\w.])self\./, "no literal `self.` should survive conversion");

  const scene = await runScene(py);
  assert.equal(scene.count, 2);
  assert.equal(scene.myCircle.constructor.name, "Circle");
});

test("CLI: node bin/py2ts.ts converts a file to stdout", () => {
  const inFile = join(tmpdir(), `py2ts_${process.pid}.py`);
  writeFileSync(
    inFile,
    "from manim import *\n\nclass Cli(Scene):\n    def construct(self):\n        self.play(Create(Circle(radius=2, color=RED)), run_time=2)\n        self.wait(0.5)\n",
  );
  try {
    const out = execFileSync("node", [CLI, inFile], { encoding: "utf8" });
    assert.match(out, /export class Cli extends Scene \{/);
    assert.match(out, /async construct\(\) \{/);
    assert.match(out, /await this\.play\(new Create\(new Circle\(\{ radius: 2, color: RED \}\)\)/);
    assert.match(out, /_playConfig: true/);
    assert.match(out, /await this\.wait\(0\.5\)/);
  } finally {
    rmSync(inFile, { force: true });
  }
});

test("CLI: a converted file is actually discoverable and renderable via `ecmanim render`", async () => {
  // Regression test for a real bug: py2ts didn't `export` the converted
  // class, so `ecmanim render <file> <SceneName>` (which finds scenes by
  // inspecting the imported module's own exports) silently rendered
  // nothing at all -- no error, no video, just a "no exported Scene found"
  // warning. Exercises the full py2ts -> ecmanim CLI pipeline end to end.
  const ECMANIM_CLI = fileURLToPath(new URL("../bin/ecmanim.ts", import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), "py2ts-cli-render-"));
  const pyFile = join(dir, "s.py");
  const tsFile = join(dir, "s.ts");
  const outFile = join(dir, "out.mp4");
  try {
    writeFileSync(
      pyFile,
      "class RenderCheck(Scene):\n    def construct(self):\n        c = Circle()\n        self.add(c)\n        self.wait(0.2)\n",
    );
    const converted = execFileSync("node", [CLI, pyFile], { encoding: "utf8" })
      .replace('from "ecmanim"', `from "${NODE_ENTRY}"`);
    writeFileSync(tsFile, converted);

    execFileSync("node", [ECMANIM_CLI, "render", tsFile, "RenderCheck", "-q", "low", "-o", outFile], {
      encoding: "utf8",
    });

    const { existsSync, statSync } = await import("node:fs");
    assert.ok(existsSync(outFile), "expected a real output video, not a silent no-op");
    assert.ok(statSync(outFile).size > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
