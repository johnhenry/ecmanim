// A scene file for the CLI: exports a Scene subclass instead of self-rendering.
//   manim-js render examples/hello-scene.js -q low -o examples/out/hello.mp4
import { Scene, Circle, Text, Create, Write, GrowFromCenter, BLUE, YELLOW } from "../src/index.js";

export default class HelloScene extends Scene {
  async construct() {
    const t = new Text("Hello, manim-js", { fontSize: 0.8, color: YELLOW });
    await this.play(new Write(t));
    const c = new Circle({ radius: 1.5, color: BLUE, fillColor: BLUE, fillOpacity: 0.4, point: [0, -2, 0] });
    await this.play(new GrowFromCenter(c));
    await this.wait(0.3);
  }
}
