// Voiceover-synced narration with bookmarks. Uses the "silent" provider (no API
// key needed) so it runs anywhere — swap `provider` for "system" (macOS `say` /
// Linux espeak) or "openai"/"elevenlabs" (with an API key) for real speech.
// Run: node examples/voiceover.ts  ->  examples/out/voiceover.mp4

import {
  render, voiceover, Scene, Circle, Square, Text, Create, FadeIn, Write, Transform,
  BLUE, GREEN, YELLOW,
} from "../src/node.ts";

class Narrated extends Scene {
  async construct() {
    const title = new Text("ecmanim", { fontSize: 0.9, color: YELLOW, point: [0, 3, 0] });
    const circle = new Circle({ radius: 1.3, color: BLUE, fillColor: BLUE, fillOpacity: 0.5 });
    circle.moveTo([-3, 0, 0]);
    const square = new Square({ sideLength: 2.2, color: GREEN, fillColor: GREEN, fillOpacity: 0.5 });
    square.moveTo([3, 0, 0]);

    await voiceover(
      this,
      "Welcome. <bookmark mark='circle'/> First a circle appears, " +
      "<bookmark mark='square'/> then it becomes a square.",
      async (vt) => {
        await this.play(new Write(title), { _playConfig: true, runTime: 0.6 });
        await vt.waitUntilBookmark("circle");
        await this.play(new Create(circle), { _playConfig: true, runTime: 0.6 });
        await vt.waitUntilBookmark("square");
        await this.play(new Transform(circle, square.copy().moveTo([-3, 0, 0])), { _playConfig: true, runTime: 0.8 });
      },
      { provider: "silent" }, // -> "system" | "openai" | "elevenlabs" for real speech
    );
    await this.wait(0.3);
  }
}

await render(Narrated, {
  output: "examples/out/voiceover.mp4",
  style: "3b1b-dark",
  quality: "low",
  fps: 15,
});

console.log("Wrote examples/out/voiceover.mp4 (narration muxed; bookmarks synced the animations)");
