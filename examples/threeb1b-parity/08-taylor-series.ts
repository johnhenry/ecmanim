// Recreation of the "Taylor series" visual (3b1b, 2017): sin(x) on axes,
// with successive Taylor polynomials P1, P3, ... P13 morphing into each
// other and hugging the curve further out, while the series formula grows
// one term per degree. Recreation of the visual, not a code port.

import {
  Scene, Axes, MathTex, Text, VMobject, Transform, Create, FadeIn, Write,
  matchTex,
  WHITE, GRAY, RED, ORANGE, YELLOW, GREEN, TEAL, BLUE, PURPLE,
} from "../../src/node.ts";
import { demoRender } from "./_run.ts";

// P_n(x) = sum_{m=0..(n-1)/2} (-1)^m x^(2m+1) / (2m+1)!
function taylorSin(deg: number): (x: number) => number {
  const coeffs: number[] = [];
  let fact = 1;
  for (let k = 1; k <= deg; k++) {
    fact *= k;
    if (k % 2 === 1) coeffs.push(((k - 1) / 2) % 2 === 0 ? 1 / fact : -1 / fact);
  }
  return (x: number) => {
    let y = 0, xp = x;
    for (const c of coeffs) { y += c * xp; xp *= x * x; }
    return y;
  };
}

const DEGREES_SHOWN = [1, 3, 5, 7, 9, 11, 13];
const COLORS = [RED, ORANGE, YELLOW, GREEN, TEAL, BLUE, PURPLE];
// One formula term per degree; each is its own isolated substring at every
// step so TransformMatchingTex pairs old terms and fades only the new one in.
// NOTE two ecmanim bugs worked around here:
//  1. matchTex's {{...}} group syntax (parseTexGroups) uses a non-greedy
//     regex, so any group ENDING in '}' (every \frac term; x^{11} corrupts
//     the tex outright) loses its closing brace -> countGlyphs throws on the
//     unbalanced key -> MathTex falls back to a single part and the whole
//     formula FadeOut/FadeIns each step. Workaround: pass plain tex +
//     explicit substringsToIsolate (no {{...}}).
//  2. MathTex normalizes overall size, so adding \frac terms (taller box)
//     shrinks every glyph. Workaround: rescale each target so the head
//     part keeps a constant width.
const HEAD = "\\sin(x) \\approx x";
const TERMS = [
  "- \\frac{x^3}{3!}", "+ \\frac{x^5}{5!}", "- \\frac{x^7}{7!}",
  "+ \\frac{x^9}{9!}", "- \\frac{x^{11}}{11!}", "+ \\frac{x^{13}}{13!}",
];
const YCAP = 4.4; // data-space clamp: drop samples once |P_n| runs away

class TaylorSeries extends Scene {
  async construct() {
    const axes = new Axes({
      xRange: [-7, 7, 1], yRange: [-3, 3, 1],
      xLength: 13, yLength: 5.2,
      axisConfig: { color: GRAY, strokeWidth: 1.5 },
      tips: false,
    });
    axes.shift([0, -0.55, 0]);
    const sinGraph = axes.plot((x) => Math.sin(x), { color: WHITE });
    (sinGraph as any).strokeWidth = 3;
    const sinLabel = new Text("sin(x)", { fontSize: 0.4, color: WHITE });
    sinLabel.moveTo([-5.6, 1.0, 0]);
    await this.play(new FadeIn(axes), new Create(sinGraph, { runTime: 1.5 }), new FadeIn(sinLabel),
      { _playConfig: true });

    // Degree 1: P1 = x, and the formula "sin(x) ~ x".
    const capped = (deg: number) => {
      const f = taylorSin(deg);
      return (x: number) => { const y = f(x); return Math.abs(y) > YCAP ? NaN : y; };
    };
    const curve = axes.plot(capped(1), { color: COLORS[0] });
    (curve as any).strokeWidth = 3;
    let formula = new MathTex(HEAD, { color: WHITE });
    const HEAD_W = formula.getWidth() * 0.68; // constant head size across steps
    formula.scale(0.68).moveTo([0, 3.4, 0]);
    await this.play(new Create(curve, { runTime: 1 }), new Write(formula), { _playConfig: true });
    await this.wait(0.6);

    // Degrees 3..13: curve Transforms into the next polynomial while the
    // matching new term fades into the formula (old terms Transform-pair).
    let texSoFar = HEAD;
    for (let i = 1; i < DEGREES_SHOWN.length; i++) {
      const deg = DEGREES_SHOWN[i];
      texSoFar += " " + TERMS[i - 1];
      const next = axes.plot(capped(deg), { color: COLORS[i] });
      (next as any).strokeWidth = 3;
      const matched = matchTex(formula, texSoFar,
        { substringsToIsolate: [HEAD, ...TERMS.slice(0, i)] });
      const t: any = matched.target;
      t.scale(HEAD_W / t.parts[0].getWidth()).moveTo([0, 3.4, 0]);
      await this.play(new Transform(curve, next), matched.animation,
        { _playConfig: true, runTime: 1.4 });
      formula = matched.target;
      await this.wait(0.5);
    }
    await this.wait(1.8);
  }
}

await demoRender(TaylorSeries, import.meta.url, { mathTex: true });
