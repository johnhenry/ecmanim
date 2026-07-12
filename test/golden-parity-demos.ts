// The set of demos golden-parity.test.ts checks. Deliberately the SAME 33
// demos already used by .github/workflows/ci.yml's demo-smoke matrix (one
// suite per job, 3 demos each) -- that selection is already a considered
// sample across each campaign's feature surface, and CI already renders
// these exact demos, so piggybacking keeps this test's baseline aligned
// with what CI actually produces instead of introducing a second,
// independently-drifting demo list. If ci.yml's matrix changes, mirror the
// change here too (no shared source of truth between YAML and TS at the
// moment -- see the roadmap note in ci.yml about consolidating once there
// are more suites).

export interface ParityDemoRef {
  suite: string;
  demo: string; // filename without extension
}

export const GOLDEN_PARITY_DEMOS: ParityDemoRef[] = [
  { suite: "showcase-parity", demo: "01-hackreels" },
  { suite: "showcase-parity", demo: "09-submagic" },
  { suite: "showcase-parity", demo: "13-electricity-maps" },
  { suite: "manim-parity", demo: "02-BraceAnnotation" },
  { suite: "manim-parity", demo: "16-GraphAreaPlot" },
  { suite: "manim-parity", demo: "25-ThreeDSurfacePlot" },
  { suite: "motion-canvas-parity", demo: "01-quickstart" },
  { suite: "motion-canvas-parity", demo: "06-camera" },
  { suite: "motion-canvas-parity", demo: "21-code" },
  { suite: "d3-parity", demo: "11-treemap" },
  { suite: "d3-parity", demo: "16-force-directed-graph" },
  { suite: "d3-parity", demo: "06-bar-chart-race" },
  { suite: "threeb1b-parity", demo: "01-fourier-epicycles" },
  { suite: "threeb1b-parity", demo: "02-linear-transformation" },
  { suite: "threeb1b-parity", demo: "08-taylor-series" },
  { suite: "mermaid-parity", demo: "01-flowchart" },
  { suite: "mermaid-parity", demo: "02-sequence" },
  { suite: "mermaid-parity", demo: "13-diagram-diff" },
  { suite: "lottie-parity", demo: "01-bodymovin" },
  { suite: "lottie-parity", demo: "02-gatin" },
  { suite: "lottie-parity", demo: "05-navidad" },
  { suite: "echarts-parity", demo: "06-gauge" },
  { suite: "echarts-parity", demo: "08-candlestick" },
  { suite: "echarts-parity", demo: "01-bar-race" },
  { suite: "gsap-parity", demo: "02-stagger-distributions" },
  { suite: "gsap-parity", demo: "04-shape-morph" },
  { suite: "gsap-parity", demo: "05-motion-path-autorotate" },
  { suite: "p5-parity", demo: "03-flocking-boids" },
  { suite: "p5-parity", demo: "05-l-system" },
  { suite: "p5-parity", demo: "06-game-of-life" },
  { suite: "reveal-slidev-parity", demo: "01-markdown-deck" },
  { suite: "reveal-slidev-parity", demo: "02-auto-animate-pair" },
  { suite: "reveal-slidev-parity", demo: "03-code-walkthrough" },
];
