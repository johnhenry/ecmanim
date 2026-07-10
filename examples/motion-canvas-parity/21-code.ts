// Port of Motion Canvas docs: CodeBlock (ref/composite-code.tsx) — a tsx
// segment hash can't see, so identical-length holds would reuse frames.

import { Scene, Code, insert, lines } from "../../src/node.ts";
import { demoRender } from "./_run.ts";

class CompositeCode extends Scene {
  private swap(old: Code, target: Code): Code {
    this.remove(old);
    this.remove(...target.codeTokens.submobjects); // FadeIn-ed loose tokens
    this.add(target);
    return target;
  }

  async construct() {
    let code = new Code(`var myBool;`, { language: "tsx", lineNumbers: false });
    this.add(code);
    await this.wait(0.5);

    // duration of 1.2 seconds
    const { animation, target } = code.edit(1.2)`var myBool${insert(" = true")};`;
    await this.play(animation);
    code = this.swap(code, target);
    await this.wait(0.5);

    // select a range to call attention to it
    await this.play(code.selection(lines(0), 0.6));
    await this.wait(0.5);
  }
}

await demoRender(CompositeCode, import.meta.url);
