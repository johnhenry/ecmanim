// A minimal shared shape satisfied by every renderer backend
// (CanvasRenderer/ThreeRenderer/SVGRenderer), each of which already has its
// own differently-named public render method (renderScene/render/
// renderToString respectively) used across 15+ call sites and re-exported as
// public package API -- renaming any of them for cosmetic consistency would
// be a real breaking change for near-zero benefit. `renderFrame()` is an
// additive, purely delegating method on each class instead; every existing
// call site is unaffected.
import type { Mobject } from "../mobject/Mobject.ts";

export interface SceneRenderer {
  renderFrame(mobjects: Mobject[]): void | string;
}
