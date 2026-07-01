// 3D via a projection camera (no WebGL) — renders headlessly to MP4 like manim's
// Cairo 3D. Run: node examples/threed.js -> examples/out/threed.mp4
import {
  render, ThreeDScene, ThreeDCamera, ThreeDAxes, Square, Circle, VGroup,
  Create, FadeIn, DEGREES, BLUE, YELLOW, RED, GREEN, PI,
} from "../src/node.js";

class Space extends ThreeDScene {
  async construct() {
    this.setCameraOrientation({ phi: 70 * DEGREES, theta: -90 * DEGREES });

    const axes = new ThreeDAxes({ xRange: [-4, 4], yRange: [-4, 4], zRange: [-3, 3] });
    await this.play(new Create(axes), { _playConfig: true, runTime: 1.5 });

    // A square in the xy-plane and a circle standing up in the xz-plane.
    const flat = new Square({ sideLength: 2.5, color: BLUE, fillColor: BLUE, fillOpacity: 0.4 });
    const standing = new Circle({ radius: 1.4, color: YELLOW, fillColor: YELLOW, fillOpacity: 0.35 });
    standing.rotate(PI / 2, { axis: [1, 0, 0] }); // rotate into the xz-plane
    await this.play(new FadeIn(flat), new FadeIn(standing));

    // Orbit the camera around the scene.
    await this.moveCamera({ theta: 20 * DEGREES, phi: 60 * DEGREES }, { runTime: 3 });
    await this.moveCamera({ theta: 120 * DEGREES }, { runTime: 3 });
    await this.wait(0.4);
  }
}

await render(Space, {
  output: "examples/out/threed.mp4",
  quality: "medium",
  background: "#0d1117",
  camera: new ThreeDCamera({ phi: 70 * DEGREES, theta: -90 * DEGREES }),
});
