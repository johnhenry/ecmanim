// top-level mobjects' own point counts ("Code:0" for every Code), so the
// equal-length holds here collide in the partial-movie cache and replay the
// first hold's frames (same library bug noted in 07-transitions.ts).

import { Code, Scene, createSignal, edit, insert, remove } from "../../src/node.ts";
import { demoRender, px, pxLen } from "./_run.ts";

class IndexGallery extends Scene {
  async construct() {
    // --- ref/index-2.tsx: the minimal static snippet ---
    const simple = new Code("const number = 7;", {
      fontSize: pxLen(28),
      lineNumbers: false,
    });
    this.add(simple);
    await this.wait(1);
    this.remove(simple);

    // --- ref/index-1.tsx: animated edits + selection ---
    let code = new Code("const number = 7;", {
      fontSize: pxLen(28),
      lineNumbers: false,
    });
    // offsetX={-1} x={-400}: left edge anchored at -400px, vertically centered.
    code.shift([px(-400)[0] - (code.getCenter()[0] - code.getWidth() / 2), 0, 0]);
    this.add(code);

    await this.wait(0.6);
    // all(code.replace(findFirstRange('number'), 'variable'),
    //     code.prepend`function example() {`, code.append`}`) — one edit:
    {
      const { animation, target } = code.edit(0.6)`${insert("function example() {\n  ")}const ${edit("number", "variable")} = 7;${insert("\n}")}`;
      await this.play(animation);
      this.remove(code, target.codeTokens.submobjects);
      this.add(target);
      code = target;
    }

    await this.wait(0.6);
    await this.play(code.selection(code.findFirstRange("variable")!, 0.6));

    await this.wait(0.6);
    // all(code().code('const number = 7;', 0.6), code().selection(DEFAULT, 0.6))
    {
      const { animation, target } = code.edit(0.6)`${remove("function example() {\n  ")}const ${edit("variable", "number")} = 7;${remove("\n}")}`;
      await this.play(code.selection(null, 0.6), animation);
      this.remove(code, target.codeTokens.submobjects);
      this.add(target);
      code = target;
    }
    await this.wait(0.6);
    this.remove(code);

    // --- ref/index-3.tsx: signals do NOT re-render an already-built Code ---
    const nameSignal = createSignal("number");
    const snippet = new Code(`const ${nameSignal()} = 7;`, {
      fontSize: pxLen(28),
      lineNumbers: false,
    });
    this.add(snippet);

    await this.wait(1);
    nameSignal("newValue");
    // The code snippet still displays "number" instead of "newValue".
    await this.wait(1);
  }
}

await demoRender(IndexGallery, import.meta.url);
