// Gallery: a runnable, end-to-end showcase that exercises many subsystems in a
// single multi-part scene and renders it to examples/out/gallery.mp4 at low
// quality. It is the "does the whole stack survive a real render" smoke test.
//
//   node examples/gallery.ts
//
// Sections:
//   1. Write a MathTex title.
//   2. Create an Axes + plot + Riemann rectangles.
//   3. FadeIn a Matrix and a Brace.
//   4. Reveal a boolean Union.
//   5. A short 3D section (Sphere + Tetrahedron) with a camera move.
//
// ThreeDScene extends Scene, so the 2D sections work unchanged; the final
// section switches the camera into 3D and orbits it.

import {
  render, ThreeDScene, ThreeDCamera,
  Axes, Matrix, Brace, MathTex, Square, Circle,
  Union, Sphere, Tetrahedron,
  Create, Write, FadeIn, FadeOut, DrawBorderThenFill,
  DEGREES, BLUE, YELLOW, GREEN, RED, TEAL, PI,
} from "../src/node.ts";

class Gallery extends ThreeDScene {
  async construct() {
    // --- 1. Title (MathTex) ------------------------------------------------
    const title = new MathTex("\\int_0^4 x^2\\,dx", { color: YELLOW });
    title.scale(1.4).moveTo([0, 2.6, 0]);
    await this.play(new Write(title));

    // --- 2. Axes + plot + Riemann rectangles -------------------------------
    const axes = new Axes({ xRange: [0, 4, 1], yRange: [0, 16, 4], xLength: 5, yLength: 3.5 });
    axes.moveTo([-3, -0.5, 0]);
    const graph = axes.plot((x: number) => x * x, { xRange: [0, 4], color: BLUE });
    const rects = axes.getRiemannRectangles(graph, { dx: 0.5, inputSampleType: "center", fillOpacity: 0.6 });
    await this.play(new Create(axes));
    await this.play(new Create(graph));
    await this.play(new Create(rects));

    // --- 3. Matrix + Brace (FadeIn) ---------------------------------------
    const matrix = new Matrix([[1, 2], [3, 4]]);
    matrix.moveTo([3, 1.4, 0]);
    const brace = new Brace(matrix, { direction: [0, -1, 0] });
    await this.play(new FadeIn(matrix), new FadeIn(brace));

    // --- 4. Boolean Union --------------------------------------------------
    const a = new Circle({ radius: 0.8, color: TEAL, fillColor: TEAL, fillOpacity: 0.5 });
    const b = new Circle({ radius: 0.8, color: GREEN, fillColor: GREEN, fillOpacity: 0.5 }).shift([0.7, 0, 0]);
    const union = new Union(a, b);
    union.setColor(GREEN).moveTo([3, -1.8, 0]);
    await this.play(new DrawBorderThenFill(union));
    await this.wait(0.2);

    // Clear the 2D stage before the 3D section.
    await this.play(new FadeOut(title), new FadeOut(axes), new FadeOut(graph),
      new FadeOut(rects), new FadeOut(matrix), new FadeOut(brace), new FadeOut(union));

    // --- 5. 3D section: Sphere + Tetrahedron + camera move ----------------
    this.setCameraOrientation({ phi: 70 * DEGREES, theta: -90 * DEGREES });
    const sphere = new Sphere();
    sphere.scale(1.2).shift([-1.5, 0, 0]);
    const tet = new Tetrahedron({ edgeLength: 2 });
    tet.shift([1.5, 0, 0]);
    await this.play(new FadeIn(sphere), new Create(tet));
    await this.moveCamera({ theta: 30 * DEGREES, phi: 55 * DEGREES }, { runTime: 1.5 });
    await this.wait(0.2);
  }
}

const result = await render(Gallery, {
  output: "examples/out/gallery.mp4",
  quality: "low",
  background: "#0d1117",
  camera: new ThreeDCamera({ phi: 70 * DEGREES, theta: -90 * DEGREES }),
  verbose: false,
});

console.log(
  `GALLERY OK: rendered ${result.frames} frames @ ${result.fps}fps ` +
  `(${result.pixelWidth}x${result.pixelHeight}) -> ${result.output}`,
);
