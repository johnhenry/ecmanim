// p5.js parity demo 11: ref/11-perlin-terrain.js — "A hilly terrain drawn in
// gray against a black sky," the `noise()` function's own official JSDoc
// example (from the p5.js core library repo, not the examples site -- see
// ref/README.md's substitution note: no 3D terrain-mesh example exists
// anywhere in the official p5.js corpus). The ref itself is a minimal 2D
// noise(nx)-sampled vertical-line skyline silhouette, not a 3D mesh.
//
// Per this campaign's brief, this port goes beyond the ref's literal 2D
// content toward "Perlin terrain" in the fuller 3D sense the pattern name
// implies (p5's own famous terrain demos -- e.g. the WEBGL noise-terrain
// sketch that inspired the pattern -- ARE 3D height-mapped meshes): a
// `Surface` whose height at each (x, y) grid point samples fractal Brownian
// motion (`fbm`, 5 octaves) over seeded `simplex2D` noise, colored by
// elevation (low = dark earth, mid = green, high = snow-capped), viewed
// obliquely with a slow ambient camera rotation so the 3D relief reads
// clearly. THIS DEMO'S DELIVERED SCOPE IS THE 3D SURFACE, not the ref's 2D
// silhouette -- documented here per the campaign's honesty convention.
//
// Determinism: fbm/simplex2D are seeded (seed=11) and sampled as a pure
// function of (x, y); no Math.random(), no wall-clock reads.

import { ThreeDScene, ThreeDAxes, Surface, DEGREES, Color, fbm, simplex2D } from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const SEED = 11;
const noise2D = simplex2D(SEED);
const terrainNoise = fbm(noise2D, { octaves: 5, lacunarity: 2, gain: 0.5 });

const NOISE_SCALE = 0.35;
const HEIGHT_SCALE = 1.6;

function heightAt(x: number, y: number): number {
  return terrainNoise(x * NOISE_SCALE, y * NOISE_SCALE) * HEIGHT_SCALE;
}

const LOW = new Color(0.18, 0.14, 0.08); // dark earth/brown
const MID = new Color(0.24, 0.45, 0.2); // hillside green
const HIGH = new Color(0.92, 0.94, 0.96); // snow-capped peak

function elevationColor(z: number) {
  const t = Math.min(1, Math.max(0, (z + HEIGHT_SCALE) / (2 * HEIGHT_SCALE)));
  return t < 0.6 ? Color.lerp(LOW, MID, t / 0.6) : Color.lerp(MID, HIGH, (t - 0.6) / 0.4);
}

class PerlinTerrain extends ThreeDScene {
  async construct() {
    this.setCameraOrientation({ phi: 65 * DEGREES, theta: -55 * DEGREES });

    const terrain = new Surface(
      (u: number, v: number) => [u, v, heightAt(u, v)],
      {
        uRange: [-4, 4],
        vRange: [-4, 4],
        resolution: [32, 32],
        colorFunc: (_u: number, _v: number, point: number[]) => elevationColor(point[2]),
        strokeWidth: 0,
      },
    );

    const axes = new ThreeDAxes({ xRange: [-4, 4], yRange: [-4, 4], zRange: [-2, 2] });
    this.add(axes, terrain);

    // Slow ambient orbit so the 3D relief is unmistakable across the clip.
    this.beginAmbientCameraRotation({ rate: 0.15 });
    await this.wait(6);
  }
}

await demoRender(PerlinTerrain, import.meta.url);
