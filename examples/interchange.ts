// Interchange + watermark: render a scene with a burned-in watermark, export the
// timeline as .otio, and export a shape as a Lottie animation.
// Run: node examples/interchange.ts
//   -> examples/out/interchange.mp4 (+ .otio.json, + .lottie.json)

import { writeFileSync, mkdirSync } from "node:fs";
import {
  render, RegularPolygon, Create, Rotating,
  vmobjectToLottieJSON, sceneToOtioString, DEGREES, TEAL,
} from "../src/node.ts";

mkdirSync("examples/out", { recursive: true });

let capturedScene: any = null;
const hexagon = new RegularPolygon(6, { radius: 1.6, color: TEAL, fillColor: TEAL, fillOpacity: 0.4 });

const r = await render(
  async (scene: any) => {
    capturedScene = scene;
    scene.nextSection("draw");
    await scene.play(new Create(hexagon), { _playConfig: true, runTime: 0.8 });
    scene.nextSection("spin");
    await scene.play(new Rotating(hexagon, { radians: 120 * DEGREES }), { _playConfig: true, runTime: 1.0 });
  },
  {
    output: "examples/out/interchange.mp4",
    style: "midnight",
    quality: "low",
    watermark: { text: "@ecmanim", position: "bottom-right", opacity: 0.7 },
  },
);

// Editorial timeline (opens in Resolve/Premiere/FCPXML via OTIO adapters).
writeFileSync("examples/out/interchange.otio.json", sceneToOtioString(capturedScene, { name: "interchange", mediaUrl: "interchange.mp4" }));

// The hexagon as a Lottie animation (plays in any Lottie player).
writeFileSync("examples/out/interchange.lottie.json", JSON.stringify(vmobjectToLottieJSON(hexagon, { width: 512, height: 512 })));

console.log(`Wrote interchange.mp4 (watermarked, ${r.sections?.length ?? 0} sections), .otio.json, and .lottie.json`);
