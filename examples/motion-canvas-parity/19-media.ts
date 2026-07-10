// Port of Motion Canvas docs: media (ref/media-1.tsx + media-2.tsx +
// media-3.tsx) as one three-beat scene: a static <Img>, an <Img> scale +
// absoluteRotation tween, and a <Video>. The doc's example.png/example.mp4
// assets are synthesized at demo start into out/_gen/ (a gradient+checker
// PNG via @napi-rs/canvas; an ffmpeg testsrc clip). Honest divergences:
// MC's <Video> sits on its first frame unless .play() is called — ecmanim's
// VideoMobject advances with scene time, so the clip plays here; MC's
// scale={2} is baked into the image size (tweenTo tracks relative scale);
// and media-2's absoluteRotation(90) beat is OMITTED: the canvas renderer
// draws ImageMobject into its corner AABB (no rotated-quad path), so a
// rotation renders as an axis-aligned stretch, not a turn.

import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Scene, imageMobject, loadVideo, tweenTo } from "../../src/node.ts";
import { demoRender, pxLen } from "./_run.ts";

const GEN = new URL("./out/_gen/", import.meta.url).pathname;
mkdirSync(GEN, { recursive: true });
const PNG = GEN + "example.png";
const MP4 = GEN + "example.mp4";
if (!existsSync(PNG)) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const c = createCanvas(320, 240);
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 320, 240);
  grad.addColorStop(0, "#e13238");
  grad.addColorStop(1, "#e6a700");
  g.fillStyle = grad;
  g.fillRect(0, 0, 320, 240);
  g.fillStyle = "rgba(255,255,255,0.35)";
  for (let y = 0; y < 6; y++)
    for (let x = y % 2; x < 8; x += 2) g.fillRect(x * 40, y * 40, 40, 40);
  writeFileSync(PNG, c.toBuffer("image/png"));
}
if (!existsSync(MP4)) {
  spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=30",
    "-pix_fmt", "yuv420p", "-y", MP4,
  ]);
}

class Media extends Scene {
  async construct() {
    // --- media-1: view.add(<Img src={examplePng} />); (natural size)
    const img = await imageMobject(PNG, { width: pxLen(320) });
    this.add(img);
    await this.wait(1);
    this.remove(img);

    // --- media-2: <Img src scale={2}/> + all(scale(2.5).to(2), absoluteRotation(90).to(0))
    const imageRef = await imageMobject(PNG, { width: pxLen(320) * 2 }); // scale={2}
    this.add(imageRef);
    await this.play(
      // 2 -> 2.5 -> 2 relative to the baked-in x2 size.
      tweenTo(imageRef, { scale: 1.25 }, 1.5).to({ scale: 1 }, 1.5),
      // (absoluteRotation(90, 1.5).to(0, 1.5) omitted — see header note.)
    );
    this.remove(imageRef);

    // --- media-3: view.add(<Video src={exampleMp4} />); (plays as time advances)
    const video = await loadVideo(MP4, { width: pxLen(320), fps: this.fps, scene: this });
    this.add(video);
    await this.wait(2);
  }
}

await demoRender(Media, import.meta.url);
