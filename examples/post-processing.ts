// GPU post-processing example (music-visuals flavored): bloom + film grain +
// a custom scanline shader pass, rendered via the headless-Chrome WebGL
// backend. Demonstrates src/renderer/three_post.ts's PostProcessingConfig
// threaded through renderGL -> browser-three record() -> EffectComposer.
//
// Requirements match examples/render-gl.ts: `npm run build` first, plus a
// CDP-accessible Chrome (MANIM_CDP_URL or http://localhost:9222).
//
// Run: node --experimental-strip-types examples/post-processing.ts
//   -> examples/out/post-processing.mp4

import { renderGL } from "../src/node.ts";
import { probeCDP } from "../src/renderer/cdp.ts";

const cdpUrl = process.env.MANIM_CDP_URL ?? "http://localhost:9222";

if (!(await probeCDP(cdpUrl))) {
  console.log(
    `No CDP-accessible Chrome at ${cdpUrl}; the GL renderer needs one. Skipping.`,
  );
  process.exit(0);
}

// A subtle CRT-scanline pass: darkens alternating lines, drifting over time.
// The shader samples tDiffuse (the composed frame); uTime and uResolution are
// auto-provided by three_post because the source references them.
const SCANLINES = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uTime;
uniform vec2 uResolution;
void main() {
  vec4 color = texture2D(tDiffuse, vUv);
  float line = sin((vUv.y * uResolution.y + uTime * 24.0) * 3.14159);
  color.rgb *= 0.92 + 0.08 * line * line;
  gl_FragColor = color;
}
`;

const res = await renderGL({
  sceneModule: "examples/scenes/gl-demo-scene.ts",
  sceneExport: "default",
  root: process.cwd(),
  cdpUrl,
  output: "examples/out/post-processing.mp4",
  format: "mp4",
  quality: "medium",
  fps: 30,
  postProcessing: {
    bloom: { strength: 1.2, radius: 0.5, threshold: 0.3 },
    film: { intensity: 0.25 },
    custom: [{ fragmentShader: SCANLINES }],
  },
});

console.log(`rendered ${res.output} (${res.bytes} bytes) with bloom + grain + scanlines`);
