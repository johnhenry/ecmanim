// Proves glyph-path text morphing: VText glyphs are real Bezier VMobjects, so
// Write traces their outlines and Transform morphs a letter into a shape.
// Run: node examples/morph.js  ->  examples/out/morph.mp4

import {
  render, Scene, VText, Circle, Square, Write, Create, Transform, FadeOut,
  YELLOW, BLUE, RED, GREEN,
} from "../src/node.js";

class MorphScene extends Scene {
  async construct() {
    const word = new VText("Bézier", { fontSize: 1.6, color: YELLOW, strokeWidth: 3, fillOpacity: 0 });
    word.center().shift([0, 1.2, 0]);
    // Write traces the actual glyph outlines.
    await this.play(new Write(word), { _playConfig: true, runTime: 2.5 });
    await this.play(word.animate.setStyle({ fillColor: YELLOW, fillOpacity: 1 }));

    // Morph a single glyph ("B") into a circle, another into a square.
    const B = word.submobjects[0];
    const target1 = new Circle({ radius: 0.8, color: BLUE, fillColor: BLUE, fillOpacity: 0.6 }).moveTo([-3, -1.5, 0]);
    const target2 = new Square({ sideLength: 1.4, color: GREEN, fillColor: GREEN, fillOpacity: 0.6 }).moveTo([3, -1.5, 0]);
    const z = word.submobjects[word.submobjects.length - 1];
    await this.play(new Transform(B, target1), new Transform(z, target2), { _playConfig: true, runTime: 2 });
    await this.wait(0.5);
    await this.play(new FadeOut(word));
  }
}

await render(MorphScene, {
  output: "examples/out/morph.mp4",
  quality: "medium",
  background: "#0d1117",
});
