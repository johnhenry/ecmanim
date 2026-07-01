// LaTeX math as real Bezier glyphs: Write traces the strokes, then we morph
// one equation into another. Run: node examples/mathtex.js -> examples/out/mathtex.mp4
import {
  render, Scene, MathTex, Write, Transform, FadeIn, Create, Text,
  WHITE, YELLOW, BLUE, TEAL,
} from "../src/node.ts";

class MathScene extends Scene {
  async construct() {
    const euler = new MathTex("e^{i\\pi} + 1 = 0", { fontSize: 1.6, color: WHITE });
    euler.shift([0, 1, 0]);
    await this.play(new Write(euler), { _playConfig: true, runTime: 2.5 });

    const gauss = new MathTex("\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}", { fontSize: 1.3, color: TEAL });
    gauss.shift([0, -1.2, 0]);
    await this.play(new Write(gauss), { _playConfig: true, runTime: 2.5 });
    await this.wait(0.4);

    const integral = new MathTex("\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}", { fontSize: 1.3, color: YELLOW });
    integral.shift([0, -1.2, 0]);
    await this.play(new Transform(gauss, integral), { _playConfig: true, runTime: 2 });
    await this.wait(0.6);
  }
}

await render(MathScene, {
  output: "examples/out/mathtex.mp4",
  quality: "medium",
  background: "#0d1117",
});
