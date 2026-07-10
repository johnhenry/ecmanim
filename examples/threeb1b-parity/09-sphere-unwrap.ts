// Recreation of the sphere-unwrap visual ("But why is a sphere's surface
// area four times its shadow?", 3b1b, 2018): a sphere built from N thin
// horizontal rings is orbited by the camera, then each ring peels off and
// flattens into a rectangle strip; the strips stack into the lens-shaped
// profile of total area 4*pi*r^2, compared against 4 unit circles.
// CPU z-buffer 3D (projection camera + painter sort) — no GPU.
// Recreation of the visual, not a code port.

import {
  ThreeDScene, ThreeDCamera, Surface, Circle, Text, VGroup,
  FadeIn, UpdateFromAlphaFunc,
  DEGREES, PI, BLUE_D, BLUE_E, YELLOW, WHITE, GRAY,
} from "../../src/node.ts";
import { demoRender, BG } from "./_run.ts";

const R = 1;        // unit sphere -> the comparison circles are unit circles
const N = 12;       // horizontal rings
const FLAT_CY = 1.0; // y-center of the flattened stack

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// Sphere band parameterization (u = polar angle from +z, v = azimuth).
const sphereP = (u: number, v: number): number[] => [
  R * Math.sin(u) * Math.cos(v),
  R * Math.sin(u) * Math.sin(v),
  R * Math.cos(u),
];

// Ring i flattened: a rectangle strip of width 2*pi*R*sin(uMid_i) (the
// ring's circumference) and height R*du (its arc length), stacked by
// latitude so the strips tile the sinusoidal "lens" of area 4*pi*R^2.
function flatP(i: number): (u: number, v: number) => number[] {
  const uMid = ((i + 0.5) * PI) / N;
  const halfW = R * Math.sin(uMid);
  return (u, v) => [halfW * (v - PI), FLAT_CY + R * (PI / 2 - u), 0];
}

// Lerp between the sphere band and the flat strip.
function morphP(i: number, a: number): (u: number, v: number) => number[] {
  const flat = flatP(i);
  return (u, v) => {
    const s = sphereP(u, v);
    const f = flat(u, v);
    return [s[0] + (f[0] - s[0]) * a, s[1] + (f[1] - s[1]) * a, s[2] + (f[2] - s[2]) * a];
  };
}

class SphereUnwrap extends ThreeDScene {
  async construct() {
    // Beat 1: the ringed sphere, camera orbiting.
    this.setCameraOrientation({ phi: 70 * DEGREES, theta: -115 * DEGREES, zoom: 2.1 });
    const rings: Surface[] = [];
    for (let i = 0; i < N; i++) {
      const ring = new Surface((u, v) => sphereP(u, v), {
        uRange: [(i * PI) / N, ((i + 1) * PI) / N],
        vRange: [0, 2 * PI],
        resolution: [2, 24],
        fillColor: i % 2 === 0 ? BLUE_D : BLUE_E,
        strokeWidth: 0.3,
        strokeColor: "#00000030",
      });
      rings.push(ring);
    }
    await this.play(...rings.map((r) => new FadeIn(r)), { _playConfig: true, runTime: 1.2 });
    await this.moveCamera({ theta: -35 * DEGREES }, { runTime: 3 });
    await this.wait(0.3);

    // Beat 2: peel + flatten. Each ring's parameterization lerps from
    // sphere band to flat strip (Surface.setFunc per frame), staggered from
    // the pole down, while the camera swings to a top-down view.
    const S = 1.5; // stagger spread: ring i starts after i/(N-1) * S/(1+S) of the sweep
    const peels = rings.map((ring, i) =>
      new UpdateFromAlphaFunc(ring, (_m: any, a: number) => {
        const local = clamp01(a * (1 + S) - (S * i) / (N - 1));
        ring.setFunc(morphP(i, local));
      }, { runTime: 5 }));
    await this.moveCamera({ phi: 0, theta: -90 * DEGREES, zoom: 1.0 },
      { runTime: 5, addedAnims: peels });
    await this.wait(0.5);

    // Beat 3: comparison — 4 unit circles, each of area pi*r^2.
    const circles = new VGroup();
    for (let k = 0; k < 4; k++) {
      const c = new Circle({ radius: R, strokeColor: YELLOW, strokeWidth: 3, fillOpacity: 0 });
      c.moveTo([-4.65 + k * 3.1, -2.55, 0]);
      const lbl = new Text("πr²", { fontSize: 0.38, color: YELLOW });
      lbl.moveTo(c.getCenter());
      circles.add(c, lbl);
    }
    const total = new Text("sphere area = 4πr²", { fontSize: 0.42, color: WHITE });
    total.moveTo([3.7, 2.9, 0]);
    const stackLbl = new Text("unrolled rings", { fontSize: 0.34, color: GRAY });
    stackLbl.moveTo([-4.6, 2.9, 0]);
    await this.play(new FadeIn(circles), new FadeIn(stackLbl), { _playConfig: true, runTime: 1.2 });
    await this.play(new FadeIn(total), { _playConfig: true, runTime: 0.8 });
    await this.wait(2);
  }
}

// NOTE: the ThreeDCamera must be passed to render() directly — ThreeDScene's
// own camera upgrade replaces scene.camera AFTER the renderer has already
// bound the original 2D Camera instance (render() constructs CanvasRenderer
// with options.camera before makeScene runs), so without this the scene
// renders with no 3D projection at all (src bug; examples/surfaces.ts uses
// the same workaround).
await demoRender(SphereUnwrap, import.meta.url, {
  // background must be set ON the camera here: render() only applies its
  // `background` option to a camera it constructs itself, and a passed-in
  // camera instance already defaulted to "#000000".
  camera: new ThreeDCamera({ phi: 70 * DEGREES, theta: -115 * DEGREES, zoom: 2.1, background: BG }),
});
