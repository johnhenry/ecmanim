// Video metadata: render a scene with sections, then emit schema.org VideoObject
// (JSON-LD) and a IIIF Presentation 3.0 manifest — chapters come from
// nextSection(). Run: node examples/metadata.ts
//   -> examples/out/metadata.mp4
//   -> examples/out/metadata.videoobject.json   (schema.org JSON-LD)
//   -> examples/out/metadata.iiif.json           (IIIF manifest)

import { writeFileSync, mkdirSync } from "node:fs";
import {
  render, Scene, Circle, Square, Text, Create, Transform, Write, FadeOut,
  toVideoObject, toIIIFManifest, BLUE, GREEN, YELLOW,
} from "../src/node.ts";

class Chaptered extends Scene {
  async construct() {
    this.nextSection("Title");
    const title = new Text("Chapters", { fontSize: 0.9, color: YELLOW, point: [0, 2.6, 0] });
    await this.play(new Write(title), { _playConfig: true, runTime: 0.6 });

    this.nextSection("Shapes");
    const c = new Circle({ radius: 1.3, color: BLUE, fillColor: BLUE, fillOpacity: 0.5 });
    await this.play(new Create(c), { _playConfig: true, runTime: 0.6 });

    this.nextSection("Transform");
    await this.play(new Transform(c, new Square({ sideLength: 2.2, color: GREEN })), { _playConfig: true, runTime: 0.6 });
    await this.wait(0.3);
  }
}

mkdirSync("examples/out", { recursive: true });
const r = await render(Chaptered, {
  output: "examples/out/metadata.mp4",
  quality: "medium",
  fps: 30,
  background: "#0d1117",
});

const input = {
  frames: r.frames,
  fps: r.fps,
  width: r.pixelWidth,
  height: r.pixelHeight,
  sections: r.sections,
  id: "https://example.org/manim/chapters",
  contentUrl: "https://example.org/manim/chapters.mp4",
  name: "Chapters demo",
  description: "A manim-js scene whose nextSection() boundaries become chapters.",
  uploadDate: "2026-07-02",
  encodingFormat: "video/mp4",
  provenance: true,
};

writeFileSync("examples/out/metadata.videoobject.json", JSON.stringify(toVideoObject(input), null, 2));
writeFileSync("examples/out/metadata.iiif.json", JSON.stringify(toIIIFManifest(input), null, 2));

console.log(
  `Wrote metadata.mp4 (${r.frames} frames), metadata.videoobject.json, and ` +
  `metadata.iiif.json with ${r.sections.length} chapters from nextSection().`,
);
