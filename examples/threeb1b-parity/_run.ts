// Shared harness for the 3Blue1Brown-canon recreations (see CANON.md:
// recreations of the visuals, NOT code ports; math visuals only).
//
//   ECMANIM_DEMO_QUALITY=low|medium|high   (default medium)
//
// House style: 3b1b's near-black blue background, manim's color families
// (BLUE/GREEN/RED/YELLOW already in the palette), MathTex where formulas
// appear (pass { mathTex: true }).

import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { render, initMathTex } from "../../src/node.ts";
import type { RenderOptions } from "../../src/node.ts";

export const DEMO_QUALITY = process.env.ECMANIM_DEMO_QUALITY ?? "medium";

/** 3b1b's characteristic near-black blue. */
export const BG = "#171d23";

export function demoOut(metaUrl: string, suffix = ""): string {
  const name = basename(fileURLToPath(metaUrl)).replace(/\.ts$/, "");
  return new URL(`./out/${name}${suffix}.mp4`, import.meta.url).pathname;
}

export async function demoRender(
  sceneOrConstruct: any,
  metaUrl: string,
  options: RenderOptions & { mathTex?: boolean } = {},
): Promise<void> {
  const { mathTex, ...renderOptions } = options;
  if (mathTex) await initMathTex();
  const output = renderOptions.output ?? demoOut(metaUrl);
  const t0 = Date.now();
  await render(sceneOrConstruct, {
    quality: DEMO_QUALITY,
    verbose: false,
    background: BG,
    ...renderOptions,
    output,
  });
  console.log(`✓ ${basename(output)} (${((Date.now() - t0) / 1000).toFixed(1)}s @ ${(renderOptions as any).quality ?? DEMO_QUALITY})`);
}
