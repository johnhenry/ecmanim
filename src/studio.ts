// ecmanim/studio — a live-preview dev server (file-watch → browser hot-reload of
// your Scene in a <manim-player>) plus a schema→props-controls helper for a
// props panel, a pointer-driven interactive camera (pan/zoom/orbit/pick), and
// the <manim-chart> custom element. Import from "ecmanim/studio". The dev
// server is Node-only; everything else is browser-safe (import-time only —
// see the Node-safety notes in interactive.ts/chart_element.ts).

export { startStudio, buildStudioHarness } from "./studio/dev_server.ts";
export type { StudioOptions, StudioHandle } from "./studio/dev_server.ts";

export { schemaToControls } from "./studio/props.ts";
export type { PropControl } from "./studio/props.ts";

export { attachInteractiveCamera, pickAt } from "./studio/interactive.ts";
export type { InteractiveCameraOptions, InteractiveCameraHandle, PickResult } from "./studio/interactive.ts";

export { ManimChartElement, defineManimChart } from "./studio/chart_element.ts";
export type { ChartGraphBuilder } from "./studio/chart_element.ts";
