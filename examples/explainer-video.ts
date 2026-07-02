// The dogfood test: a short explainer about ecmanim, made BY the ecmanim
// explainer format. Narration pacing comes from the voiceover system (silent
// provider by default — set OPENAI_API_KEY or install espeak-ng and pass
// tts: "openai" / "system" for spoken narration).
// Run: node examples/explainer-video.ts  ->  examples/out/ecmanim-explainer.mp4

import { runFormat, manimRenderProvider } from "../src/authoring.ts";

const res = await runFormat("explainer", {
  params: {
    title: "ecmanim",
    subtitle: "code → animation, in TypeScript",
    sections: [
      {
        heading: "One Scene, three renderers",
        bullets: [
          "Node: MP4 / WebM / GIF via ffmpeg",
          "Browser: live canvas + WebM export",
          "WebGL: Three.js, same Scene code",
        ],
        narration:
          "You write one Scene. ecmanim renders it headlessly in Node, live on a browser canvas, or on the GPU through Three.js.",
      },
      {
        heading: "Animation as code",
        bullets: [
          "play, Transform, Create, 60+ animations",
          "content-hash caching skips unchanged segments",
        ],
        diagram: "S[Scene] --> R[Renderer]\nR --> V[Video]",
        narration:
          "Scenes are code: play animations, transform shapes, and re-render instantly — unchanged segments are cached by content hash.",
      },
      {
        heading: "Batteries included",
        bullets: [
          "voiceover + captions + audio-reactive FFT",
          "physics, diagrams, charts, LaTeX",
          "OTIO / Lottie interchange",
        ],
        narration:
          "Narration, captions, physics, charts, LaTeX, and timeline interchange ship in the box.",
      },
    ],
    outro: "github.com/johnhenry/ecmanim",
    // Prefer OpenAI TTS when a key is present, else local espeak-ng ("system");
    // resolveTTSProvider falls back to "silent" if neither is available.
    tts: process.env.OPENAI_API_KEY ? "openai" : "system",
    renderOptions: {
      output: "examples/out/ecmanim-explainer.mp4",
      quality: "medium",
      verbose: true,
    },
  },
  providers: { render: manimRenderProvider },
});

console.log("done:", res.output?.output ?? res.output);
