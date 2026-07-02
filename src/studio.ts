// ecmanim/studio — a live-preview dev server (file-watch → browser hot-reload of
// your Scene in a <manim-player>) plus a schema→props-controls helper for a
// props panel. Import from "ecmanim/studio". Node-only for the server.
//
// Foundation for the interactive Studio: the dev server + schema controls land
// here; checkpoint replay, mouse-camera orbit, and an in-page eval REPL build on
// this loop (the browser already provides the live canvas + input events).

export { startStudio, buildStudioHarness } from "./studio/dev_server.ts";
export type { StudioOptions, StudioHandle } from "./studio/dev_server.ts";

export { schemaToControls } from "./studio/props.ts";
export type { PropControl } from "./studio/props.ts";
