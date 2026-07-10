// Shared harness for the Lottie parity demos: each demo loads a corpus
// animation (data/*.json — lottie-web MIT demos — or an authored fixture
// from fixtures/), plays it deterministically, and renders to video.
//
//   ECMANIM_DEMO_QUALITY=low|medium|high   (default medium)

import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { render } from "../../src/node.ts";
import type { RenderOptions } from "../../src/node.ts";

export const DEMO_QUALITY = process.env.ECMANIM_DEMO_QUALITY ?? "medium";

export function loadAnimationJson(name: string): any {
  const dir = name.endsWith(".fixture.json") || name.startsWith("fixtures/") ? "." : "data";
  const path = new URL(`./${dir}/${name.replace(/^fixtures\//, "fixtures/")}`, import.meta.url).pathname;
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
