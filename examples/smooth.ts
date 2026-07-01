// Smooth (Gouraud) vs flat shading. Left sphere interpolates per-vertex lighting
// across each face (no facets); right sphere is flat-shaded per quad.
// Run: node examples/smooth.js -> examples/out/smooth.mp4
import {
  render, ThreeDScene, ThreeDCamera, Sphere, Torus, FadeIn,
  DEGREES, RED, TEAL,
} from "../src/node.ts";

class Smooth extends ThreeDScene {
  async construct() {
    this.setCameraOrientation({ phi: 72 * DEGREES, theta: -90 * DEGREES });
    // No grid strokes so the shading itself is visible.
    const smooth = new Sphere({ radius: 1.4, fillColor: RED, resolution: [16, 32], strokeWidth: 0, smooth: true })
      .moveTo([-2.2, 0, 0]);
    const flat = new Sphere({ radius: 1.4, fillColor: RED, resolution: [16, 32], strokeWidth: 0, smooth: false })
      .moveTo([2.2, 0, 0]);
    const torus = new Torus({ majorRadius: 1.1, minorRadius: 0.45, fillColor: TEAL, resolution: [32, 16], strokeWidth: 0, smooth: true })
      .moveTo([0, 0, 2.4]);
    this.add(smooth, flat, torus);
    await this.wait(0.1);
    await this.moveCamera({ theta: 30 * DEGREES }, { runTime: 3 });
  }
}

await render(Smooth, {
  output: "examples/out/smooth.mp4",
  quality: "medium",
  background: "#0d1117",
  camera: new ThreeDCamera({ phi: 72 * DEGREES, theta: -90 * DEGREES }),
});
