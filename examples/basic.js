// A first end-to-end example: draw shapes, create them, transform, fade.
// Run: node examples/basic.js   ->   examples/out/basic.mp4

import {
  render, Scene, Circle, Square, Text, Create, Transform, FadeOut, Write,
  Shift, BLUE, YELLOW, RED, GREEN, UP, DOWN, LEFT, RIGHT, PI,
} from "../src/node.js";

class BasicScene extends Scene {
  async construct() {
    const title = new Text("manim-js", { fontSize: 1, color: YELLOW, point: [0, 3, 0] });
    await this.play(new Write(title));

    const circle = new Circle({ radius: 1.5, color: BLUE, fillColor: BLUE, fillOpacity: 0.5 });
    circle.moveTo(LEFT.map((x) => x * 3));
    await this.play(new Create(circle));

    const square = new Square({ sideLength: 2.4, color: GREEN, fillColor: GREEN, fillOpacity: 0.5 });
    square.moveTo([3, 0, 0]);
    await this.play(new Create(square));

    await this.play(new Transform(circle, square.copy().moveTo([-3, 0, 0]).setColor(RED)));
    await this.play(Shift(square, [0, 1.5, 0]), Shift(circle, [0, -1.5, 0]));
    await this.wait(0.5);
    await this.play(new FadeOut(circle), new FadeOut(square), new FadeOut(title));
  }
}

await render(BasicScene, {
  output: "examples/out/basic.mp4",
  quality: "medium",
  background: "#0d1117",
});
