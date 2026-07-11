// Shared harness for the ECharts parity demos: each demo recreates one
// ECharts gallery example (raw source in ./ref/) on ecmanim's chart mobjects
// (RadarChart/GaugeChart/FunnelChart/Candlestick/PieChart+roseType/Legend/
// ColorBar, or the D3-campaign Axes/BarChart/hierarchy/sankey/force layer
// when an example reuses that machinery directly — see ref/README.md's
// per-example verdict).
//
//   ECMANIM_DEMO_QUALITY=low|medium|high   (default medium)

import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { render } from "../../src/node.ts";
import type { RenderOptions } from "../../src/node.ts";

export const DEMO_QUALITY = process.env.ECMANIM_DEMO_QUALITY ?? "medium";

export function loadJson(name: string): any {
  const path = new URL(`./ref/data/${name}`, import.meta.url).pathname;
  return JSON.parse(readFileSync(path, "utf8"));
}

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
    background: "#ffffff",
    ...options,
    output,
  });
  console.log(`✓ ${basename(output)} (${((Date.now() - t0) / 1000).toFixed(1)}s @ ${(options as any).quality ?? DEMO_QUALITY})`);
}
