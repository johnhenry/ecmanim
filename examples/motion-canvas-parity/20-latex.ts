// Port of Motion Canvas docs: Latex (ref/latex-2.tsx + ref/latex-1.tsx) —
// a static Pythagorean formula, then the animated tex morphs: y=ax^2 grows
// a +bx term, gets wrapped in \left( ... \over 1 \right), and collapses
// back. MC's `tex().tex(newStr, 1)` (with {{...}} match groups) maps to
// matchTex(old, newStr) -> {animation, target}: play the animation, keep
// using target. ecmanim `fontSize` is the expression HEIGHT in world units,
// counts, and a MathTex keeps all geometry in nested submobjects — so every
// "0.2s hold over one MathTex" hashes identically and later holds would
// reuse the first hold's frames (second suspected library bug).

import { Scene, MathTex, matchTex, parseTexGroups } from "../../src/node.ts";
import type { MatchTexResult } from "../../src/node.ts";
import { demoRender, pxLen } from "./_run.ts";

class LatexScenes extends Scene {
  private swap(old: MathTex, step: MatchTexResult): MathTex {
    this.remove(old);
    for (const p of step.target.parts) this.remove(p);
    this.add(step.target);
    return step.target;
  }

  async construct() {
    // --- ref/latex-2.tsx: static formula ---
    const pythagoras = new MathTex("a^2 + b^2 = c^2", {
      // Try editing the formula below:
      color: "white",
      fontSize: pxLen(32),
    });
    this.add(pythagoras);
    await this.wait(0.6);
    this.remove(pythagoras);

    // --- ref/latex-1.tsx: animated tex swaps ---
    const initial = parseTexGroups("{{y=}}{{a}}{{x^2}}");
    let tex = new MathTex(initial.tex, {
      substringsToIsolate: initial.isolate,
      color: "white",
    });
    this.add(tex);

    await this.wait(0.2);
    let step = matchTex(tex, "{{y=}}{{a}}{{x^2}} + {{bx}}", { runTime: 1 });
    await this.play(step.animation);
    tex = this.swap(tex, step);
    await this.wait(0.2);
    step = matchTex(
      tex,
      "{{y=}}{{\\left(}}{{a}}{{x^2}} + {{bx}}{{\\over 1}}{{\\right)}}",
      { runTime: 1 },
    );
    await this.play(step.animation);
    tex = this.swap(tex, step);
    await this.wait(0.2);
    step = matchTex(tex, "{{y=}}{{a}}{{x^2}}", { runTime: 1 });
    await this.play(step.animation);
    tex = this.swap(tex, step);
    await this.wait(0.2);
  }
}

await demoRender(LatexScenes, import.meta.url, { mathTex: true, });
