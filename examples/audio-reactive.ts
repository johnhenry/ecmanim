// Audio-reactive bars + captions. Synthesizes a short noise clip, decodes it,
// drives a spectrum bar visualizer per frame from visualizeAudio(), overlays a
// caption track, and muxes the audio. Run: node examples/audio-reactive.ts
//   -> examples/out/audio-reactive.mp4

import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import {
  render, Scene, Rectangle, VGroup, alwaysRedraw,
  getAudioData, visualizeAudio, parseSrt, CaptionTrack, TEAL, YELLOW,
} from "../src/node.ts";

mkdirSync("examples/out", { recursive: true });
const CLIP = "examples/out/_audio-clip.wav";
if (!existsSync(CLIP)) {
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi",
    "-i", "anoisesrc=d=3:c=pink:r=44100", "-ac", "1", "-y", CLIP]);
}

const FPS = 30;
const N = 32;

const CAPTIONS = parseSrt(`1
00:00:00,200 --> 00:00:01,400
audio-reactive bars

2
00:00:1,600 --> 00:00:2,900
driven by an FFT`);

class AudioReactive extends Scene {
  audioData: any;
  async construct() {
    this.audioData = await getAudioData(CLIP, { sampleRate: 44100, channels: 1 });

    const bars = alwaysRedraw(() => {
      const frame = Math.round(this.time * FPS);
      const spec = visualizeAudio({ audioData: this.audioData, frame, fps: FPS, numberOfSamples: N });
      const g = new VGroup();
      const width = 0.22, gap = 0.06, total = N * (width + gap);
      for (let i = 0; i < N; i++) {
        const h = 0.05 + spec[i] * 3.5;
        const bar = new Rectangle({ width, height: h, color: TEAL, fillColor: TEAL, fillOpacity: 0.9 });
        bar.moveTo([-total / 2 + i * (width + gap), -1.5 + h / 2, 0]);
        g.add(bar);
      }
      return g;
    });
    this.add(bars);

    const caption = new CaptionTrack(CAPTIONS, { color: YELLOW, fontSize: 0.5, point: [0, 3, 0] });
    this.add(caption);

    this.addSound(CLIP, { timeOffset: 0 });
    await this.wait(Math.min(3, this.audioData.durationInSeconds));
  }
}

await render(AudioReactive, {
  output: "examples/out/audio-reactive.mp4",
  fps: FPS,
  style: "midnight",
  quality: "low",
});

console.log("Wrote examples/out/audio-reactive.mp4");
