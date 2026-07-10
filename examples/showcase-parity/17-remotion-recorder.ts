// Showcase parity: Remotion Recorder — the COMPOSITING half of a screen-
// recorder studio: screen capture + webcam bubble + captions, with animated
// layout switches (PiP corner <-> split view). Actual device capture is
// explicitly out of scope — the "screen" is a rendered clip (same two-stage
// pipeline as 07) and the "webcam" is a live avatar in a circular bubble.

import { existsSync, mkdirSync } from "node:fs";
import {
  render, loadVideo, Scene, VGroup, VMobject, RoundedRectangle, Circle, Rectangle, Text,
  FadeIn, FadeOut, createTikTokStyleCaptions, WordCaptionTrack,
} from "../../src/node.ts";
import type { Caption } from "../../src/node.ts";
import { demoRender, DEMO_QUALITY } from "./_run.ts";

const GEN_DIR = new URL("./out/_gen/", import.meta.url).pathname;
mkdirSync(GEN_DIR, { recursive: true });
const SCREEN_MP4 = `${GEN_DIR}recorder-screen.mp4`;

class FakeTerminal extends Scene {
  async construct() {
    this.add(new RoundedRectangle({ width: 11, height: 6.4, cornerRadius: 0.25, color: "#14181D", fillOpacity: 1, strokeWidth: 0 }));
    const lines = ["$ npm create ecmanim@latest", "✓ scaffolded my-video", "$ npm run render", "rendering 240 frames..."];
    for (let i = 0; i < lines.length; i++) {
      const t = new Text(lines[i], { fontSize: 0.36, color: i % 2 ? "#83C167" : "#F5F6F8" });
      t.moveTo([-4.9 + t.getWidth() / 2, 2.2 - i * 0.9, 0]);
      await this.play(new FadeIn(t), { runTime: 0.35 });
      await this.wait(0.55);
    }
    await this.wait(0.8);
  }
}

if (!existsSync(SCREEN_MP4)) {
  await render(FakeTerminal, { output: SCREEN_MP4, quality: DEMO_QUALITY, fps: 20, verbose: false, background: "#0B0E12" });
  console.log("✓ stage 1: fake screen clip generated");
}
const screen = await loadVideo(SCREEN_MP4, { fps: 20, width: 9.6 });

// A live "webcam": simple avatar whose mouth animates while speaking.
function makeAvatar(): { bubble: VGroup; mouth: VMobject } {
  const ring = new Circle({ radius: 1.02, color: "#58C4DD", fillOpacity: 0, strokeWidth: 5 });
  const face = new Circle({ radius: 0.95, color: "#2A2F36", fillOpacity: 1, strokeWidth: 0 });
  const head = new Circle({ radius: 0.34, color: "#E8C39E", fillOpacity: 1, strokeWidth: 0, point: [0, 0.28, 0] });
  const body = new Rectangle({ width: 0.85, height: 0.5, color: "#4A6FA5", fillOpacity: 1, strokeWidth: 0, point: [0, -0.42, 0] });
  const mouth = new Rectangle({ width: 0.16, height: 0.05, color: "#7A4A3A", fillOpacity: 1, strokeWidth: 0, point: [0, 0.16, 0] }) as unknown as VMobject;
  const bubble = new VGroup(face, body, head, mouth, ring);
  return { bubble, mouth };
}

const WORDS: Array<[string, number, number]> = [
  ["Record", 400, 800], [" your", 800, 1100], [" screen", 1100, 1600],
  ["Then", 2400, 2700], [" switch", 2700, 3100], [" layouts", 3100, 3700], [" live", 3700, 4200],
];
const captions: Caption[] = WORDS.map(([text, startMs, endMs]) => ({ text, startMs, endMs, timestampMs: startMs, confidence: null }));
const { pages } = createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds: 500 });

class Recorder extends Scene {
  async construct() {
    // Start: split layout — screen left, webcam right.
    screen.moveTo([-1.6, 0.5, 0]).scale(0.72);
    const { bubble, mouth } = makeAvatar();
    bubble.moveTo([4.6, 0.5, 0]);
    let clock = 0;
    mouth.addUpdater((m: any, dt: number) => {
      clock += dt;
      const talk = 0.05 + 0.16 * Math.abs(Math.sin(clock * 11));
      const [cx, cy] = [bubble.getCenter()[0], bubble.getCenter()[1] + 0.16 * (bubble.getHeight() / 2.04)];
      const s = bubble.getHeight() / 2.04;
      m.points = [
        [cx - 0.08 * s, cy + talk * s / 2, 0], [cx + 0.08 * s, cy + talk * s / 2, 0],
        [cx + 0.08 * s, cy - talk * s / 2, 0], [cx - 0.08 * s, cy - talk * s / 2, 0],
      ];
      m.subpathStarts = [0];
    });

    const track = new WordCaptionTrack(pages, {
      fontSize: 0.44, point: [0, -3.1, 0], color: "#FFFFFF",
      highlight: { color: "#58C4DD", scale: 1.15, futureOpacity: 0.4 },
    });

    await this.play(new FadeIn(screen), new FadeIn(bubble), { runTime: 0.6 });
    this.add(track);
    await this.wait(1.4);

    // Layout switch: webcam shrinks into a PiP corner, screen goes full.
    await this.play(
      screen.animate.scale(1 / 0.72 * 0.9).moveTo([0, 0.4, 0]),
      bubble.animate.scale(0.62).moveTo([5.2, -2.2, 0]),
      { runTime: 0.9 },
    );
    await this.wait(1.6);

    // And back to an even split.
    await this.play(
      screen.animate.scale(1 / 0.9 * 0.72).moveTo([-1.6, 0.5, 0]),
      bubble.animate.scale(1 / 0.62).moveTo([4.6, 0.5, 0]),
      { runTime: 0.9 },
    );
    await this.wait(1.2);
    await this.play(new FadeOut(screen), new FadeOut(bubble), new FadeOut(track), { runTime: 0.7 });
  }
}

await demoRender(Recorder, import.meta.url, { background: "#101318" });
