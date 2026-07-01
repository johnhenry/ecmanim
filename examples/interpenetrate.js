// Interpenetrating surfaces: a sphere poking through a flat plane. Per-face
// painter sorting can't resolve this (a face is partly in front, partly behind);
// the per-pixel z-buffer does. Render both ways to see the difference.
// Run: node examples/interpenetrate.js -> examples/out/interpenetrate_{zbuffer,painter}.mp4
import {
  render, ThreeDScene, ThreeDCamera, Sphere, Surface, FadeIn,
  DEGREES, RED, BLUE_D,
} from "../src/node.js";

class Cross extends ThreeDScene {
  async construct() {
    this.setCameraOrientation({ phi: 68 * DEGREES, theta: -75 * DEGREES });
    const plane = new Surface((u, v) => [u, v, 0], {
      uRange: [-2.6, 2.6], vRange: [-2.6, 2.6], resolution: [26, 26],
      fillColor: BLUE_D, checkerboardColors: ["#2C7DA0", "#1C5A78"], strokeWidth: 0,
    });
    const ball = new Sphere({ radius: 1.6, fillColor: RED, resolution: [24, 48], strokeWidth: 0 });
    this.add(plane, ball);
    await this.wait(0.1);
    await this.moveCamera({ theta: 30 * DEGREES }, { runTime: 3 });
  }
}

const base = { quality: "medium", background: "#0d1117" };
await render(Cross, {
  ...base,
  output: "examples/out/interpenetrate_zbuffer.mp4",
  camera: new ThreeDCamera({ phi: 68 * DEGREES, theta: -75 * DEGREES }),
});
// Same scene, z-buffer disabled -> falls back to per-face painter sorting.
const painterCam = new ThreeDCamera({ phi: 68 * DEGREES, theta: -75 * DEGREES });
painterCam.disableZBuffer = true;
await render(Cross, {
  ...base,
  output: "examples/out/interpenetrate_painter.mp4",
  camera: painterCam,
});
