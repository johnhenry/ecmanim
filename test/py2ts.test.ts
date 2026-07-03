import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { convert } from "../src/tools/py2ts.ts";

const CLI = fileURLToPath(new URL("../bin/py2ts.ts", import.meta.url));

test("class + construct: Scene subclass -> extends Scene / async construct()", () => {
  const py = [
    "from manim import *",
    "",
    "class MyScene(Scene):",
    "    def construct(self):",
    "        c = Circle()",
    "        self.add(c)",
  ].join("\n");
  const ts = convert(py);
  assert.match(ts, /class MyScene extends Scene \{/);
  assert.match(ts, /async construct\(\) \{/);
  assert.match(ts, /this\.add\(c\)/);
  // import header references detected identifiers.
  assert.match(ts, /import \{[^}]*\bCircle\b[^}]*\} from "ecmanim"/);
  assert.match(ts, /import \{[^}]*\bScene\b[^}]*\} from "ecmanim"/);
});

test("self.play(Create(Circle(radius=2, color=RED)), run_time=2) folds config objects", () => {
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
});

test("self.wait(0.5) -> await this.wait(0.5)", () => {
  const ts = convert("class S(Scene):\n    def construct(self):\n        self.wait(0.5)");
  assert.match(ts, /await this\.wait\(0\.5\)/);
});

test("snake_case kwargs are camelCased", () => {
  const py =
    "class S(Scene):\n    def construct(self):\n" +
    "        s = Square(side_length=3, stroke_width=4, fill_opacity=0.5)";
  const ts = convert(py);
  assert.match(ts, /new Square\(\{ sideLength: 3, strokeWidth: 4, fillOpacity: 0\.5 \}\)/);
});

test("comments, True/False/None conversion", () => {
  const py = [
    "class S(Scene):",
    "    def construct(self):",
    "        # make a dot",
    "        d = Dot(fill_opacity=1.0)  # inline",
    "        flag = True",
    "        off = False",
    "        empty = None",
  ].join("\n");
  const ts = convert(py);
  assert.match(ts, /\/\/ make a dot/);
  assert.match(ts, /\/\/ inline/);
  assert.match(ts, /const flag = true/);
  assert.match(ts, /const off = false/);
  assert.match(ts, /const empty = null/);
});

test("f-strings -> template literals; np.array + math.pi", () => {
  const py = [
    "class S(Scene):",
    "    def construct(self):",
    "        label = Text(f\"value {x}\")",
    "        v = np.array([1, 2, 3])",
    "        a = math.pi",
  ].join("\n");
  const ts = convert(py);
  assert.match(ts, /`value \$\{x\}`/);
  assert.match(ts, /const v = \[1, 2, 3\]/);
  assert.match(ts, /const a = Math\.PI/);
});

test("ThreeDScene base and camera frame; for-range loop", () => {
  const py = [
    "class Demo(ThreeDScene):",
    "    def construct(self):",
    "        for i in range(3):",
    "            self.wait(0.1)",
  ].join("\n");
  const ts = convert(py);
  assert.match(ts, /class Demo extends ThreeDScene \{/);
  assert.match(ts, /for \(const i of range\(0, 3, 1\)\) \{/);
  assert.match(ts, /await this\.wait\(0\.1\)/);
});

test("mob.animate.shift(RIGHT) and dotted method camelCasing pass through", () => {
  const py =
    "class S(Scene):\n    def construct(self):\n" +
    "        self.play(sq.animate.shift(RIGHT))\n" +
    "        c.set_fill(RED, opacity=0.3)";
  const ts = convert(py);
  assert.match(ts, /sq\.animate\.shift\(RIGHT\)/);
  assert.match(ts, /c\.setFill\(RED, \{ opacity: 0\.3 \}\)/);
});

test("raw strings r\"...\" drop the prefix and escape backslashes", () => {
  const py =
    "class S(Scene):\n    def construct(self):\n" +
    "        eq = MathTex(r\"e^{i\\pi} + 1 = 0\")\n" +
    "        also = Text(r'a\\nb')";
  const ts = convert(py);
  assert.match(ts, /new MathTex\("e\^\{i\\\\pi\} \+ 1 = 0"\)/);
  // \n inside a raw string is literal backslash+n, not a newline -- must stay escaped.
  assert.match(ts, /new Text\('a\\\\nb'\)/);
});

test("enumerate() emits a generator helper and converts for i, x in enumerate(...)", () => {
  const py =
    "class S(Scene):\n    def construct(self):\n" +
    "        for i, d in enumerate(dots):\n            self.play(d.animate.set_color(RED))";
  const ts = convert(py);
  assert.match(ts, /function\* enumerate/);
  assert.match(ts, /for \(const \[i, d\] of enumerate\(dots\)\) \{/);
});

test("top-level def gets `function` keyword; call site matches the camelCased name", () => {
  const py =
    "def helper_positions(n):\n    return n * 2\n\n" +
    "class S(Scene):\n    def construct(self):\n        positions = helper_positions(4)";
  const ts = convert(py);
  assert.match(ts, /function helperPositions\(n\) \{/);
  assert.match(ts, /const positions = helperPositions\(4\)/);
  // The method-shorthand form (no `function` keyword) must still be used for
  // an actual method with the same name pattern, inside a class.
  const py2 = "class S(Scene):\n    def do_thing(self):\n        pass";
  const ts2 = convert(py2);
  assert.match(ts2, /doThing\(\) \{/);
  assert.doesNotMatch(ts2, /function doThing/);
});

test("CLI: node bin/py2ts.ts converts a file to stdout", () => {
  const inFile = join(tmpdir(), `py2ts_${process.pid}.py`);
  writeFileSync(
    inFile,
    "from manim import *\n\nclass Cli(Scene):\n    def construct(self):\n        self.play(Create(Circle(radius=2, color=RED)), run_time=2)\n        self.wait(0.5)\n",
  );
  try {
    const out = execFileSync("node", [CLI, inFile], { encoding: "utf8" });
    assert.match(out, /class Cli extends Scene \{/);
    assert.match(out, /async construct\(\) \{/);
    assert.match(out, /await this\.play\(new Create\(new Circle\(\{ radius: 2, color: RED \}\)\)/);
    assert.match(out, /_playConfig: true/);
    assert.match(out, /await this\.wait\(0\.5\)/);
  } finally {
    rmSync(inFile, { force: true });
  }
});
