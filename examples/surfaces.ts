// 3D surfaces: a shaded sphere, a torus, a cube, and a parametric saddle, with
// the camera orbiting so painter depth-sorting and Lambertian shading show.
// Run: node examples/surfaces.js -> examples/out/surfaces.mp4
import {
  render, ThreeDScene, ThreeDCamera, ThreeDAxes,
  Sphere, Torus, Cube, Surface, Create, FadeIn,
  DEGREES, PI, BLUE, RED, GREEN, YELLOW,
} from "../src/node.ts";

class Surfaces extends ThreeDScene {
  async construct() {
    this.setCameraOrientation({ phi: 65 * DEGREES, theta: -90 * DEGREES });

    const sphere = new Sphere({ radius: 1.2, fillColor: BLUE }).moveTo([-3, 0, 0]);
    const torus = new Torus({ majorRadius: 1.1, minorRadius: 0.4, fillColor: RED }).moveTo([3, 0, 0]);
    const cube = new Cube({ sideLength: 1.6, fillColor: GREEN }).moveTo([0, 3, 0]);

    // A saddle z = 0.4(x^2 - y^2) over a uv grid.
    const saddle = new Surface(
      (u, v) => [u, v, 0.4 * (u * u - v * v)],
      { uRange: [-2, 2], vRange: [-2, 2], resolution: [24, 24], checkerboardColors: ["#F0AC5F", "#8C5A20"] },
    ).moveTo([0, -3, 0]);

    await this.play(new FadeIn(sphere), new FadeIn(torus), new FadeIn(cube), new FadeIn(saddle),
      { _playConfig: true, runTime: 1.5 });

    await this.moveCamera({ theta: 30 * DEGREES, phi: 60 * DEGREES }, { runTime: 4 });
    await this.moveCamera({ theta: 150 * DEGREES }, { runTime: 4 });
    await this.wait(0.3);
  }
}

await render(Surfaces, {
  output: "examples/out/surfaces.mp4",
  quality: "medium",
  background: "#0d1117",
  camera: new ThreeDCamera({ phi: 65 * DEGREES, theta: -90 * DEGREES }),
});
