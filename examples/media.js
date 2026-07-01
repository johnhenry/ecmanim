// ImageMobject, SVGMobject, and sound. The image fades in, the SVG logo is
// drawn with Write, and two tones play at scheduled times — muxed into the MP4.
// Run: node examples/media.js  ->  examples/out/media.mp4 (with audio)
import {
  render, Scene, imageMobject, loadSVG, Text, FadeIn, Write, Create,
  YELLOW, WHITE,
} from "../src/node.js";

class Media extends Scene {
  async construct() {
    const title = new Text("ImageMobject · SVGMobject · sound", { fontSize: 0.5, color: YELLOW, point: [0, 3, 0] });
    await this.play(new Write(title));

    const img = await imageMobject("examples/assets/test.png", { height: 3, point: [-3.2, -0.3, 0] });
    this.addSound("examples/assets/tone.wav"); // at current time
    await this.play(new FadeIn(img));

    const logo = await loadSVG("examples/assets/logo.svg", { height: 3.4, point: [3.2, -0.3, 0] });
    this.addSound("examples/assets/tone.wav", { gain: 0.6 });
    await this.play(new Write(logo), { _playConfig: true, runTime: 2 });
    await this.wait(0.5);
  }
}

await render(Media, {
  output: "examples/out/media.mp4",
  quality: "medium",
  background: "#0d1117",
});
