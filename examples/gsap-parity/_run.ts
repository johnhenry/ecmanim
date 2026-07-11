// Shared harness for the GSAP pattern demos: each demo recreates one GSAP
// pattern (brief in ./ref/) on ecmanim's animation primitives. Deliberately
// does NOT override `background` — render()'s default is black (#000000,
// src/node.ts), and Text defaults to WHITE fill, so leaving the default
// alone sidesteps the invisible-text-on-white-background class of bug the
// ECharts campaign hit repeatedly (see examples/echarts-parity/README.md).
//
//   ECMANIM_DEMO_QUALITY=low|medium|high   (default medium)

import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "../../src/node.ts";
import type { RenderOptions } from "../../src/node.ts";

export const DEMO_QUALITY = process.env.ECMANIM_DEMO_QUALITY ?? "medium";

export function demoOut(metaUrl: string, suffix = ""): string {
  const name = basename(fileURLToPath(metaUrl)).replace(/\.ts$/, "");
  return new URL(`./out/${name}${suffix}.mp4`, import.meta.url).pathname;
}

export async function demoRender(
  sceneOrConstruct: any,
  metaUrl: string,
  options: RenderOptions = {},
): Promise<void> {
  const output = options.output ?? demoOut(metaUrl);
  const t0 = Date.now();
  await render(sceneOrConstruct, {
    quality: DEMO_QUALITY,
    verbose: false,
    ...options,
    output,
  });
  console.log(`✓ ${basename(output)} (${((Date.now() - t0) / 1000).toFixed(1)}s @ ${(options as any).quality ?? DEMO_QUALITY})`);
}
