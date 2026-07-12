// Golden-frame regression checks for the 33 CI-representative parity-campaign
// demos (see golden-parity-demos.ts). Unlike snapshot.test.ts, this never
// renders anything itself -- it only compares an ALREADY-RENDERED demo's mp4
// against a committed golden frame, and skips (not fails) any demo that
// hasn't been rendered yet. That keeps this test fast and side-effect-free
// for `npm test`'s default run (most demos aren't rendered on a fresh
// clone -- see examples/gallery/README.md), while giving CI's demo-smoke
// job (which DOES render these exact demos) a real fidelity check to run
// right after rendering.
//
//   npm run test:golden-parity                          # check whatever's rendered
//   GOLDEN_PARITY_SUITE=d3-parity npm run test:golden-parity   # one suite only (what CI's matrix uses)
//   UPDATE_SNAPSHOTS=1 npm run test:golden-parity        # (re)generate goldens for whatever's rendered
//
// See test/golden/parity/README.md for the tolerance rationale and the
// regeneration procedure if a locally-baselined golden drifts once CI (a
// different font stack) actually renders it.

import { test } from "node:test";
import assert from "node:assert";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { matchParitySnapshot } from "./_parity_snapshot_util.ts";
import { GOLDEN_PARITY_DEMOS } from "./golden-parity-demos.ts";
import { loadNapiCanvas } from "./_snapshot_util.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = join(HERE, "..", "examples");

const canvasAvailable = await loadNapiCanvas().then((m) => !!m);
const suiteFilter = process.env.GOLDEN_PARITY_SUITE;
const demos = suiteFilter ? GOLDEN_PARITY_DEMOS.filter((d) => d.suite === suiteFilter) : GOLDEN_PARITY_DEMOS;

if (suiteFilter && demos.length === 0) {
  throw new Error(`GOLDEN_PARITY_SUITE="${suiteFilter}" matched no demos in golden-parity-demos.ts`);
}

for (const { suite, demo } of demos) {
  const name = `${suite}/${demo}`;
  const mp4Path = join(EXAMPLES_DIR, suite, "out", `${demo}.mp4`);
  const rendered = existsSync(mp4Path);
  test(
    `golden-parity: ${name}`,
    { skip: !canvasAvailable ? "@napi-rs/canvas not available" : !rendered && "not rendered yet -- npm run gallery:render-missing" },
    async () => {
      const result = await matchParitySnapshot(name, mp4Path);
      if (result.status === "fail") assert.fail(result.message);
    },
  );
}
