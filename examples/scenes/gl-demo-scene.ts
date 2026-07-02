// A browser-importable scene for the headless GPU render (examples/render-gl.ts).
// It imports from "ecmanim/browser-three" (the WebGL backend) because it is
// loaded and executed inside the headless Chrome page, not in Node. The
// renderGL harness maps that specifier to the built dist/browser-three.js.

import {
  Scene, Sphere, Torus, Create, Rotating, FadeIn,
  ThreeDCamera, BLUE, TEAL, DEGREES,
} from "ecmanim/browser-three";

export default class GLDemo extends Scene {
  async construct() {
    const sphere = new Sphere({ radius: 1.3, color: BLUE, fillOpacity: 0.9 });
    sphere.moveTo([-1.6, 0, 0]);
    const torus = new Torus({ majorRadius: 1.1, minorRadius: 0.4, color: TEAL, fillOpacity: 0.9 });
    torus.moveTo([1.8, 0, 0]);

    await this.play(new FadeIn(sphere), new Create(torus), { _playConfig: true, runTime: 0.6 });
    await this.play(new Rotating(torus, { axis: [1, 1, 0], radians: 120 * DEGREES }), { _playConfig: true, runTime: 0.8 });
  }
}

// A tilted 3D camera so the depth/lighting is visible.
export const camera = new ThreeDCamera({ phi: 65 * DEGREES, theta: -45 * DEGREES });
